# 4. Background Jobs Registry

**Origin:** [`dsh-jobs`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/jobs/jobs) + `dsh-tool-jobs` (`packages/jobs/*/README.md`)

## Concept

One registry for long-running background work with a model-facing controller toolset: `job_list`, `job_read`, `job_kill` (dsh: list/read/kill + wait + completion notices). Producers (background bash, subagents, PTY sends) register jobs; the model polls and cancels through the registry instead of ad-hoc pid juggling.

dsh details:
- Jobs have owner isolation (`SessionId`); `get/list/read/kill` are owner-relative — an agent sees only its own jobs.
- `read` consumes a *single cursor* for stream jobs (each read returns new output since last read — no re-reading), and returns terminal output idempotently for finished jobs.
- `kill` invokes producer cancellation *before* changing status; a cancellation throw leaves the job running. `wait(id, timeout)` returns terminal snapshot or live snapshot at timeout.
- Producer-owned `outputLimitBytes` caps model-facing output; settlement is first-wins (one terminal record, one notification round).

## Why port to pi

Pi's `bash` tool already supports background processes (user_bash events exist), but the model has no unified way to *list* what's running, *read* incremental output, or *kill* by id across tools. A jobs extension standardizes it: start a dev server, let the model poll logs, kill it when done — all through one vocabulary instead of `ps`/`kill` spelunking.

## pi plugin design

- **Registry:** in-extension Map of `JobId → {ownerSessionId, status, output[], cursor, controller}`. Jobs registered from:
  - `user_bash` events / background bash results (hook into what pi already reports),
  - the extension's own `job_spawn` tool wrapping `pi.exec` (start detached, stream stdout into the job's output buffer).
- **Tools:**
  - `job_spawn(command, timeout?)` → id (the lazy way to get background work without touching pi's bash internals),
  - `job_list` → `[{id, status, age}]`,
  - `job_read(id)` → *only new* output since last read (cursor semantics — this is the good part, no re-reading 10KB logs),
  - `job_kill(id, reason?)` → kill, report `stopping`, then terminal on exit,
  - `job_wait(id, timeoutMs)` → terminal snapshot or live status at timeout.
- **Isolation:** tag jobs with current session id; `job_list` filters by owner. Unowned jobs (spawned pre-extension) invisible.
- **Lifecycle:** on `session_shutdown`, kill all owner jobs and await exit (dsh rule: "dispose must reach quiescence, not just request it").
- **Notice:** when a job settles, inject a short completion notice via `pi.sendMessage` (dsh does the same via completion notices).

```ts
const jobs = new Map<string, Job>()
pi.registerTool({ name: "job_read", /* ... */ execute: async (_id, { id }, _sig, _upd, ctx) => {
  const j = jobs.get(id)
  if (!j || j.owner !== ctx.sessionManager.currentSessionId) return err("job_not_found")
  const out = j.output.splice(j.cursor)   // consume cursor
  j.cursor += out.length
  return text(out.join("\n") || "(no new output)")
}})
```

## Effort / risk

- Medium: ~250 lines. Risk areas: zombie processes (always `kill → await exit`), output buffer growth (cap at `outputLimitBytes`, drop head), and cursor races.
- Skip: stream-vs-final-output job kinds split — one kind (stream) covers everything in v1.

## dsh extras to skip

- Job kind namespaces, controller attach/registry scoping, provider admission policies. Pi is single-agent-per-session; keep the registry session-scoped and move on.
