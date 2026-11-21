// Windows-only check: closing a native port must terminate its live
// ConPTY child AND a descendant, not just the outer native messaging host.
import {spawn, execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";

const exe=resolve("dist/native/chromofox_terminal_host.exe");
function processExists(pid) {
  const output=execFileSync("tasklist.exe",["/FO","CSV","/NH","/FI","PID eq "+pid],{
    encoding:"utf8",windowsHide:true,timeout:5000
  });
  return output.includes(',"'+pid+'",');
}
let host, descendant=0;
try {
  descendant=await new Promise((ok,fail)=>{
    host=spawn(exe,[],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let received=Buffer.alloc(0),output="",closing=false,settled=false,stderr="";
    const timer=setTimeout(()=>finish(new Error("cleanup smoke timed out: "+output.slice(-400)+"; "+stderr)),25000);
    host.stderr.on("data",b=>{stderr+=b.toString().slice(0,500);});
    function send(m) {
      const data=Buffer.from(JSON.stringify(m));
      const header=Buffer.alloc(4);
      header.writeUInt32LE(data.length);
      if (!host.stdin.destroyed) host.stdin.write(Buffer.concat([header,data]));
    }
    function finish(err) {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      try{host.stdin.end();}catch{}
      if(err)fail(err);
      else ok(descendant);
    }
    host.on("error",finish);
    host.on("exit",code=>{
      if(closing && descendant>0 && code===0)finish();
      else finish(new Error("native host exited prematurely: "+code+"; "+output.slice(-400)+"; "+stderr));
    });
    host.stdout.on("data",bytes=>{
      received=Buffer.concat([received,bytes]);
      while(received.length>=4){
        const len=received.readUInt32LE(0);
        if(len<2||len>65536)return finish(new Error("invalid native length "+len));
        if(received.length<4+len)break;
        let msg;
        try{msg=JSON.parse(received.subarray(4,4+len).toString());}
        catch(e){return finish(e);}
        received=received.subarray(4+len);
        if(msg.type==="started"){
          // Start-Process normally inherits the parent's Windows job object.
          const cmd='$p = Start-Process -FilePath "$env:WINDIR\\System32\\ping.exe" -ArgumentList @("-n","61","127.0.0.1") -NoNewWindow -PassThru; Write-Output ("CLEANUP_PID=" + $p.Id)';
          send({type:"input",data:cmd+"\r"});
        }else if(msg.type==="data"){
          output+=Buffer.from(msg.data,"base64").toString();
          send({type:"ack"});
          const m=/CLEANUP_PID=(\d+)/.exec(output);
          if(m && !closing) {
            descendant=Number(m[1]);
            if(!processExists(descendant))return finish(new Error("descendant was never live: "+descendant));
            closing=true;
            send({type:"close"});
          }
        }else if(msg.type==="error"){
          return finish(new Error("native error: "+msg.message));
        }
      }
    });
    send({type:"start",profile:"powershell",cols:80,rows:24});
  });
  let gone=false;
  for(let i=0;i<24;i++){
    if(!processExists(descendant)){gone=true;break;}
    await delay(250);
  }
  if(!gone)throw new Error("native close orphaned descendant PID "+descendant);
  console.log("ConPTY job kill-on-close descendant termination PASS, PID "+descendant);
} finally {
  if(host && host.exitCode===null)host.kill();
  // Avoid leaving a test process behind even if the regression fails.
  if(descendant>0 && processExists(descendant)){
    try {execFileSync("taskkill.exe",["/PID",String(descendant),"/T","/F"],{windowsHide:true,timeout:5000});}
    catch {}
  }
}
