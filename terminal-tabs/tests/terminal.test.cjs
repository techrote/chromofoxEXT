const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup({clipboard} = {}) {
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
    constructor() {this.cols=80;this.rows=24;this.writes=[];this.pastes=[];this.selection="";terminals.push(this);}
    open() {}
    loadAddon() {}
    onData(fn) {this.onInput=fn;}
    attachCustomKeyEventHandler(fn) {this.onKey=fn;}
    write(value, callback) {this.writes.push({value,callback});}
    focus() {}
    dispose() {this.disposed=true;}
    getSelection() {return this.selection;}
    hasSelection() {return this.selection.length>0;}
    paste(text) {this.pastes.push(text);this.onInput?.(text);}
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
    navigator:{clipboard:clipboard || {readText:async()=>"",writeText:async()=>{}}},
    ChromoTerminalProtocol:require("../src/extension/protocol.js"),
    TextDecoder,TextEncoder,Uint8Array,atob
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/extension/terminal.js"),"utf8"),sandbox);
  return {element,sent,terminals,
    currentId:()=>sent.filter(m=>m.type==="start").at(-1)?.sessionId,
    receive:m=>{
      const current=sent.filter(x=>x.type==="start").at(-1)?.sessionId;
      onMessage.forEach(f=>f({sessionId:current,...m}));
    }
  };
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

test("rapid End → Start accepts the second host started event",()=>{
  const x=setup();
  x.element("start").click();
  x.receive({type:"started"});
  x.element("stop").click();
  x.element("start").click();
  assert.equal(x.sent.filter(e=>e.type==="start").length,2);
  x.receive({type:"started"});
  assert.equal(x.element("start").disabled,true);
  assert.equal(x.element("stop").disabled,false);
});

test("already-forwarded old lifecycle notifications cannot end session B",()=>{
  for (const old of [{type:"exit",code:0},{type:"error",message:"A failed"},
    {type:"disconnected",message:"A closed"}]) {
    const x=setup();
    x.element("start").click();
    const oldId=x.currentId();
    x.receive({type:"started",sessionId:oldId});
    x.element("stop").click();
    x.element("start").click();
    const secondId=x.currentId();
    assert(secondId>oldId);
    const closes=x.sent.filter(m=>m.type==="close").length;
    x.receive({...old,sessionId:oldId});
    assert.equal(x.sent.filter(m=>m.type==="close").length,closes);
    x.receive({type:"started",sessionId:secondId});
    assert.equal(x.element("start").disabled,true,old.type);
    assert.equal(x.element("stop").disabled,false,old.type);
    assert.equal(x.element("status").textContent,"Connected · Command Prompt");
  }
});

function deferredClipboard() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve=res; reject=rej; });
  return {promise, resolve, reject};
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test("Paste button reads clipboard from a user gesture and forwards only to active shell",async()=>{
  const pending=deferredClipboard();
  let reads=0;
  const x=setup({clipboard:{
    readText() {reads++; return pending.promise;},
    writeText:async()=>{}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  const t=x.terminals.at(-1);
  x.element("paste").click();
  assert.equal(reads,1,"clipboard must be read from Paste click");
  assert.equal(t.pastes.length,0,"never paste while permission prompt is pending");
  pending.resolve("echo confirmed\r");
  await settled();
  assert.deepEqual(t.pastes,["echo confirmed\r"]);
  assert.equal(x.sent.filter(m=>m.type==="input").at(-1).data,"echo confirmed\r");
});

test("Ctrl+Shift+V triggers Firefox clipboard read; ordinary terminal input remains available",async()=>{
  const pending=deferredClipboard();
  let reads=0;
  const x=setup({clipboard:{
    readText() {reads++; return pending.promise;},
    writeText:async()=>{}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  const t=x.terminals.at(-1);
  const handled=t.onKey({type:"keydown",ctrlKey:true,shiftKey:true,code:"KeyV"});
  assert.equal(handled,false,"custom paste shortcut consumes keydown");
  assert.equal(reads,1);
  pending.resolve("pwd");
  await settled();
  assert.deepEqual(t.pastes,["pwd"]);
  // Represents the normal xterm onData path used for an OS/browser Ctrl+V.
  t.onInput("via Ctrl+V");
  assert.equal(x.sent.filter(m=>m.type==="input").at(-1).data,"via Ctrl+V");
});

test("Firefox Paste rejection gives current-session fallback but never pastes",async()=>{
  const pending=deferredClipboard();
  const x=setup({clipboard:{
    readText:()=>pending.promise,writeText:async()=>{}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  x.element("paste").click();
  pending.reject(new Error("NotAllowedError: confirmation dismissed"));
  await settled();
  assert.equal(x.terminals.at(-1).pastes.length,0);
  assert.match(x.element("status").textContent,/Ctrl\+V/);
  assert.equal(x.element("stop").disabled,false,"clipboard rejection must not kill shell");
});

test("late clipboard grant OR denial after End -> Start cannot affect B",async()=>{
  for (const outcome of ["resolve","reject"]) {
    const pending=deferredClipboard();
    const x=setup({clipboard:{
      readText:()=>pending.promise,writeText:async()=>{}
    }});
    x.element("start").click();
    x.receive({type:"started"});
    const original=x.terminals.at(-1);
    x.element("paste").click();
    x.element("stop").click();
    x.element("start").click();
    x.receive({type:"started"});
    const current=x.terminals.at(-1);
    const before=x.sent.filter(m=>m.type==="input").length;
    if(outcome==="resolve") pending.resolve("echo stale\r");
    else pending.reject(new Error("NotAllowedError"));
    await settled();
    assert.equal(original.pastes.length,0);
    assert.equal(current.pastes.length,0);
    assert.equal(x.sent.filter(m=>m.type==="input").length,before);
    assert.equal(x.element("status").textContent,"Connected · Command Prompt");
  }
});

test("late COPY error after End -> Start never overwrites B's status",async()=>{
  const pending=deferredClipboard();
  const x=setup({clipboard:{
    readText:async()=>"",writeText:()=>pending.promise
  }});
  x.element("start").click();
  x.receive({type:"started"});
  x.terminals.at(-1).selection="selected";
  x.element("copy").click();
  x.element("stop").click();
  x.element("start").click();
  x.receive({type:"started"});
  pending.reject(new Error("NotAllowedError"));
  await settled();
  assert.equal(x.element("status").textContent,"Connected · Command Prompt");
});

test("sync Clipboard API failure is reported without corrupting active session",()=>{
  const x=setup({clipboard:{
    readText(){throw new Error("NotAllowedError");},
    writeText(){throw new Error("NotAllowedError");}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  x.element("paste").click();
  assert.match(x.element("status").textContent,/Ctrl\+V/);
  x.terminals.at(-1).selection="test";
  x.element("copy").click();
  assert.match(x.element("status").textContent,/copy was blocked/);
  assert.equal(x.element("stop").disabled,false);
});

test("Copy button copies selected scrollback after explicit End",async()=>{
  const written=[];
  const x=setup({clipboard:{
    readText:async()=>"",
    writeText(text){written.push(text);return Promise.resolve();}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  const stoppedTerminal=x.terminals.at(-1);
  x.element("stop").click();
  assert.equal(x.element("stop").disabled,true);
  stoppedTerminal.selection="output retained after End";
  x.element("copy").click();
  await settled();
  assert.deepEqual(written,["output retained after End"]);
  assert.equal(x.element("status").textContent,"Session ended");
});

test("Ctrl+Shift+C copies selected output after normal native exit",async()=>{
  const written=[];
  const x=setup({clipboard:{
    readText:async()=>"",
    writeText(text){written.push(text);return Promise.resolve();}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  x.receive({type:"exit",code:0});
  const stoppedTerminal=x.terminals.at(-1);
  stoppedTerminal.selection="command output after exit";
  const handled=stoppedTerminal.onKey({
    type:"keydown",ctrlKey:true,shiftKey:true,code:"KeyC"
  });
  assert.equal(handled,false,"Copy shortcut must still be available after exit");
  await settled();
  assert.deepEqual(written,["command output after exit"]);
  assert.match(x.element("status").textContent,/Process exited/);
  assert.equal(x.element("stop").disabled,true);
});

test("late stopped-session Copy rejection cannot change replacement status",async()=>{
  const pending=deferredClipboard();
  const copied=[];
  const x=setup({clipboard:{
    readText:async()=>"",
    writeText(text){copied.push(text);return pending.promise;}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  const stoppedTerminal=x.terminals.at(-1);
  x.element("stop").click();
  stoppedTerminal.selection="stopped shell text";
  x.element("copy").click();
  assert.deepEqual(copied,["stopped shell text"]);
  x.element("start").click();
  x.receive({type:"started"});
  pending.reject(new Error("NotAllowedError"));
  await settled();
  assert.equal(x.element("status").textContent,"Connected · Command Prompt");
  assert.equal(x.element("stop").disabled,false);
});

test("Copy rejection on a still-visible stopped buffer is reported",async()=>{
  const x=setup({clipboard:{
    readText:async()=>"",
    writeText(){throw new Error("NotAllowedError");}
  }});
  x.element("start").click();
  x.receive({type:"started"});
  x.element("stop").click();
  x.terminals.at(-1).selection="old output";
  x.element("copy").click();
  assert.match(x.element("status").textContent,/Clipboard copy was blocked/);
  assert.equal(x.element("stop").disabled,true);
});
