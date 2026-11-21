// Exercise actual, independent Windows ConPTY sessions through the native stdio protocol.
// Run on Windows Actions after the Go host build, not on Linux.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const exe = resolve("dist/native/chromofox_terminal_host.exe");

function session(profile, expression) {
  return new Promise((resolveTest, rejectTest) => {
    const child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let received = Buffer.alloc(0);
    let output = "";
    let errors = "";
    let started = false;
    let found = false;
    let settled = false;
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
          // Arithmetic output must appear as its own line, not echoed input.
          if (!found && /(?:\r?\n)323(?:\r?\n|$)/.test(output)) {
            found = true;
            send({ type: "close" });
          }
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
for (const result of results) {
  console.log(result.profile + " native ConPTY command/closure PASS");
}
