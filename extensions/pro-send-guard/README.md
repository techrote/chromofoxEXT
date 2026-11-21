# PRO-SEND-GUARD-001 — ChatGPT Pro send confirmation

**Firefox-first browser extension**, with a Chromium MV3 build. Every recognised **ChatGPT Pro model** send requires an explicit native browser confirmation dialog. It protects against accidentally sending a trivial prompt with a limited Pro-model allowance. It is **not** an official ChatGPT feature and cannot determine actual server-side quota charging.

## Behaviour

- Prompts for Pro-labelled model picker states, including **Pro**, **Pro Standard/Extended**, **GPT-6 Pro** and **GPT-5.6 Pro**.
- Checks the currently displayed composer model at **each send attempt**; does not assume that a model choice remains unchanged across conversations.
- Uses capturing listeners for **Enter**, **Send-button clicks** and **form submission**. Shift+Enter, active IME composition, and autocomplete menus do not trigger it. Repeated keydown is blocked while Pro or unknown-mode protection applies.
- **Cancel** suppresses the original event; **OK** allows that same event to proceed without synthetic replay, altering focus, rewriting the draft, or automatically switching model.
- Defaults to confirming **unknown model state** too. The popup lets you disable this fallback if it is too conservative. It also has an enabled toggle.
- An approved user gesture permits only one same-composer follow-on form submission (within 400 ms), not future independent trusted clicks or key presses. Every new user send requires a separate decision.

### Limits and important caveats

This is DOM-based UI protection, not a browser-level or server-side quota firewall. **ChatGPT can change its markup, event handling or model-selection flow.** A site event handler that ran before the content script, a send path without captured DOM events (voice, special integrations), or server-side model rerouting may evade the guard. **Never assume an unprompted send is guaranteed non-Pro.** The conservative unknown-mode default helps but cannot ensure total coverage. The browser-native confirmation is chosen specifically so the original trusted event can proceed on approval, and a denial cannot accidentally replay it.

It never reads conversation history, logs prompt text, calls ChatGPT endpoints, uses a background service, or sends telemetry. The only persistent values are the two local settings. No `tabs`, `activeTab` or network permissions.

## Build and test

Requirements: Node 18+, no npm dependencies.

```sh
cd extensions/pro-send-guard
node build.mjs
node --test tests/*.test.mjs
python tests/browser-smoke.py   # optional: Playwright 1.56 + local Chromium
```

Firefox 159: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick `dist/firefox/manifest.json`. Open/reload `https://chatgpt.com/` to activate the guard. Temporary add-ons disappear after restarting Firefox.

Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/chrome`.

## Owner acceptance before enabling normal use

1. On Firefox with a **safe draft**, select GPT-6 Pro or GPT-5.6 Pro, send by both Enter and button; **Cancel** must preserve text and produce no new message; **OK** should submit exactly once. Repeat for every Pro message.
2. Change to Instant/Medium/High/Extra High or Sol and verify no confirmation is shown when that choice is clearly identified. Test Pro Standard/Extended where present.
3. Change model without refreshing; navigate existing ↔ new chats, verify the guard tracks the visible selection. Test the message composer with attachments.
4. Turn off unknown-model protection in the popup and check the fallback difference; turn it back on. Test Shift+Enter and IME composition without a confirmation.
5. Keep the extension isolated from other chromofoxEXT extensions during acceptance, then check coexistence. Inspect console errors.

**Status:** Draft/HOLD; offline browser tests are not a substitute for real Firefox 159 / ChatGPT acceptance. Do not merge or mark Ready without owner approval.
