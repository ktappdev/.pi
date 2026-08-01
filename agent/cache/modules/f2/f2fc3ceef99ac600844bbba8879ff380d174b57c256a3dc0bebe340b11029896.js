import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/tools.ts";
import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_TOOL_CALLS, MAX_TOOL_CALLS, MIN_TOOL_CALLS } from "./config.ts";
export const READONLY_TOOL_NAMES = [
    "read",
    "grep",
    "find",
    "ls"
];
export const MUTATING_TOOL_NAMES = [
    "bash",
    "edit",
    "write"
];
export const ALL_TOOL_NAMES = [
    ...READONLY_TOOL_NAMES,
    ...MUTATING_TOOL_NAMES
];
const FACTORIES = {
    read: (cwd)=>createReadToolDefinition(cwd),
    grep: (cwd)=>createGrepToolDefinition(cwd),
    find: (cwd)=>createFindToolDefinition(cwd),
    ls: (cwd)=>createLsToolDefinition(cwd),
    bash: (cwd)=>createBashToolDefinition(cwd),
    edit: (cwd)=>createEditToolDefinition(cwd),
    write: (cwd)=>createWriteToolDefinition(cwd)
};
function isToolName(value) {
    return (ALL_TOOL_NAMES).includes(value);
}
export function selectionToNames(selection) {
    if (!selection || selection === "none") return [];
    if (selection === "readonly") return [
        ...READONLY_TOOL_NAMES
    ];
    if (selection === "all") return [
        ...ALL_TOOL_NAMES
    ];
    if (Array.isArray(selection)) {
        const seen = new Set();
        const out = [];
        for (const raw of selection){
            const name = String(raw).toLowerCase();
            if (isToolName(name) && !seen.has(name)) {
                seen.add(name);
                out.push(name);
            }
        }
        return out;
    }
    return [];
}
export function resolveToolDefs(selection, cwd) {
    return selectionToNames(selection).map((name)=>FACTORIES[name](cwd));
}
export function isMutatingSelection(selection) {
    return selectionToNames(selection).some((n)=>(MUTATING_TOOL_NAMES).includes(n));
}
export function selectionLabel(selection) {
    if (!selection || selection === "none") return "none";
    if (selection === "readonly" || selection === "all") return selection;
    const names = selectionToNames(selection);
    return names.length ? names.join(",") : "none";
}
export function clampMaxToolCalls(value) {
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_TOOL_CALLS;
    return Math.max(MIN_TOOL_CALLS, Math.min(MAX_TOOL_CALLS, Math.floor(value)));
}
