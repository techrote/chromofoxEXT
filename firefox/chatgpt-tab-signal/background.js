/* Badge on the extension's toolbar icon; no browsing permissions or remote APIs. */
"use strict";

const BADGES = Object.freeze({
  idle: { text: "", color: "#727986" },
  working: { text: "…", color: "#2875d4" },
  done: { text: "✓", color: "#13855d" },
  stopped: { text: "■", color: "#7c8390" },
  error: { text: "!", color: "#c83f46" }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.kind !== "chatgpt-tab-signal/status") return;
  const tabId = sender.tab && sender.tab.id;
  if (!Number.isInteger(tabId)) return;
  const badge = BADGES[message.phase] || BADGES.idle;
  const text = message.toolbarBadge ? badge.text : "";
  // Both APIs are tab-scoped, so two ChatGPT tabs can show different states.
  return Promise.all([
    browser.action.setBadgeBackgroundColor({ tabId, color: badge.color }),
    browser.action.setBadgeText({ tabId, text })
  ]).catch(() => {});
});
