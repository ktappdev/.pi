import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/llm.ts";
import { complete, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { TOOL_OUTPUT_MAX_BYTES } from "./config.ts";
import { modelDisplay } from "./models.ts";
import { truncateToBytes } from "./utils.ts";
export function resolveModelReasoning(model, requested) {
    if (!requested) return {};
    if (getSupportedThinkingLevels(model).includes(requested)) {
        return {
            requested,
            effective: requested
        };
    }
    return {
        requested,
        warning: `Reasoning ${requested} is not supported by ${modelDisplay(model)}; running that model without requested reasoning.`
    };
}
export async function buildCompleteOptions(registry, model, maxTokens, temperature, signal, reasoning) {
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
        throw new Error(auth.ok ? `No API key for ${modelDisplay(model)}` : auth.error);
    }
    const options = {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal,
        maxTokens
    };
    if (getSupportsTemperature(model)) {
        options.temperature = temperature;
    }
    if (reasoning) options.reasoning = reasoning;
    return options;
}
export async function callModelText(registry, model, systemPrompt, userText, maxTokens, temperature, signal, reasoning) {
    const options = await buildCompleteOptions(registry, model, maxTokens, temperature, signal, reasoning);
    return runComplete(model, {
        systemPrompt,
        messages: [
            {
                role: "user",
                content: userText,
                timestamp: Date.now()
            }
        ]
    }, options);
}
export async function callModelWithTools(registry, model, systemPrompt, userText, maxTokens, temperature, signal, toolDefs, maxToolCalls, ctx, onToolEvent, reasoning) {
    const options = await buildCompleteOptions(registry, model, maxTokens, temperature, signal, reasoning);
    const tools = toolDefs.map((d)=>({
            name: d.name,
            description: d.description,
            parameters: d.parameters
        }));
    const byName = new Map(toolDefs.map((d)=>[
            d.name,
            d
        ]));
    const messages = [
        {
            role: "user",
            content: userText,
            timestamp: Date.now()
        }
    ];
    const toolCalls = [];
    let turns = 0;
    let used = 0;
    let lastKey;
    let repeatRun = 0;
    let errorStreak = 0;
    while(true){
        const resp = await runComplete(model, {
            systemPrompt,
            messages,
            tools
        }, options);
        turns++;
        const calls = resp.content.filter((c)=>c.type === "toolCall");
        if (resp.stopReason !== "toolUse" || calls.length === 0) {
            return {
                message: resp,
                turns,
                toolCalls,
                cappedOut: false
            };
        }
        messages.push(resp);
        let forceFinalize = false;
        for (const tc of calls){
            if (forceFinalize || used >= maxToolCalls) {
                messages.push(syntheticResult(tc, forceFinalize ? "stopped: repeated or failing tool calls" : "tool-call budget exhausted"));
                toolCalls.push({
                    name: tc.name,
                    ok: false
                });
                continue;
            }
            const ok = await executeToolCall(tc, byName.get(tc.name), signal, ctx, messages);
            used++;
            toolCalls.push({
                name: tc.name,
                ok
            });
            onToolEvent?.({
                name: tc.name,
                turn: turns,
                ok
            });
            const key = `${tc.name}:${JSON.stringify(tc.arguments)}`;
            repeatRun = key === lastKey ? repeatRun + 1 : 1;
            lastKey = key;
            errorStreak = ok ? 0 : errorStreak + 1;
            if (repeatRun >= 3 || errorStreak >= 3) {
                forceFinalize = true;
            }
        }
        if (forceFinalize || used >= maxToolCalls) {
            const finalSystem = `${systemPrompt}\n\nYou have reached the tool-call limit. Write your complete final answer now using only what you have already gathered — do not request any more tools.`;
            const finalMsg = await runComplete(model, {
                systemPrompt: finalSystem,
                messages
            }, options);
            turns++;
            return {
                message: finalMsg,
                turns,
                toolCalls,
                cappedOut: true
            };
        }
    }
}
async function runComplete(model, context, options) {
    const resp = await complete(model, context, options);
    if (resp.stopReason === "error" || resp.stopReason === "aborted") {
        throw new Error(resp.errorMessage ?? `Model stopped with reason: ${resp.stopReason}`);
    }
    return resp;
}
async function executeToolCall(tc, def, signal, ctx, messages) {
    try {
        if (!def) throw new Error(`unknown tool: ${tc.name}`);
        const out = await def.execute(tc.id, tc.arguments, signal, undefined, ctx);
        messages.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: truncateToolContent(out.content),
            isError: false,
            timestamp: Date.now()
        });
        return true;
    } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        messages.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [
                {
                    type: "text",
                    text: `Error: ${text}`
                }
            ],
            isError: true,
            timestamp: Date.now()
        });
        return false;
    }
}
function syntheticResult(tc, text) {
    return {
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [
            {
                type: "text",
                text
            }
        ],
        isError: true,
        timestamp: Date.now()
    };
}
function truncateToolContent(content) {
    return content.map((part)=>{
        if (part.type !== "text") return part;
        const truncated = truncateToBytes(part.text, TOOL_OUTPUT_MAX_BYTES, "\n…[truncated]");
        return truncated === part.text ? part : {
            type: "text",
            text: truncated
        };
    });
}
export function getSupportsTemperature(model) {
    if (model.provider === "github-copilot" && model.id === "gpt-5.6-sol") return false;
    if (model.api === "anthropic-messages") {
        const supported = (model).compat?.supportsTemperature;
        if (typeof supported === "boolean") return supported;
    }
    const haystack = `${model.provider} ${model.id} ${model.baseUrl}`.toLowerCase();
    if (haystack.includes("codex")) return false;
    return true;
}
export function getTextContent(message) {
    return message.content.filter((c)=>c.type === "text").map((c)=>c.text).join("\n");
}
