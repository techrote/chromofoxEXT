"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Writable, PassThrough } = require("node:stream");

const smokes = import("./windows-conpty-smoke.mjs");

function framed(obj) {
  const data=Buffer.from(JSON.stringify(obj));
  const length=Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return Buffer.concat([length,data]);
}
function fakeSpawn(mode) {
  return () => {
    const child=new EventEmitter();
    const stdout=new PassThrough(),stderr=new PassThrough();
    child.stdout=stdout;
    child.stderr=stderr;
    child.exitCode=null;
    let closed=false;
    function finish(code) {
      if(closed) return;
      closed=true;
      child.exitCode=code;
      stdout.end();
      stderr.end();
      queueMicrotask(()=>child.emit("close",code,null));
    }
    child.kill=()=>finish(9);
    child.stdin=new Writable({
      write(chunk,enc,done) {
        const len=chunk.readUInt32LE(0);
        const msg=JSON.parse(chunk.subarray(4,4+len).toString());
        if(msg.type==="start") queueMicrotask(()=>stdout.write(framed({type:"started"})));
        if(msg.type==="input") queueMicrotask(()=>{
          stdout.write(framed({type:"data",
            data:Buffer.from("DRAIN_COMPLETE\r\nline1\r\n").toString("base64")}));
          if(mode==="crash") finish(1);
          else if(mode==="no-native-exit") finish(0);
          else {
            stdout.write(framed({type:"exit",code:0}));
            if(mode==="late-output") stdout.write(framed({
              type:"data",data:Buffer.from("line2\r\n").toString("base64")
            }));
          }
        });
        if(msg.type==="close") queueMicrotask(()=>finish(0));
        done();
      }
    });
    return child;
  };
}

test("marker + one line + host crash MUST fail without native exit",async()=>{
  const {session}=await smokes;
  await assert.rejects(session("cmd","synthetic",{
    expectExit:true,marker:"DRAIN_COMPLETE",expectedLines:2000,
    spawnProcess:fakeSpawn("crash"),timeoutMs:1000
  }),/unexpected host termination/);
});
test("marker + complete one-line output but no native exit MUST fail",async()=>{
  const {session}=await smokes;
  await assert.rejects(session("cmd","synthetic",{
    expectExit:true,marker:"DRAIN_COMPLETE",expectedLines:1,
    spawnProcess:fakeSpawn("no-native-exit"),timeoutMs:1000
  }),/without native exit frame/);
});
test("native exit with incomplete numbered output MUST fail",async()=>{
  const {session}=await smokes;
  await assert.rejects(session("cmd","synthetic",{
    expectExit:true,marker:"DRAIN_COMPLETE",expectedLines:2000,
    spawnProcess:fakeSpawn("partial-exit"),timeoutMs:1000
  }),/native exit before all output/);
});
test("data after validated native exit MUST fail",async()=>{
  const {session}=await smokes;
  await assert.rejects(session("cmd","synthetic",{
    expectExit:true,marker:"DRAIN_COMPLETE",expectedLines:1,
    spawnProcess:fakeSpawn("late-output"),timeoutMs:1000
  }),/data before start or after native exit/);
});
test("complete output + native exit + clean host Close passes",async()=>{
  const {session}=await smokes;
  const got=await session("cmd","synthetic",{
    expectExit:true,marker:"DRAIN_COMPLETE",expectedLines:1,
    spawnProcess:fakeSpawn("pass"),timeoutMs:1000
  });
  assert.equal(got.profile,"cmd");
});
