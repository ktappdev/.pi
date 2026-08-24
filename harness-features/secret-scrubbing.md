# 8. Secret Scrubbing + Safe Temp Files

**Origin:** [`docs/defensive-patterns.md`](https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/defensive-patterns.md) (`deepseek-harness/docs/`)

## Concept

Two small hardening rules from dsh's "bug classes that actually shipped" list:

1. **Scrubbed env for spawned commands.** Every spawned process gets an env with `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*` variables dropped, so harness credentials can't leak into command output, `env` dumps, or spilled files.
2. **Private, race-free temp/spill files.** Private `0700` dirs, random names, exclusive owner-only opens (`'wx'`, `0o600`). Predictable world-readable paths invite symlink races and disclosure. Bonus rule: unlink link-shaped paths with `lstat` first — `unlink` deletes only the link, refuses a real directory, never follows into the target.

## Why port to pi

Pi's `bash` tool spawns with the user's full environment — including any provider API keys and tokens exported in the shell. One `env` command or a misbehaving script echoes them into the transcript. pi docs already warn extensions run with full permissions; this extension shrinks the blast radius for *the agent's own commands* and for any spill/prune temp files the ecosystem starts writing (spill-store.md shares the same dir rules).

## pi plugin design

- **Env scrub** — `pi.on("tool_call")` for `bash`: mutate `event.input` to prefix the command with a scrubbed env:

```ts
pi.on("tool_call", async (event) => {
  if (event.toolName !== "bash") return
  const scrubbed = Object.entries(process.env)
    .filter(([k]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(k))
    .map(([k, v]) => `export ${shq(k)}=${shq(v)}`)
  event.input.command = `${scrubbed.join("\n")}\n${event.input.command}`
})
```

  (Or via `pi.exec`'s `env` option when possible — check `pi.exec` signature; the tool_call mutation works universally.)
  - **Exception list:** config knob `allowEnv: string[]` for vars agents legitimately need (`NODE_ENV`, `PATH` is auto-kept since it matches none of the patterns). Variables matching the secret patterns are *never* re-added even if listed.
  - **Show-don't-hide:** optional UI notice when vars were scrubbed, so the user isn't confused by missing env.
- **Safe temp helper** — small exported util in the extension (or a shared pi package later): `safeTempDir()` → `mkdir('~/.pi/agent/tmp', {mode: 0o700, recursive: true})`, files via `open(file, 'wx', 0o600)` with random names; `safeUnlink(path)` = lstat-check-then-unlink. Ship it as a tiny package other extensions import (spill-store.md consumes it).

## Effort / risk

- Tiny: ~60 lines. Risks: shell-quoting bugs in the export line (use a battle-tested quote function or array-form exec — test with weird env values), and breaking scripts that *depend* on a scrubbed var (that's the point; document it).
- Do NOT scrub `PATH`, `HOME`, `USER` — whitelist the patterns, blacklist the exceptions. dsh scrubs by pattern only.

## dsh extras to skip

- Sandbox-mode enforcement integration, the rest of defensive-patterns.md (callback exception containment, async teardown rules — those are framework-internal, pi handles them).
