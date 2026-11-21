// Exercise actual, independent Windows ConPTY sessions through the native stdio protocol.
// Run on Windows Actions after the Go host build, not on Linux.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const exe = resolve("dist/native/chromofox_terminal_host.exe");

function session(profile, expression, {expectExit = false, marker = "323", expectedLines = 0} = {}) {
  return new Promise((resolveTest, rejectTest) => {
    const child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {...process.env, CHROMOFOX_TERM_DEBUG: "1"} });
    let received = Buffer.alloc(0);
    let output = "";
    let errors = "";
    let started = false;
    let found = false;
    let settled = false;
    let exitObserved = false;
    let visibleOutput = "";
    const timeout = setTimeout(() => finish(new Error(profile + ": timeout; output=" + output.slice(-1000) + "; stderr=" + errors)), 25000);
    child.stderr.on("data", (b) => { errors += b.toString("utf8").slice(0, 1000); });
    function send(obj) {
      const body = Buffer.from(JSON.stringify(obj), "utf8");
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length, 0);
      if (!child.stdin.destroyed) child.stdin.write(Buffer.concat([prefix, body]));
    }
    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { child.stdin.end(); } catch {}
      if (child.exitCode === null) child.kill();
      if (err) rejectTest(err);
      else resolveTest({ profile, output: output.slice(-200) });
    }
    child.on("error", finish);
    child.on("exit", (code) => {
      if (found) finish();
      else finish(new Error(profile + ": host exited " + code + " before expected terminal output; stderr=" + errors + "; output=" + output.slice(-2000)));
    });
    child.stdout.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 4) {
        const length = received.readUInt32LE(0);
        if (length < 2 || length > 65536) return finish(new Error("invalid host frame " + length));
        if (received.length < 4 + length) break;
        let msg;
        try { msg = JSON.parse(received.subarray(4, 4 + length).toString("utf8")); }
        catch (e) { return finish(e); }
        received = received.subarray(4 + length);
        if (msg.type === "started" && !started) {
          started = true;
          send({ type: "input", data: expression + "\r" });
        } else if (msg.type === "data") {
          output += Buffer.from(msg.data, "base64").toString("utf8");
          send({ type: "ack" });
          // Strip common VT/OSC escapes before matching the actual result.
          // The command echo is "17*19", not "323".
          const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
          visibleOutput = plain;
          if (exitObserved) return finish(new Error(profile + ": received output after exit"));
          if (!found && plain.includes(marker)) {
            found = true;
            if (!expectExit) send({ type: "close" });
          }
        } else if (msg.type === "exit") {
          if (!expectExit) {
            if (found && Number.isInteger(msg.code)) return finish();
          } else {
            const lines = (visibleOutput.match(/^line\d+\r?$/gm) || []).length;
            if (found && Number.isInteger(msg.code) && lines >= expectedLines) {
              exitObserved = true;
              setTimeout(() => finish(), 100);
              continue;
            }
          }
          return finish(new Error(profile + ": exit before full output drain (lines=" +
            (visibleOutput.match(/^line\d+\r?$/gm) || []).length + ", expected=" + expectedLines +
            ", code=" + msg.code + "); tail=" + output.slice(-600)));
        } else if (msg.type === "error") {
          return finish(new Error(profile + ": native host error: " + msg.message));
        }
      }
    });
    send({ type: "start", profile, cols: 80, rows: 24 });
  });
}

const results = await Promise.all([
  session("cmd", "set /a 17*19"),
  session("powershell", "(17 * 19)")
]);
// Both sessions produce >32 KiB of output and then exit normally.
// A native 'exit' frame is correct only after every output line is delivered.
const drained = await Promise.all([
  session("cmd", 'for /L %i in (1,1,2000) do @echo line%i\recho DRAIN_COMPLETE\rexit', {expectExit:true, marker:"DRAIN_COMPLETE", expectedLines:2000}),
  session("powershell", '1..2000 | ForEach-Object { "line$_" }\rWrite-Output DRAIN_COMPLETE\rexit', {expectExit:true, marker:"DRAIN_COMPLETE", expectedLines:2000})
]);
results.push(...drained);
for (const result of results) {
  console.log(result.profile + " native ConPTY command/closure PASS");
}
