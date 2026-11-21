const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../src/extension/protocol.js");

test("only explicit supported shells and safe sizes", () => {
  for (const profile of p.profiles) assert.equal(p.validUI({type:"start", profile, cols:80, rows:24}), true);
  for (const profile of ["powershell.exe -enc x", "../cmd", "", "bash"]) {
    assert.equal(p.validUI({type:"start", profile, cols:80, rows:24}), false);
  }
  for (const [cols, rows] of [[0, 24], [80, 0], [501, 24], [80, 251]]) {
    assert.equal(p.validUI({type:"start", profile:"cmd", cols, rows}), false);
  }
});
test("bounded user messages and rejected unknown controls", () => {
  assert.equal(p.validUI({type:"input", data:"你好🚀"}), true);
  assert.equal(p.validUI({type:"input", data:"x".repeat(8193)}), false);
  assert.equal(p.validUI({type:"input", data:"x\0y"}), false);
  assert.equal(p.validUI({type:"input", data:123}), false);
  assert.equal(p.validUI({type:"eval", code:"Get-Process"}), false);
  assert.equal(p.validUI({type:"ack"}), true);
  assert.equal(p.validUI({type:"close"}), true);
});
test("native host data is limited to small base64 frames", () => {
  assert.equal(p.validNative({type:"started"}), true);
  assert.equal(p.validNative({type:"data", data:"AP8K"}), true);
  assert.equal(p.validNative({type:"data", data:"@bad"}), false);
  assert.equal(p.validNative({type:"data", data:"A".repeat(8196)}), false);
  assert.equal(p.validNative({type:"exit", code:0}), true);
  assert.equal(p.validNative({type:"exit", code:"0"}), false);
  assert.equal(p.validNative({type:"error", message:"closed"}), true);
  assert.equal(p.validNative({type:"unknown"}), false);
});
