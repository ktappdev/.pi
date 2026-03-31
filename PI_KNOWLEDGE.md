# Pi Coding Agent - Project Knowledge Base

## Official Resources

### GitHub Repository
- **Main**: https://github.com/badlogic/pi-mono
- **Coding Agent Package**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- **Documentation**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs

### Documentation Files (from official repo)

| Document | Purpose |
|----------|---------|
| [extensions.md](extensions.md) | TypeScript modules extending pi behavior, events, tools, commands |
| [themes.md](themes.md) | JSON color schemes for TUI |
| [skills.md](skills.md) | Self-contained task packages (Agent Skills standard) |
| [prompt-templates.md](prompt-templates.md) | Markdown snippets invoked via `/command` |
| [compaction.md](compaction.md) | Context summarization when window fills |
| [session.md](session.md) | Session file format, tree structure, SessionManager API |
| [tree.md](tree.md) | Tree-based navigation of session history |
| [rpc.md](rpc.md) | JSON protocol for headless/embedded operation |
| [sdk.md](sdk.md) | Programmatic API via `@mariozechner/pi-coding-agent` |
| [settings.md](settings.md) | All configuration options |
| [providers.md](providers.md) | API key and OAuth provider configuration |
| [models.md](models.md) | Custom model configuration (Ollama, vLLM, etc.) |
| [development.md](development.md) | Local development setup |
| [packages.md](packages.md) | npm/git package distribution |
| [custom-provider.md](custom-provider.md) | Custom API implementations via extensions |
| [keybindings.md](keybindings.md) | Keyboard shortcuts |
| [shell-aliases.md](shell-aliases.md) | CLI aliases |
| [terminal-setup.md](terminal-setup.md) | Terminal configuration |
| [tmux.md](tmux.md) | tmux integration |
| [termux.md](termux.md) | Termux (Android) setup |
| [tui.md](tui.md) | Terminal UI components |
| [json.md](json.md) | JSON output mode |
| [windows.md](windows.md) | Windows-specific notes |

## Project Structure

```
~/.pi/agent/
├── agents/           # Pre-configured agent profiles
├── extensions/       # TypeScript extension modules
├── skills/           # Self-contained capability packages
├── themes/           # TUI color themes
│   └── subagent/     # Subagent theme variant
├── prompts/          # Prompt template markdown files
├── settings.json     # Global configuration
├── auth.json         # API keys and OAuth tokens
├── models.json       # Custom model definitions
└── sessions/         # Session storage (tree-structured JSONL)
```

## Core Concepts

### Sessions
- **Format**: JSONL (JSON Lines) files
- **Structure**: Tree with `id`/`parentId` linking (version 3)
- **Location**: `~/.pi/agent/sessions/`
- **Branching**: `/tree` navigates in-place, `/fork` extracts to new file
- **Compaction**: Auto-summarizes when context window fills (~16384 tokens reserved)

### Extensions
- **Location**: `~/.pi/agent/extensions/*.ts` or `.pi/extensions/`
- **Format**: TypeScript modules exporting default function
- **Events**: Subscribe to lifecycle events (agent_start, tool_call, session_compact, etc.)
- **Registration**: `pi.registerTool()`, `pi.registerCommand()`, `pi.registerShortcut()`
- **Hot reload**: `/reload` reinitializes extensions

### Tools
- **Built-in**: read, bash, edit, write, grep, find, ls
- **Parallel execution**: Multiple tool calls run concurrently by default
- **File mutation queue**: Prevents race conditions on same-file edits

### Themes
- **Format**: JSON with color tokens
- **51 required tokens**: Core UI, backgrounds, markdown, syntax, thinking levels
- **Hot reload**: Editing active theme updates TUI immediately

### Skills
- **Format**: Directory with `SKILL.md` file
- **Discovery**: `~/.pi/agent/skills/` and `.pi/skills/`
- **Invocation**: `/skill:name` command or automatic on task match
- **Standard**: Follows [Agent Skills specification](https://agentskills.io/specification)

### Prompt Templates
- **Format**: Markdown files with optional YAML frontmatter
- **Location**: `~/.pi/agent/prompts/*.md`
- **Invocation**: `/template-name` (filename without .md)
- **Arguments**: `$1`, `$2`, `$@` for positional parameters

## Configuration Files

### settings.json
```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 },
  "retry": { "enabled": true, "maxRetries": 3 },
  "enabledModels": ["claude-*", "gpt-4o"],
  "packages": ["pi-skills"],
  "extensions": [],
  "skills": [],
  "prompts": [],
  "themes": []
}
```

### auth.json
API keys and OAuth tokens. Supports:
- Literal values: `"key": "sk-ant-..."`
- Environment variables: `"key": "ANTHROPIC_API_KEY"`
- Shell commands: `"key": "!security find-generic-password -ws 'anthropic'"`

### models.json
Custom providers and models (Ollama, LM Studio, vLLM, proxies).

## Available Agents (in agents/)

Based on file listing:
- **scout.md** - Exploration/scout agent
- **kyrie.md** - Secondary agent
- **devops.md** - DevOps tasks
- **sparky.md** - Another agent variant
- **planner.md** - Planning agent
- **tavily.md** - Web search integration
- **documenter.md** - Documentation tasks
- **designer.md** - Design tasks
- **builder.md** - Building/construction tasks
- **reviewer.md** - Code review

## Theme Structure (themes/subagent/)

Contains:
- `README.md` - Theme documentation
- `prompts/` - Subagent-specific prompts (scout-and-plan, implement, implement-and-review)
- `agents/` - Agent definitions (scout, planner, worker, reviewer)

## Installed Extensions

- **Uncodixfy.md** - Extension documentation
- **ENGRAM.md** - Extension documentation

## Key Events for Extensions

```
session_directory → session_start → user prompt
  ↓
input → before_agent_start → agent_start
  ↓
turn_start → context → before_provider_request
  ↓
tool_execution_start → tool_call → tool_result → tool_execution_end
  ↓
turn_end → agent_end
```

## Quick Commands

| Command | Description |
|---------|-------------|
| `/new` | Start fresh session |
| `/resume` | Switch sessions |
| `/fork` | Branch from previous user message |
| `/tree` | Navigate session tree |
| `/compact` | Manual compaction |
| `/model` | Switch model |
| `/settings` | Edit configuration |
| `/reload` | Hot reload extensions/skills/themes |
| `/name <title>` | Set session display name |

## Environment Variables

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `MISTRAL_API_KEY` | Mistral |
| `GROQ_API_KEY` | Groq |
| `CEREBRAS_API_KEY` | Cerebras |
| `XAI_API_KEY` | xAI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `HF_TOKEN` | Hugging Face |

## Development Setup

```bash
git clone https://github.com/badlogic/pi-mono
cd pi-mono
npm install
npm run build
./pi-test.sh
```

## Tips for New Sessions

1. Start with this file to understand the project context
2. Check `settings.json` for active configuration
3. Review existing extensions in `extensions/` for patterns
4. Use `/help` in interactive mode for built-in commands
5. Session files are in `sessions/` directory - can be deleted or edited

## Common Patterns

### Creating an Extension
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Intercept or modify tool calls
  });

  pi.registerTool({
    name: "my_tool",
    // ... tool definition
  });

  pi.registerCommand("my-cmd", {
    handler: async (args, ctx) => {
      ctx.ui.notify("Done!", "info");
    },
  });
}
```

### Custom Theme
```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "my-theme",
  "vars": { "primary": "#00aaff" },
  "colors": {
    "accent": "primary",
    "text": "",
    // ... all 51 required tokens
  }
}
```

## Related Packages

- `@mariozechner/pi-coding-agent` - Main SDK package
- `@mariozechner/pi-ai` - LLM provider abstraction
- `@mariozechner/pi-agent-core` - Agent core
- `@mariozechner/pi-tui` - Terminal UI components
- `@sinclair/typebox` - Schema definitions for tool parameters

## External Resources

- [Agent Skills Standard](https://agentskills.io/specification)
- [Pi Skills Gallery](https://shittycodingagent.ai/packages)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Pi Skills](https://github.com/badlogic/pi-skills)