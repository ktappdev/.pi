# 9. Permission Presets

**Origin:** [`dsh-permission-presets`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/interaction/permission-presets) + `dsh-sandbox-policy` (`packages/interaction/permission-presets/README.md`, `packages/sandbox/sandbox-policy/README.md`)

## Concept

A tiny user-facing *preset table* bundling the two permission knobs (sandbox mode + approval policy) into named switches: `workspace-write` (default: writes confined to workspace, approvals on), `danger-full-access` (no sandbox, no approvals). Selecting a preset writes one durable `permission/preset` event that fans out to both knob events — one decision point instead of N toggles. The last event wins; the model learns the policy from runtime context, never from the transcript (policy events are log-only).

dsh details:
- Preset records durable user intent (`permission/preset`), out of model transcript; knob events control execution.
- Policy is fail-closed at the seam: `approval/request` with no answerer resolves to `unavailable`, not "allow".
- Sandbox mode + approval policy are read by both enforcing families (bash + fs) from one shared source, so shell and filesystem can't disagree about confinement.

## Why port to pi

Pi has one-off gates (`permission-gate.ts` example, `confirm-destructive.ts`, `protected-paths.ts`) but no *mode* concept. Users end up approving or blocking per-case forever, or disabling extensions manually. A presets extension gives three levels — `workspace-write` / `danger-full-access` / plus pi's existing per-case gate as the middle — switched with one command, remembered per session via custom entries.

## pi plugin design

- **Command:** `/permissions <preset>` (presets: `workspace-write`, `danger-full-access`; maybe `ask` for pure per-case). Shows current + available on bare `/permissions`.
- **State:** `pi.appendEntry("permission_preset", {preset})` on switch; fold entries on load; last wins. Never inject into context (dsh: log-only) — but *do* inject a one-line notice when the model's next turn runs under a changed preset, so behavior changes aren't silent.
- **Gate:** one `pi.on("tool_call")` handler reads current preset:
  - `workspace-write`: block writes outside `ctx.cwd` (like `protected-paths.ts`), auto-allow reads; confirm destructive ops (`rm -rf`, `sudo`, `git push --force`).
  - `danger-full-access`: allow everything, log a prominent warning line per session.
  - Preset applies to bash, write, edit — same list `protected-paths` uses.
- **Fail-closed:** if the extension's state fold fails or the preset is unknown → treat as `workspace-write`. No preset state = default `workspace-write`.
- **Consistency:** one source of truth for both fs-write gating and bash gating (the extension's preset state), so a bash `rm` outside the workspace is caught by the same rule as a write tool call.

```ts
const preset = foldPreset(entries(ctx)) ?? "workspace-write"
pi.on("tool_call", async (event, ctx) => {
  if (preset === "danger-full-access") return
  if (isWrite(event) && !isInsideCwd(event.input, ctx.cwd))
    return { block: true, reason: "outside workspace — switch preset to allow" }
})
```

## Effort / risk

- Small: ~120 lines, mostly gluing the existing example patterns behind one state read.
- Risk: the preset *hiding* decisions — keep the transcript notice + status line visible so the user always knows which mode they're in. Fail-closed default is the safety property; never flip it.

## dsh extras to skip

- Sandbox-mode enforcement families (pi has no sandbox seam — the gate is the enforcement), approval-request waterfall, `delegation` source tags for child agents.
