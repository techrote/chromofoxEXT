"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const protocol = require("../src/extension/protocol.js");

function emitter() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    fire(msg) { for (const fn of listeners) fn(msg); }
  };
}
function setupPair() {
  const events = [];
  const nativePorts = [];
  const terminalUrl = "moz-extension://test-runtime/terminal.html";
  const clientPort = {
    onMessage: emitter(), onDisconnect: emitter(),
    postMessage(msg) { events.push(() => backPort.onMessage.fire(msg)); }
  };
  const backPort = {
    name: "terminal", sender: { tab: { id: 42 }, url: terminalUrl },
    onMessage: emitter(), onDisconnect: emitter(),
    postMessage(msg) { events.push(() => clientPort.onMessage.fire(msg)); },
    disconnect() { events.push(() => backPort.onDisconnect.fire()); }
  };
  function native() {
    const n = {
      sent: [], disconnected: false, onMessage: emitter(), onDisconnect: emitter(),
      postMessage(msg) { this.sent.push(msg); },
      disconnect() {
        this.disconnected = true;
        events.push(() => this.onDisconnect.fire());
      },
      receive(msg) { events.push(() => this.onMessage.fire(msg)); }
    };
    nativePorts.push(n);
    return n;
  }
  const backgroundBrowser = {
    runtime: {
      getURL: () => terminalUrl,
      connectNative: native,
      onConnect: emitter(),
      lastError: null
    },
    tabs: { onRemoved: emitter() }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/extension/background.js"), "utf8"),
    { browser: backgroundBrowser, ChromoTerminalProtocol: protocol, URL, console }
  );
  backgroundBrowser.runtime.onConnect.fire(backPort);

  const controls = new Map();
  function element(id) {
    if (!controls.has(id)) {
      const handlers = {};
      controls.set(id, {
        handlers, disabled: false, textContent: "", dataset: {},
        value: id === "profile" ? "cmd" : "",
        selectedOptions: [{ textContent: "Command Prompt" }],
        replaceChildren() {},
        addEventListener(type, fn) { handlers[type] = fn; },
        click() { handlers.click?.(); }
      });
    }
    return controls.get(id);
  }
  class MockTerminal {
    constructor() { this.cols = 80; this.rows = 24; }
    open() {}
    loadAddon() {}
    onData() {}
    attachCustomKeyEventHandler() {}
    write(_text, callback) { callback?.(); }
    focus() {}
    dispose() {}
    getSelection() { return ""; }
  }
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/extension/terminal.js"), "utf8"),
    {
      browser: { runtime: { connect: () => clientPort } },
      Terminal: MockTerminal,
      FitAddon: { FitAddon: class { fit() {} } },
      document: { getElementById: element },
      window: { addEventListener() {} },
      ResizeObserver: class { observe() {} },
      navigator: { clipboard: { readText: async () => "", writeText: async () => {} } },
      ChromoTerminalProtocol: protocol,
      TextDecoder, TextEncoder, Uint8Array, atob
    }
  );
  function flush() {
    let remaining = 100;
    while (events.length && --remaining > 0) events.shift()();
    assert(remaining > 0, "message loop must quiesce");
  }
  return { element, nativePorts, flush };
}

test("background/UI End → Start does not deliver stale close to new session", () => {
  const pair = setupPair();
  pair.element("start").click();
  pair.flush();
  assert.equal(pair.nativePorts.length, 1);
  pair.nativePorts[0].receive({ type: "started" });
  pair.flush();
  assert.equal(pair.element("status").textContent, "Connected · Command Prompt");

  // Simulate user triggering End and immediately Start before the background
  // has processed either request; delivered native disconnects are delayed.
  pair.element("stop").click();
  pair.element("start").click();
  pair.flush();
  assert.equal(pair.nativePorts.length, 2);
  assert.equal(pair.nativePorts[0].disconnected, true);
  assert.equal(pair.nativePorts[1].disconnected, false);

  // A retired native callback can arrive at any point and must be ignored.
  pair.nativePorts[0].receive({ type: "error", message: "stale first shell" });
  pair.nativePorts[1].receive({ type: "started" });
  pair.flush();

  assert.equal(pair.element("status").textContent, "Connected · Command Prompt");
  assert.equal(pair.element("start").disabled, true);
  assert.equal(pair.element("stop").disabled, false);
  assert.equal(pair.nativePorts[1].disconnected, false);
});
