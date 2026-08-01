# Code Context — `/Users/kentaylor/.pi` Recon

## Top-Level Structure

```
~/.pi/
├── .git/                    ← git-tracked repo (branch: main, also pitrix, tmp)
├── .gitignore               ← excludes creds, sessions, logs, .DS_Store
├── .lavish/                 ← lavish test HTML
├── .pi-subagents/           ← subagent artifacts (this run lives here)
├── .picode/                 ← picode coordinator config (journal, inbox)
├── .thread/                 ← thread-based runtime (models.json, coordinator threads)
├── agent/                   ← **primary orchestrator config** (active)
│   ├── extensions/          ← custom TS extensions (context-cap, loop, init, etc.)
│   ├── skills/              ← 4 skills: fromai, impeccable, land-the-plane, lavish
│   ├── prompts/             ← 4 prompt templates (.md)
│   ├── sessions/            ← session history (gitignored)
│   ├── models.json          ← custom provider defs (deepseek, kiro, etc.)
│   ├── settings.json        ← 16 packages, defaultProvider=windsurf, defaultModel=glm-5-2
│   ├── auth.json            ← gitignored (creds)
│   ├── git/                 ← git provider data
│   ├── npm/                 ← npm package cache
│   ├── cache/               ← runtime cache
│   ├── packages.lock.json   ← package lock
│   ├── trust.json           ← trust config
│   ├── run-history.jsonl    ← run log
│   └── themes/              ← (referenced in AGENTS.md)
├── minipi/                  ← lightweight Pi config (auth.json, sessions/)
├── piii/                    ← alternate runtime config
│   ├── settings.json        ← defaultProvider=opencode-go, defaultModel=minimax-m3
│   ├── auth.json
│   └── sessions/
├── AGENTS.md.disabled       ← steering doc (disabled — 255 lines, detailed layout)
├── APPEND_SYSTEM.md         ← system prompt append
├── PI_KNOWLEDGE.md          ← Pi quick reference
├── README.md                ← setup instructions (137 lines)
├── FRIENDLY_MODEL_NAMES.md  ← model name mappings
├── migration-plan.md        ← plan: make minipi main, rename agent→agent-orchestrator
├── update_piii.md           ← piii update notes
├── context.toml             ← contexting config (LLM indexing, search, watch)
├── context.json             ← contexting index output (8K+ lines, tree of ~/.pi)
├── package-lock.json        ← npm lock
├── provider-cache.json      ← provider cache
├── pi-infobar-cache.json    ← infobar cache
├── web-search.json          ← web search config/data
├── free.json                ← free model config
├── free.log                 ← free model log
├── modelmatch.log           ← model matching log
├── exa-usage.json           ← Exa API usage tracking
├── playwright-cli-example.txt
└── .contexting_synonyms_cache.json
```

## Config Files

| File | Purpose |
|------|---------|
| `agent/settings.json` | Primary config: 16 packages, windsurf/glm-5-2, high thinking, compaction enabled |
| `piii/settings.json` | Alt config: opencode-go/minimax-m3, dark theme |
| `context.toml` | Contexting engine: llama-3.1-8b via OpenRouter, synonym cache, watch/search/eval |
| `agent/models.json` | Custom provider defs (deepseek-v4-flash/pro, kiro, etc.) |
| `AGENTS.md.disabled` | Full steering doc — disabled but contains detailed layout & conventions |
| `.gitignore` | Excludes: auth.json, sessions, logs, .DS_Store, node_modules, dist |

## Agent / Skill / Custom Directories

### `agent/skills/` (4 skills)
- `fromai/SKILL.md` — fromai skill
- `impeccable/SKILL.md` — impeccable skill (has `reference/` + `scripts/` subdirs)
- `land-the-plane/SKILL.md` — land-the-plane skill
- `lavish/SKILL.md` — lavish skill

### `agent/extensions/` (custom TS extensions)
- `context-cap.json` / `context.ts` — context management
- `compact-flash.ts` — compaction
- `copy-all.ts` — copy utility
- `custom-footer.ts.bk` — footer (backed up)
- `herdr-agent-state.ts` — agent state
- `init.ts` — init logic
- `loop.ts` — loop logic
- `permission-gate.ts.disable.ts` — permission gate (disabled)
- `questionnaire.ts` — questionnaire
- `whimsical.ts.disable` — whimsical (disabled)
- `lib/` — shared lib

### `agent/prompts/` (4 templates)
- `confidence.md`, `create-br.md`, `investigate.md`, `no-mistakes.md`

## Notable Items

1. **Migration plan** (`migration-plan.md`): Rename `agent/` → `agent-orchestrator/`, make `minipi` main. 220+ lines, detailed steps.
2. **AGENTS.md disabled**: Steering doc renamed to `.disabled` — conventions not auto-loaded by Pi.
3. **Two runtime configs**: `agent/` (windsurf/glm-5-2, 16 packages) vs `piii/` (opencode-go/minimax-m3, minimal). Shell aliases `pii` vs `piii` switch between them.
4. **`.picode/`**: Coordinator with journal + inbox — separate orchestration layer.
5. **`.thread/`**: Thread-based runtime with models.json + coordinator threads/state.
6. **Git repo**: `~/.pi` is git-tracked with branches `main`, `pitrix`, `tmp`. Sensitive files gitignored.
7. **Subagent infrastructure**: `.pi-subagents/artifacts/` — this run's input + transcript stored here.

## Start Here
`agent/settings.json` — primary config entry point. Defines packages, provider, model, compaction. Then `AGENTS.md.disabled` for full architecture context.
