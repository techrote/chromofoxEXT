const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../src/extension/protocol.js");

test("only explicit supported shells and safe sizes", () => {
  for (const profile of p.profiles) assert.equal(p.validUI({type:"start", sessionId:1, profile, cols:80, rows:24}), true);
  for (const profile of ["powershell.exe -enc x", "../cmd", "", "bash"]) {
    assert.equal(p.validUI({type:"start", sessionId:1, profile, cols:80, rows:24}), false);
  }
  for (const [cols, rows] of [[0, 24], [80, 0], [501, 24], [80, 251]]) {
    assert.equal(p.validUI({type:"start", sessionId:1, profile:"cmd", cols, rows}), false);
  }
});
test("bounded user messages and rejected unknown controls", () => {
  assert.equal(p.validUI({type:"input", sessionId:1, data:"你好🚀"}), true);
  assert.equal(p.validUI({type:"input", sessionId:1, data:"x".repeat(8193)}), false);
  assert.equal(p.validUI({type:"input", sessionId:1, data:"x\0y"}), false);
  assert.equal(p.validUI({type:"input", sessionId:1, data:123}), false);
  assert.equal(p.validUI({type:"eval", sessionId:1, code:"Get-Process"}), false);
  assert.equal(p.validUI({type:"ack",sessionId:1}), true);
  assert.equal(p.validUI({type:"close",sessionId:1}), true);
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

test("browser session identity is required and must be positive safe integer",()=>{
  const good={type:"start",profile:"cmd",cols:80,rows:24,sessionId:1};
  assert.equal(p.validUI(good),true);
  for (const id of [undefined,null,0,-1,1.5,"1",NaN,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(p.validUI({...good,sessionId:id}),false);
  }
  assert.equal(p.validSessionId(2),true);
});
