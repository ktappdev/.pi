import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/config.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const DEFAULT_MAX_PANEL_MODELS = 3;
export const DEFAULT_MAX_PANEL_OUTPUT_TOKENS = 2048;
export const DEFAULT_MAX_COMPLETION_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0.3;
export const MAX_PANEL_MODELS_HARD_LIMIT = 8;
export const PANEL_CONCURRENCY = 4;
export const DEFAULT_MAX_TOOL_CALLS = 16;
export const MIN_TOOL_CALLS = 1;
export const MAX_TOOL_CALLS = 100;
export const TOOL_OUTPUT_MAX_BYTES = 12_000;
export const THINKING_LEVELS = [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh"
];
export function loadConfig(cwd, projectTrusted) {
    const paths = [];
    if (projectTrusted) {
        paths.push(join(cwd, ".pi", "fusion.json"));
    }
    paths.push(join(getAgentDir(), "fusion.json"));
    for (const path of paths){
        if (!existsSync(path)) continue;
        try {
            return parseFusionConfig(readFileSync(path, "utf8"));
        } catch (err) {
            console.error(`[pi-fusion] failed to parse ${path}:`, err);
        }
    }
    return {};
}
export function parseFusionConfig(text) {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("Fusion config root must be a JSON object.");
    return parsed;
}
export function applyDefaults(config, overrides) {
    const merged = {
        ...config,
        ...(overrides.max_completion_tokens ? {
            maxCompletionTokens: overrides.max_completion_tokens
        } : {}),
        ...(overrides.temperature !== undefined ? {
            temperature: overrides.temperature
        } : {}),
        ...(overrides.panel_tools !== undefined ? {
            panelTools: overrides.panel_tools
        } : {}),
        ...(overrides.max_tool_calls !== undefined ? {
            maxToolCalls: overrides.max_tool_calls
        } : {}),
        ...(overrides.panel_reasoning !== undefined ? {
            panelReasoning: overrides.panel_reasoning
        } : {}),
        ...(overrides.judge_reasoning !== undefined ? {
            judgeReasoning: overrides.judge_reasoning
        } : {})
    };
    return {
        ...merged,
        maxPanelModels: merged.maxPanelModels ?? DEFAULT_MAX_PANEL_MODELS,
        maxPanelOutputTokens: merged.maxPanelOutputTokens ?? DEFAULT_MAX_PANEL_OUTPUT_TOKENS,
        maxCompletionTokens: merged.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
        temperature: merged.temperature ?? DEFAULT_TEMPERATURE,
        maxToolCalls: merged.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS
    };
}
export function resolveEffectiveConfig(config, overrides = {}, explicitPanel) {
    const warnings = [];
    const normalized = normalizeTopLevelReasoning(config, warnings);
    if (explicitPanel !== undefined) {
        const selected = readNamedPanel(normalized, explicitPanel);
        if (!selected.ok) return {
            ok: false,
            error: selected.error,
            warnings
        };
        return {
            ok: true,
            config: applyDefaults(applyNamedPanel(normalized, selected.panel), overrides),
            profileName: explicitPanel,
            source: "explicit",
            warnings
        };
    }
    const rawDefault = (normalized).defaultPanel;
    if (rawDefault !== undefined) {
        if (typeof rawDefault !== "string" || rawDefault.trim().length === 0) {
            warnings.push("Configured defaultPanel must be a non-empty string; falling back to legacy or auto selection.");
        } else {
            const selected = readNamedPanel(normalized, rawDefault);
            if (selected.ok) {
                return {
                    ok: true,
                    config: applyDefaults(applyNamedPanel(normalized, selected.panel), overrides),
                    profileName: rawDefault,
                    source: "default",
                    warnings
                };
            }
            warnings.push(`Configured defaultPanel "${rawDefault}" is invalid: ${selected.error.message} Falling back to legacy or auto selection.`);
        }
    }
    return {
        ok: true,
        config: applyDefaults(normalized, overrides),
        source: "legacy",
        warnings
    };
}
function normalizeTopLevelReasoning(config, warnings) {
    const normalized = {
        ...config
    };
    for (const key of [
        "panelReasoning",
        "judgeReasoning"
    ]){
        const value = (config)[key];
        if (value !== undefined && !isThinkingLevel(value)) {
            delete normalized[key];
            warnings.push(`Invalid ${key} value; omitting it. Expected ${THINKING_LEVELS.join(", ")}.`);
        }
    }
    return normalized;
}
function readNamedPanel(config, panelName) {
    if (!panelName.trim()) {
        return invalidPanel(panelName, "Named panel name must be a non-empty string.");
    }
    const panels = (config).panels;
    if (!isRecord(panels) || !Object.hasOwn(panels, panelName)) {
        return {
            ok: false,
            error: {
                code: "unknown_named_panel",
                panelName,
                message: `Named panel "${panelName}" is not configured.`
            }
        };
    }
    const value = panels[panelName];
    if (!isRecord(value)) {
        return invalidPanel(panelName, `Named panel "${panelName}" must be an object.`);
    }
    if (!Array.isArray(value.models) || value.models.length === 0) {
        return invalidPanel(panelName, `Named panel "${panelName}" must define at least one model.`);
    }
    if (!value.models.every((model)=>typeof model === "string" && model.trim().length > 0)) {
        return invalidPanel(panelName, `Named panel "${panelName}" models must be non-empty strings.`);
    }
    if (value.judge !== undefined && (typeof value.judge !== "string" || value.judge.trim().length === 0)) {
        return invalidPanel(panelName, `Named panel "${panelName}" judge must be a non-empty string.`);
    }
    for (const key of [
        "panelReasoning",
        "judgeReasoning"
    ]){
        if (value[key] !== undefined && !isThinkingLevel(value[key])) {
            return invalidPanel(panelName, `Named panel "${panelName}" ${key} must be one of ${THINKING_LEVELS.join(", ")}.`);
        }
    }
    return {
        ok: true,
        panel: {
            models: [
                ...value.models
            ],
            ...(value.judge !== undefined ? {
                judge: value.judge
            } : {}),
            ...(value.panelReasoning !== undefined ? {
                panelReasoning: value.panelReasoning
            } : {}),
            ...(value.judgeReasoning !== undefined ? {
                judgeReasoning: value.judgeReasoning
            } : {})
        }
    };
}
function applyNamedPanel(config, panel) {
    return {
        ...config,
        panel: [
            ...panel.models
        ],
        judge: panel.judge ?? config.judge,
        panelReasoning: panel.panelReasoning ?? config.panelReasoning,
        judgeReasoning: panel.judgeReasoning ?? config.judgeReasoning
    };
}
function invalidPanel(panelName, message) {
    return {
        ok: false,
        error: {
            code: "invalid_named_panel",
            panelName,
            message
        }
    };
}
function isThinkingLevel(value) {
    return typeof value === "string" && (THINKING_LEVELS).includes(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function generateConfigExample(panel, judge) {
    return {
        defaultPanel: "default",
        panels: {
            default: {
                models: panel ?? [
                    "anthropic/claude-sonnet-4-5",
                    "openai/gpt-4.1",
                    "google/gemini-2.5-pro"
                ],
                judge: judge ?? "anthropic/claude-opus-4-5",
                panelReasoning: "medium",
                judgeReasoning: "high"
            }
        },
        maxPanelModels: DEFAULT_MAX_PANEL_MODELS,
        maxPanelOutputTokens: DEFAULT_MAX_PANEL_OUTPUT_TOKENS,
        maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        panelTools: "none",
        maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
        footerDisplay: "full"
    };
}
