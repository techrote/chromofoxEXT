# Permissions, storage and privacy review

Review each manifest independently; these are **development copies**, not a blanket assertion that every module is safe or approved for publication.

- **Firefox Actions Jumper:** requests `storage` and `https://api.github.com/*` to retrieve public repo names; saves usage/popularity and settings locally. No GitHub token, history permission or authenticated account scraping.
- **Firefox Message Timestamps:** requests `storage`, runs on ChatGPT origins, keeps conversation/turn identifiers and local timestamps; original design does not store message body text.
- **Firefox Tab Signal:** requests `storage`, observes ChatGPT UI controls/title/favicon and displays local state. Does not need ChatGPT API access or capture message bodies.
- **Chrome suite:** `storage`, `notifications`, content scripts on ChatGPT domains. Some opt-in modules deliberately store or manipulate user-authored content, notably the draft **Prompt Snapshotter** and **Copy for Codex**. Treat such stored records as potentially sensitive; test deletion/export/reset paths. Do not infer that the privacy claims of the Firefox utilities apply to Chrome modules.

This code is not an OpenAI, GitHub, Mozilla, or Chrome service. DOM selectors are fragile and may change when the target websites change. Counters and model/effort observations from browser UI are **not** authoritative subscription allowances, billing records or API quota. The separate unified quota-tracking project is cancelled.

Before testing or distributing, review currently requested permissions, sensitive-data paths, active URL matches, content security policy, export/import validation, external network requests, and interactions with uBlock/content blockers. Prefer no additional permissions.
