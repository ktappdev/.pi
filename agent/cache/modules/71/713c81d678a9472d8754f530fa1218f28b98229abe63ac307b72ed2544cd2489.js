import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-commandcode-provider/src/core.ts";
import { randomUUID } from "node:crypto";
import { getApiKey, getEnvironmentInfo, isRecord, mapFinishReason, messagesToCC, numberValue, parseStreamEventLine, recordOrEmpty, stringValue, toolsToJson, systemPromptToText } from "./converters.ts";
export * from "./converters.ts";
export * from "./types.ts";
export const DEFAULT_API_BASE = "https://api.commandcode.ai";
export const COMMAND_CODE_CLI_VERSION = "0.29.0";
const DEFAULT_GENERATE_MAX_TOKENS = 64_000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const BASE_RETRY_DELAY_MS = 500;
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
}
function parseRetryAfterSeconds(value) {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
    return undefined;
}
function effectiveMaxRetryDelayMs(value) {
    if (value === undefined) return DEFAULT_MAX_RETRY_DELAY_MS;
    if (value === 0) return Number.POSITIVE_INFINITY;
    return value;
}
function retryDelayMs(attempt, retryAfterHeader, maxDelayMs) {
    const retryAfterMs = parseRetryAfterSeconds(retryAfterHeader);
    if (retryAfterMs !== undefined) {
        if (retryAfterMs * 1000 > maxDelayMs) return -1;
        return retryAfterMs * 1000;
    }
    const exponential = BASE_RETRY_DELAY_MS * 2 ** attempt;
    const jitter = exponential * 0.2 * Math.random();
    return Math.min(exponential + jitter, maxDelayMs);
}
function defaultUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0
        }
    };
}
function commandCodeUsage(event) {
    return isRecord(event.totalUsage) ? event.totalUsage : undefined;
}
function commandCodeInputTokenDetails(usage) {
    return isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : undefined;
}
function headersToRecord(headers) {
    const out = {};
    headers.forEach((value, key)=>{
        out[key] = value;
    });
    return out;
}
function abortError(message = "The operation was aborted") {
    return new DOMException(message, "AbortError");
}
function timeoutError(timeoutMs) {
    return new Error(timeoutMs === undefined ? "Command Code API request timed out" : `Command Code API request timed out after ${timeoutMs}ms`);
}
function successStopReason(reason) {
    if (reason === "length" || reason === "toolUse") return reason;
    return "stop";
}
function generateMaxTokens(model, options) {
    return Math.min(options?.maxTokens ?? model.maxTokens, model.maxTokens, DEFAULT_GENERATE_MAX_TOKENS);
}
export function projectSlugFromPath(pathName) {
    const slug = pathName.toLowerCase().replace(/^[a-z]:/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "project";
}
export function createStreamCommandCode(deps) {
    const apiBase = deps.apiBase ?? DEFAULT_API_BASE;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const cwd = deps.cwd ?? (()=>process.cwd());
    const now = deps.now ?? (()=>Date.now());
    const uuid = deps.uuid ?? (()=>randomUUID());
    const delay = deps.delay ?? ((ms, signal)=>{
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise((resolve, reject)=>{
            const id = setTimeout(()=>{
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            const onAbort = ()=>{
                clearTimeout(id);
                reject(abortError());
            };
            signal.addEventListener("abort", onAbort, {
                once: true
            });
        });
    });
    function raceAbort(promise, signal) {
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise((resolve, reject)=>{
            const onAbort = ()=>reject(abortError());
            signal.addEventListener("abort", onAbort, {
                once: true
            });
            promise.then((value)=>{
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            }, (error)=>{
                signal.removeEventListener("abort", onAbort);
                reject(error);
            });
        });
    }
    return function streamCommandCode(model, context, options) {
        const stream = deps.createStream();
        async function run() {
            const hostKey = options?.apiKey && options.apiKey !== "COMMANDCODE_API_KEY" ? options.apiKey : undefined;
            const apiKey = hostKey ?? getApiKey({
                env: deps.env,
                authPaths: deps.authPaths,
                homeDir: deps.homeDir
            });
            if (!apiKey) {
                const msg = {
                    role: "assistant",
                    content: [],
                    api: model.api,
                    provider: model.provider,
                    model: model.id,
                    usage: defaultUsage(),
                    stopReason: "error",
                    errorMessage: "No Command Code API key. Run /login and select Command Code, set the COMMANDCODE_API_KEY env var, or configure ~/.commandcode/auth.json, ~/.pi/agent/auth.json or ~/.omp/agent/auth.json",
                    timestamp: now()
                };
                stream.push({
                    type: "error",
                    reason: "error",
                    error: msg
                });
                stream.end();
                return;
            }
            const output = {
                role: "assistant",
                content: [],
                api: model.api,
                provider: model.provider,
                model: model.id,
                usage: defaultUsage(),
                stopReason: "stop",
                timestamp: now()
            };
            const controller = new AbortController();
            let reader;
            let textBlock;
            let currentTextIdx = -1;
            let thinkingIdx = -1;
            let finished = false;
            const abortUpstream = ()=>{
                if (!controller.signal.aborted) controller.abort();
                try {
                    reader?.cancel().catch(()=>undefined);
                } catch  {}
            };
            if (options?.signal?.aborted) {
                abortUpstream();
            } else {
                options?.signal?.addEventListener("abort", abortUpstream, {
                    once: true
                });
            }
            const endTextBlock = ()=>{
                if (!textBlock) return;
                stream.push({
                    type: "text_end",
                    contentIndex: currentTextIdx,
                    content: textBlock.text,
                    partial: output
                });
                textBlock = undefined;
                currentTextIdx = -1;
            };
            const endThinking = ()=>{
                if (thinkingIdx < 0) return;
                const tc = output.content[thinkingIdx];
                if (tc && tc.type === "thinking") {
                    stream.push({
                        type: "thinking_end",
                        contentIndex: thinkingIdx,
                        content: (tc).thinking,
                        partial: output
                    });
                }
                thinkingIdx = -1;
            };
            const handleEvent = (event)=>{
                if (!isRecord(event)) return;
                switch(event.type){
                    case "text-delta":
                        {
                            endThinking();
                            if (!textBlock) {
                                textBlock = {
                                    type: "text",
                                    text: ""
                                };
                                output.content.push(textBlock);
                                currentTextIdx = output.content.length - 1;
                                stream.push({
                                    type: "text_start",
                                    contentIndex: currentTextIdx,
                                    partial: output
                                });
                            }
                            const delta = stringValue(event.text) ?? "";
                            textBlock.text += delta;
                            stream.push({
                                type: "text_delta",
                                contentIndex: currentTextIdx,
                                delta,
                                partial: output
                            });
                            break;
                        }
                    case "reasoning-start":
                        {
                            endTextBlock();
                            break;
                        }
                    case "reasoning-delta":
                        {
                            endTextBlock();
                            const delta = stringValue(event.text) ?? "";
                            if (thinkingIdx < 0) {
                                output.content.push({
                                    type: "thinking",
                                    thinking: delta
                                });
                                thinkingIdx = output.content.length - 1;
                                stream.push({
                                    type: "thinking_start",
                                    contentIndex: thinkingIdx,
                                    partial: output
                                });
                            } else {
                                const tc = output.content[thinkingIdx];
                                if (tc && tc.type === "thinking") {
                                    ;
                                    (tc).thinking += delta;
                                }
                            }
                            stream.push({
                                type: "thinking_delta",
                                contentIndex: thinkingIdx,
                                delta,
                                partial: output
                            });
                            break;
                        }
                    case "reasoning-end":
                        {
                            endThinking();
                            break;
                        }
                    case "tool-result":
                        {
                            break;
                        }
                    case "tool-call":
                        {
                            endTextBlock();
                            endThinking();
                            const toolCall = {
                                type: "toolCall",
                                id: stringValue(event.toolCallId) ?? "",
                                name: stringValue(event.toolName) ?? "",
                                arguments: recordOrEmpty(event.input ?? event.args ?? event.arguments)
                            };
                            output.content.push(toolCall);
                            const idx = output.content.length - 1;
                            stream.push({
                                type: "toolcall_start",
                                contentIndex: idx,
                                partial: output
                            });
                            stream.push({
                                type: "toolcall_end",
                                contentIndex: idx,
                                toolCall,
                                partial: output
                            });
                            break;
                        }
                    case "finish":
                        {
                            const usage = commandCodeUsage(event);
                            if (usage) {
                                const details = commandCodeInputTokenDetails(usage);
                                output.usage.input = numberValue(usage.inputTokens) ?? 0;
                                output.usage.output = numberValue(usage.outputTokens) ?? 0;
                                output.usage.cacheRead = numberValue(details?.cacheReadTokens) ?? 0;
                                output.usage.cacheWrite = numberValue(details?.cacheWriteTokens) ?? 0;
                                output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                                deps.calculateCost(model, output.usage);
                            }
                            output.stopReason = mapFinishReason(event.finishReason);
                            finished = true;
                            break;
                        }
                    case "error":
                        {
                            const errorRecord = isRecord(event.error) ? event.error : undefined;
                            const message = stringValue(errorRecord?.message) ?? stringValue(event.error) ?? "Stream error";
                            output.stopReason = "error";
                            output.errorMessage = message;
                            throw new Error(message);
                        }
                }
            };
            try {
                stream.push({
                    type: "start",
                    partial: output
                });
                const workingDir = cwd();
                const threadId = uuid();
                let body = {
                    config: {
                        workingDir,
                        date: new Date(now()).toISOString().split("T")[0],
                        environment: getEnvironmentInfo(),
                        structure: [],
                        isGitRepo: false,
                        currentBranch: "",
                        mainBranch: "",
                        gitStatus: "",
                        recentCommits: []
                    },
                    memory: null,
                    taste: null,
                    skills: null,
                    params: {
                        model: model.id,
                        messages: messagesToCC(context.messages),
                        tools: toolsToJson(context.tools),
                        system: systemPromptToText(context.systemPrompt),
                        max_tokens: generateMaxTokens(model, options),
                        temperature: 0.3,
                        stream: true
                    },
                    threadId
                };
                const nextBody = await raceAbort(Promise.resolve(options?.onPayload?.(body, model)), controller.signal);
                if (nextBody !== undefined) body = nextBody;
                const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
                const maxRetryDelayMs = effectiveMaxRetryDelayMs(options?.maxRetryDelayMs);
                const timeoutMs = options?.timeoutMs;
                const requestHeaders = {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    "x-command-code-version": COMMAND_CODE_CLI_VERSION,
                    "x-cli-environment": "production",
                    "x-project-slug": projectSlugFromPath(workingDir),
                    "x-taste-learning": "true",
                    "x-co-flag": "false",
                    ...options?.headers
                };
                const bodyStr = JSON.stringify(body);
                let response;
                retryLoop: for(let attempt = 0;; attempt++){
                    const attemptController = new AbortController();
                    let attemptTimedOut = false;
                    let attemptTimeoutId;
                    const clearAttemptTimeout = ()=>{
                        if (attemptTimeoutId !== undefined) {
                            clearTimeout(attemptTimeoutId);
                            attemptTimeoutId = undefined;
                        }
                    };
                    if (timeoutMs !== undefined) {
                        attemptTimeoutId = setTimeout(()=>{
                            attemptTimedOut = true;
                            attemptController.abort();
                        }, timeoutMs);
                    }
                    const onOuterAbort = ()=>attemptController.abort();
                    controller.signal.addEventListener("abort", onOuterAbort, {
                        once: true
                    });
                    try {
                        try {
                            response = await fetchImpl(`${apiBase}/alpha/generate`, {
                                method: "POST",
                                headers: requestHeaders,
                                body: bodyStr,
                                signal: attemptController.signal
                            });
                        } catch (fetchError) {
                            if (controller.signal.aborted) throw abortError("Aborted");
                            if (attemptTimedOut) {
                                if (attempt < maxRetries) continue retryLoop;
                                throw timeoutError(timeoutMs);
                            }
                            throw fetchError;
                        }
                        if (!response.ok && isRetryableStatus(response.status)) {
                            const retryAfter = response.headers.get("retry-after");
                            const waitMs = retryDelayMs(attempt, retryAfter, maxRetryDelayMs);
                            if (waitMs < 0) {
                                const requestedSeconds = parseRetryAfterSeconds(retryAfter) ?? 0;
                                const capLabel = maxRetryDelayMs === Number.POSITIVE_INFINITY ? "disabled" : `${maxRetryDelayMs}ms`;
                                throw new Error(`Retry-After delay ${requestedSeconds}s exceeds max ${capLabel}`);
                            }
                            if (attempt < maxRetries) {
                                await response.text().catch(()=>"");
                                if (waitMs > 0) await delay(waitMs, controller.signal);
                                continue retryLoop;
                            }
                        }
                        await raceAbort(Promise.resolve(options?.onResponse?.({
                            status: response.status,
                            headers: headersToRecord(response.headers)
                        }, model)), controller.signal);
                        if (!response.ok) {
                            const errBody = await raceAbort(response.text().catch(()=>""), controller.signal);
                            throw new Error(`Command Code API error ${response.status}: ${errBody.slice(0, 500)}`);
                        }
                        reader = response.body?.getReader();
                        if (!reader) throw new Error("No response body");
                        const decoder = new TextDecoder();
                        let buffer = "";
                        try {
                            readLoop: for(;;){
                                if (controller.signal.aborted) throw abortError("Aborted");
                                const { done, value } = await raceAbort(reader.read(), attemptController.signal);
                                if (done) {
                                    if (buffer.trim()) handleEvent(parseStreamEventLine(buffer));
                                    break;
                                }
                                if (controller.signal.aborted) throw abortError("Aborted");
                                buffer += decoder.decode(value, {
                                    stream: true
                                });
                                const lines = buffer.split("\n");
                                buffer = lines.pop() ?? "";
                                for (const line of lines){
                                    if (controller.signal.aborted) throw abortError("Aborted");
                                    handleEvent(parseStreamEventLine(line));
                                    if (finished) break readLoop;
                                }
                            }
                        } catch (streamError) {
                            await reader.cancel().catch(()=>{});
                            try {
                                reader.releaseLock();
                            } catch  {}
                            reader = undefined;
                            if (controller.signal.aborted) throw streamError;
                            const canRetry = output.content.length === 0 && attempt < maxRetries;
                            if (canRetry) {
                                output.content.length = 0;
                                textBlock = undefined;
                                currentTextIdx = -1;
                                thinkingIdx = -1;
                                output.stopReason = "stop";
                                output.errorMessage = undefined;
                                finished = false;
                                const waitMs = attemptTimedOut ? 0 : retryDelayMs(attempt, null, maxRetryDelayMs);
                                if (waitMs > 0) await delay(waitMs, controller.signal);
                                continue retryLoop;
                            }
                            if (attemptTimedOut) throw timeoutError(timeoutMs);
                            throw streamError;
                        }
                        endTextBlock();
                        endThinking();
                        stream.push({
                            type: "done",
                            reason: successStopReason(output.stopReason),
                            message: output
                        });
                        stream.end();
                        break retryLoop;
                    } finally{
                        controller.signal.removeEventListener("abort", onOuterAbort);
                        clearAttemptTimeout();
                    }
                }
            } catch (error) {
                const reason = controller.signal.aborted ? "aborted" : "error";
                output.stopReason = reason;
                output.errorMessage = reason === "aborted" ? "Request aborted" : error instanceof Error ? error.message : String(error);
                stream.push({
                    type: "error",
                    reason,
                    error: output
                });
                stream.end();
            } finally{
                options?.signal?.removeEventListener("abort", abortUpstream);
                try {
                    await reader?.cancel();
                } catch  {}
                try {
                    reader?.releaseLock();
                } catch  {}
            }
        }
        run().catch((error)=>{
            const msg = {
                role: "assistant",
                content: [],
                api: model.api,
                provider: model.provider,
                model: model.id,
                usage: defaultUsage(),
                stopReason: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
                timestamp: now()
            };
            stream.push({
                type: "error",
                reason: "error",
                error: msg
            });
            stream.end();
        });
        return stream;
    };
}
