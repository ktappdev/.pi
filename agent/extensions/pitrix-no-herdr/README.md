# pitrix-no-herdr

A minimal, **herdr-less** variant of the [pitrix](../../../developer/pitrix/pitrix) multi-agent extension, for local testing. Same Matrix crew, same prompts, same file-mailbox protocol — but **no multiplexer**: Morpheus spawns his crew as plain child processes.

## The one idea

The caller only ever talks to **Morpheus (the coordinator)**. You give him a mission; he internally spawns his crew (Tank / Trinity / …), collects findings, and returns one answer. The crew is ephemeral — spawned and killed inside Morpheus's process, invisible to the caller.

The worker protocol is **unchanged** from real pitrix: `.pnh/pnh-threads/<id>/{state.json, inbox/}` with atomic-rename enqueue/drain and a heartbeat in `state.json`. Only the process substrate changed.

## What changed vs real pitrix

| Real pitrix (herdr) | This build (herdr-less) |
|---|---|
| `pnh_spawn_worker` splits a herdr pane and runs `pi` inside it | forks a plain detached `pi --mode rpc` child |
| `src/herdr/listener.ts` socket subscription to `pane.closed`/`pane.exited` | a `kill(pid,0)` liveness sweep (`src/proc/substrate.ts`) |
| `pnh_panes` reads `herdr api snapshot` | reads `.pnh/pnh-threads/*/state.json` + pid liveness |
| `pnh_cleanup_panes` does `herdr pane close` | `SIGTERM` the worker's process group |
| `pnh_pane_read` tails pane scrollback | tails `.pnh/pnh-threads/<id>/output.log` |
| `lifecycle.ts` hard-gates on `HERDR_ENV=1` | gate removed — boots anywhere |
| `pnh_tab_create` / `pnh_tab_close` / `pnh_run` | removed (no panes/tabs headless) |
| `src/restate/` durable-wake backend | removed (local file mailbox only) |

### Why `--mode rpc`

pi needs a mode for a **long-lived headless** process. Docs (`docs/cli-integration.md`) are explicit: interactive needs a TTY; print/JSON are one-shot; **RPC is the long-lived bidirectional mode**. So each worker is `pi --mode rpc`, and the coordinator holds the write end of the child's stdin pipe. That pipe is never written to — its existence keeps RPC mode resident, and when the coordinator exits the pipe closes → the worker's stdin hits EOF → pi shuts down. **Crew lifetime is tied to Morpheus for free.**

(TUI-only calls degrade safely in RPC mode: `setTheme()` returns a failure, `setStatus`/`setWidget`/`notify` are fire-and-forget. The extension already guards these.)

### `pnh_` naming (not optional)

`~/.pi/agent/extensions/` is **auto-discovered**, so dropping an extension there loads it in every session. A copy keeping the `pitrix_*` tool/flag names collides with the globally-installed real pitrix ("Tool pnh_status conflicts with …"). So everything is namespaced `pnh_*` / `--pnh-*` / `.pnh/`, which lets both extensions coexist.

### Kept, not rewritten

- `src/prompts/*` — the cast, untouched.
- `src/core/`, `src/adapter/local-fs.ts`, `src/state.ts`, `src/inbox.ts` — mailbox/heartbeat/barriers, pure filesystem.
- `src/journal.ts` — already herdr-free (it forks pi directly).

## Run it

The extension auto-loads (opt-in via the `--pnh-id` flag; inert otherwise). To launch Morpheus:

```bash
cd /path/to/a/repo
pi --extension ~/.pi/agent/extensions/pitrix-no-herdr --pnh-id coordinator
```

Then give him a mission, e.g.:

> Spawn Tank, have him run `git log --oneline -5`, and report what he found.

Morpheus will call `pnh_spawn_worker(role="tank")` (→ `{ok, pid, pitrix_id}`), `pnh_send` the task, and `pnh_wait` for the reply. Watch a worker live:

```bash
tail -f .pnh/pnh-threads/tank/output.log
```

Check crew status and clean up:

```
pnh_panes()                     # status per worker + pid liveness
pnh_cleanup_panes()             # SIGTERM stale/done crew
pnh_cleanup_panes(force=true)   # also kill idle/done crew
```

When the coordinator exits, its children are shut down automatically (stdin-pipe close) plus `SIGTERM` from `session_shutdown`.

## Smoke test (verified)

```bash
cd /tmp && mkdir -p smoke && cd smoke && git init
pi --extension ~/.pi/agent/extensions/pitrix-no-herdr --pnh-id coordinator
```

Ask Morpheus to spawn Tank with a trivial task and report back. Expected: `pnh_spawn_worker` returns a pid, `.pnh/pnh-threads/tank/state.json` appears (state `running`), and a reply envelope lands in `.pnh/pnh-threads/coordinator/inbox/`.

A scripted version of exactly this — spawn coordinator + tank headless, enqueue an envelope, observe tank reply `MAILBOX_OK` with `re=coordinator/01TEST` — passed end-to-end.

## Type-check

```bash
cd ~/.pi/agent/extensions/pitrix-no-herdr
node node_modules/typescript/bin/tsc --noEmit   # clean
node_modules/.bin/eslint src                    # clean
```

(`node_modules` is symlinked from the source repo; pi supplies `@earendil-works/pi-coding-agent` and `typebox` at runtime.)

## Caveats

- **Workers use RPC mode**, so their `output.log` is pi's JSONL event stream, not a pretty TUI transcript. `pnh_pane_read` tails it as-is.
- **No tabs/panes/geometry** — `pnh_tab_create`/`pnh_tab_close`/`pnh_run` don't exist here.
- **`PNH_APPEND_SYSTEM.md`**: workers point at the operator's existing `~/.pi/agent/PITRIX_APPEND_SYSTEM.md` persona file (same as real pitrix); absent → skipped.
- **`PI_BIN`**: the substrate prefers `$PI_BIN`, else re-invokes pi the way this process was started (`piSelfCommand`). Needed on Windows where npm installs `pi` as a `.cmd` shim.
