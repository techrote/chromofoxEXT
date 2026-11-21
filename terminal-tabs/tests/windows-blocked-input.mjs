// Windows-only native integration: verify the control reader remains responsive
// while a PowerShell child is sleeping and its ConPTY input pipe has queued data.
// Uses real ConPTY, not a mocked input channel. Bounded to 12 seconds.
import {spawn} from "node:child_process";
import {resolve} from "node:path";

const exe=resolve("dist/native/chromofox_terminal_host.exe");
const host=spawn(exe,[],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
const startedAt=Date.now();
await new Promise((resolveTest,rejectTest)=>{
  let started=false,closeSent=false,settled=false,buffer=Buffer.alloc(0),stderr="";
  let bytesQueued=0;
  const timer=setTimeout(()=>fail("native Close blocked beyond 12 s under input pressure"),12000);
  host.stderr.on("data",data=>{stderr=(stderr+data.toString("utf8")).slice(-1000);});
  function finish(err) {
    if(settled)return;
    settled=true;
    clearTimeout(timer);
    try{host.stdin.end();}catch{}
    if(err){
      try{host.kill();}catch{}
      rejectTest(err);
    }else resolveTest();
  }
  function fail(reason) {
    finish(new Error(reason+"; queued="+bytesQueued+" bytes; stderr="+stderr));
  }
  function send(obj) {
    if(settled)return;
    const data=Buffer.from(JSON.stringify(obj),"utf8");
    const header=Buffer.alloc(4);
    header.writeUInt32LE(data.length,0);
    try{
      host.stdin.write(Buffer.concat([header,data]),err=>{
        if(err&&!settled)fail("native input write failed: "+err.message);
      });
    }catch(e){fail("native pipe write failed: "+e.message);}
  }
  host.on("error",e=>fail("host spawn error: "+e.message));
  host.on("close",(code,signal)=>{
    if(!started||!closeSent||code!==0||signal){
      return fail("host exited unexpectedly: code="+code+", signal="+signal);
    }
    finish();
  });
  host.stdout.on("data",data=>{
    if(settled)return;
    buffer=Buffer.concat([buffer,data]);
    while(!settled&&buffer.length>=4){
      const size=buffer.readUInt32LE(0);
      if(size<2||size>65536)return fail("invalid native frame length "+size);
      if(buffer.length<size+4)break;
      let msg;
      try{msg=JSON.parse(buffer.subarray(4,size+4).toString("utf8"));}
      catch(e){return fail("invalid native frame: "+e.message);}
      buffer=buffer.subarray(size+4);
      if(msg.type==="started"&&!started){
        started=true;
        // While the shell sleeps it cannot consume typed console input.
        send({type:"input",data:"Start-Sleep -Seconds 30\r"});
        setTimeout(()=>{
          if(settled)return;
          // Each frame is below the host's 8192-byte input bound. The 16
          // frames total 128 KiB, below the 256 KiB input queue cap.
          // This is enough pressure to overflow the ordinary ConPTY pipe,
          // while leaving spare queue capacity to avoid intentional overflow.
          for(let i=0;i<16;i++){
            send({type:"input",data:"x".repeat(8192)});
            bytesQueued+=8192;
          }
          closeSent=true;
          send({type:"close"});
        },450);
      }else if(msg.type==="data"){
        // Keep the output pipeline unblocked; only INPUT is stressed.
        send({type:"ack"});
      }else if(msg.type==="error"){
        fail("native host error under input pressure: "+msg.message);
      }else if(msg.type==="exit"&&!closeSent){
        fail("shell exited before blocked-input Close test");
      }
    }
  });
  send({type:"start",profile:"powershell",cols:80,rows:24});
});
console.log("Native Close remained responsive with 128 KiB backed-up ConPTY input; elapsed "+
  (Date.now()-startedAt)+" ms — PASS");
