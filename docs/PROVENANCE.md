# Source provenance and qualification custody

## Chrome/Chromium

**Upstream repository:** [techrote/chatGPTchromeQOL](https://github.com/techrote/chatGPTchromeQOL)  
**Exact source commit:** `d43c61b1bba7d465cc35d6293b1af6debc7de186` (12 October 2026)  
**Imported files:** 72, including the consolidated suite, thirteen standalone prototypes, original docs, tests, SVG/PNG and the original workflow as an inert historical nested file.

The 72 files under `chrome/chatGPTchromeQOL/` retain their original path-relative Git blob SHAs. The upstream was not rewritten or retired. Its own README records 36 automated Chromium checks and earlier 5.6 Send Guard field-testing; no new Chrome acceptance was executed in this import.

## Firefox

The authoritative source is four original previously generated ZIPs preserved in the owner's ChatGPT Library, recovered without modification on 14 November 2026. Their complete uncompressed contents were also imported into 56 browsable files under `firefox/`.

| Original archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `firefox-actions-jumper.zip` (v1, superseded) | 5,871 | `f25dafcd0e8f30032e982b633ab4fef8b3d57270d379dc182bfc2507a075f40b` |
| `firefox-actions-jumper-v2.zip` | 26,115 | `5a59a4d6425ca131ff9c3bb7c77d6c11ba8cc95455717130ab7ca6b5367ad9a0` |
| `chatgpt-timestamps-firefox-v1.0.0.zip` | 15,094 | `942cd34813e82589347f02dc5488f5640394598d3b6bc1bacafe13523498ecce` |
| `chatgpt-tab-signal-source-1.0.0.zip` | 38,869 | `df24a28232c34abf79a026fbcdaace7daddaf1f44484127098f2967ea43047e9` |

All four ZIP Git blobs were independently compared against their locally computed Git object identities before being attached to the repository tree. Each of the 56 extracted files was compared with the original ZIP entry's Git blob SHA; all matched.

**Re-run local unit tests (14 Nov):** Actions Jumper 13/13; Timestamps 5/5; Tab Signal 11/11; all pass. No Playwright/browser-fixture tests were run during this import. No authenticated live Firefox owner acceptance was performed.

## Reproducibility

`docs/SOURCE_INTEGRITY.json` pins SHA-1 Git blob identities of all 128 imported source files plus 4 exact ZIPs. Run `python scripts/check_source_integrity.py` to check bytes locally. Git blob SHA-1 here is a custody check, **not** proof of security against targeted collisions or a publisher's signature.

The Chrome source directory is a **snapshot of a separate public repository**, not a Git submodule. Future changes must identify their provenance and not claim upstream byte identity once modified.

The source packages did not contain a project-wide license grant. Do not infer a redistribution license or add a license without the owner's explicit licensing decision.
