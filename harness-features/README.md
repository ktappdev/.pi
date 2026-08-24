# Harness Features — pi Plugin Ideas

Ideas extracted from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`, v0.1.0-rc.5), mapped to pi extension API. Not implementations — concept + port design + sketch.

Source of truth for dsh behavior: `/Users/kentaylor/developer/deepseek-harness/docs/` + `packages/` READMEs. Pi API ground: `docs/extensions.md` (pi docs), session JSONL format (`docs/session-format.md`).

## The ideas

| # | File | dsh origin | pi hook used |
|---|---|---|---|
| 1 | [schedule-reminders.md](schedule-reminders.md) | `dsh-schedule` | `registerTool`, background timer, `pi.sendMessage` |
| 2 | [spill-store.md](spill-store.md) | `dsh-spill` + `dsh-spill-policy` | `tool_result` rewrite |
| 3 | [goal-tracker.md](goal-tracker.md) | `dsh-goal` | `/goal` command + tool + custom entries |
| 4 | [jobs-registry.md](jobs-registry.md) | `dsh-jobs` + `dsh-tool-jobs` | `user_bash` + `job_*` tools |
| 5 | [compaction-pruner.md](compaction-pruner.md) | `dsh-compaction-tool-result-pruner` + `dsh-token-meter` | `session_before_compact`, `tool_result` |
| 6 | [cross-session-search.md](cross-session-search.md) | `dsh-tool-session-query` | `registerTool`, sessionManager reads |
| 7 | [message-feedback.md](message-feedback.md) | `dsh-message-feedback`, `dsh-command-feedback` | `/feedback` command, `pi.appendEntry` |
| 8 | [secret-scrubbing.md](secret-scrubbing.md) | `docs/defensive-patterns.md` | `tool_call` env patch, temp-dir policy |
| 9 | [permission-presets.md](permission-presets.md) | `dsh-permission-presets` + `dsh-sandbox-policy` | `tool_call` gate + preset state |
| 10 | [lsp-tools.md](lsp-tools.md) | `dsh-lsp` + `dsh-tool-lsp` | `registerTool`, stdio LSP spawn |

## Meta-observations worth stealing (not plugins)

- **Append-only session log as single source of truth.** dsh: "model-visible means logged" — runtime invariant asserts anything reaching a model is reconstructable from the log. Pi already has JSONL sessions; the invariant idea (extension checking transcript reconstruction) is cheap.
- **Log-only vs surface events.** dsh distinguishes durable facts (`approval/asked`, `schedule/change`, `todo/write`) from model-visible surface. Pi extensions can copy this: store state as custom entries (`pi.appendEntry`), never inject into context.
- **Fail-closed defaults.** Approval seam fails closed to `unavailable` when no answerer; unrecognized required log events refuse reconstruction. Good policy to copy in permission gates.
- **Capability seam discipline** (Service Definition / Provider / Consumer split) is an architecture rule, not a pi plugin idea — pi extensions are flat; just keep one interface per concern.
