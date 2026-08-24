# 5. Compaction Pruner + Pressure Meter

**Origin:** [`dsh-compaction-tool-result-pruner`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/compaction/compaction-tool-result-pruner) + [`dsh-token-meter`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/token-meter) + `dsh-compaction-basic`

## Concept

Two composable compaction refinements:

1. **Model-free pruning.** Before summarizing, rewrite *oversized tool results* into `head + fixed omission marker + tail` (defaults: threshold 8192 chars, head 4096, tail 1024). No model call needed, strictly smaller than input, replay-safe: the original stays in the log, the replacement cites its source. dsh runs this *before* deciding whether to summarize — often pruning alone drops pressure below threshold and summarization is skipped entirely.
2. **Heuristic pressure metering.** One shared token estimator (4 chars/token + structural overhead) computes surface pressure per session so any consumer can decide "is compaction needed?" without depending on the compaction engine.

dsh details worth copying:
- Pruner never splits a UTF-16 surrogate pair; a second pass emits no replacement (idempotent).
- `headChars + marker + tailChars` must fit within `thresholdChars` — config is validated, so pruning can never grow output.
- Compaction-basic: `thresholdRatio` 0.8 / `retainRatio` 0.16 of context window; compaction triggered *proactively* at step boundaries, not just on provider overflow.
- KV-cache trick: the summarization call replays the conversation's own prefix verbatim + appends the compaction instruction, so the provider reuses warm prefix cache instead of invalidating it.

## Why port to pi

Pi's compaction summarizes; the `summarize.ts` / `custom-compaction.ts` examples show the seam. But pi has no *pre-step*: no pruning of oversized tool results before the summary call, no pressure estimate to decide whether to compact at all. Result: pi either compacts too eagerly (burning tokens) or too late. The pruner is the highest-value single piece — 100 lines, immediate token savings.

## pi plugin design

- **Pruner** — `pi.on("tool_result")` (like spill-store, but *discard* the middle instead of relocating) **or** run at `session_before_compact` over recent tool results. Better: run at `session_before_compact` + for tools known to be huge (`bash`, `read`, `git diff`). Replace content with head/marker/tail; keep original retrievable from session JSONL (it's already logged).
- **Pressure meter** — extension-internal estimator: fold session entries → char counts × 0.25 + overhead. Expose via `ctx.getContextUsage()` comparisons: warn via `ctx.ui.notify` when > 80% of context window; optionally auto-trigger `ctx.compact()`.
- **Smart-skip:** if pruning alone drops pressure under threshold, skip compaction (copy dsh's "remeasure, skip summarization when safe" flow).
- **Config:** `thresholdChars`, `headChars`, `tailChars`, `thresholdRatio`, `retainRatio` — the five dsh knobs, all validated at load.

```ts
pi.on("session_before_compact", async (event, ctx) => {
  // prune oversized tool results BEFORE the summary prompt is built
  for (const r of recentToolResults(ctx)) {
    if (textLen(r) > threshold) r.content = prune(r.content) // head+marker+tail
  }
  // if total pressure now < thresholdRatio * window: cancel compaction
  if (estimateTokens(ctx) < safeBudget) return { cancel: true }
})
```

## Effort / risk

- Small-medium: ~150 lines. Pruning is mechanical; the pressure estimator is the only heuristic part (4 chars/token is coarse — fine for a *decision*, never show it as truth).
- Overlap with `spill-store.md`: spill *preserves*, prune *discards middle*. Compose: spill huge outputs at tool_result, prune at compaction time as backstop. Don't build both into one extension — keep single responsibility.

## dsh extras to skip

- Routed per-model policies (`modelPolicies` overrides), provider overflow recovery, KV-cache replay summarizer (pi can't control provider request shaping that finely through extensions — check `before_provider_request` event, but v1 = skip).
