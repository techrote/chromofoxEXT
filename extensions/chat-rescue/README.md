# CHAT-RESCUE-001 — Stuck ChatGPT conversation rescue

**Experimental browser extension**, Firefox first, Chrome second. No backend, telemetry, network requests, message extraction, or hidden API usage. The extension does **not** download entire conversations yet; that is a separate milestone in [issue #4](https://github.com/techrote/chromofoxEXT/issues/4).

## Approaches implemented

1. **Guided real-click experiment** (16 seconds / 30 trusted click cap). Displays a small page overlay, counts real clicks within 125px of a detected spinner (or centre fallback), and compares clicks elsewhere. This is the only approach using actual trusted user-generated mouse clicks.
2. **Focus + repaint nudge**. `window.focus()`, a 1px scroll and restoration, a layout read and synthetic resize, then observe for 3 seconds. No navigation.
3. **Synthetic pointer pulse**. 16 bounded sequences around an identified spinner. `isTrusted === false`; may do nothing if React/browser checks trusted interactions. Skips buttons, links, form controls, editable surfaces. If no spinner is found, does nothing.
4. **Safe sequence**. Run focus/repaint; observe, then synthetic pulse if a spinner remains, and observe. No reloads.
5. **Normal reload**. Explicit user confirmation; may lose unsent text.
6. **Bypass-cache reload**. Explicit user confirmation; may lose unsent text. Caches and service workers still have browser-specific behaviours; this is not a guaranteed total cache purge.
7. **Open fresh tab**. Clone the current conversation URL in a new active tab, preserving the original tab.

A **Stop** button cancels active observation and guided clicking without reloading. Content-script state is per-page, so navigation/reload discards its previous diagnostics. Copy diagnostic JSON includes only state/metadata, never conversation text.

## Build and load

Requires Node 18+; no npm dependencies:

```powershell
cd extensions/chat-rescue
node build.mjs
```

Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select `dist/firefox/manifest.json`. Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/chrome`.

**Reload ChatGPT tabs after installing.** On an open `https://chatgpt.com/c/<uuid>` thread, click the extension's toolbar icon to see the diagnosis and experiment buttons. With guided clicking, return focus to the ChatGPT page; the small overlay remains available even when the popup closes.

Run tests:

```powershell
node --test tests/*.test.mjs
```

## What it can and cannot diagnose

- `messages-visible` means at least one transcript marker exists in the live DOM. It **does not** establish that every message, alternate branch, asset or tool output loaded.
- `loading-indicator` means a CSS/ARIA spinner candidate was detected. Selectors are heuristics; a UI release may change them.
- `unconfirmed` means neither known message marker nor spinner was detected. It is not evidence the conversation was deleted.
- Synthetic pulses **cannot** reproduce OS-level pointer input or bypass an `event.isTrusted` check.
- Opening a new tab/reloading simply asks the official ChatGPT frontend to try again; it never calls hidden authenticated endpoints, changes cookies, or guarantees recovery.
- Actual lost conversations require separate recovery via previously saved backups or the official account data export. Do not upload exports to unknown services.

## Privacy, safety, and review

- Content scripts only load on `chatgpt.com` / `chat.openai.com`; recovery actions are available only under `/c/<id>`.
- No transcript content is copied, saved, uploaded, logged, or sent to the popup. The only text inspected is a small number of alert/error elements to classify a loading failure.
- No background page, remote scripts, `storage`, network/XHR, external permissions or automatic reload loop.
- Reload / bypass cache / new-tab navigation requires the user's click. The extension does not promise that an unload will preserve unsent text or uploaded files.
- For security, the per-page overlay uses a closed shadow DOM and `textContent`. No remote HTML interpolation.

### Suggested manual A/B experiment

Run each condition from a genuinely stuck thread: (1) no click/wait 16 seconds, (2) real clicks around spinner, (3) same number of clicks elsewhere in blank transcript, (4) focus/repaint, (5) synthetic pulse, (6) reload, (7) new tab. Repeat where possible and record success/time; otherwise ordinary waiting may explain the apparent effect. When reporting, compare network/console behaviour without disclosing credentials or conversation content.

**Status: experimental engineering implementation, not independently validated against a real production ChatGPT load failure.**
