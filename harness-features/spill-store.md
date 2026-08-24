# 2. Spill Store

**Origin:** [`dsh-spill`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/spill/spill) + `dsh-spill-policy` (`packages/spill/*/README.md`)

## Concept

When a tool result is oversized, don't stuff it into context — *spill* it: persist the full text to a private file, and hand the model a small locator + retrieval hint ("read the rest with the read tool"). The full bytes stay available, context stays lean, and the model decides whether it needs the tail.

dsh details:
- Spill backend saves text verbatim, returns `SpillRef { locator, bytes, retrievalHint }`. Saves are rejected on real storage failure (ENOSPC, permissions) — caller decides how to degrade.
- Files go in a private `0700` dir, random names, exclusive owner-only opens (`'wx'`, `0o600`) — predictable world-readable paths invite symlink races and disclosure.
- `dsh-spill-policy` is a `tools/post-execute` consumer: it decides *when* to spill, independent of the storage backend. Namespace per session; forks inherit existing locators, new spills use the child session id.
- Locator is rendered as an opaque string — could be a URI or key, not necessarily a path.

## Why port to pi

Pi already truncates tool output (built-in `truncated-tool` example / output truncation). Truncation *loses* data; spill *relocates* it. For `bash` runs dumping 50KB logs, `read` of a huge file, or `git diff` of a big change, the model currently gets a truncated view and can't recover the tail. A spill extension changes truncation from lossy to lossless.

## pi plugin design

- **Hook:** `pi.on("tool_result", ...)` — if serialized content length > threshold (e.g. 16KB), write full text to spill file, replace returned content with `head + marker + retrieval hint`.
- **Storage:** `~/.pi/agent/spill/<session-id>/<random>.txt`, dir mode `0700`, open `wx` + `0o600`. Session id from `ctx.sessionManager`.
- **Hint format** (model-facing): `[output spilled: 128KB → /Users/ken/.pi/agent/spill/.../abc123.txt] Use read tool with offset/limit to inspect.` Keep head ~4KB + tail ~1KB so the model can usually skip retrieval.
- **Filetype-aware:** spill as `.txt` normally; for `bash` outputs keep ANSI stripped (or keep raw — decide v1). Never spill image content.
- **Cleanup:** on session delete/exit optionally purge spill dir (or leave + let user GC; cheap disk).

```ts
pi.on("tool_result", async (event, ctx) => {
  const text = textLength(event.content)
  if (text < 16_000) return
  const path = await spillDir(ctx) // mkdir 0700, per session
  const file = join(path, `${randomUUID()}.txt`)
  await writeFile(file, fullText, { mode: 0o600, flag: "wx" })
  return {
    ...event,
    content: [{ type: "text",
      text: `${head(4000)}\n\n[spilled ${text - 8000} chars → ${file}]\n\n${tail(1000)}` }],
  }
})
```

## Effort / risk

- Small: ~100 lines. Core risk = the model forgetting the hint exists, or spilling content the model *needed* verbatim — mitigate by keeping a generous head/tail and naming the read tool in the hint.
- Threshold policy: one knob (`thresholdChars`), default 16KB. dsh pruner uses head 4K / tail 1K — reuse those numbers.

## dsh extras to skip

- Pluggable backends (URI/key locators), output-retention policy package, `SpillSource` naming metadata. One local dir is enough for pi.
- Compaction interplay (spill before summary) — pi compaction calls would naturally see the already-spilled short result, no extra work.
