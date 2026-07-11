# Friendly Model Names — Implementation Guide

## Overview

This document describes the changes made to display friendly model names (e.g., "Kat Coder Pro V2") instead of raw endpoint IDs (e.g., "ep-w928yx-1783704566689445974") throughout Pi's UI.

## Problem

StreamLake models on the coding plan require inference endpoint IDs (like `ep-w928yx-...`) for API calls, but these are unreadable in the UI. The goal was to show friendly names everywhere while keeping the real IDs for actual API calls.

## Solution Architecture

### 1. Model Registry (`models.json`)
Models have both `id` (endpoint ID) and `name` (friendly name) fields:
```json
{
  "id": "ep-w928yx-1783704566689445974",
  "name": "Kat Coder Pro V2",
  "provider": "streamlake",
  ...
}
```

### 2. Core Patches (auto-reapplied on session start)
Three core files are patched by `extensions/patch-model-selector.ts`:

- **`list-models.js`**: Shows `provider: Name (id)` format
  - Before: `streamlake  ep-w928yx-1783704566689445974`
  - After: `streamlake: Kat Coder Pro V2 (ep-w928yx-1783704566689445974)`

- **`model-selector.js`**: Shows `item.model.name || item.id` in `/model` menu

- **`footer.js`**: Shows `state.model?.name || state.model?.id` in footer status bar

### 3. Agent Team Views (`lib/agent-team-views.ts`)
Added `resolveModelName()` function that:
- Builds a cache from `pi --list-models` output on first call
- Maps model IDs to friendly names
- Handles `provider/id` format by extracting the ID part and looking it up
- Prepends provider prefix if not already present

Used by `getModelThinkLabel()` which renders model names in grid/table/tactical/activity views.

### 4. Agent Team Extension (`extensions/agent-team.ts`)
- Same `resolveModelName()` for display-only contexts (`/agents-models` picker, stateless list)
- API calls still use raw model IDs (via `ctxModel.id`)
- `state.model` stores raw IDs; resolution happens at display time

### 5. Model Picker (`lib/agent-team-model-picker.ts`)
Updated to accept `{ label: string, value: string }` pairs:
- `label`: Friendly name for display (e.g., "Kat Coder Pro V2")
- `value`: Real model ID for API (e.g., "ep-w928yx-...")

### 6. Custom Footer (`extensions/custom-footer.ts`)
Shows `ctx.model?.name || ctx.model?.id` for the footer display.

## File Locations

### Core (npm package)
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli/list-models.js`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/model-selector.js`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js`

### Custom Extensions (your code)
- `~/.pi/agent/extensions/patch-model-selector.ts` — Auto-patch extension
- `~/.pi/agent/extensions/agent-team.ts` — Agent team orchestrator
- `~/.pi/agent/extensions/lib/agent-team-views.ts` — View rendering
- `~/.pi/agent/extensions/lib/agent-team-model-picker.ts` — Model selection UI
- `~/.pi/agent/extensions/custom-footer.ts` — Custom footer display

### Configuration
- `~/.pi/agent/models.json` — Model registry with friendly names
- `~/.pi/agent/settings.json` — Enabled models
- `~/.pi/agent/agent-models.yaml` — Agent-specific model assignments

## How It Works End-to-End

1. **Model Registry Load**: `models.json` defines models with both `id` and `name`
2. **`pi --list-models`**: Outputs `provider: Name (id)` format (patched)
3. **Cache Build**: First call to `resolveModelName()` runs `pi --list-models` and builds a Map
4. **Display**: All UI components call `resolveModelName(modelId)` to get friendly names
5. **API Calls**: Still use raw IDs from `ctx.model.id` or `agentModels` values

## Recovery Steps (If Updates Break This)

### Quick Check
Run `pi --list-models | grep streamlake` to verify the format is still `provider: Name (id)`.

### If Core Patches Are Lost
The `patch-model-selector.ts` extension should re-apply them on session start. If not:

1. Manually patch `list-models.js`:
   - Find line: `model: m.id,`
   - Change to: `model: (m.name && m.name !== m.id) ? \`\${m.provider}: \${m.name} (\${m.id})\` : \`\${m.provider}: \${m.id}\`,`

2. Manually patch `model-selector.js`:
   - Find: `const modelText = \`\${item.id}\`;`
   - Change to: `const modelText = \`\${item.model.name || item.id}\`;`

3. Manually patch `footer.js`:
   - Find: `const modelName = state.model?.id || "no-model";`
   - Change to: `const modelName = state.model?.name || state.model?.id || "no-model";`

### If Agent Team Views Show Raw IDs
Check that `agent-team-views.ts` has the `resolveModelName()` function and `getModelThinkLabel()` calls it.

### If `/agents-models` Picker Shows Raw IDs
Check that `agent-team-model-picker.ts` accepts `{ label, value }` pairs and `agent-team.ts`'s `fetchAvailableModels()` returns them.

## Key Design Decisions

1. **Display vs. Storage**: Raw IDs are stored in `state.model` and `agentModels`; resolution happens at display time. This keeps API calls working correctly.

2. **Lazy Cache**: The model name cache is built on first use (lazy) rather than at startup, avoiding startup delays.

3. **Provider Prefix**: Display names include the provider prefix (e.g., "streamlake: Kat Coder Pro V2") to distinguish models with the same name from different providers.

4. **Auto-Patch**: Core patches are re-applied on every session start to survive pi updates.

5. **Fallback**: If the cache build fails or a model isn't found, the raw ID is shown as-is.

## Testing

To verify everything works:
```bash
# Check list-models format
pi --list-models | grep streamlake

# Check /model menu (interactive)
/model

# Check agent views (interactive)
/agents-view table
/agents-view grid

# Check /agents-models picker
/agents-models
```

## Date Created
2026-07-10

## Related
- StreamLake coding plan: `https://vanchin.streamlake.ai/api/gateway/coding/v1`
- Models: Kat Coder Pro V2, Pro V2.5, Air V2.5, Air V1
