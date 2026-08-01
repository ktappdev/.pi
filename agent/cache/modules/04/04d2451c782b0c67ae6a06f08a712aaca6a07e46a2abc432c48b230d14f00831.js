import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/fusion.ts";
import { loadConfig, PANEL_CONCURRENCY, resolveEffectiveConfig } from "./config.ts";
import { buildFusionTaskText } from "./context.ts";
import { callModelText, callModelWithTools, getTextContent, resolveModelReasoning } from "./llm.ts";
import { modelDisplay, PanelSelectionError, resolvePanelAndJudge } from "./models.ts";
import { JUDGE_SYSTEM_PROMPT, PANEL_SYSTEM_PROMPT, PANEL_SYSTEM_PROMPT_WITH_TOOLS, truncateForJudge } from "./prompts.ts";
import { clampMaxToolCalls, isMutatingSelection, MUTATING_TOOL_NAMES, resolveToolDefs, selectionLabel, selectionToNames } from "./tools.ts";
import { extractJson, mapWithConcurrencyLimit } from "./utils.ts";
export function emptyPanelError(content, capped) {
    if (content.trim()) return undefined;
    return capped ? "no text answer (tool-call budget or loop guard hit)" : "empty response";
}
export function resolvePanelReasoning(panel, requested) {
    const effective = {};
    const warnings = [];
    for (const model of panel){
        const name = modelDisplay(model);
        const resolution = resolveModelReasoning(model, requested);
        effective[name] = resolution.effective ?? null;
        if (resolution.warning) warnings.push(resolution.warning);
    }
    return {
        requested,
        effective,
        warnings
    };
}
export async function resolveFusionSelection(rawConfig, registry, currentModel, overrides) {
    const explicitProfile = overrides.panel_profile;
    const effectiveOverrides = explicitProfile ? {
        ...overrides,
        panel_reasoning: undefined,
        judge_reasoning: undefined
    } : overrides;
    const effective = resolveEffectiveConfig(rawConfig, effectiveOverrides, explicitProfile);
    if (!effective.ok) {
        return selectionFailure(effective.error.message, effective.error.panelName, effective.warnings);
    }
    let legacyResult = effective;
    if (effective.source === "default") {
        const legacyRaw = {
            ...rawConfig
        };
        delete legacyRaw.defaultPanel;
        legacyResult = resolveEffectiveConfig(legacyRaw, overrides);
    }
    if (!legacyResult.ok) {
        return selectionFailure(legacyResult.error.message, legacyResult.error.panelName, legacyResult.warnings);
    }
    const legacy = legacyResult;
    const candidates = [];
    if (explicitProfile) {
        candidates.push({
            source: "explicit",
            profileName: effective.profileName,
            panel: effective.config.panel ?? [],
            judge: effective.config.judge,
            maxPanelModels: effective.config.maxPanelModels,
            strict: true
        });
    } else {
        if (overrides.analysis_models?.length) {
            candidates.push({
                source: "session",
                panel: overrides.analysis_models,
                judge: overrides.model ?? overrides.judge_model,
                maxPanelModels: 8
            });
        }
        if (effective.source === "default") {
            candidates.push({
                source: "default",
                profileName: effective.profileName,
                panel: effective.config.panel ?? [],
                judge: effective.config.judge,
                maxPanelModels: effective.config.maxPanelModels
            });
        }
        if (legacy.config.panel?.length) {
            candidates.push({
                source: "legacy",
                panel: legacy.config.panel,
                judge: legacy.config.judge,
                maxPanelModels: legacy.config.maxPanelModels
            });
        }
    }
    try {
        const resolution = await resolvePanelAndJudge(registry, {
            candidates,
            autoJudge: legacy.config.judge,
            autoMaxPanelModels: legacy.config.maxPanelModels,
            currentModel,
            warnings: effective.warnings
        });
        const config = resolution.source === "explicit" || resolution.source === "default" ? effective.config : legacy.config;
        return {
            ok: true,
            config,
            resolution
        };
    } catch (error) {
        if (error instanceof PanelSelectionError) {
            return selectionFailure(error.message, error.profileName, error.warnings);
        }
        throw error;
    }
}
function selectionFailure(message, profileName, warnings) {
    const details = {
        status: "error",
        responses: [],
        ...(profileName ? {
            panel_profile: profileName
        } : {}),
        ...(warnings.length ? {
            warnings
        } : {}),
        error: message,
        failure_reason: "unexpected_error"
    };
    return {
        ok: false,
        result: {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(details, null, 2)
                }
            ],
            details
        }
    };
}
export async function resolveFusionModels(cwd, registry, currentModel, projectTrusted, overrides) {
    const selection = await resolveFusionSelection(loadConfig(cwd, projectTrusted), registry, currentModel, overrides);
    if (!selection.ok) throw new Error(selection.result.details.error ?? "Fusion model selection failed");
    return selection.resolution;
}
export async function runFusion(cwd, registry, currentModel, prompt, projectTrusted, overrides, ctx, consented, signal, onUpdate) {
    const selection = await resolveFusionSelection(loadConfig(cwd, projectTrusted), registry, currentModel, overrides);
    if (!selection.ok) return selection.result;
    const { config, resolution } = selection;
    const maxPanelOutputTokens = config.maxPanelOutputTokens;
    const maxCompletionTokens = config.maxCompletionTokens;
    const temperature = config.temperature;
    const taskText = buildFusionTaskText(prompt, overrides.context_text);
    const { panel, judge, warnings, profileName, source } = resolution;
    const requestedPanelReasoning = source === "session" ? overrides.panel_reasoning ?? config.panelReasoning : config.panelReasoning;
    const requestedJudgeReasoning = source === "session" ? overrides.judge_reasoning ?? config.judgeReasoning : config.judgeReasoning;
    const panelReasoning = resolvePanelReasoning(panel, requestedPanelReasoning);
    warnings.push(...panelReasoning.warnings);
    const panelReasoningDetails = panelReasoning.requested ? {
        requested: panelReasoning.requested,
        effective: panelReasoning.effective
    } : undefined;
    let toolSelection = config.panelTools;
    const hasConsent = consented || config.panelToolsConsent === true;
    if (isMutatingSelection(toolSelection) && !hasConsent) {
        const readOnly = selectionToNames(toolSelection).filter((n)=>!(MUTATING_TOOL_NAMES).includes(n));
        toolSelection = readOnly.length ? readOnly : "none";
        warnings.push("Mutating panel tools require consent (run /fusion-setup or set panelToolsConsent in fusion.json); using read-only subset.");
    }
    const toolDefs = resolveToolDefs(toolSelection, cwd);
    const toolsEnabled = toolDefs.length > 0;
    const maxToolCalls = clampMaxToolCalls(config.maxToolCalls);
    const mutating = isMutatingSelection(toolSelection);
    const panelConcurrency = mutating ? 1 : PANEL_CONCURRENCY;
    const panelModelNames = panel.map(modelDisplay);
    const judgeName = modelDisplay(judge);
    const toolsLabel = toolsEnabled ? ` | tools: ${selectionLabel(toolSelection)}·${maxToolCalls}${mutating ? " (serialized)" : ""}` : "";
    const panelReasoningLabel = panelReasoningDetails ? ` | panel reasoning: ${panelReasoningDetails.requested} (${Object.entries(panelReasoningDetails.effective).map(([name, level])=>`${name}=${level ?? "off"}`).join(", ")})` : "";
    const judgeReasoningLabel = requestedJudgeReasoning ? ` | judge reasoning requested: ${requestedJudgeReasoning}` : "";
    onUpdate?.({
        content: [
            {
                type: "text",
                text: `Fusion panel: ${panelModelNames.join(", ")} | judge: ${judgeName}${profileName ? ` | named panel: ${profileName}` : ""}${panelReasoningLabel}${judgeReasoningLabel}${toolsLabel}${warnings.length > 0 ? " | warnings: " + warnings.join("; ") : ""}`
            }
        ],
        details: {
            phase: "resolving",
            panel_profile: profileName,
            panel_reasoning: panelReasoningDetails
        }
    });
    const rawPanelResults = await mapWithConcurrencyLimit(panel, panelConcurrency, async (model)=>{
        const base = {
            model: modelDisplay(model),
            provider: model.provider,
            id: model.id
        };
        const effectiveReasoning = panelReasoning.effective[base.model] ?? undefined;
        try {
            let content;
            let tools;
            if (toolsEnabled) {
                const result = await callModelWithTools(registry, model, PANEL_SYSTEM_PROMPT_WITH_TOOLS, taskText, maxPanelOutputTokens, temperature, signal, toolDefs, maxToolCalls, ctx, undefined, effectiveReasoning);
                content = getTextContent(result.message);
                tools = {
                    turns: result.turns,
                    tool_calls: result.toolCalls,
                    capped: result.cappedOut
                };
            } else {
                const response = await callModelText(registry, model, PANEL_SYSTEM_PROMPT, taskText, maxPanelOutputTokens, temperature, signal, effectiveReasoning);
                content = getTextContent(response);
            }
            const error = emptyPanelError(content, tools?.capped ?? false);
            return {
                ...base,
                content: error ? "" : content,
                ...(error ? {
                    error
                } : {}),
                ...(tools ? {
                    tools
                } : {})
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                ...base,
                content: "",
                error: message
            };
        }
    });
    const successful = rawPanelResults.filter((r)=>!r.error);
    const failed = rawPanelResults.filter((r)=>!!r.error);
    if (successful.length === 0) {
        const details = {
            status: "error",
            responses: [],
            failed_models: failed.map((f)=>({
                    model: f.model,
                    error: f.error ?? "unknown error",
                    ...(f.tools ? {
                        tools: f.tools
                    } : {})
                })),
            panel_models: panelModelNames,
            judge_model: judgeName,
            ...(profileName ? {
                panel_profile: profileName
            } : {}),
            ...(panelReasoningDetails ? {
                panel_reasoning: panelReasoningDetails
            } : {}),
            ...(warnings.length > 0 ? {
                warnings
            } : {}),
            error: "all panel models failed",
            failure_reason: classifyAllPanelFailure(failed)
        };
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(details, null, 2)
                }
            ],
            details
        };
    }
    onUpdate?.({
        content: [
            {
                type: "text",
                text: successful.length === 1 ? `Panel complete (${successful.length}/${panel.length}). Only one model succeeded; skipping judge synthesis.` : `Panel complete (${successful.length}/${panel.length}). Running judge...`
            }
        ],
        details: {
            phase: successful.length === 1 ? "single_response" : "judging",
            panel_reasoning: panelReasoningDetails
        }
    });
    let analysis;
    let judgeReasoningDetails;
    if (successful.length >= 2) {
        const judgeReasoning = resolveModelReasoning(judge, requestedJudgeReasoning);
        if (judgeReasoning.warning) warnings.push(judgeReasoning.warning);
        if (judgeReasoning.requested) {
            judgeReasoningDetails = {
                requested: judgeReasoning.requested,
                effective: judgeReasoning.effective ?? null
            };
        }
        const judgeBudgetPerResponse = Math.max(1024, Math.floor(judge.contextWindow / Math.max(successful.length * 2, 8)));
        const judgeUserText = `Task:\n${taskText}\n\n` + successful.map((r)=>`--- Response from ${r.model} ---\n${truncateForJudge(r.content, judgeBudgetPerResponse)}`).join("\n\n");
        try {
            const judgeResponse = await callModelText(registry, judge, JUDGE_SYSTEM_PROMPT, judgeUserText, maxCompletionTokens, temperature, signal, judgeReasoning.effective);
            const judgeText = getTextContent(judgeResponse);
            analysis = extractJson(judgeText);
        } catch (err) {
            console.error("[pi-fusion] judge failed:", err);
            analysis = undefined;
        }
    }
    const details = {
        status: "ok",
        analysis,
        responses: successful.map((r)=>({
                model: r.model,
                content: r.content,
                ...(r.tools ? {
                    tools: r.tools
                } : {})
            })),
        ...(failed.length > 0 ? {
            failed_models: failed.map((f)=>({
                    model: f.model,
                    error: f.error ?? "unknown error",
                    ...(f.tools ? {
                        tools: f.tools
                    } : {})
                }))
        } : {}),
        panel_models: panelModelNames,
        judge_model: judgeName,
        ...(profileName ? {
            panel_profile: profileName
        } : {}),
        ...(panelReasoningDetails ? {
            panel_reasoning: panelReasoningDetails
        } : {}),
        ...(judgeReasoningDetails ? {
            judge_reasoning: judgeReasoningDetails
        } : {}),
        ...(toolsEnabled ? {
            panel_tools: {
                mode: selectionLabel(toolSelection),
                max_tool_calls: maxToolCalls,
                serialized: mutating
            }
        } : {}),
        ...(warnings.length > 0 ? {
            warnings
        } : {})
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(details, null, 2)
            }
        ],
        details
    };
}
function classifyAllPanelFailure(failed) {
    const messages = failed.map((f)=>(f.error ?? "").toLowerCase());
    if (messages.some((m)=>m.includes("credit") || m.includes("quota") || m.includes("billing"))) {
        return "insufficient_credits";
    }
    if (messages.some((m)=>m.includes("rate limit") || m.includes("429"))) {
        return "rate_limited";
    }
    return "all_panels_failed";
}
