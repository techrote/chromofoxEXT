// Windows ConPTY/native-messaging integration smoke.
// Export the unchanged production verifier for negative transport tests.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function session(profile, expression, {
  expectExit = false, marker = "323", expectedLines = 0,
  spawnProcess = spawn, executable = resolve("dist/native/chromofox_terminal_host.exe"),
  timeoutMs = 25000
} = {}) {
  return new Promise((resolveTest, rejectTest) => {
    const child = spawnProcess(executable, [], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: {...process.env, CHROMOFOX_TERM_DEBUG: "1"}
    });
    let received = Buffer.alloc(0), output = "", visibleOutput = "", errors = "";
    let started = false, found = false, nativeExit = false, closeSent = false, settled = false;
    const timeout = setTimeout(() => finish(new Error(profile + ": timeout; output=" +
      output.slice(-900) + "; stderr=" + errors.slice(-900))), timeoutMs);
    child.stderr.on("data", b => { errors = (errors + b.toString("utf8")).slice(-3000); });
    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { child.stdin.end(); } catch {}
      if (err && child.exitCode === null) child.kill();
      if (err) rejectTest(err);
      else resolveTest({ profile, output: output.slice(-200) });
    }
    function fail(message) { finish(new Error(profile + ": " + message +
      "; output tail=" + output.slice(-600) + "; stderr tail=" + errors.slice(-600))); }
    function send(obj) {
      const body = Buffer.from(JSON.stringify(obj), "utf8");
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length, 0);
      try {
        if (child.stdin.destroyed) return fail("host stdin closed unexpectedly");
        child.stdin.write(Buffer.concat([prefix, body]));
      } catch (e) { fail("host input write failed: " + e.message); }
    }
    function linesComplete() {
      if (!expectedLines) return true;
      const matches = [...visibleOutput.matchAll(/^line(\d+)\r?$/gm)];
      if (matches.length !== expectedLines) return false;
      const unique = new Set(matches.map(m => Number(m[1])));
      if (unique.size !== expectedLines) return false;
      for (let i = 1; i <= expectedLines; i++) if (!unique.has(i)) return false;
      return true;
    }
    child.on("error", e => fail("host spawn error: " + e.message));
    // 'close' occurs AFTER all stdio has drained. 'exit' alone does not.
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal) return fail("unexpected host termination (code=" + code +
        ", signal=" + signal + ")");
      if (received.length) return fail("truncated native frame at host shutdown");
      if (!started || !found) return fail("host closed before successful command output");
      if (expectExit && !nativeExit) return fail("host closed without native exit frame");
      if (expectExit && !linesComplete()) return fail("host closed without complete output");
      if (!closeSent) return fail("host closed before protocol Close request");
      finish();
    });
    child.stdout.on("data", chunk => {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      while (!settled && received.length >= 4) {
        const length = received.readUInt32LE(0);
        if (length < 2 || length > 65536) return fail("invalid native frame length " + length);
        if (received.length < 4 + length) break;
        let msg;
        try { msg = JSON.parse(received.subarray(4, 4 + length).toString("utf8")); }
        catch (e) { return fail("invalid host JSON: " + e.message); }
        received = received.subarray(4 + length);
        if (msg.type === "started") {
          if (started || nativeExit) return fail("duplicate or late started frame");
          started = true;
          send({ type: "input", data: expression + "\r" });
        } else if (msg.type === "data") {
          if (!started || nativeExit || typeof msg.data !== "string") {
            return fail("data before start or after native exit");
          }
          output += Buffer.from(msg.data, "base64").toString("utf8");
          if (output.length > 2000000) return fail("excessive smoke output");
          send({ type: "ack" });
          visibleOutput = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
            .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
          if (!found && visibleOutput.includes(marker)) {
            found = true;
            // Basic interactive mode deliberately closes a running shell.
            // The exit/drain qualification must wait for a real native exit.
            if (!expectExit) {
              closeSent = true;
              send({ type: "close" });
            }
          }
        } else if (msg.type === "exit") {
          if (!started || nativeExit || !Number.isSafeInteger(msg.code) || msg.code !== 0) {
            return fail("invalid or nonzero native exit code " + msg.code);
          }
          if (!found || (expectExit && !linesComplete())) {
            return fail("native exit before all output (count=" +
              (visibleOutput.match(/^line\d+\r?$/gm) || []).length +
              ", expected=" + expectedLines + ")");
          }
          nativeExit = true;
          if (!closeSent) {
            closeSent = true;
            send({ type: "close" });
          }
        } else if (msg.type === "error") {
          return fail("native host error: " + msg.message);
        } else {
          return fail("unexpected host frame " + msg.type);
        }
      }
    });
    send({ type: "start", profile, cols: 80, rows: 24 });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Two independently interactive shells (intentional host Close).
  const interactive = await Promise.all([
    session("cmd", "set /a 17*19"),
    session("powershell", "(17 * 19)")
  ]);
  // Required native exit frame and all 2,000 distinct lines before host Close.
  const drained = await Promise.all([
    session("cmd", 'for /L %i in (1,1,2000) do @echo line%i\recho DRAIN_COMPLETE\rexit',
      {expectExit:true, marker:"DRAIN_COMPLETE", expectedLines:2000}),
    session("powershell", '1..2000 | ForEach-Object { "line$_" }\rWrite-Output DRAIN_COMPLETE\rexit',
      {expectExit:true, marker:"DRAIN_COMPLETE", expectedLines:2000})
  ]);
  for (const result of [...interactive, ...drained]) {
    console.log(result.profile + " native ConPTY command/closure PASS");
  }
}
