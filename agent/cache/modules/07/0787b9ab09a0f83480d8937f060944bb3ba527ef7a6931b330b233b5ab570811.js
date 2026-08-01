import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-commandcode-provider/src/models.ts";
export const DEFAULT_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function stringField(record, key) {
    const value = record[key];
    if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`);
    return value;
}
function numberField(record, key) {
    const value = record[key];
    if (typeof value !== "number") throw new Error(`Expected ${key} to be a number`);
    return value;
}
function parseApiModel(value) {
    if (!isRecord(value)) throw new Error("Expected model entry to be an object");
    return {
        id: stringField(value, "id"),
        name: stringField(value, "name"),
        contextLength: numberField(value, "context_length")
    };
}
export function commandCodeModelsFromApiResponse(value) {
    if (!isRecord(value)) throw new Error("Expected models response to be an object");
    if (value.object !== "list") throw new Error("Expected models response object to be 'list'");
    const data = value.data;
    if (!Array.isArray(data)) throw new Error("Expected models response data to be an array");
    return data.map(parseApiModel).map((model)=>({
            id: model.id,
            name: `${model.name} (CC)`,
            reasoning: true,
            contextWindow: model.contextLength,
            maxTokens: Math.min(model.contextLength, DEFAULT_MAX_OUTPUT_TOKENS)
        }));
}
export async function fetchCommandCodeModels(options = {}) {
    const url = options.url ?? DEFAULT_MODELS_URL;
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
        headers: {
            accept: "application/json"
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch Command Code models: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    return commandCodeModelsFromApiResponse(body);
}
