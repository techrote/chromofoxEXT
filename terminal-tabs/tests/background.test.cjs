const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function mockPort(name, sender) {
  const handlers = { message: [], disconnect: [] };
  return {
    name, sender, sent: [], disconnected: false, handlers,
    onMessage: { addListener(f) { handlers.message.push(f); } },
    onDisconnect: { addListener(f) { handlers.disconnect.push(f); } },
    postMessage(m) { this.sent.push(m); },
    disconnect() {
      this.disconnected = true;
      for (const fn of handlers.disconnect) fn();
    },
    receive(m) { for (const fn of handlers.message) fn(m); }
  };
}
function setup() {
  let connectHandler, tabRemoval;
  let nativeCreated = [];
  const browser = {
    runtime: {
      getURL: (path) => "moz-extension://example-uuid/" + path,
      onConnect: { addListener(f) { connectHandler = f; } },
      connectNative: (name) => {
        assert.equal(name, "com.techrote.chromofox_terminal_tabs");
        const port = mockPort("native", null);
        nativeCreated.push(port);
        return port;
      }
    },
    tabs: { onRemoved: { addListener(f) { tabRemoval = f; } } }
  };
  const sandbox = {
    browser, URL, console, ChromoTerminalProtocol: require("../src/extension/protocol.js")
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/extension/background.js"), "utf8"), sandbox);
  return { connected: (p) => connectHandler(p), removed: (n) => tabRemoval(n), nativeCreated };
}
function ui(id, url = "moz-extension://example-uuid/terminal.html") {
  return mockPort("terminal", { tab: { id }, url });
}
test("webpage and wrong extension page cannot bridge into native shell", () => {
  const s = setup();
  const fake = ui(1, "https://untrusted.invalid/terminal.html");
  s.connected(fake);
  assert.equal(fake.disconnected, true);
  const other = ui(1, "moz-extension://example-uuid/popup.html");
  s.connected(other);
  assert.equal(other.disconnected, true);
  const local = ui(1, "file:///terminal.html");
  s.connected(local);
  assert.equal(local.disconnected, true);
  assert.equal(s.nativeCreated.length, 0);
});
test("start/resize/input/output/ack close are isolated per browser tab", () => {
  const s = setup(), a = ui(1), b = ui(2);
  s.connected(a);
  s.connected(b);
  a.receive({ type: "start", profile: "cmd", cols: 80, rows: 24 });
  b.receive({ type: "start", profile: "powershell", cols: 80, rows: 24 });
  assert.equal(s.nativeCreated.length, 2);
  const [n1, n2] = s.nativeCreated;
  assert.equal(n1.sent[0].profile, "cmd");
  assert.equal(n2.sent[0].profile, "powershell");
  n1.receive({ type: "started" });
  n1.receive({ type: "data", data: "T0s=" });
  assert.equal(a.sent.some((e) => e.type === "data"), true);
  assert.equal(b.sent.some((e) => e.type === "data"), false);
  a.receive({ type: "ack" });
  a.receive({ type: "input", data: "hi" });
  a.receive({ type: "resize", cols: 100, rows: 30 });
  assert.equal(n1.sent.slice(-3).map((m) => m.type).join(","), "ack,input,resize");
  s.removed(1);
  assert.equal(n1.sent.at(-1).type, "close");
  assert.equal(n1.disconnected, true);
  assert.equal(n2.disconnected, false);
  b.disconnect();
  assert.equal(n2.disconnected, true);
});
test("invalid profile never reaches host; restarting closes previous connection", () => {
  const s = setup(), a = ui(17);
  s.connected(a);
  a.receive({ type: "start", profile: "custom.exe", cols: 80, rows: 24 });
  assert.equal(s.nativeCreated.length, 0);
  a.receive({ type: "start", profile: "cmd", cols: 80, rows: 24 });
  a.receive({ type: "start", profile: "powershell", cols: 80, rows: 24 });
  assert.equal(s.nativeCreated.length, 2);
  assert.equal(s.nativeCreated[0].disconnected, true);
  assert.equal(s.nativeCreated[1].disconnected, false);
});
