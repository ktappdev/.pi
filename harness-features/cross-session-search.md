# 6. Cross-Session Search

**Origin:** [`dsh-tool-session-query`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/session-query/tool-session-query) + `dsh-session-query-sqlite`

## Concept

Model-facing tools over *past sessions*: `session_search` (full-text), `session_event_search`, `session_trace`, `session_event_read`. The agent can ask "what did I do last week when the build broke?" and get a snapshot of an old session injected as context. Authorization is workspace-scoped: cross-session access requires the target session's `cwd` to exactly equal the caller's; unknown and cross-workspace ids behave identically (no oracle).

dsh details:
- `session_search` always omits the caller session; parent-id dedup; FTS against a sqlite backend with ranking + snippets.
- A current-session search stops immediately before the step that invoked it, so the active output can't match itself.
- Lineage output replaces unauthorized ancestor/descendant boundaries with markers containing no hidden session id.
- Search consumes provider cursors internally — no page-size knobs exposed to the model; `maxSearchResults` (default 100) is a config, not a tool arg.
- Every result crosses one sanitizer at the model boundary.

## Why port to pi

Pi sessions are JSONL files under `~/.pi/agent/sessions/--<cwd>--/`. The *data* already exists; no tool exposes it. Users get `/resume` + `/session-tree` for navigation, but the model can't query its own history. This is the single most useful "memory" feature pi lacks — and it needs zero infra: parse JSONL, regex/grep search, done.

## pi plugin design

- **Tools:**
  - `session_search(query)` — grep across all past session files in the same cwd bucket (path already encodes cwd: `--<path>--`). Return top N hits: `{sessionId, timestamp, snippet}`. Never return hits from the current session file.
  - `session_read(sessionId, around?: lines)` — read a session file, return trimmed transcript (skip thinking blocks by default? — v1: include, flag in output).
  - `session_summarize(sessionId)` — optional v2: model-side summary via existing compact machinery.
- **Authorization:** exact cwd equality — derive caller cwd from `ctx.cwd`, only search `~/.pi/agent/sessions/--<escaped cwd>--/`. Different cwd → `session_not_found`, same error as a nonexistent id.
- **Self-match guard:** while a tool call is in flight inside session X, exclude X from search results.
- **Sanitizer:** strip base64 image blocks from read output; cap snippet length. Never return raw tool *inputs* for `bash` by default (credentials risk) — v1: strip `bash` command strings from transcripts, return "tool: bash (input redacted)".
- **Search backend:** lazy v1 = ripgrep via `pi.exec` (pi has it in PATH as `rg`; check) or plain node string scan over `.jsonl` files. sqlite FTS is v2.

```ts
const dir = sessionsDirFor(ctx.cwd)  // ~/.pi/agent/sessions/--<escaped>--
const hits = (await glob(`${dir}/*.jsonl`))
  .filter(f => f !== ctx.sessionManager.currentPath)
  .flatMap(f => scanFile(f, query).map(m => ({ file: f, ...m })))
```

## Effort / risk

- Small v1 (~150 lines): glob + text scan + two tools. sqlite FTS + ranking is the v2 upgrade when scans get slow (> a few hundred sessions).
- Risk: leaking secrets across sessions into context (that's why the bash-input redaction) and unbounded output (cap results at `maxSearchResults`).

## dsh extras to skip

- Provider cursors, lineage tracing with boundary markers, parent-id FTS dedup, workspace authority service. Pi's flat session files + cwd path encoding replace most of the authorization machinery.
