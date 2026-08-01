import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/models.ts";
import { DEFAULT_MAX_PANEL_MODELS, MAX_PANEL_MODELS_HARD_LIMIT } from "./config.ts";
export function modelDisplay(model) {
    return `${model.provider}/${model.id}`;
}
export function resolveModelIdentifier(registry, identifier) {
    const slash = identifier.indexOf("/");
    if (slash > 0) {
        const provider = identifier.slice(0, slash);
        const id = identifier.slice(slash + 1);
        return registry.find(provider, id);
    }
    return registry.getAll().find((m)=>m.id === identifier);
}
export function selectDiversePanel(available, max) {
    const textModels = available.filter((m)=>m.input.includes("text"));
    if (textModels.length === 0) return [];
    const byProvider = new Map();
    for (const m of textModels){
        const list = byProvider.get(m.provider) ?? [];
        list.push(m);
        byProvider.set(m.provider, list);
    }
    const providers = Array.from(byProvider.keys());
    const chosen = [];
    let round = 0;
    while(chosen.length < max){
        let addedThisRound = false;
        for (const provider of providers){
            const list = byProvider.get(provider);
            const candidate = list[round];
            if (!candidate) continue;
            if (!chosen.some((c)=>c.provider === candidate.provider && c.id === candidate.id)) {
                chosen.push(candidate);
                addedThisRound = true;
                if (chosen.length >= max) break;
            }
        }
        if (!addedThisRound) break;
        round++;
    }
    return chosen;
}
export class PanelSelectionError extends Error {
    profileName;
    warnings;
    constructor(profileName, warnings, message){
        super(message), this.profileName = profileName, this.warnings = warnings;
        this.name = "PanelSelectionError";
    }
}
function resolvePanelIdentifiers(registry, identifiers, maxPanel, warnings) {
    const panel = [];
    for (const id of identifiers){
        const resolved = resolveModelIdentifier(registry, id);
        if (!resolved) {
            warnings.push(`Unknown model identifier: ${id}`);
            continue;
        }
        if (!registry.hasConfiguredAuth(resolved)) {
            warnings.push(`Model not authed: ${modelDisplay(resolved)}`);
            continue;
        }
        if (!panel.some((m)=>m.provider === resolved.provider && m.id === resolved.id)) {
            panel.push(resolved);
        }
        if (panel.length >= maxPanel) break;
    }
    return panel;
}
export async function resolvePanelAndJudge(registry, options) {
    const warnings = [
        ...(options.warnings ?? [])
    ];
    const configuredMaxPanel = Math.min(options.autoMaxPanelModels ?? options.configMaxPanelModels ?? DEFAULT_MAX_PANEL_MODELS, MAX_PANEL_MODELS_HARD_LIMIT);
    const candidates = options.candidates ?? legacyResolveCandidates(options, configuredMaxPanel);
    let panel = [];
    let selected;
    for (const candidate of candidates){
        if (candidate.panel.length === 0) continue;
        const maxPanel = Math.min(candidate.maxPanelModels, MAX_PANEL_MODELS_HARD_LIMIT);
        panel = resolvePanelIdentifiers(registry, candidate.panel, maxPanel, warnings);
        if (panel.length > 0) {
            selected = candidate;
            break;
        }
        const label = candidate.profileName ? `Named panel "${candidate.profileName}"` : candidate.source === "session" ? "Session panel" : "Legacy panel";
        const message = `${label} contained no authed models.`;
        warnings.push(candidate.strict ? message : `${message} Trying the next configured candidate.`);
        if (candidate.strict) {
            throw new PanelSelectionError(candidate.profileName, warnings, message);
        }
    }
    let source;
    if (selected) {
        source = selected.source;
    } else {
        panel = selectDiversePanel(registry.getAvailable(), configuredMaxPanel);
        source = "auto";
    }
    if (panel.length === 0 && options.currentModel && registry.hasConfiguredAuth(options.currentModel)) {
        panel = [
            options.currentModel
        ];
        source = "current";
    }
    if (panel.length === 0) {
        throw new Error("No authed models available for the fusion panel. Configure models in ~/.pi/agent/fusion.json or authenticate more providers.");
    }
    let judge;
    const selectedJudge = selected?.judge ?? (selected?.source === "session" ? options.autoJudge ?? options.configJudge : selected ? undefined : options.autoJudge ?? options.configJudge);
    for (const candidateId of [
        selectedJudge
    ]){
        if (judge || !candidateId) continue;
        const resolved = resolveModelIdentifier(registry, candidateId);
        if (!resolved) {
            warnings.push(`Unknown judge identifier: ${candidateId}`);
        } else if (!registry.hasConfiguredAuth(resolved)) {
            warnings.push(`Judge model not authed: ${modelDisplay(resolved)}`);
        } else {
            judge = resolved;
        }
    }
    if (!judge && options.currentModel && registry.hasConfiguredAuth(options.currentModel)) {
        judge = options.currentModel;
    }
    if (!judge) {
        judge = panel[0];
    }
    return {
        panel,
        judge,
        warnings,
        source,
        ...(selected?.profileName ? {
            profileName: selected.profileName
        } : {})
    };
}
function legacyResolveCandidates(options, configuredMaxPanel) {
    const candidates = [];
    if (options.sessionPanel?.length) {
        candidates.push({
            source: "session",
            panel: options.sessionPanel,
            judge: options.sessionJudge,
            maxPanelModels: MAX_PANEL_MODELS_HARD_LIMIT
        });
    }
    if (options.configPanel?.length) {
        candidates.push({
            source: "legacy",
            panel: options.configPanel,
            judge: options.configJudge,
            maxPanelModels: configuredMaxPanel
        });
    }
    return candidates;
}
