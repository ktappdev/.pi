# PI Quick Reference

## Official Docs (Always Current)

| Topic | Path |
|-------|------|
| Extensions | `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md` |
| Settings | `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/settings.md` |
| Sessions | `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md` |
| SDK | `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md` |
| Keybindings | `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/keybindings.md` |

**GitHub:** https://github.com/badlogic/pi-mono

---

## My Workspace

```
~/.pi/agent/
├── extensions/     # My custom extensions
├── skills/         # My skills
├── prompts/        # My prompt templates
├── themes/         # My themes
├── settings.json   # My config
├── models.json     # Custom models
└── sessions/       # Session history
```

---

## Quick Commands

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

**Shortcuts:** `Ctrl+C` clear, `Ctrl+C×2` quit, `Esc×2` tree, `Ctrl+L` model, `Ctrl+P` cycle models

---

## Extension Snippets

### Minimal Extension
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Loaded!", "info");
  });

  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What it does",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      return { content: [{ type: "text", text: "Done" }], details: {} };
    },
  });
}
```

### Block Dangerous Commands
```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    const ok = await ctx.ui.confirm("Dangerous!", "Allow?");
    if (!ok) return { block: true, reason: "Blocked" };
  }
});
```

### Custom Command
```typescript
pi.registerCommand("stats", {
  description: "Show session stats",
  handler: async (_args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  },
});
```

---

## Key Events

| Event | When | Use |
|-------|------|-----|
| `session_start` | On load | Initialize state |
| `tool_call` | Before tool runs | Block/modify |
| `tool_result` | After tool runs | Modify result |
| `before_agent_start` | Before LLM call | Inject message/prompt |
| `input` | On user input | Transform/handle |

---

## Common Patterns

### Persist State
```typescript
pi.appendEntry("my-state", { count: 42 });
// Restore in session_start by iterating ctx.sessionManager.getEntries()
```

### UI Methods
```typescript
ctx.ui.notify("Message", "info|success|error|warn");
ctx.ui.confirm("Title", "Question?");
ctx.ui.select("Title", [{label, value}]);
ctx.ui.input("Title", "Placeholder");
ctx.ui.setStatus("key", "Text");  // Footer
ctx.ui.setWidget("key", ["Line1", "Line2"]);  // Above editor
```

### Abort-Aware Fetch
```typescript
pi.on("tool_result", async (event, ctx) => {
  const res = await fetch("https://api.example.com", {
    signal: ctx.signal,  // Respects Esc cancel
  });
});
```

---

## Config Quick Reference

### settings.json
```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "theme": "dark",
  "compaction": { "enabled": true },
  "enabledModels": ["claude-*", "gpt-4o"]
}
```

### auth.json
```json
{
  "anthropic": "ANTHROPIC_API_KEY",  // env var
  "openai": "sk-..."                  // literal
}
```

---

## Environment Variables

| Provider | Variable |
|----------|----------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GEMINI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

---

## Tips

1. **Hot reload:** Edit extension → `/reload` (no restart needed)
2. **Test extensions:** `pi -e ./my-ext.ts`
3. **Session files:** JSONL in `~/.pi/agent/sessions/`, safe to delete
4. **File mutation queue:** Use `withFileMutationQueue()` for custom tools that edit files
5. **StringEnum:** Use `StringEnum` from `@mariozechner/pi-ai` for tool parameters (Google compat)

---

## Installed Packages

| Name | Type | Purpose |
|------|------|---------|
| | | |

*Fill in as you install pi packages*
