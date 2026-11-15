# Chrome / Chromium implementations

[Original source snapshot](chatGPTchromeQOL/) from [techrote/chatGPTchromeQOL](https://github.com/techrote/chatGPTchromeQOL) at commit `d43c61b1bba7d465cc35d6293b1af6debc7de186` (12 October 2026). All **72 source files are byte-identical** to that commit.

- [ChatGPT QOL Suite](chatGPTchromeQOL/chatgpt-qol-suite/README.md) — one MV3 extension, 13 independently togglable modules with shared send interception and a dashboard. The originally field-tested GPT-5.6 Send Guard is the only default-enabled module.
- [Original standalone catalogue](chatGPTchromeQOL/README.md) — thirteen individually loadable implementations, primarily prototypes retained for comparison/rollback.
- [Original suite tests](chatGPTchromeQOL/chatgpt-qol-suite/tests/) — manifest and Chromium fixture tests. Historical work reported 36 automated checks, **not a new live-browser acceptance**.

Install the suite from `chrome://extensions/` → Developer mode → **Load unpacked** → `chrome/chatGPTchromeQOL/chatgpt-qol-suite/`. Disable standalone versions of equivalent modules while testing.

This copy is a preservation baseline; the original GitHub repository remains linked for provenance. See [porting notes](../docs/PORTING.md) before claiming Firefox compatibility.
