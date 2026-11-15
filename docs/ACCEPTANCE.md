# Owner acceptance runbook

**Status at intake (14 November 2026): no proper owner acceptance of the three Firefox extensions.** Automated Node results were rechecked during archival: Actions Jumper 13/13, Message Timestamps 5/5, Tab Signal 11/11. Chrome has historical fixture qualification, but this import ran no fresh authenticated Chrome/Firefox UI tests.

## Preparation

Use Windows 11 Firefox as the primary acceptance browser, ideally a clean separate Firefox profile. Load **one temporary add-on at a time** using `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → project `manifest.json`. Refresh ChatGPT tabs after loading content scripts. Record Firefox version, extension source folder, date and any add-ons that might interfere (including content blockers). Test both ordinary and private browsing only if the extension is explicitly granted permission.

## GitHub Actions Jumper v2

- Choose a GitHub owner and Actions query (running, queued, failed, all); verify resulting URL/query.
- Popup autocomplete: short/long prefixes, Tab acceptance, Up/Down, Enter and Ctrl+Enter, Escape, private manually entered repo.
- Native Firefox omnibox keyword `ga `: suggestions and navigation.
- Popularity ranking persistence, options-window edit/clear, offline fallback, GitHub rate limiting.
- Temporary removal/reload and storage behaviour; note that opening a repository URL does not prove repository existence.

## ChatGPT Message Timestamps

- New user send vs assistant first appearance, refresh/reopen, regenerate/retry, multiple chats.
- Old messages remain unlabelled by default; toggle **Mark older messages** and ensure `First seen` is clearly distinct from creation time.
- Locale/time format, display-off-but-capture-on, JSON export/import, clear/reinstall, duplicate message/turn detection.
- Missing/unstable message IDs, temporary chats, rapid sends and navigation, clocks set incorrectly.
- Verify no prompt or response text enters stored records.

## ChatGPT Tab Signal

- Two or more concurrent ChatGPT tabs: idle → working → finished, background-tab latching until revisit.
- Explicit Stop click → stopped (not finished); visible error → error; error fallback if control labels change.
- Original page title/favicon restored; popup and toolbar settings; SPA navigation; rapid Stop/status changes.
- Check favicon caching, pinned tab display, Firefox background throttling and tab transitions.

## Chrome QOL Suite

- Open `chrome://extensions/`, enable Developer mode, load unpacked suite folder.
- Confirm only Send Guard starts enabled; toggle each of thirteen modules independently; refresh and verify persistence.
- Exercise shared send-interception with each send-related module individually and in combinations; ensure no double-send or deadlock.
- Check dashboard, local data export/import where offered, historical standalone rollback and disable duplicates.
- Test against current authenticated ChatGPT DOM, multiple ChatGPT tabs, long threads and partially completed responses. Count/model data are **not** proof of account quota or billing.

## Release gates

A pass requires manual evidence (Firefox and optionally Chrome versions, scenario, result, screenshot/log, defects). Distinguish **test passed in fixture**, **field-tested earlier**, **owner-accepted now**, **Mozilla-signed**, and **published**. None should be inferred from another.

Additional cross-browser work (porting the Chrome suite to Firefox, reconciling Tab Signal with the Chrome completion watcher, shared settings) is future work requiring its own design/acceptance; this PR preserves source only.
