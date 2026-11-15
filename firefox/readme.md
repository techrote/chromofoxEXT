# Firefox implementations

| Directory | Purpose | Notes |
| --- | --- | --- |
| [actions-jumper-v2](actions-jumper-v2/) | Search/jump to GitHub Actions with personal ranking, popup and `ga` omnibox | Current v2 source, 13/13 Node tests passed |
| [chatgpt-timestamps](chatgpt-timestamps/) | Observe/save local ChatGPT message timestamps | First-seen stamps are not server-side creation timestamps; 5/5 Node tests passed |
| [chatgpt-tab-signal](chatgpt-tab-signal/) | Per-tab working/done/stopped/error title and favicon indicators | UI-observation-based, not authoritative completion; 11/11 Node tests passed |
| [actions-jumper-v1-legacy](actions-jumper-v1-legacy/) | Superseded v1 GitHub Actions popup | Retained to preserve historical source |
| [original-zips](original-zips/) | Exactly recovered original ZIP packages | Hashes and custody in [provenance](../docs/PROVENANCE.md) |

**These builds have NOT yet been properly tested by the owner.** All test counts above refer to automated local tests repeated during the import on 14 November 2026.

To load an unsigned development build: visit `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `manifest.json` from the desired directory. The add-on disappears on restart. For permanent distribution, review and obtain Mozilla signing; do not rename ZIP to XPI and assume signing.

Avoid testing all three simultaneously at first. Validate individually in a fresh Firefox profile, then assess interactions, DOM changes and storage handling together. See the [acceptance runbook](../docs/ACCEPTANCE.md).
