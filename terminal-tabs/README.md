# Terminal Tabs — Firefox/Windows experimental PoC

**Issue:** [TERM-TABS-001 / #7](https://github.com/techrote/chromofoxEXT/issues/7)  
**Status:** Draft/HOLD — not merged, signed, or owner-accepted. **Do not treat CI as proof that ConPTY has passed a real Firefox session.**

Run **new** interactive Windows shell sessions inside normal Firefox tabs. This does **not** move an already-running Windows Terminal GUI tab into Firefox: Windows Terminal has no supported live-tab attach API.

## How to install the Windows evaluator

1. Open the [Terminal Tabs GitHub Actions workflow](https://github.com/techrote/chromofoxEXT/actions/workflows/terminal-tabs.yml) and open a **green run for the exact PR HEAD**. Under Artifacts, download `chromofox-terminal-tabs-windows-ff`; extract the ZIP.
2. Run **Install Terminal Tabs.cmd** in the extracted folder (or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Action Install`). No administrator permission is needed. This copies the local host binary into `%LOCALAPPDATA%\chromofoxEXT\terminal-tabs` and registers it only for the current Windows user in Firefox NativeMessagingHosts.
3. In Firefox: open `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select `extension\manifest.json` from the extracted ZIP. Temporary add-ons are **not persistent across Firefox restarts**; reload it from the extracted files when required. Do not load `src/extension/manifest.json` from GitHub source, because it does not include the xterm renderer until the build runs.
4. Click the Terminal Tabs toolbar icon → **New terminal tab** → choose **Windows PowerShell** or **Command Prompt** → **Start session**. Try two tabs at once. Optionally select PowerShell 7 (needs `pwsh.exe` installed/on PATH) or WSL (needs Windows Subsystem for Linux installed).
5. Type `whoami`, `Get-Process` (PowerShell) or `dir` (CMD); resize the window, select/copy/paste text, run a long command, then close one tab and verify that the other continues.

**Install status:** `powershell -NoProfile -File .\install.ps1 -Action Status`  
**Remove companion:** Run **Uninstall Terminal Tabs.cmd** after closing terminal tabs. Unloading the temporary Firefox extension can be done from `about:debugging`.

The installer checks for an existing registry entry and **refuses to replace someone else's host**. It doesn't install a service or open a TCP socket.

## Behaviour and limitations

- Each new browser tab has its **own** native messaging connection and Windows ConPTY/child process. Press **Start** explicitly; restoring a Firefox tab does not automatically execute a shell.
- Input and UTF-8/VT output are delivered over stdio-framed Firefox native messaging, never via a web server. Output uses an 8 × 4 KiB renderer-credit window; queued input is bounded to 256 KiB and written off the protocol thread. The host drains ConPTY output before signalling exit, or explicitly reports a bounded drain failure. ANSI colour, navigation keys and interactive prompts use xterm.js 5.5.0 + fit addon 0.10.0.
- **Clipboard policy (least privilege):** the extension deliberately does **not** request `clipboardRead`. Firefox 147+ requires a user gesture and may show a temporary **Paste** confirmation menu when you click **Paste** or press **Ctrl+Shift+V**. Select Firefox's Paste entry to approve; it may become enabled after a short delay. Cancelling or denying it pastes nothing. When Firefox denies a clipboard read, focus the terminal and press **Ctrl+V** for ordinary OS/browser paste instead. For copying selected text use **Copy** or **Ctrl+Shift+C**. Ctrl+C with terminal focus sends an interrupt to the shell. A pending clipboard request belongs to the session that initiated it: completing or rejecting it after End → Start must not paste into or change the replacement session's status. Clipboard text containing newlines can execute multiple commands immediately; only paste trusted content. We intentionally avoid the broader always-granted system-clipboard-read permission.
- The host creates a suspended shell and assigns it to a **Windows kill-on-close job object** before running it. On normal browser tab closure, Firefox disconnection or browser process termination, the host's job handle should kill its process tree. **Crash, breakaway-job and Windows-specific edge cases still require physical Windows validation.**
- Browser tab history/refresh does not preserve the live shell's state or scrollback. Each Start creates a fresh xterm instance so stale parser modes, delayed writes and scrollback are isolated. You can launch a new session after a process exits. No network/remote shell support and no shell commands accepted from ordinary webpages.
- Firefox **Manifest V2 persistent background script** is deliberate here to keep native ports alive. This is a Firefox-first experiment, not a Chrome extension package. A separately engineered Chromium MV3 lifecycle is a follow-up.
- Optional WSL/pwsh use the user's normal installed shell and PATH; no privilege escalation. No remote telemetry, command history upload, or cloud service.
- `nativeMessaging` gives the extension local code-execution capability **by design**. Install only from source you trust and review its native host and permission model first.
- If you see **Native host disconnected**, confirm the bundle executable and native host registration with `install.ps1 -Action Status`, verify the Firefox temporary add-on ID matches `terminal-tabs@chromofoxext.local`, then restart the tab. If Windows Defender blocks a locally built unsigned executable, inspect the artifact and Windows security report rather than blindly disabling protections.

## Building from source

Requires Go 1.23+, Node 22+ and npm for building; **no Go/Node/.NET prerequisite is needed on the user's PC when using the Windows artifact**.

```powershell
cd terminal-tabs
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
cd native
go test ./...
go vet ./...
go build -trimpath -o ../dist/native/chromofox_terminal_host.exe .
```

The packaged extension is at `dist/extension`; the host executable is `dist/native/chromofox_terminal_host.exe`. The GitHub Actions workflow bundles both with installer scripts. The committed npm lockfile pins the full dependency graph with SHA-512 integrity hashes. CI uses `npm ci` on both Linux and Windows; the published exact-HEAD CI run and artifact remain delivery provenance for this PoC.

### Clipboard code-review disposition

Firefox's documented API behavior (Firefox 147+) supports clipboard reads from extension pages with transient activation plus a user-accepted temporary Paste prompt **without** `clipboardRead` permission. Granting `clipboardRead` would suppress this prompt but grant continuous system clipboard reading to the extension, which is unnecessary for a local terminal. We deliberately retain only `nativeMessaging`; see [Mozilla's Clipboard guidance](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard) and [Firefox 147 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/147).

Automated JS tests cover both paste entry points, approved/denied clipboard reads, missing APIs, copy failures, and stale promises after a session restart. These **do not** simulate Firefox's actual permission UI or OS clipboard. The physical Windows 11 / Firefox 159 prompt behaviour remains a final acceptance criterion rather than a claimed completed browser test.

## Manual Windows/Firefox owner acceptance

- [ ] Launch Windows PowerShell and CMD simultaneously in two Firefox tabs; each must accept input and display independent output.
- [ ] Enter and interrupt a long-running command with Ctrl+C, resize and verify readline editing works.
- [ ] Exercise ANSI colours, Unicode, very large output, and tab switching; confirm Firefox remains responsive.
- [ ] After End session and after an ordinary shell `exit`, select retained output and verify **Copy** and **Ctrl+Shift+C** still copy it without starting a shell.
- [ ] In real Firefox 159, test **Paste button** and **Ctrl+Shift+V** separately: approve the transient Paste confirmation (if shown), then cancel it and verify no input; test normal **Ctrl+V** fallback in the focused terminal. Confirm both Copy button and Ctrl+Shift+C on a selection.
- [ ] With a Paste confirmation still pending, End → Start into another shell, then approve or dismiss the old prompt: neither late success nor rejection may send input to or change the new session's status. Automated tests simulate this; actual Firefox permission UI is not emulated by Node tests.
- [ ] Exit from a shell after printing more than 32 KiB: verify all output arrives before the exit status. Paste repeatedly into a non-reading shell and verify that End session remains responsive.
- [ ] Close one terminal tab while a subprocess is running. Verify the process tree is actually gone, and other tabs remain functional.
- [ ] Test a browser restart, add-on unload, missing host binary, and reinstallation. No automatic shell start on reload.
- [ ] Confirm no listener is bound to localhost, no session data is sent to the network, and install/uninstall round trip leaves no stray registration.
- [ ] Independent security review of Windows job objects, native protocol handling and browser/tab lifecycle, with exact-HEAD CI evidence.

**Scope beyond this PoC:** Windows Terminal profile JSON import, permanent signed Firefox installation, Chromium build and live Windows Terminal tab handoff are not implemented.

Reference architecture: [Mozilla Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging), [Microsoft ConPTY](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session), [xterm.js](https://xtermjs.org/).
