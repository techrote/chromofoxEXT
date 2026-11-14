# Extension inventory

## Firefox implementations

| Name | Version/source | Capability | Acceptance status |
| --- | --- | --- | --- |
| GitHub Actions Jumper | v2.0.0 | GitHub repo suggestion scoring, toolbar popup, `ga` omnibox, Actions filter | 13/13 automated tests; not human-tested |
| ChatGPT Message Timestamps | v1.0.0 | Local message event timestamps, display preferences and JSON export/import | 5/5 automated tests; not human-tested |
| ChatGPT Tab Signal | v1.0.0 | Local tab title/favicon/toolbar badges for observed generation state | 11/11 automated tests; not human-tested |
| GitHub Actions Jumper legacy | v1.0 | Historical first iteration | Superseded by v2; no new acceptance performed |

## Chrome/Chromium originals

The standalone source directories below and the corresponding suite modules are retained **together**, so experiments can compare migration behaviour against the original prototypes.

| Original directory | Design purpose | Historical state |
| --- | --- | --- |
| `chatgpt-56-send-guard` | Gate send when visible model is not GPT-5.6 | Field-tested standalone; suite default ON |
| `chatgpt-pro-message-counter` | Observed local send count | Prototype, NOT authoritative account quota |
| `chatgpt-model-effort-ledger` | Model/effort records and JSON export | Prototype |
| `chatgpt-model-cost-guard` | Caution on heavy visible settings | Prototype |
| `chatgpt-conversation-model-history` | Model/effort history by conversation | Prototype |
| `chatgpt-prompt-snapshotter` | Draft/sent prompt capture for recovery | Prototype; handles potentially sensitive prompt text |
| `chatgpt-repo-context-badge` | Detect project/repo context | Prototype |
| `chatgpt-long-prompt-warning` | Approximate length/token-warning guard | Prototype |
| `chatgpt-accidental-send-guard` | Catch unfinished-looking messages | Prototype |
| `chatgpt-chat-project-index` | Chat-to-repository/task index | Prototype |
| `chatgpt-response-completion-watch` | Detect observed ChatGPT response finish | Prototype |
| `chatgpt-branch-issue-extractor` | Extract issue, PR, branch and commit references | Prototype |
| `chatgpt-copy-for-codex` | Copy a selection or assistant reply for coding-agent handoff | Prototype |

The consolidated `chatgpt-qol-suite/` provides **one 13-module implementation**, not another set of 13 independent standalone extensions. Its migrated modules are structurally different and need independent acceptance. The suite's historical 36-check Chromium regression is separate from owner validation.

**Cancelled proposals, not work items:** Terminal Courier / Interlocuator and a unified Firefox/Chrome/Codex quota tracker. The existing Pro counter and effort-ledger code remain archival implemented examples, not approval to restart that proposal.
