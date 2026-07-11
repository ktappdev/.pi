# AGENTS.md — Pi Orchestrator Setup

User-level Pi coding agent configuration. Git-tracked at `~/.pi`.

## What This Is

Multi-agent coding harness built on [Pi](https://github.com/badlogic/pi-mono). User talks to **Orchestrator** → Orchestrator delegates to specialist agents. Specialists do real work. Orchestrator routes, reports back.

`pi-caveman` extension active → terse responses, no fluff.

## Entry Points (Shell Aliases)

Each points to different config dir. Defined in `~/.zshrc`.

| Alias | Config Dir | Thinking | Description |
|-------|-----------|----------|-------------|
| `pii` | default (`~/.pi`) | medium | `pi -np -ne -p --model deepseek-v4-flash` — no prompt, no extensions, persistent |
| `piii` | `~/.pi/piii` | medium | `PI_CODING_AGENT_DIR` override, no prompt, passes through args |
| `pitrix` | `~/.pi/agent-pitrix` | — | Separate binary (`agent-pitrix/bin/pitrix`) |
| `aph` | `~/.pi/agent-pitrix-headless` | — | Headless RPC/dispatch mode (`agent-pitrix-headless/bin/aph`) |
| `my-pi` | `~/.pi/my-pi` | high | Experimental config |

Flags: `-np` = no prompt template, `-ne` = no extensions, `-p` = persistent session.

## Directory Layout

```
~/.pi/
├── AGENTS.md              ← this file (steering doc)
├── PI_KNOWLEDGE.md        ← Pi quick reference
├── README.md              ← setup instructions
├── agent/                 ← orchestrator config (active)
│   ├── agents/            ← agent prompts (.md), teams, model/thinking yaml
│   ├── extensions/        ← custom extensions (.ts)
│   ├── skills/            ← skills (fromai, land-the-plane, supacode-cli)
│   ├── prompts/           ← prompt templates
│   ├── themes/            ← themes
│   ├── models.json        ← custom model provider definitions
│   ├── settings.json      ← agent-level settings
│   └── sessions/          ← session history
├── piii/                  ← active Pi runtime config
│   ├── settings.json      ← packages, default provider/model, enabled models
│   ├── extensions/        ← runtime extensions
│   ├── skills/            ← runtime skills (fromai, grill-me)
│   ├── sessions/
│   └── auth.json
├── agent-pitrix/          ← alternate config (pitrix)
├── agent-sessions/        ← session store
└── my-pi/                 ← experiments
```

## Agent Roster

| Agent | Role | Model | Thinking | Tools |
|-------|------|-------|----------|-------|
| **Orchestrator** | Route + delegate, no code | (default) | — | dispatch_agent, bash, read, questionnaire, web_search |
| **scout** | Codebase recon (single) | windsurf/kimi-k2.7 | high | read, grep, find, ls, bash, mcp |
| **scout-alfa** | Parallel recon worker 1 | ocg1/deepseek-v4-flash | medium | read, grep, find, ls, bash, mcp |
| **scout-bravo** | Parallel recon worker 2 | ocg1/deepseek-v4-flash | medium | read, grep, find, ls, bash, mcp |
| **planner** | Implementation plans | windsurf/glm-5.2 | high | read, grep, find, ls |
| **builder** | Write code | windsurf/kimi-k2.7 | high | read, write, edit, bash, grep, find, ls |
| **crafter** | Parallel builder (separate files) | windsurf/kimi-k2.7 | medium | read, write, edit, bash, grep, find, ls |
| **reviewer** | Code review, quality + security | windsurf/glm-5.2 | high | read, grep, find, ls, bash (read-only) |
| **designer** | UI/UX specs (no code) | windsurf/kimi-k2.7 | medium | read, grep, find, ls, bash (read-only) |
| **documenter** | Docs, READMEs | windsurf/swe-1.6:base | medium | read, write, edit, grep, find, ls |
| **devops** | GitHub ops, `gh`, `br` | ocg1/deepseek-v4-flash | low | bash, read, grep, find, ls |
| **tavily** | Web search, external research | ocg1/deepseek-v4-flash | low | bash (Tavily API) |
| **sparky** | Brainstorm, 5-7 directions | opencode/big-pickle | medium | read, grep, find, ls |

## Teams

Defined in `agent/agents/teams.yaml`:

| Team | Agents |
|------|--------|
| **full** | scout ×3, planner, designer, builder, crafter, reviewer, documenter, tavily, sparky, devops |
| **plan-build** | scout ×3, planner, builder, crafter, reviewer, tavily |
| **info** | scout ×3, documenter, reviewer, tavily |
| **brainstorm** | sparky |

## Default Workflow

```
scout (if context weak) → planner (optional) → builder → reviewer → builder fixes → done
```

- **UI work:** designer → builder → reviewer
- **GitHub issues:** devops first (`gh` + `br`), then specialists
- **Brainstorm:** sparky → you pick direction → execute

## Parallel Execution

- **`parallel_scout`**: 2 independent recon tasks → Alfa + Bravo concurrent. Hard limit 2 tasks.
- **Recon mode** (user says "recon"): scout + parallel_scout can all run concurrent (up to 3 scouts).
- **Parallel build**: builder + crafter on separate files, no shared deps. Reviewer after both finish.

## Extensions

### Active (`agent/extensions/`)
- `agent-team.ts` — agent team + contexting injection
- `ask-mode.ts` — ask mode toggle
- `auto-session-name.ts` — auto session naming
- `btw.ts` — by-the-way reminders
- `context.ts` — context management
- `copy-all.ts` — copy all output
- `custom-footer.ts` — custom footer
- `git-worktree.ts` — git worktree support
- `herdr-agent-state.ts` — agent state tracking
- `init.ts` — initialization
- `loop.ts` — loop control
- `notify.ts` — notifications
- `permission-gate.ts` — permission gating
- `protected-paths.ts` — path protection
- `questionnaire.ts` — questionnaire tool
- `subagent-widget.ts` — subagent UI widget
- `supacode` — Supacode integration
- `superset-hooks.ts` — hook composition
- `theme-cycler.ts` — theme cycling
- `whimsical.ts` — whimsical mode

### Runtime (`piii/extensions/`)
- `ask-mode.ts`, `context.ts`, `copy-all.ts`, `custom-footer.ts`, `loop.ts`, `notify.ts`, `questionnaire.ts`

## Skills

| Skill | Location | Use |
|-------|----------|-----|
| **fromai** | `agent/skills/`, `piii/skills/` | Offload self-contained coding task (15-60 min, one file) to human |
| **grill-me** | `piii/skills/` | Stress-test plans via relentless interview |
| **land-the-plane** | `agent/skills/` | End-of-session: commit, push, file beads, quality gates, handoff |
| **supacode-cli** | `agent/skills/` | Control Supacode from terminal |

## Packages (`piii/settings.json`)

- `pi-web-access` — web search + librarian skill
- `pi-telegram` — Telegram integration
- `kilo-pi-provider` — Kilo provider
- `pi-caveman` — terse response mode
- `pi-provider-kiro` — Kiro provider
- `pi-free` — free model routing
- `pi-windsurf` — Windsurf provider
- `pi-commandcode-provider` — CommandCode provider
- `context-monitor` (×2) — context monitoring

## Providers & Models

Default provider: **windsurf** · Default model: **glm-5.2**

Enabled model families: `deepseek/*`, `ocg1/*`, `ocg2/*`, `kilo/*`, `windsurf/*`, `openai-codex/*`, `mimo/*`, `opencode-zen/*`

Custom providers in `agent/models.json`: deepseek, lugetech (self-hosted), and more. API keys via env vars (`$DEEPSEEK_API_KEY`, `$LUGETECH_API_KEY`, etc.).

## Tooling

### br (Beads Rust) — Issue Tracking
All issue tracking via `br`. No markdown TODOs.
```bash
br ready --json                    # unblocked work
br create "Title" -t bug -p 2      # create (priority 0-4)
br update <id> --claim             # claim
br close <id> -r "Done"            # close
br search "text"                   # search
```

### engram — Persistent Memory
```bash
engram save "key" "value"
engram search "query"
```

### contexting — Codebase Index
Concept-to-path lookup before dispatching.
```bash
contexting --agent search-hints "login signin auth" --json -n 10 --memory --type files --summary
```
Modes: `memory` (live watch), `snapshot`, `unavailable`.

## Key Rules

1. **Orchestrator never edits code** — always `dispatch_agent`
2. **Assume agents know nothing** — include full context every dispatch
3. **Read before edit** — always
4. **Minimal diffs** — don't rewrite unaffected parts
5. **No secrets in code** — use `${API_KEY}` placeholders
6. **TypeScript > JS**, < 400 lines per file
7. **Verify TS**: `npx tsc --noEmit` after changes
8. **Project-first**: assume questions are about current codebase unless clearly external
9. **Error triage first**: give quick diagnosis before dispatching on errors
10. **Anti-stall**: keep momentum, complete end-to-end before proposing next phases

## Dispatch Format

Orchestrator dispatches use structured task format:
1. `Objective:` — one sentence
2. `Context:` — full background, files, current state
3. `Constraints:` — limits
4. `Action Steps:` — numbered
5. `Deliverables:` — exact expected output
6. `Notes:` — optional extras
7. `Prerequisites:` — mandatory first steps
8. `Uncertainty Protocol:` — failure modes + responses
9. `Verification Checklist:` — sanity checks
10. `Anti-Hallucination Reminder:` — task-specific facts

## Pi Quick Commands

| Command | Description |
|---------|-------------|
| `/new` | Fresh session |
| `/resume` | Pick session |
| `/tree` | Navigate history |
| `/fork` | Branch from here |
| `/compact` | Summarize old messages |
| `/model` | Switch model |
| `/reload` | Hot reload extensions |
| `/settings` | Edit config |
| `!cmd` | Run bash, send output |
| `!!cmd` | Run bash, silent |

## Pi Documentation

| Topic | Path |
|-------|------|
| Main | `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md` |
| Extensions | `docs/extensions.md` |
| Themes | `docs/themes.md` |
| Skills | `docs/skills.md` |
| TUI | `docs/tui.md` |
| Keybindings | `docs/keybindings.md` |
| SDK | `docs/sdk.md` |
| Models | `docs/models.md` |

(Resolve `docs/` and `examples/` under the package root above.)
