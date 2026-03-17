# Fresh Read Guard

A Pi coding agent extension that prevents stale file edits by ensuring files are re-read before modification if they have changed since the last read operation.

**Version**: 1.0.0  
**Author**: Ken Taylor  
**GitHub**: [@ktappdev](https://github.com/ktappdev)

## Features

- **Automatic staleness detection** — Checks file modification time before each edit
- **Auto re-read** — Automatically re-reads stale files before editing
- **Session-aware** — Tracks files per session, resets on session end/fork
- **Lightweight** — Minimal overhead (~5ms per edit operation)
- **Configurable** — Optional config file for customization
- **Re-read loop protection** — Prevents infinite re-read cycles

## Installation

1. Copy `fresh-read.ts` to your Pi extensions directory:
   ```bash
   cp fresh-read.ts ~/.pi/agent/extensions/
   ```

2. (Optional) Copy the example config:
   ```bash
   cp fresh-read.config.example.json ~/.pi/agent/extensions/fresh-read.config.json
   ```

3. Restart Pi or reload your session.

## Usage

The extension works automatically once installed. You'll see notifications when:

```
ℹ️ File was modified externally. Re-reading...
ℹ️ File re-read complete
```

### Commands

| Command | Description |
|---------|-------------|
| `/fresh-read-status` | Show tracked files and their age |
| `/fresh-read-clear` | Clear file tracking for current session |

## Configuration

Create `~/.pi/agent/extensions/fresh-read.config.json`:

```json
{
  "enabled": true,
  "autoReread": true,
  "protectedPaths": [],
  "ignoredPaths": [
    "**/*.log",
    "**/tmp/**",
    "**/dist/**",
    "**/node_modules/**"
  ]
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the extension |
| `autoReread` | boolean | `true` | Automatically re-read stale files |
| `protectedPaths` | string[] | `[]` | Always enforce freshness (glob patterns) |
| `ignoredPaths` | string[] | `[]` | Never enforce freshness (glob patterns) |

## How It Works

### Runtime Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Pi Session Starts                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  session_start hook fires                                       │
│  → fileMap = new Map()  (empty in-memory tracking)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Works Normally                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Agent calls: read({ path: "./src/app.ts" })           │  │
│  │    → Pi reads the file                                   │  │
│  │    → tool_result hook fires                              │  │
│  │    → recordRead() stores:                                │  │
│  │      { lastRead: 1234567890, mtime: 9876543210 }         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 2. User edits ./src/app.ts externally (vim, etc.)        │  │
│  │    → fileMap doesn't know (no hook fires)                │  │
│  │    → file mtime updates on disk                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 3. Agent calls: edit({ path: "./src/app.ts", ... })      │  │
│  │    → tool_call hook fires (BEFORE edit executes)         │  │
│  │    → isFileStale() checks:                               │  │
│  │        currentMtime (from fs.stat) > recorded.mtime?     │  │
│  │    → YES, file is stale!                                 │  │
│  │    → Block the edit                                      │  │
│  │    → Notify: "File modified externally. Re-reading..."   │  │
│  │    → Auto-call: ctx.tools.read({ path: "./src/app.ts" }) │  │
│  │    → Re-read completes, fileMap updated                  │  │
│  │    → Return: { block: true, reason: "..." }              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 4. Agent retries the edit (now with fresh contents)      │  │
│  │    → tool_call hook fires again                          │  │
│  │    → isFileStale() checks:                               │  │
│  │        currentMtime === recorded.mtime?                  │  │
│  │    → NO, file is fresh!                                  │  │
│  │    → Allow edit to proceed                               │  │
│  │    → tool_result hook fires                              │  │
│  │    → recordEdit() updates lastEdit timestamp             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  session_end hook fires                                         │
│  → fileMap = null (cleared)                                    │  │
│  → reReadInProgress.clear()                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Mechanisms

**File Tracking (`fileMap`)**
```typescript
Map<
  "/Users/project/src/app.ts",  // Absolute path
  {
    lastRead: 1709999999000,     // When agent last read it
    lastEdit: 1710000000000,     // When agent last edited it (or null)
    mtime: 9876543210000         // Filesystem mtime at last read
  }
>
```

**Staleness Check**
```typescript
async function isFileStale(filePath, fileMap): Promise<boolean> {
  const record = fileMap.get(filePath);
  
  if (!record) return true;  // Never read = stale
  
  const stats = await fs.stat(filePath);  // 1 syscall
  const currentMtime = stats.mtimeMs;
  
  return currentMtime > record.mtime;  // Changed since we read it?
}
```

**Tool Interception**
- `tool_call` hook runs **before** edit executes → checks freshness, blocks if stale
- `tool_result` hook runs **after** tool succeeds → records the operation

### Simple Summary

```
1. Agent reads a file → recorded in memory with mtime
2. Agent attempts to edit → check if mtime changed
3. If stale → block edit, auto re-read, then allow retry
4. If fresh → allow edit immediately
```

## When It Triggers

| Scenario | Behavior |
|----------|----------|
| File modified externally | ✅ Re-read triggered |
| File modified by another agent | ✅ Re-read triggered |
| New file (never existed) | ✅ Write allowed |
| File in `ignoredPaths` | ⏭️ Skipped |
| Re-read fails | ⚠️ Error shown, edit blocked |

## Performance

- **Memory**: ~72 bytes per tracked file
- **Overhead**: <5ms per edit operation
- **Syscalls**: 1 `fs.stat` per edit/write check

## Troubleshooting

### Extension not working?

1. Check Pi logs for `fresh-read:` prefixed messages
2. Verify the file is in `~/.pi/agent/extensions/`
3. Ensure no syntax errors in the TypeScript file

### Too many notifications?

Add frequently-changing files to `ignoredPaths`:

```json
{
  "ignoredPaths": ["**/logs/**", "**/*.tmp"]
}
```

### Re-read loop detected?

This means a file is being modified externally in a loop. The extension will detect this and allow the edit to proceed with a warning.

## License

MIT — Feel free to share, modify, and distribute.

© 2026 Ken Taylor ([@ktappdev](https://github.com/ktappdev))
