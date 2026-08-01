import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-commandcode-provider/src/converters.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function booleanValue(value) {
    return typeof value === "boolean" ? value : undefined;
}
export function recordArray(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord);
}
export function recordOrEmpty(value) {
    if (isRecord(value)) return value;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (isRecord(parsed)) return parsed;
        } catch  {}
    }
    return {};
}
export function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function defaultAuthPaths(home) {
    return [
        join(home, ".commandcode", "auth.json"),
        join(home, ".omp", "agent", "auth.json"),
        join(home, ".pi", "agent", "auth.json")
    ];
}
function apiKeyFromCredentialRecord(value) {
    if (!isRecord(value)) return undefined;
    const type = stringValue(value.type);
    if (type === "api") return stringValue(value.key);
    if (type === "oauth") return stringValue(value.access);
    return stringValue(value.key) ?? stringValue(value.access);
}
export function getApiKey(options = {}) {
    const env = options.env ?? process.env;
    if (env.COMMANDCODE_API_KEY) return env.COMMANDCODE_API_KEY;
    const home = options.homeDir?.() ?? homedir();
    const authPaths = options.authPaths ?? defaultAuthPaths(home);
    for (const authPath of authPaths){
        try {
            if (!existsSync(authPath)) continue;
            const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
            if (!isRecord(parsed)) continue;
            const apiKey = stringValue(parsed.apiKey);
            if (apiKey) return apiKey;
            const commandcode = stringValue(parsed.commandcode);
            if (commandcode) return commandcode;
            const providerKey = apiKeyFromCredentialRecord(parsed.commandcode) ?? apiKeyFromCredentialRecord(parsed["command-code"]);
            if (providerKey) return providerKey;
        } catch  {}
    }
    return undefined;
}
export function textContent(message) {
    return recordArray(message.content).filter((part)=>part.type === "text").map((part)=>stringValue(part.text) ?? "").join("\n");
}
export function getEnvironmentInfo() {
    return `${process.platform}-${process.arch}, Node.js ${process.version}`;
}
export function toJsonSchema(schema) {
    if (!isRecord(schema)) return {};
    const kind = stringValue(schema.kind) ?? stringValue(schema.type);
    const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
    if (enumValues) {
        return {
            type: typeof enumValues[0],
            enum: enumValues
        };
    }
    switch(kind){
        case "string":
        case "String":
            return {
                type: "string"
            };
        case "number":
        case "Number":
            return {
                type: "number"
            };
        case "boolean":
        case "Boolean":
            return {
                type: "boolean"
            };
        case "object":
        case "Object":
            {
                const properties = {};
                const inferredRequired = [];
                const sourceProperties = isRecord(schema.properties) ? schema.properties : undefined;
                const optional = Array.isArray(schema.optional) ? schema.optional.filter((item)=>typeof item === "string") : [];
                if (sourceProperties) {
                    for (const [key, value] of Object.entries(sourceProperties)){
                        properties[key] = toJsonSchema(value);
                        const valueRecord = isRecord(value) ? value : undefined;
                        if (booleanValue(valueRecord?.optional) !== true && !optional.includes(key)) {
                            inferredRequired.push(key);
                        }
                    }
                }
                const explicitRequired = Array.isArray(schema.required) ? schema.required.filter((item)=>typeof item === "string") : undefined;
                const required = explicitRequired ?? inferredRequired;
                const out = {
                    type: "object"
                };
                if (Object.keys(properties).length > 0) out.properties = properties;
                if (required.length > 0) out.required = required;
                return out;
            }
        case "array":
        case "Array":
            return {
                type: "array",
                items: toJsonSchema(schema.items ?? schema.element)
            };
        case "union":
        case "Union":
            {
                const variants = Array.isArray(schema.variants) ? schema.variants : Array.isArray(schema.anyOf) ? schema.anyOf : [];
                for (const variant of variants){
                    const converted = toJsonSchema(variant);
                    if (isRecord(converted) && Object.keys(converted).length > 0) return converted;
                }
                return {};
            }
        case "optional":
        case "Optional":
            return toJsonSchema(schema.wrapped ?? schema.inner);
        default:
            return {};
    }
}
export function toolsToJson(tools) {
    if (!tools) return [];
    return tools.map((tool)=>({
            type: "function",
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters ? toJsonSchema(tool.parameters) : {}
        }));
}
function completeToolCallIds(messages) {
    const callIds = new Set();
    const resultIds = new Set();
    for (const message of messages ?? []){
        if (message.role === "assistant") {
            for (const content of recordArray(message.content)){
                if (content.type === "toolCall") {
                    const id = stringValue(content.id);
                    if (id) callIds.add(id);
                }
            }
        } else if (message.role === "toolResult") {
            if (message.toolCallId) resultIds.add(message.toolCallId);
        }
    }
    return new Set([
        ...callIds
    ].filter((id)=>resultIds.has(id)));
}
export function messagesToCC(messages) {
    const out = [];
    const pairedToolCallIds = completeToolCallIds(messages);
    for (const message of messages ?? []){
        if (message.role === "user") {
            out.push({
                role: "user",
                content: typeof message.content === "string" ? message.content : message.content
            });
        } else if (message.role === "assistant") {
            const parts = [];
            for (const content of recordArray(message.content)){
                if (content.type === "text") {
                    parts.push({
                        type: "text",
                        text: stringValue(content.text) ?? ""
                    });
                } else if (content.type === "thinking") {
                    parts.push({
                        type: "reasoning",
                        text: stringValue(content.thinking) ?? ""
                    });
                } else if (content.type === "toolCall") {
                    const toolCallId = stringValue(content.id) ?? "";
                    if (!pairedToolCallIds.has(toolCallId)) continue;
                    parts.push({
                        type: "tool-call",
                        toolCallId,
                        toolName: stringValue(content.name) ?? "",
                        input: recordOrEmpty(content.arguments)
                    });
                }
            }
            if (parts.length > 0) out.push({
                role: "assistant",
                content: parts
            });
        } else if (message.role === "toolResult") {
            if (!message.toolCallId || !pairedToolCallIds.has(message.toolCallId)) continue;
            out.push({
                role: "tool",
                content: [
                    {
                        type: "tool-result",
                        toolCallId: message.toolCallId,
                        toolName: message.toolName,
                        output: message.isError ? {
                            type: "error-text",
                            value: textContent(message)
                        } : {
                            type: "text",
                            value: textContent(message)
                        }
                    }
                ]
            });
        }
    }
    return out;
}
export function parseStreamEventLine(line) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return undefined;
    if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
    if (!trimmed || trimmed === "[DONE]") return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed;
    } catch  {
        return undefined;
    }
}
export function mapFinishReason(reason) {
    if (reason === "tool-calls") return "toolUse";
    if (reason === "length" || reason === "max_tokens" || reason === "max-tokens" || reason === "max_output_tokens") {
        return "length";
    }
    return "stop";
}
function promptPartToText(value, depth = 0) {
    if (depth > 10) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((v)=>promptPartToText(v, depth + 1)).filter(Boolean).join("\n");
    if (!isRecord(value)) return "";
    const text = stringValue(value.text);
    if (text) return text;
    const content = promptPartToText(value.content, depth + 1);
    if (content) return content;
    return "";
}
export function systemPromptToText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((v)=>promptPartToText(v, 0)).filter(Boolean).join("\n\n");
    return promptPartToText(value, 0);
}
