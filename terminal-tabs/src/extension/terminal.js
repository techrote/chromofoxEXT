"use strict";
const protocol = ChromoTerminalProtocol;
const $ = (id) => document.getElementById(id);
const startButton = $("start");
const stopButton = $("stop");
const profileSelect = $("profile");
const statusLabel = $("status");
const dot = $("dot");
let term;
let fit;
// Recreate the emulator for each native session: no parser modes, terminal
// buffer, or delayed writes can leak into the next shell.
function newTerminal() {
  if (term) term.dispose();
  $("terminal").replaceChildren();
  term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Mono","Consolas",monospace',
    fontSize: 15,
    lineHeight: 1.16,
    scrollback: 5000,
    theme: { background: "#10141d", foreground: "#e4e9f0", cursor: "#8ab4ff", selectionBackground: "#405476" }
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($("terminal"));
  term.onData(handleTerminalInput);
  term.attachCustomKeyEventHandler(handleTerminalKey);
}
let running = false;
let pending = false;
let encoder = new TextEncoder();
let decoder = new TextDecoder("utf-8");
let generation = 0;
let highestSessionId = 0;
let activeSessionId = null;
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
function send(m, sessionId = activeSessionId) {
  if (!protocol.validSessionId(sessionId)) return false;
  try { ui.postMessage({ ...m, sessionId }); return true; } catch (_) {
    setStatus("Extension connection lost — reload this tab", "error");
    return false;
  }
}
function finish(label, level = "idle") {
  generation++; // Invalidate delayed renderer ACKs and clipboard reads.
  activeSessionId = null; // Already-forwarded notifications for old shell are stale.
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
  // An event can be forwarded while A is active but delivered after B starts.
  if (!m || !protocol.validSessionId(m.sessionId) ||
      m.sessionId !== activeSessionId || typeof m.type !== "string") return;
  const sessionId = activeSessionId;
  switch (m.type) {
    case "started":
      if (!pending) return;
      pending = false;
      running = true;
      updateButtons();
      setStatus("Connected · " + profileSelect.selectedOptions[0].textContent, "ok");
      term.focus();
      break;
    case "data":
      if (!running || typeof m.data !== "string") return;
      try {
        const text = decodeB64(m.data);
        const currentGeneration = generation;
        const currentTerm = term;
        if (text) {
          currentTerm.write(text, () => {
            if (running && generation === currentGeneration &&
                activeSessionId === sessionId && currentTerm === term) {
              send({ type: "ack" }, sessionId);
            }
          });
        } else if (running && generation === currentGeneration &&
                   activeSessionId === sessionId) {
          send({ type: "ack" }, sessionId);
        }
      } catch (_) {
        finish("Terminal output decode error", "error");
        send({ type: "close" }, sessionId);
      }
      break;
    case "exit":
      term.write(decoder.decode());
      finish("Process exited (code " + m.code + "). Press Start for a new session.", "idle");
      break;
    case "error":
      finish(m.message || "Native host error", "error");
      send({ type: "close" }, sessionId);
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
  generation++;
  newTerminal();
  decoder = new TextDecoder("utf-8");
  const profile = profileSelect.value;
  const dimensions = size();
  if (!protocol.profiles.includes(profile) || !protocol.validSize(dimensions.cols, dimensions.rows)) {
    setStatus("Unsupported shell or terminal size", "error"); return;
  }
  activeSessionId = ++highestSessionId;
  pending = true;
  updateButtons();
  setStatus("Connecting to Windows native host…", "pending");
  document.title = profileSelect.selectedOptions[0].textContent + " — Terminal";
  if (!send({ type: "start", profile, ...dimensions })) finish("Unable to connect", "error");
});
stopButton.addEventListener("click", () => {
  if (running || pending) {
    const sessionId = activeSessionId;
    finish("Session ended", "idle");
    send({ type: "close" }, sessionId);
  }
});
function handleTerminalInput(data) {
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
}
const observer = new ResizeObserver(() => {
  const dimensions = size();
  if (running) send({ type: "resize", ...dimensions });
});
observer.observe($("screen"));
window.addEventListener("focus", () => { size(); });
// Clipboard access is deliberately user-gesture-only: do not request the
// broad Firefox clipboardRead permission. Firefox 147+ can show a temporary
// "Paste" confirmation when readText() is called from an extension page.
const pasteError = "Paste unavailable — approve Firefox's Paste confirmation or focus the terminal and press Ctrl+V";
function clipboardTarget() {
  if (!running || !protocol.validSessionId(activeSessionId)) return null;
  return { sessionId: activeSessionId, generation, terminal: term };
}
function targetIsCurrent(target) {
  return !!target && running && generation === target.generation &&
    activeSessionId === target.sessionId && term === target.terminal;
}
function clipboardFailure(target, message) {
  // The browser permission prompt can resolve/reject after End -> Start.
  // A stale completion must never overwrite B's status or send input to B.
  if (targetIsCurrent(target)) setStatus(message, "error");
}
function pasteFromClipboard() {
  const target = clipboardTarget();
  if (!target) return;
  let reading;
  try {
    // Call synchronously from the button/key event: Firefox requires
    // transient activation before presenting its temporary Paste prompt.
    reading = navigator.clipboard.readText();
  } catch (_) {
    clipboardFailure(target, pasteError);
    return;
  }
  Promise.resolve(reading).then(text => {
    if (targetIsCurrent(target) && typeof text === "string" && text.length) {
      target.terminal.paste(text);
    }
  }).catch(() => clipboardFailure(target, pasteError));
}
function copySelection() {
  // Copy reads the visible xterm buffer, even after End or native exit.
  // Unlike Paste it does not require a live shell or sessionId.
  const sourceTerminal = term;
  if (!sourceTerminal) return;
  const selected = sourceTerminal.getSelection();
  if (!selected) return;
  const copyGeneration = generation;
  const reportFailure = () => {
    // A late clipboard rejection must not overwrite a replacement shell.
    // Still report failures for Copy initiated on the currently visible buffer.
    if (term === sourceTerminal && generation === copyGeneration) {
      setStatus("Clipboard copy was blocked by Firefox", "error");
    }
  };
  try {
    // Keep the write inside the user's click/key handler.
    Promise.resolve(navigator.clipboard.writeText(selected)).catch(reportFailure);
  } catch (_) {
    reportFailure();
  }
}
$("copy").addEventListener("click", copySelection);
$("paste").addEventListener("click", pasteFromClipboard);
function handleTerminalKey(e) {
  if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
  if (e.code === "KeyC" && term.hasSelection()) {
    copySelection();
    return false;
  }
  if (e.code === "KeyV" && running) {
    pasteFromClipboard();
    return false;
  }
  return true;
}
newTerminal();
size();
