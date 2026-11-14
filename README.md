# chromofoxEXT

Source-preservation and future development workspace for small **Firefox** and **Chrome/Chromium** browser extensions.

This repository contains **original, recoverable implementations** rather than speculative specifications. Most have not passed owner acceptance in a live authenticated browser session. It is **not** an extension store, signed distribution, or claim that all modules are production-ready.

## Implementations

| Browser | Implementation | Current status |
| --- | --- | --- |
| Firefox | [GitHub Actions Jumper v2](firefox/actions-jumper-v2/README.md) | Source preserved; 13/13 Node tests passed; live Firefox acceptance pending |
| Firefox | [ChatGPT Message Timestamps v1.0.0](firefox/chatgpt-timestamps/README.md) | Source preserved; 5/5 Node tests passed; live Firefox acceptance pending |
| Firefox | [ChatGPT Tab Signal v1.0.0](firefox/chatgpt-tab-signal/README.md) | Source preserved; 11/11 Node tests passed; live Firefox acceptance pending |
| Firefox | [Actions Jumper v1](firefox/actions-jumper-v1-legacy/README.md) | Historical superseded implementation, preserved for comparison |
| Chrome/Chromium | [ChatGPT QOL Suite](chrome/chatGPTchromeQOL/chatgpt-qol-suite/README.md) | 13-module consolidated extension; historical automated Chromium qualification; modules opt-in except Send Guard |
| Chrome/Chromium | [13 standalone extensions](chrome/chatGPTchromeQOL/README.md) | Historical implementations retained for comparison/rollback; only the 5.6 Send Guard had prior field testing |

The Chrome suite's 13 features are **not 13 additional signed releases**. They correspond to modules migrated from the standalone implementations. See [detailed inventory](docs/INVENTORY.md).

## Getting started

**Firefox:** extract or open one project directory; in Firefox open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select its `manifest.json`. Refresh existing ChatGPT tabs if required. Temporary extensions are unloaded when Firefox closes, and these are **unsigned**. The original ZIP files are preserved in [firefox/original-zips](firefox/original-zips).

**Chrome/Chromium:** open `chrome://extensions/`, enable Developer mode, select **Load unpacked**, and point to `chrome/chatGPTchromeQOL/chatgpt-qol-suite/`. The suite defaults to only Send Guard enabled. Do not run the matching standalone extensions simultaneously.

**Source-integrity and lightweight tests:**
```bash
python scripts/check_source_integrity.py
node --test firefox/actions-jumper-v2/tests/*.test.cjs
node --test firefox/chatgpt-timestamps/tests/*.test.js
node --test firefox/chatgpt-tab-signal/tests/*.test.js
python chrome/chatGPTchromeQOL/chatgpt-qol-suite/tests/test_manifest.py
```
These commands test source custody and selected logic, not live Firefox or Chrome behavior.

## Documentation

- [Design intent and constraints](docs/DESIGN_INTENT.md)
- [Inventory and project states](docs/INVENTORY.md)
- [Owner acceptance runbook](docs/ACCEPTANCE.md)
- [Original source and verification](docs/PROVENANCE.md)
- [Security, permissions and local data](docs/PRIVACY_AND_PERMISSIONS.md)
- [Cross-browser development notes](docs/PORTING.md)

**Cancelled/out of scope:** the Terminal Courier / Interlocuator bridge and the proposed unified ChatGPT/Codex quota-tracker extension. Existing Chrome local counters and effort-ledger prototypes are included **only because they were already implemented**; they are not a resurrection of the cancelled unified tracker.

No Mozilla signing, Chrome Web Store publishing, merged release, or human browser-acceptance claim is implied by this archive.
