# Design intent and maintenance principles

## Why this repository exists

Collect the actually implemented Firefox and Chrome/Chromium WebExtensions into a recoverable, inspectable home for later testing, repair, and deliberate cross-browser development. Preserve both implementation **and the reasoning behind its boundaries**; avoid retroactively converting prototypes into released products.

## Principles to retain

- **Observable facts over fabricated certainty.** Timestamp labels represent local observations, not unrecoverable server creation times; tab completion means a UI transition was observed, not a backend acknowledgement; visible model labels and counters are not billing or quota telemetry.
- **Narrow permissions and local state.** Prefer browser-local storage, specific host matches, no credential scraping, no unnecessary network permissions. Data-sensitive Chrome modules must be reviewed separately before enabling.
- **Browser-native interaction.** Actions Jumper uses a popup and Firefox-supported `ga` omnibox keyword rather than attempting an unsupported persistent HTML field inside browser chrome.
- **Modular and reversible.** Keep standalone modules available as baselines; in the consolidated suite, one send-interception path prevents multiple modules independently blocking/sending a message.
- **Keyboard-first and low-friction.** Popup completion, clear toggles, manageable dashboards, simple recovery/export features.
- **Source integrity before modification.** The imported directories are unmodified snapshots. Carry experimental changes on new branches or in clearly designated future development work, with separate acceptance gates.
- **Avoid overclaiming.** Automated fixtures can prove local state logic and selector behaviour against a fixture. They cannot prove compatibility with current authenticated ChatGPT UI, real browser extensions, Firefox persistence or signed distribution.

## Key product distinctions

**Actions Jumper** solves repeated navigation to a repository's filtered Actions page; autocomplete ranking is locally learned and does not require GitHub authentication. Manually entered private repo names can be used without API listing.

**Message Timestamps** makes when-you-saw/sent/replied events inspectable and exportable, with explicit first-seen fallback for older turns. It is not a forensic reconstruction of historical message times.

**Tab Signal** solves tab-attention management: one tab can finish while another remains in progress. It operates on visible ChatGPT Stop/error controls, with latched background-tab completion and restoration of original title/favicon.

**Chrome QOL Suite** aggregates 13 experimental workflow helpers around a common settings dashboard, storage and send interception. Only the earlier 5.6 Send Guard had prior standalone field testing; migration itself must still be qualified.

## Non-goals

Do not revive cancelled Terminal Courier / Interlocuator or the unified quota-tracker proposal. Do not introduce remote auth or scraping, automatic publication/signing, or assume Chrome MV3 APIs translate 1:1 into Firefox. No unsolicited UI redesign in this archive import.
