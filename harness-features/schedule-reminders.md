# 1. Schedule Reminders

**Origin:** [`dsh-schedule`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/schedule/schedule) (`packages/schedule/schedule/README.md`)

## Concept

Three session-scoped tools — `schedule_create`, `schedule_list`, `schedule_delete` — let the agent set durable reminders for itself. State is event-sourced: every create/delete/dispatch is a `schedule/change` log entry; timers, tool values, and model follow-ups are disposable projections of that log. When a reminder comes due, the harness injects a prompt into the next turn ("reminder X is due").

Key dsh details:
- Delays via `after_seconds` (positive safe int), absolute `at` targets (strict RFC 3339 with `Z` or explicit numeric offset; local times require explicit IANA zone), or `every_seconds` intervals (min 5 minutes).
- DST gap → reject; DST overlap → first earlier instant. All stored as canonical UTC.
- Forks don't inherit parent reminders; the log is the only durable authority.
- Replay validates: reused ids, duplicate deletes, non-future targets all rejected.

## Why port to pi

Pi's todo tool is ephemeral per-session state. A *timed* self-reminder is genuinely new: "check the deploy at 3pm", "retry this build in 30 min", periodic "ping me if the CI is still red". Currently impossible without an external cron. Cost: one extension + no new infra.

## pi plugin design

- **Tools:** `schedule_create` (after_seconds | at | every_seconds, prompt), `schedule_list`, `schedule_delete(id)`. Schemas via `Type` from typebox.
- **Durability:** each mutation → `pi.appendEntry("schedule_change", {id, kind, scheduledAt, prompt, deleted?})`. Rebuild state by folding entries at session load; don't keep parallel in-memory authority. Forked/branched sessions fold their own tree — same semantics as dsh fork.
- **Timers:** on load + after each mutation, recompute earliest due time. Use `setTimeout` with split waits for delays > 24 days (Node timer limit) — same trick dsh uses — and re-read wall clock after wake so rollback can't fire early.
- **Delivery:** due one-shots have priority, enter one turn at a time. Inject via `pi.sendMessage("Reminder: ...", {agentOnly?})` or a user-visible notice — decide in build. Dispatched one-shots append a dispatch entry (idempotent).
- **Cancel on exit:** cleanup in the extension's shutdown hook (`pi.on("session_shutdown")` or async-factory return).

```ts
const due = await computeNextDue(entries)   // fold schedule entries
timer = setTimeout(fire, min(due - now, 2_147_000_000))
async function fire() {
  await pi.sendMessage(`Reminder due: ${prompt}`)
  pi.appendEntry("schedule_change", { id, dispatched: true })
  reschedule()
}
```

## Effort / risk

- Small-medium: ~200 lines. Timer edge cases (DST, sleep/wake, clock jumps) are the whole game — copy dsh's rules, don't invent.
- Skip `every_seconds` in v1? No — it's 10 extra lines over the same fold. Keep.
- Skip: timezone auto-inference from context; dsh explicitly refuses. Require explicit zone.

## dsh extras to skip

- Per-agent scoping, persistence-seam flushes (pi has no such seam), strict version-1 replay validation — pi can validate lazily.
