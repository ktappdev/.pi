import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/context.ts";
const MAX_CONTEXT_TURNS = 10;
const DEFAULT_CONTEXT_TURNS = 4;
const MAX_CONTEXT_CHARS = 20000;
export function normalizeContextTurns(value) {
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONTEXT_TURNS;
    return Math.max(1, Math.min(MAX_CONTEXT_TURNS, Math.floor(value)));
}
export function extractMessageText(message) {
    const content = (message)?.content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content.map((part)=>{
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "type" in part && (part).type === "text") {
            const text = (part).text;
            return typeof text === "string" ? text : "";
        }
        return "";
    }).join("\n").trim();
}
export function buildRecentContextFromEntries(entries, turns) {
    const maxTurns = normalizeContextTurns(turns);
    const messages = [];
    let userMessagesSeen = 0;
    for(let i = entries.length - 1; i >= 0; i--){
        const entry = entries[i];
        if (entry?.type !== "message" || !entry.message) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = extractMessageText(entry.message);
        if (!text) continue;
        messages.unshift({
            role,
            text
        });
        if (role === "user") {
            userMessagesSeen++;
            if (userMessagesSeen >= maxTurns) break;
        }
    }
    if (messages.length === 0) return undefined;
    let rendered = messages.map((m)=>`${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
    if (rendered.length > MAX_CONTEXT_CHARS) {
        rendered = rendered.slice(rendered.length - MAX_CONTEXT_CHARS).trimStart();
        rendered = `[truncated to last ${MAX_CONTEXT_CHARS} chars]\n${rendered}`;
    }
    return rendered;
}
export function buildFusionTaskText(prompt, contextText) {
    if (!contextText?.trim()) return prompt;
    return [
        "Recent conversation context:",
        contextText.trim(),
        "",
        "Current task:",
        prompt.trim()
    ].join("\n");
}
