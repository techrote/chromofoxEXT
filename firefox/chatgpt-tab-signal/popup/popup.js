"use strict";

const KEYS = ["titleIndicator", "faviconIndicator", "toolbarBadge", "latchUntilVisited"];
const DEFAULTS = {
  titleIndicator: true,
  faviconIndicator: true,
  toolbarBadge: true,
  latchUntilVisited: true
};
let tabId = null;

async function queryTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tabs[0] && tabs[0].id;
  if (!Number.isInteger(tabId)) return setStatus("Unavailable", "No active tab", "idle");
  try {
    const result = await browser.tabs.sendMessage(tabId, { kind: "chatgpt-tab-signal/query" });
    const labels = { idle: "Idle", working: "Generating response", done: "Response finished", stopped: "Stopped manually", error: "Response failed" };
    setStatus(labels[result.phase] || "Idle", "Current ChatGPT tab", result.phase);
    document.getElementById("clear").disabled = !result || result.phase === "idle" || result.phase === "working";
  } catch {
    setStatus("Not a ChatGPT tab", "Open a conversation at chatgpt.com", "idle");
    document.getElementById("clear").disabled = true;
  }
}

function setStatus(label, hint, phase) {
  document.getElementById("tab-status").textContent = label;
  document.getElementById("tab-hint").textContent = hint;
  document.getElementById("status-dot").className = "dot " + (phase || "idle");
}

async function init() {
  const saved = await browser.storage.local.get(DEFAULTS);
  for (const key of KEYS) {
    const control = document.getElementById(key);
    control.checked = !!saved[key];
    control.addEventListener("change", async () => {
      await browser.storage.local.set({ [key]: control.checked });
    });
  }
  document.getElementById("clear").addEventListener("click", async () => {
    if (tabId == null) return;
    try {
      await browser.tabs.sendMessage(tabId, { kind: "chatgpt-tab-signal/query", action: "clear" });
      await queryTab();
    } catch {
      setStatus("Cannot clear status", "Reload the ChatGPT tab and try again", "error");
    }
  });
  await queryTab();
}

init().catch(error => setStatus("Extension unavailable", String(error.message || error), "error"));
