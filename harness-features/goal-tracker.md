# 3. Goal Tracker

**Origin:** [`dsh-goal`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/goal/goal) (`packages/goal/goal/README.md`)

## Concept

A durable, same-session *objective* with lifecycle verbs: create, edit, pause, resume, complete, block, clear. The harness keeps one current goal and can *continue* it across turns — e.g. "keep fixing the build until it's green, max 256 rounds". State is event-sourced from `goal/change` log entries (full post-mutation snapshot per entry, revisioned compare-and-set); the log is the only durable authority. Continuation permission (activation) is deliberately *process-local*, never persisted — restarting never auto-resumes work.

dsh details:
- Mutations use a `GoalRef { id, revision }` CAS fence; stale refs rejected.
- Pause / completion / blocking / clear all disarm activation. A *block* records a policy-owned code + free-form reason — provider limits, budget, execution error, human-input-requested all use this one durable phase instead of N lifecycle states.
- `defaultMaxGoalRounds` caps continuation rounds; resume rejects once cap exhausted.
- Strict replay rejects: malformed shapes, discontinuous revisions, illegal transitions, non-sequential rounds.

## Why port to pi

Pi has no "keep working on X until Y" primitive. Long multi-turn tasks currently depend on the user re-prompting or the model remembering. A goal extension gives: bounded autonomy (round cap = safety), explicit block/pause vocabulary, and a transcript-visible objective that survives `/resume`. Useful for "watch CI and fix until green", "migrate this folder", "fuzz until you find the crash".

## pi plugin design

- **Command:** `/goal create "objective"` / `/goal edit` / `/goal pause|resume|complete|block <reason>` / `/goal show` / `/goal clear`.
- **Tool:** `get_goal` (model reads current state — dsh keeps goal state *out* of context unless asked).
- **Durability:** `pi.appendEntry("goal_change", {id, revision, phase, objective, blockedReason?, rounds})` per mutation; fold entries on load. CAS = check revision before append.
- **Continuation:** after each `agent_end` / `turn_end`, if goal is armed + rounds < cap → `pi.sendMessage` continuation prompt ("Continue toward objective: ... Round n/max"). Round counts only advance on admitted goal-sourced rounds.
- **Failsafe:** disarm on `session_shutdown`; never persist activation — restart = inactive goal that needs explicit resume. That's the key safety property to copy.
- **Block codes** (one enum, not N states): `provider-limit`, `budget`, `error`, `needs-human`.

```ts
pi.on("agent_end", async (_e, ctx) => {
  const g = foldGoal(entries(ctx))
  if (!g || g.phase !== "active" || g.rounds >= max) return
  g.rounds++  // via appendEntry, CAS-checked
  await pi.sendMessage(`[goal round ${g.rounds}/${max}] Continue: ${g.objective}`)
})
```

## Effort / risk

- Medium: ~250 lines. The dangerous part is auto-continuation loops — copy dsh's guards exactly: round cap + disarm on restart + resume requires explicit user action + block absorbs every failure mode.
- Skip: fork semantics, invariant companion package, deployment-level config plumbing. One session, one goal, one cap knob.

## dsh extras to skip

- Per-agent scoping, `GoalView` detachment, goal-sourced `user/message` source tagging — pi's JSONL entries cover the durable part.
