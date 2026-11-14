# ChatGPT Tab Signal (Firefox)

A small, local-only Firefox WebExtension that marks ChatGPT conversation tabs as:

| Status | Tab title | Favicon | When |
|---|---|---|---|
| Idle | Original title | Original favicon | No activity observed |
| Working | `⏳` | Blue / white stop square | ChatGPT's Stop button is visible |
| Finished | `✓` | Green / white tick | Stop button disappeared after an active response |
| Stopped | `■` | Grey / white dash | You clicked ChatGPT's Stop button |
| Error | `!` | Red / white exclamation | Explicit error alert detected after activity |

A small badge on the **extension toolbar icon** also reflects the current tab's state. Each conversation tab is tracked independently. The popup lets you turn title, favicon and toolbar indicators on/off, choose whether finished states remain visible until visited, and clear a completed tab's status.

## Install in Firefox (temporary / testing)

1. Download `chatgpt-tab-signal-1.0.0.zip`.
2. Enter `about:debugging` in Firefox's address bar.
3. Select **This Firefox** → **Load Temporary Add-on…**.
4. Select the downloaded `.zip` directly. Alternatively, extract it and select `manifest.json`.
5. **Reload existing ChatGPT tabs** once to activate the content script.
6. Optionally pin the toolbar icon and click it to change settings.

**Important:** A temporary extension is removed when Firefox is restarted. Normal Firefox requires Mozilla signing for permanent installation. For a lasting version, submit the extension to [AMO as an unlisted add-on](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) for signing, then install the signed `.xpi`. The supplied archive is not signed, and merely renaming it to `.xpi` does not make it persistently installable in release Firefox.

## How detection works

- A `MutationObserver` detects changes in ChatGPT's DOM, particularly the Stop control in the message composer. This is **UI detection**, not API polling.
- State transitions are tracked locally inside each tab. A response is only marked finished after an observed working state; opening a historical conversation doesn't produce a false completion.
- Clicking **Stop** is captured before ChatGPT removes the button, and is reported as *Stopped* instead of *Finished*.
- The completion marker is latched on background tabs. It clears about 2.5 seconds after revisiting them or when you interact with the page (subject to the popup setting).
- ChatGPT's original title and favicon are restored when the status is cleared. The title is re-applied if ChatGPT updates it during generation.
- SPA conversation navigation resets the status; every browser tab retains its own independent state.

## Privacy and permissions

Only the `storage` WebExtension permission is requested. The extension's content script runs on `https://chatgpt.com/*` and legacy `https://chat.openai.com/*`; favicon images are bundled locally in the extension.

**No remote requests, no telemetry, no content extraction, no authentication/token handling.** The script reads control labels, visible error-alert text, page title and favicon links. It does not read conversation messages to determine completion. Settings are saved locally using `browser.storage.local`.

## Caveats

- ChatGPT's UI is not a public stability contract. Changes to Stop button markup may require adjusting the selectors in `core.js`.
- If ChatGPT renders a fleeting Stop button faster than the observer samples it, that response might not be detected.
- The error state requires a visible, recognised error alert. Silent failures may look like completion; no promise is made to detect every kind of user-input requirement.
- The extension distinguishes manual Stop clicks, but a stop induced by keyboard shortcut or programmatic action may be indistinguishable from successful completion.
- If Firefox or ChatGPT aggressively caches favicon assets, a tab might not show the updated icon immediately. The tab-title prefix and toolbar badge are independent fallbacks.
- A tab opened while a response is already active is shown as working once the Stop control becomes visible.

## Development / tests

No build tools or external JavaScript dependencies are required.

```bash
node --test tests/*.test.js
```

All source files are plain HTML, CSS, JavaScript and PNG. The `core.js` module can be tested in isolation, and a local browser fixture exercises the injected content script with simulated ChatGPT Stop and Send controls. Run `python tests/browser-test.py` if Python Playwright and Chromium are installed. Live Firefox/ChatGPT compatibility must still be verified on the target installation.

This extension is an independent utility, not affiliated with OpenAI or Mozilla.
