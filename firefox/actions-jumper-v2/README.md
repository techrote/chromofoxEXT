# GitHub Actions Jumper — Firefox, v2.0

Quick repository navigation into GitHub Actions. Version 2 separates all settings from the tiny entry popup, adds developer-editor-style inline completion, and learns local per-repository popularity.

## What Firefox allows (important)

A standard Firefox WebExtension **cannot add a permanently visible editable HTML field directly to the browser's native toolbar beside the address bar**. This package uses both supported near-equivalents:

1. **Toolbar button**: right-click Firefox's toolbar, choose **Customize Toolbar**, and pin/move the extension button beside the address bar. Click to open a popup containing **only the repository field and autocomplete** (plus a tiny configuration gear).
2. **Native address bar**: type `ga` followed by a space and start typing a repository name. Select a ranked suggestion from Firefox's native address-bar drop-down, then press Enter. The extension cannot paint ghost text within Firefox's built-in address bar; inline ghost completion is available in its own popup.

Neither mode uses a fake persistent input, elevated browser privileges, nor browser-chrome file modifications.

## Temporary install (no signing required)

1. Extract `firefox-actions-jumper-v2.zip`.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Remove the previously loaded temporary v1 extension, if present. Click **Load Temporary Add-on…** and select the extracted `manifest.json`.
4. Click the toolbar icon and enter part of a repository name.
5. Use the gear to open a **separate configuration window**.

Firefox removes temporarily installed add-ons when it closes. Persistent installation normally requires Mozilla signing (not included here).

## Navigation and completion

- Type a repository name. The first completion appears as a **grey inline suffix** in the text field.
- **Tab** accepts the current inline suggestion without navigating.
- **Enter** opens the top ranked suggestion in a new tab; Up/Down chooses another suggestion.
- **Ctrl+Enter** opens the exact repository string typed, bypassing autocomplete. This also works for private repositories unavailable to the anonymous API.
- **Escape** dismisses suggestions. Clicking a suggestion opens it.
- You can also type **`ga `** in the native Firefox address bar, followed by the name.
- For keyboard access to the popup, try **Ctrl+Shift+.** (customise it in Firefox's extension shortcut settings if Firefox reports a collision).

### Personal popularity

After each successful extension-triggered navigation, the extension saves locally:

- lifetime open count;
- timestamp of last open;
- a decaying usage score (30-day half-life).

For zero-, one-, and two-character prefixes, suggestions are ordered **primarily by decayed personal popularity**, then by total count, then recency. Only after those comparisons does alphabetical order determine the rank of equally unknown repositories. Longer prefixes prioritise exact/start-of-name matches, followed by popularity. Previously visited private repositories are included even if the GitHub API does not list them.

The options window shows the top repositories and can clear popularity history for the configured owner. No usage data is transmitted to GitHub or another service.

### Configuration

Set GitHub account and **Active GitHub Actions query** in the separate configuration window. Change the active query directly, or select one of the editable presets. Defaults:

- Running — `is:in_progress`
- Queued — `is:queued`
- Failed — `conclusion:failure`
- All runs — empty filter

For example, `is:in_progress branch:main` creates a URL of the form:

`https://github.com/techrote/cybersand/actions?query=is%3Ain_progress%20branch%3Amain`

The encoded query applies to all navigation paths, including the address-bar keyword mode. The GitHub Actions page interprets the actual supported search syntax.

### Data / limitations

- Uses the unauthenticated `https://api.github.com/users/{owner}/repos` endpoint for public names (up to 1000, paginated).
- Uses `storage.local` and caches names for 30 minutes; automatically falls back to stale names on offline / API errors (and rate-limits retries).
- You can type private repository names manually and they'll be learned from successful navigation attempts. **Opening a tab does not confirm the repo exists or that the user has access.**
- No GitHub token, no read access to web pages, no browsing-history permission.
- Popup and native address-bar autocomplete share the same usage data; the toolbar field has visual ghost completion, while the built-in address bar uses the native suggestions menu.
- This is an unsigned development package. JavaScript and unit tests are included; browser-level integration should be tested manually in Firefox.

## Development

Run `node --test tests/*.test.cjs` to test scoring, query construction and migration logic. No npm dependencies.
