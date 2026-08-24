# 7. Message Feedback

**Origin:** [`dsh-message-feedback`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/feedback/message-feedback) + `dsh-command-feedback` (`packages/feedback/*/README.md`)

## Concept

Human remarks about a session/message, recorded as durable *log-only* entries: never enter model context, never enter derived history, survive compaction. In dsh: `feedback/record` events (free-text remark), plus per-message feedback with lifecycle/target validation, compare-and-set per item, and the rule that feedback never enters session history or telemetry.

dsh details:
- Feedback is independent of its trigger — a remark about turn 5 recorded at turn 20 stays attached to turn 5.
- Every record is log-only: replay-safe, invisible to the model unless explicitly queried.
- The command handler (`command-feedback`) pairs `command/run` → `command/done` events; the stored payload is structured, so consumers never re-parse.

## Why port to pi

Pi has no way to mark "this answer was wrong / great / why" without *replying to the model* (which changes behavior and burns tokens). A `/feedback` command records judgment without perturbing the session; later, `cross-session-search.md` or a future fine-tune/export flow can mine those records. Cheap, and it closes the loop between user evaluation and future improvement.

## pi plugin design

- **Command:** `/feedback <text>` — appends a custom entry tagged to the current position. Optionally `/feedback <n> <text>` to tag an earlier message id.
- **Storage:** `pi.appendEntry("feedback_record", {text, targetEntryId?, time})` — custom entry types are already the mechanism; they stay out of model context by default (confirm: custom entries don't join the provider payload unless a renderer adds them).
- **Renderer:** `pi.registerEntryRenderer("feedback_record", ...)` — small dim line `💬 feedback: <text>`, so it's visible in transcript scroll but inert.
- **Per-message thumbs (v2):** register a shortcut (e.g. `Ctrl+G`) that marks the last assistant message + prompt for feedback text; store with CAS semantics (overwrite allowed, append alternative).
- **Query tool (v2):** `list_feedback` tool so the model *can* explicitly read feedback when the user tells it to — dsh keeps it out of context unless asked, same here.

```ts
pi.registerCommand("feedback", {
  description: "Record a remark about the session (never sent to model)",
  handler: async (args, ctx) => {
    await pi.appendEntry("feedback_record", {
      text: args || "",
      targetEntryId: lastAssistantEntryId(ctx),
      time: Date.now(),
    })
    ctx.ui.notify("Feedback recorded", "info")
  },
})
```

## Effort / risk

- Tiny: ~50 lines for v1. The one design question = whether custom entries leak into context; verify against pi docs and pin the behavior in the extension README.
- No risk worth planning around. Skip per-message CAS and thumbs until someone asks.

## dsh extras to skip

- Lifecycle/target validation service, feedback domain over storage seam, telemetry exclusion machinery (pi has no telemetry seam to exclude from). Command pairing events are just pi command logs — not needed.
