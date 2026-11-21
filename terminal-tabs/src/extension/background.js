/* Privileged, persistent Firefox background page. One native host per tab. */
"use strict";
const HOST_NAME = "com.techrote.chromofox_terminal_tabs";
const terminalURL = browser.runtime.getURL("terminal.html");
const sessions = new Map();

function ownTerminal(sender) {
  if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    const expected = new URL(terminalURL);
    // moz-extension: URLs can report an opaque ('null') origin; compare
    // protocol, host and exact path instead, not the serialized origin.
    return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname;
  } catch (_) { return false; }
}
function signal(ui, m) {
  try { ui.postMessage(m); } catch (_) { /* closed tab */ }
}
function releaseNative(s, reason) {
  const port = s.native;
  s.native = null;
  if (port) {
    try { port.postMessage({ type: "close" }); } catch (_) {}
    try { port.disconnect(); } catch (_) {}
  }
  if (reason) signal(s.ui, { type: "disconnected", message: reason });
}
function dispose(s) {
  if (s.disposed) return;
  s.disposed = true;
  if (sessions.get(s.tabId) === s) sessions.delete(s.tabId);
  releaseNative(s);
}

browser.runtime.onConnect.addListener((ui) => {
  if (ui.name !== "terminal" || !ownTerminal(ui.sender)) {
    ui.disconnect();
    return;
  }
  const tabId = ui.sender.tab.id;
  const old = sessions.get(tabId);
  if (old) dispose(old);
  const s = { tabId, ui, native: null, disposed: false };
  sessions.set(tabId, s);

  ui.onMessage.addListener((msg) => {
    if (s.disposed) return;
    if (!ChromoTerminalProtocol.validUI(msg)) {
      signal(ui, { type: "error", message: "Rejected malformed terminal request" });
      return;
    }
    if (msg.type === "start") {
      if (s.native) releaseNative(s);
      try {
        const n = browser.runtime.connectNative(HOST_NAME);
        s.native = n;
        n.onMessage.addListener((event) => {
          if (s.disposed || s.native !== n) return;
          if (!ChromoTerminalProtocol.validNative(event)) {
            signal(ui, { type: "error", message: "Invalid native host response" });
            releaseNative(s, "Host protocol error");
            return;
          }
          signal(ui, event);
        });
        n.onDisconnect.addListener(() => {
          if (s.disposed || s.native !== n) return;
          const message = browser.runtime.lastError && browser.runtime.lastError.message;
          s.native = null;
          signal(ui, { type: "disconnected", message: message || "Native host disconnected" });
        });
        n.postMessage(msg);
      } catch (e) {
        releaseNative(s);
        signal(ui, { type: "disconnected", message: e.message || "Native host unavailable" });
      }
    } else if (msg.type === "close") {
      // The UI already marks this intentional End as complete. Do not send
      // a delayed 'disconnected' event: it may arrive after a new Start and
      // incorrectly terminate the new session's pending state.
      releaseNative(s);
    } else if (s.native) {
      try { s.native.postMessage(msg); } catch (_) {
        releaseNative(s, "Unable to send to native terminal host");
      }
    }
  });
  ui.onDisconnect.addListener(() => dispose(s));
});
browser.tabs.onRemoved.addListener((tabId) => {
  const s = sessions.get(tabId);
  if (s) dispose(s);
});
