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
  const sessionId = s.activeSessionId;
  s.native = null;
  s.activeSessionId = null;
  if (port) {
    try { port.postMessage({ type: "close" }); } catch (_) {}
    try { port.disconnect(); } catch (_) {}
  }
  if (reason && sessionId !== null) {
    signal(s.ui, { type: "disconnected", sessionId, message: reason });
  }
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
  const s = { tabId, ui, native: null, disposed: false,
    activeSessionId: null, highestSessionId: 0 };
  sessions.set(tabId, s);

  ui.onMessage.addListener((msg) => {
    if (s.disposed) return;
    if (!ChromoTerminalProtocol.validUI(msg)) {
      if (s.activeSessionId !== null && msg?.sessionId === s.activeSessionId) {
        signal(ui, { type: "error", sessionId: s.activeSessionId,
          message: "Rejected malformed terminal request" });
      }
      return;
    }
    if (msg.type === "start") {
      // Reject delayed or repeated starts that could displace a newer shell.
      if (msg.sessionId <= s.highestSessionId) return;
      if (s.native) releaseNative(s);
      s.highestSessionId = msg.sessionId;
      s.activeSessionId = msg.sessionId;
      const sessionId = msg.sessionId;
      try {
        const n = browser.runtime.connectNative(HOST_NAME);
        s.native = n;
        n.onMessage.addListener((event) => {
          if (s.disposed || s.native !== n || s.activeSessionId !== sessionId) return;
          if (!ChromoTerminalProtocol.validNative(event)) {
            signal(ui, { type: "error", sessionId,
              message: "Invalid native host response" });
            releaseNative(s);
            return;
          }
          signal(ui, { ...event, sessionId });
        });
        n.onDisconnect.addListener(() => {
          if (s.disposed || s.native !== n || s.activeSessionId !== sessionId) return;
          const message = browser.runtime.lastError && browser.runtime.lastError.message;
          s.native = null;
          s.activeSessionId = null;
          signal(ui, { type: "disconnected", sessionId,
            message: message || "Native host disconnected" });
        });
        // Strip the browser-only identity: native Go protocol is intentionally strict.
        n.postMessage({ type: "start", profile: msg.profile,
          cols: msg.cols, rows: msg.rows });
      } catch (e) {
        releaseNative(s);
        signal(ui, { type: "disconnected", sessionId,
          message: e.message || "Native host unavailable" });
      }
    } else if (msg.sessionId === s.activeSessionId) {
      // Stale close, input, resize and ACK must never touch a replacement shell.
      if (msg.type === "close") {
        releaseNative(s);
      } else if (s.native) {
        const nativeMessage = msg.type === "input" ?
          { type: "input", data: msg.data } :
          msg.type === "resize" ?
          { type: "resize", cols: msg.cols, rows: msg.rows } :
          { type: "ack" };
        try { s.native.postMessage(nativeMessage); } catch (_) {
          releaseNative(s, "Unable to send to native terminal host");
        }
      }
    }
  });
  ui.onDisconnect.addListener(() => dispose(s));
});
browser.tabs.onRemoved.addListener((tabId) => {
  const s = sessions.get(tabId);
  if (s) dispose(s);
});
