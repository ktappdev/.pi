# Pitrix Issues

## 🔴 Critical

### 1. Keymaker Model ID Won't Resolve
**File:** `agents/keymaker.md`
**Problem:** Uses `anthropic/claude-sonnet-4` (no version suffix). Every other agent uses `claude-sonnet-4-20250514`.
**Fix:** Change to `claude-sonnet-4-20250514`

### 2. Missing grep/find/ls Tools
**Files:** `agents/neo.md`, `agents/tank.md`, `agents/trinity.md`, `agents/cypher.md`, `agents/dozer.md`, `agents/switch.md`, `agents/oracle.md`, `agents/merovingian.md`
**Problem:** All explicitly set `tools: read,bash` — no `grep`, `find`, or `ls`. Agents can't explore the filesystem (Tank can't list directories, Neo can't find SUID binaries, etc.)
**Fix:** Change all to `tools: read,bash,grep,find,ls`

## 🟡 Medium

### 3. dispatch_agent Not Filtered for Sub-Agents
**File:** `extensions/agent-team.ts` (~line 1027-1043 area)
**Problem:** Same issue fixed in main pi — `dispatch_agent` is registered at top level so all sub-agents (Tank, Neo, etc.) also get it.
**Fix:** Check for `--tools` CLI arg presence (main session has no `--tools`, sub-agents do). No `--tools` = main orchestrator (gets dispatch). Has `--tools` = sub-agent (no dispatch unless explicitly defined).

### 4. Background Subagent Sessions Path
**File:** `extensions/lib/agent-team-background-subagents.ts` → `makeSessionFile()`
**Problem:** Hardcodes `~/.pi/agent/sessions/background-subagents/` (main pi dir), not `agent-pitrix`.
**Fix:** Use `PI_CODING_AGENT_DIR` env var or resolve relative to the pitrix agents dir.

## 🟢 Low

### 5. Dead Code: Builder Agent Check
**File:** `extensions/agent-team.ts` → `getSubagentExtensionArgs()`
**Problem:** Checks for `agentName.toLowerCase() === "builder"` but there is no "Builder" agent in pitrix.
**Fix:** Remove or replace with relevant pitrix agent names (Keymaker? Link?).

### 6. README Docs Wrong
**File:** `HACKER_GUIDE.md`
**Problem:** Says `kyrie.md # Morpheus` but the file is `morpheus.md`.
**Fix:** Update docs.

### 7. Unused Theme Directory
**Path:** `themes/subagent/`
**Problem:** Contains full agent definitions but is not referenced anywhere in the pitrix extension.
**Fix:** Remove or document purpose.
