# ChatGPT Message Timestamps — Firefox

An independent, no-build Manifest V3 Firefox extension. Adds discreet, locale-aware date/time labels to ChatGPT turns and stores the timestamps in **Firefox extension-local storage**. No external network calls, no access to message text, no OpenAI API or private endpoint usage.

## Install / test

1. Download `chatgpt-message-timestamps.zip` and unzip it (or use the ZIP directly).
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on** and choose `manifest.json` in the extracted directory, or choose the ZIP.
4. Open or refresh `https://chatgpt.com/` and send a message.
5. Click the extension's toolbar entry (under Extensions if not pinned) to change options, export/import records, or clear them.

**Temporary add-ons are unloaded when Firefox restarts.** For permanent installation on standard Firefox, the extension needs Mozilla add-on signing (self-distribution or Add-ons for Firefox). The source is ready for publishing but the supplied ZIP is unsigned. Keep the same extension ID (`chatgpt-message-timestamps@local.addon`) across builds.

## Semantics and limitations

- **Your new message:** timestamp at a detected send action (Enter in ChatGPT's composer, its Send button, or composer form submit), committed once the new message turn is observed. Sending without the normal controls may not be detected.
- **New assistant reply:** timestamp when a new assistant turn first appears in this browser following a recorded send or an observed Regenerate/Retry action. Not the end-of-generation time.
- **Already existing conversation messages:** their true original creation times generally cannot be recovered from the visible ChatGPT page. By default they are left unlabelled unless previously recorded. In the popup, enable **Mark older messages** to give unrecorded turns a clearly labelled **First seen:** date/time (not a creation time). This also saves those first-seen records.
- Values reflect your device clock, not authoritative server-side creation timestamps.
- Records stay in the same Firefox profile across reloads/restarts while the extension is installed. They are not synced to other browsers/devices. Export/import JSON to back them up or move them.
- ChatGPT frontend markup can change; the extension uses `article[data-turn-id]`, `data-message-id`, `data-message-author-role` and the ChatGPT composer. Updating selectors might be required.
- Temporary chats without a stable `/c/<id>` route can show current-session timestamps, but cannot persist reliably. Messages must have stable turn/message IDs for persistence.
- Disabling **Display timestamps** hides existing labels but still captures new timestamps.
- If you delete the add-on or Firefox removes its extension storage, export is the only way to preserve the records. Do not assume temporary-install data survives reinstall.

## Privacy

Permissions are restricted to `storage` and the ChatGPT domains. Values are per-message metadata (conversation ID, turn/message ID, timestamp and source). **Message content, prompts, response text, account credentials, cookies and authentication tokens are neither read nor saved.** No analytics, remote servers or telemetry.

## Files

- `manifest.json` — Firefox MV3 metadata.
- `shared.js` — validation, record preference and date formatting.
- `content.js`, `content.css` — capture, persistence, and page labels.
- `popup.html`, `popup.js`, `popup.css` — options and JSON backup/restore.
- `tests/` — tests and instructions.

### Local validation

```bash
node --test tests/core.test.js
node --check content.js
node --check popup.js
```

For a permanently installed version, submit the extension for signing at https://addons.mozilla.org/developers/ (unlisted signing is possible).
