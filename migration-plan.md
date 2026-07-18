# Pi Config Migration Plan

## Goal

Make `minipi` the main `pi` (default config). Rename current `agent/` → `agent-orchestrator/` (keep everything). `piii` continues pointing to `agent-orchestrator/`.

## Current State

```
~/.pi/
├── agent/              ← current main pi (source of truth for symlinks)
│   ├── agents/         ← 112K
│   ├── extensions/     ← 202M (includes node_modules 201M)
│   ├── git/            ← 541M
│   ├── npm/            ← 227M
│   ├── prompts/        ← 16K
│   ├── skills/         ← 48K
│   ├── themes/         ← 48K
│   ├── sessions/
│   ├── models.json
│   ├── settings.json   ← 10 packages
│   └── ...
├── minipi/             ← becomes new main pi
│   ├── extensions/     ← real files + symlinks to agent/
│   ├── git/            ← has content
│   ├── npm/            ← has content
│   ├── sessions/
│   ├── skills/
│   ├── settings.json   ← 3 packages
│   └── ...
├── piii/               ← symlinks to agent/, will repoint to agent-orchestrator/
├── agent-pitrix/       ← symlinks to agent/extensions/
└── my-pi/              ← DELETED (already done)
```

## Symlinks to Repoint (agent/ → agent-orchestrator/)

### piii/ (5 symlinks)
| Symlink | Target |
|---------|--------|
| `piii/models.json` | `agent/models.json` |
| `piii/agents` | `agent/agents` |
| `piii/prompts` | `agent/prompts` |
| `piii/extensions/copy-all.ts` | `agent/extensions/copy-all.ts` |
| `piii/extensions/ask-mode.ts` | `agent/extensions/ask-mode.ts` |
| `piii/extensions/herdr-agent-state.ts` | `agent/extensions/herdr-agent-state.ts` |
| `piii/extensions/lib/ask-mode-utils.ts` | `agent/extensions/lib/ask-mode-utils.ts` |

### agent-pitrix/ (2 symlinks)
| Symlink | Target |
|---------|--------|
| `agent-pitrix/extensions/copy-all.ts` | `agent/extensions/copy-all.ts` |
| `agent-pitrix/extensions/node_modules` | `agent/extensions/node_modules` |

### minipi/ (5 symlinks — these move with minipi, repoint after mv)
| Symlink | Target |
|---------|--------|
| `minipi/models.json` | `agent/models.json` |
| `minipi/extensions/copy-all.ts` | `agent/extensions/copy-all.ts` |
| `minipi/extensions/context.ts` | `agent/extensions/context.ts` |
| `minipi/extensions/herdr-agent-state.ts` | `agent/extensions/herdr-agent-state.ts` |
| `minipi/prompts` | `agent/prompts` |

## Steps

### Step 1: Rename agent/ → agent-orchestrator/

```bash
mv ~/.pi/agent ~/.pi/agent-orchestrator
```

**Verify:**
```bash
ls -d ~/.pi/agent-orchestrator
ls ~/.pi/agent-orchestrator/extensions/ | head -5
```

### Step 2: Repoint piii/ symlinks → agent-orchestrator/

```bash
# Remove old symlinks, create new ones
ln -sf ~/.pi/agent-orchestrator/models.json ~/.pi/piii/models.json
ln -sf ~/.pi/agent-orchestrator/agents ~/.pi/piii/agents
ln -sf ~/.pi/agent-orchestrator/prompts ~/.pi/piii/prompts
ln -sf ~/.pi/agent-orchestrator/extensions/copy-all.ts ~/.pi/piii/extensions/copy-all.ts
ln -sf ~/.pi/agent-orchestrator/extensions/ask-mode.ts ~/.pi/piii/extensions/ask-mode.ts
ln -sf ~/.pi/agent-orchestrator/extensions/herdr-agent-state.ts ~/.pi/piii/extensions/herdr-agent-state.ts
ln -sf ~/.pi/agent-orchestrator/extensions/lib/ask-mode-utils.ts ~/.pi/piii/extensions/lib/ask-mode-utils.ts
```

**Verify:**
```bash
ls -la ~/.pi/piii/models.json ~/.pi/piii/agents ~/.pi/piii/prompts
ls -la ~/.pi/piii/extensions/copy-all.ts ~/.pi/piii/extensions/ask-mode.ts
# All should point to agent-orchestrator/
readlink ~/.pi/piii/models.json
```

### Step 3: Repoint agent-pitrix/ symlinks → agent-orchestrator/

```bash
ln -sf ~/.pi/agent-orchestrator/extensions/copy-all.ts ~/.pi/agent-pitrix/extensions/copy-all.ts
ln -sf ~/.pi/agent-orchestrator/extensions/node_modules ~/.pi/agent-pitrix/extensions/node_modules
```

**Verify:**
```bash
readlink ~/.pi/agent-pitrix/extensions/copy-all.ts
readlink ~/.pi/agent-pitrix/extensions/node_modules
```

### Step 4: Repoint minipi/ symlinks → agent-orchestrator/

```bash
ln -sf ~/.pi/agent-orchestrator/models.json ~/.pi/minipi/models.json
ln -sf ~/.pi/agent-orchestrator/extensions/copy-all.ts ~/.pi/minipi/extensions/copy-all.ts
ln -sf ~/.pi/agent-orchestrator/extensions/context.ts ~/.pi/minipi/extensions/context.ts
ln -sf ~/.pi/agent-orchestrator/extensions/herdr-agent-state.ts ~/.pi/minipi/extensions/herdr-agent-state.ts
ln -sf ~/.pi/agent-orchestrator/prompts ~/.pi/minipi/prompts
```

**Verify:**
```bash
readlink ~/.pi/minipi/models.json
readlink ~/.pi/minipi/extensions/copy-all.ts
```

### Step 5: Move minipi/ → agent/

```bash
mv ~/.pi/minipi ~/.pi/agent
```

**Verify:**
```bash
ls -d ~/.pi/agent
ls ~/.pi/agent/extensions/ | head -10
cat ~/.pi/agent/settings.json | grep '"packages"'
```

### Step 6: Verify new agent/ symlinks still resolve

After `mv minipi/ agent/`, symlinks inside use absolute paths (`~/.pi/agent-orchestrator/...`) so they still work.

```bash
# Check all symlinks in new agent/
find ~/.pi/agent -maxdepth 3 -type l -exec sh -c 'echo "$(readlink "$1") ← $1"' _ {} \;
# Verify targets exist
find ~/.pi/agent -maxdepth 3 -type l ! -exec test -e {} \; -print
```

### Step 7: Update ~/.zshrc aliases

**Current:**
```bash
piii() {
  PI_CODING_AGENT_DIR="$HOME/.pi/piii" pi "$@"
}

minipi() {
  PI_CODING_AGENT_DIR="$HOME/.pi/minipi" pi "$@"
}

alias picode="minipi --thread-id coordinator"

agent-pi() {
  PI_CODING_AGENT_DIR="$HOME/.pi/agent" pi "$@"
}
```

**New:**
```bash
piii() {
  PI_CODING_AGENT_DIR="$HOME/.pi/piii" pi "$@"
}

# minipi is now the default agent/ — bare 'pi' uses it
# Remove minipi() alias or repoint to agent/
# alias picode="minipi --thread-id coordinator" → update to use agent/

agent-pi() {
  PI_CODING_AGENT_DIR="$HOME/.pi/agent-orchestrator" pi "$@"
}
```

**Decision needed:** 
- Does bare `pi` already default to `~/.pi/agent/`? If yes, no change needed — `agent/` is now minipi.
- `minipi` alias → dead (dir moved). Remove or repoint to `agent/`.
- `picode` alias → update `minipi` → `pi` or `agent-pi` → `pi`.

### Step 8: Herdr verification

Herdr writes to `piii/extensions/herdr-agent-state.ts` (symlink). After repoint in Step 2, it resolves to `agent-orchestrator/extensions/herdr-agent-state.ts`.

```bash
herdr integration status | grep "^pi:"
# Should show: pi: current (v5)
```

New `agent/` (minipi) has its own `extensions/herdr-agent-state.ts` symlink → `agent-orchestrator/extensions/`. Works at runtime.

### Step 9: Package verification

New `agent/` (was minipi) has 3 packages in settings.json:
- `git:github.com/ktappdev/pi-commandcode-provider`
- `npm:pi-windsurf`
- `git:github.com/ktappdev/picode`

These moved with minipi's `npm/` and `git/` dirs. Should work as-is.

```bash
# Launch new pi, check packages load
PI_CODING_AGENT_DIR="$HOME/.pi/agent" pi --version
# Or just run 'pi' if it defaults to agent/
```

If packages missing, pi re-fetches on launch. To force reinstall, remove `npm/` and `git/` dirs and relaunch.

## Rollback

If something breaks:

```bash
# Reverse the moves
mv ~/.pi/agent ~/.pi/minipi
mv ~/.pi/agent-orchestrator ~/.pi/agent

# Repoint symlinks back to agent/
ln -sf ~/.pi/agent/models.json ~/.pi/piii/models.json
# ... (reverse all symlink repoints)
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Symlink breaks | Config won't load extensions | Step 6 verification catches |
| Sessions lost | History inaccessible | Sessions move with dirs, no loss |
| Packages missing | Extensions won't load | Pi re-fetches on launch |
| Herdr loses state | No agent tracking | Step 8 verifies, symlink repoint fixes |
| zshrc alias dead | Can't launch config | Step 7 updates aliases |

## What Does NOT Change

- `agent-orchestrator/` keeps all content (extensions, npm, git, sessions, models.json, etc.)
- `piii/` continues working, just points to `agent-orchestrator/` instead of `agent/`
- Herdr integration stays in `piii/extensions/` (symlink repointed)
- `agent-pitrix/` continues working (symlink repointed)
- All session history preserved (moves with dirs)
