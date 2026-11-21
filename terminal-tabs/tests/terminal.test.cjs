const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const controls = new Map();
  function element(id) {
    if (!controls.has(id)) {
      const handlers = {};
      controls.set(id, {
        handlers, disabled: false, textContent: "", dataset: {},
        value: id === "profile" ? "cmd" : "",
        selectedOptions: [{textContent: "Command Prompt"}],
        replaceChildren() {},
        addEventListener(type, fn) { handlers[type] = fn; },
        click() { handlers.click?.(); }
      });
    }
    return controls.get(id);
  }
  const terminals = [];
  class MockTerminal {
    constructor() {this.cols=80;this.rows=24;this.writes=[];terminals.push(this);}
    open() {}
    loadAddon() {}
    onData(fn) {this.onInput=fn;}
    attachCustomKeyEventHandler(fn) {this.onKey=fn;}
    write(value, callback) {this.writes.push({value,callback});}
    focus() {}
    dispose() {this.disposed=true;}
    getSelection() {return "";}
  }
  const sent=[], onMessage=[];
  const port={
    postMessage(m) {sent.push(m);},
    onMessage: {addListener(f) {onMessage.push(f);}},
    onDisconnect: {addListener() {}}
  };
  const sandbox={
    browser:{runtime:{connect(){return port;}}},
    Terminal:MockTerminal,FitAddon:{FitAddon:class{fit(){}}},
    document:{getElementById:element},window:{addEventListener(){}},
    ResizeObserver:class{observe(){}},
    navigator:{clipboard:{readText:async()=>"",writeText:async()=>{}}},
    ChromoTerminalProtocol:require("../src/extension/protocol.js"),
    TextDecoder,TextEncoder,Uint8Array,atob
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/extension/terminal.js"),"utf8"),sandbox);
  return {element,sent,terminals,receive:m=>onMessage.forEach(f=>f(m))};
}
test("new session replaces terminal modes and drops previous renderer ACK",()=>{
  const x=setup();
  x.element("start").click();
  x.receive({type:"started"});
  const old=x.terminals.at(-1);
  x.receive({type:"data",data:"SGVsbG8="});
  assert.equal(old.writes.length,1);
  x.element("stop").click();
  const ackBefore=x.sent.filter(m=>m.type==="ack").length;
  x.element("start").click();
  x.receive({type:"started"});
  assert.notEqual(x.terminals.at(-1),old);
  assert.equal(old.disposed,true);
  old.writes[0].callback();
  assert.equal(x.sent.filter(m=>m.type==="ack").length,ackBefore);
  const current=x.terminals.at(-1);
  x.receive({type:"data",data:"T0s="});
  current.writes[0].callback();
  assert.equal(x.sent.filter(m=>m.type==="ack").length,ackBefore+1);
});
test("late data and started messages after End cannot resurrect shell",()=>{
  const x=setup();
  x.element("start").click();
  x.receive({type:"started"});
  x.element("stop").click();
  const old=x.terminals.at(-1),count=old.writes.length;
  x.receive({type:"data",data:"SGVsbG8="});
  x.receive({type:"started"});
  assert.equal(old.writes.length,count);
  assert.equal(x.element("stop").disabled,true);
});
