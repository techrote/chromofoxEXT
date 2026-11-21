"use strict";
const protocol = ChromoTerminalProtocol;
const $ = (id) => document.getElementById(id);
const startButton = $("start");
const stopButton = $("stop");
const profileSelect = $("profile");
const statusLabel = $("status");
const dot = $("dot");
const term = new Terminal({
  cursorBlink: true,
  fontFamily: '"Cascadia Mono","Consolas",monospace',
  fontSize: 15,
  lineHeight: 1.16,
  scrollback: 5000,
  theme: { background: "#10141d", foreground: "#e4e9f0", cursor: "#8ab4ff", selectionBackground: "#405476" }
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
let running = false;
let pending = false;
let encoder = new TextEncoder();
let decoder = new TextDecoder("utf-8");
let ui = browser.runtime.connect({ name: "terminal" });

function setStatus(label, state = "idle") {
  statusLabel.textContent = label;
  dot.dataset.state = state;
}
function updateButtons() {
  startButton.disabled = pending || running;
  stopButton.disabled = !pending && !running;
  profileSelect.disabled = pending || running;
}
function size() {
  fit.fit();
  return {
    cols: Math.max(20, Math.min(500, term.cols)),
    rows: Math.max(5, Math.min(250, term.rows))
  };
}
function send(m) {
  try { ui.postMessage(m); return true; } catch (_) {
    setStatus("Extension connection lost — reload this tab", "error");
    return false;
  }
}
function finish(label, level = "idle") {
  running = false;
  pending = false;
  updateButtons();
  setStatus(label, level);
}
function decodeB64(s) {
  const raw = atob(s);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return decoder.decode(bytes, { stream: true });
}
function received(m) {
  if (!m || typeof m.type !== "string") return;
  switch (m.type) {
    case "started":
      pending = false;
      running = true;
      updateButtons();
      setStatus("Connected · " + profileSelect.selectedOptions[0].textContent, "ok");
      term.focus();
      break;
    case "data":
      if (typeof m.data !== "string") return;
      try {
        const text = decodeB64(m.data);
        if (text) term.write(text, () => send({ type: "ack" }));
        else send({ type: "ack" });
      } catch (_) {
        finish("Terminal output decode error", "error");
        send({ type: "close" });
      }
      break;
    case "exit":
      term.write(decoder.decode());
      finish("Process exited (code " + m.code + "). Press Start for a new session.", "idle");
      break;
    case "error":
      finish(m.message || "Native host error", "error");
      break;
    case "disconnected":
      if (running || pending) {
        finish((m.message || "Native host disconnected") + " · Check installation if unexpected.", "error");
      }
      break;
  }
}
ui.onMessage.addListener(received);
ui.onDisconnect.addListener(() => finish("Extension connection closed — reload the tab", "error"));

startButton.addEventListener("click", () => {
  if (running || pending) return;
  term.clear();
  decoder = new TextDecoder("utf-8");
  const profile = profileSelect.value;
  const dimensions = size();
  if (!protocol.profiles.includes(profile) || !protocol.validSize(dimensions.cols, dimensions.rows)) {
    setStatus("Unsupported shell or terminal size", "error"); return;
  }
  pending = true;
  updateButtons();
  setStatus("Connecting to Windows native host…", "pending");
  document.title = profileSelect.selectedOptions[0].textContent + " — Terminal";
  if (!send({ type: "start", profile, ...dimensions })) finish("Unable to connect", "error");
});
stopButton.addEventListener("click", () => {
  if (running || pending) {
    send({ type: "close" });
    finish("Session ended", "idle");
  }
});
term.onData((data) => {
  if (!running) return;
  // Break large pastes into small UTF-8-safe chunks under the 8 KiB host limit.
  let chunk = "";
  let byteCount = 0;
  for (const char of data) {
    const n = encoder.encode(char).length;
    if (byteCount + n > 4096) {
      send({ type: "input", data: chunk });
      chunk = "";
      byteCount = 0;
    }
    chunk += char;
    byteCount += n;
  }
  if (chunk) send({ type: "input", data: chunk });
});
const observer = new ResizeObserver(() => {
  const dimensions = size();
  if (running) send({ type: "resize", ...dimensions });
});
observer.observe($("screen"));
window.addEventListener("focus", () => { size(); });
$("copy").addEventListener("click", async () => {
  const selected = term.getSelection();
  if (!selected) return;
  try { await navigator.clipboard.writeText(selected); }
  catch (_) { setStatus("Clipboard copy was blocked by Firefox", "error"); }
});
$("paste").addEventListener("click", async () => {
  if (!running) return;
  try { term.paste(await navigator.clipboard.readText()); }
  catch (_) { setStatus("Clipboard paste was blocked by Firefox", "error"); }
});
term.attachCustomKeyEventHandler((e) => {
  if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
  if (e.code === "KeyC" && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    return false;
  }
  if (e.code === "KeyV") {
    navigator.clipboard.readText().then((s) => { if (running) term.paste(s); }).catch(() => {});
    return false;
  }
  return true;
});
size();
