import.meta.url = "pi://@mariozechner/pi-ai";
export function StringEnum(values, opts = {}) {
  const list = Array.isArray(values) ? values.map((v) => String(v)) : [];
  return { type: "string", enum: list, ...opts };
}

export function calculateCost(model, usage) {
  const usageObj = usage && typeof usage === 'object' ? usage : {};
  const cost = usageObj.cost && typeof usageObj.cost === 'object' ? usageObj.cost : {};
  const modelCost = model && typeof model === 'object' ? (model.cost || {}) : {};

  const inputTokens = Number(usageObj.input ?? usageObj.inputTokens ?? usageObj.input_tokens ?? 0);
  const outputTokens = Number(usageObj.output ?? usageObj.outputTokens ?? usageObj.output_tokens ?? 0);
  const cacheReadTokens = Number(usageObj.cacheRead ?? usageObj.cache_read ?? 0);
  const cacheWriteTokens = Number(usageObj.cacheWrite ?? usageObj.cache_write ?? 0);

  const inputRate = Number(modelCost.input ?? 0);
  const outputRate = Number(modelCost.output ?? 0);
  const cacheReadRate = Number(modelCost.cacheRead ?? modelCost.cache_read ?? 0);
  const cacheWriteRate = Number(modelCost.cacheWrite ?? modelCost.cache_write ?? 0);

  cost.input = (inputRate / 1000000) * inputTokens;
  cost.output = (outputRate / 1000000) * outputTokens;
  cost.cacheRead = (cacheReadRate / 1000000) * cacheReadTokens;
  cost.cacheWrite = (cacheWriteRate / 1000000) * cacheWriteTokens;
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;

  usageObj.cost = cost;
  if (!Number.isFinite(Number(usageObj.totalTokens))) {
    usageObj.totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  }

  return cost;
}

function getEnvValue(name) {
  if (globalThis.pi && globalThis.pi.env && typeof globalThis.pi.env.get === "function") {
    const value = globalThis.pi.env.get(name);
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}

export function getEnvApiKey(provider) {
  const p = String(provider ?? "").trim();
  if (!p) return undefined;

  if (p === "github-copilot") {
    return (
      getEnvValue("COPILOT_GITHUB_TOKEN") ||
      getEnvValue("GH_TOKEN") ||
      getEnvValue("GITHUB_TOKEN")
    );
  }

  if (p === "anthropic") {
    return getEnvValue("ANTHROPIC_OAUTH_TOKEN") || getEnvValue("ANTHROPIC_API_KEY");
  }

  if (p === "google-vertex") {
    const hasCredentials = !!getEnvValue("GOOGLE_APPLICATION_CREDENTIALS");
    const hasProject = !!(getEnvValue("GOOGLE_CLOUD_PROJECT") || getEnvValue("GCLOUD_PROJECT"));
    const hasLocation = !!getEnvValue("GOOGLE_CLOUD_LOCATION");
    if (hasCredentials && (hasProject || hasLocation)) {
      return "<authenticated>";
    }
    if (hasProject && hasLocation) {
      return "<authenticated>";
    }
  }

  if (p === "amazon-bedrock") {
    if (
      getEnvValue("AWS_PROFILE") ||
      (getEnvValue("AWS_ACCESS_KEY_ID") && getEnvValue("AWS_SECRET_ACCESS_KEY")) ||
      getEnvValue("AWS_BEARER_TOKEN_BEDROCK") ||
      getEnvValue("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") ||
      getEnvValue("AWS_CONTAINER_CREDENTIALS_FULL_URI") ||
      getEnvValue("AWS_WEB_IDENTITY_TOKEN_FILE")
    ) {
      return "<authenticated>";
    }
  }

  const envMap = {
    openai: "OPENAI_API_KEY",
    "azure-openai-responses": "AZURE_OPENAI_API_KEY",
    google: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    xai: "XAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    zai: "ZAI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    huggingface: "HF_TOKEN",
    opencode: "OPENCODE_API_KEY",
    "kimi-coding": "KIMI_API_KEY",
  };

  const envVar = envMap[p];
  return envVar ? getEnvValue(envVar) : undefined;
}

function failClosedUnsupported(name) {
  throw new Error(`@mariozechner/pi-ai.${name} is not available in PiJS without a provider/session host bridge; refusing to return placeholder data`);
}

function failClosedBridge(name, cause) {
  const suffix = cause ? `: ${cause}` : "";
  throw new Error(`@mariozechner/pi-ai.${name} is not available in PiJS without a provider/session host bridge; refusing to return placeholder data${suffix}`);
}

const __piBuiltinModelRegistry = {
  "openai-codex": [
    {
      id: "gpt-5.5",
      name: "GPT-5.5 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.4",
      name: "GPT-5.4 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.2-codex",
      name: "GPT-5.2 Codex",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
  ],
};

const __piKnownApiIds = new Set([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
]);

function cloneModel(model) {
  return {
    ...model,
    input: Array.isArray(model.input) ? model.input.slice() : [],
    cost: model.cost && typeof model.cost === "object" ? { ...model.cost } : {},
    headers: model.headers && typeof model.headers === "object" ? { ...model.headers } : undefined,
  };
}

function modelsForProvider(provider) {
  const providerId = String(provider ?? "").trim();
  if (!providerId) return [];
  const models = __piBuiltinModelRegistry[providerId] || [];
  return models.map(cloneModel);
}

async function callProviderBridge(name, op, payload = {}) {
  if (!globalThis.pi || typeof globalThis.pi.events !== "function") {
    failClosedBridge(name);
  }
  try {
    return await globalThis.pi.events(op, payload);
  } catch (error) {
    const message = String((error && error.message) || error || "");
    failClosedBridge(name, message);
  }
}

function completionText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  if (typeof result.text === "string") return result.text;
  const content = Array.isArray(result.content)
    ? result.content
    : result.message && Array.isArray(result.message.content)
      ? result.message.content
      : [];
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block.text === "string") return block.text;
      if (block && block.type === "text" && typeof block.content === "string") return block.content;
      return "";
    })
    .join("");
}

function completeSimpleArgs(model, prompt, opts) {
  if (prompt === undefined || (prompt && typeof prompt === "object" && !Array.isArray(prompt))) {
    return {
      model: undefined,
      prompt: model,
      opts: prompt && typeof prompt === "object" && !Array.isArray(prompt) ? prompt : {},
    };
  }
  return { model, prompt, opts: opts || {} };
}

export function getOAuthApiKey(_provider) {
  failClosedUnsupported("getOAuthApiKey");
}

export function createAssistantMessageEventStream() {
  let done = false;
  const queue = [];
  const waiters = [];
  let resolveFinalResult;
  const finalResult = new Promise((resolve) => {
    resolveFinalResult = resolve;
  });

  return {
    push: (event) => {
      if (done) return;
      if (event && (event.type === "done" || event.type === "error")) {
        done = true;
        resolveFinalResult(event.type === "done" ? event.message : event.error);
      }
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },
    end: (result) => {
      if (done && result === undefined) return;
      done = true;
      if (result !== undefined) {
        resolveFinalResult(result);
      }
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter({ value: undefined, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
        } else if (done) {
          return;
        } else {
          const result = await new Promise((resolve) => waiters.push(resolve));
          if (result.done) return;
          yield result.value;
        }
      }
    },
    result: () => finalResult,
  };
}

function assistantMessageFor(model, text, result) {
  const modelObj = model && typeof model === "object" ? model : {};
  const resultObj = result && typeof result === "object" ? result : {};
  const usageObj = resultObj.usage && typeof resultObj.usage === "object" ? resultObj.usage : {};
  const usageCost = usageObj.cost && typeof usageObj.cost === "object" ? usageObj.cost : {};
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: modelObj.api || "",
    provider: modelObj.provider || "",
    model: modelObj.id || modelObj.modelId || (typeof model === "string" ? model : ""),
    usage: {
      input: Number(usageObj.input ?? 0),
      output: Number(usageObj.output ?? 0),
      cacheRead: Number(usageObj.cacheRead ?? usageObj.cache_read ?? 0),
      cacheWrite: Number(usageObj.cacheWrite ?? usageObj.cache_write ?? 0),
      totalTokens: Number(usageObj.totalTokens ?? usageObj.total_tokens ?? 0),
      cost: {
        input: Number(usageCost.input ?? 0),
        output: Number(usageCost.output ?? 0),
        cacheRead: Number(usageCost.cacheRead ?? usageCost.cache_read ?? 0),
        cacheWrite: Number(usageCost.cacheWrite ?? usageCost.cache_write ?? 0),
        total: Number(usageCost.total ?? 0),
      },
    },
    stopReason: resultObj.stopReason || resultObj.stop_reason || "stop",
    timestamp: Number(resultObj.timestamp ?? Date.now()),
  };
}

function providerBridgeStream(name, model, context, opts = {}, simple = true) {
  const stream = createAssistantMessageEventStream();
  (async () => {
    try {
      const result = await callProviderBridge(name, "completeAi", {
        model,
        context,
        options: opts || {},
        simple,
      });
      const text = completionText(result);
      if (text) {
        stream.push({ type: "text_delta", delta: text });
      }
      const message =
        result && typeof result === "object" && result.message && typeof result.message === "object"
          ? result.message
          : assistantMessageFor(model, text, result);
      stream.push({ type: "done", message });
    } catch (error) {
      const message = assistantMessageFor(model, "", {});
      message.stopReason = "error";
      message.errorMessage = String((error && error.message) || error || "");
      stream.push({ type: "error", reason: "error", error: message });
    }
  })();
  return stream;
}

function apiProviderBridge(api) {
  const apiId = String(api ?? "").trim();
  if (!apiId || !__piKnownApiIds.has(apiId)) return undefined;
  return {
    api: apiId,
    stream: (model, context, opts = {}) =>
      providerBridgeStream(`getApiProvider(${apiId}).stream`, model, context, opts, false),
    streamSimple: (model, context, opts = {}) =>
      providerBridgeStream(`getApiProvider(${apiId}).streamSimple`, model, context, opts, true),
  };
}

async function* streamSimple(name, model, context, opts = {}) {
  const result = await callProviderBridge(name, "completeAi", {
    model,
    context,
    options: opts || {},
    simple: true,
  });
  const text = completionText(result);
  if (text) yield text;
}

export function streamSimpleAnthropic(model, context, opts = {}) {
  return streamSimple("streamSimpleAnthropic", model, context, opts);
}

export function streamSimpleOpenAIResponses(model, context, opts = {}) {
  return streamSimple("streamSimpleOpenAIResponses", model, context, opts);
}

export function streamSimpleOpenAICompletions(model, context, opts = {}) {
  return streamSimple("streamSimpleOpenAICompletions", model, context, opts);
}

export async function complete(model, messages, opts = {}) {
  return await callProviderBridge("complete", "completeAi", {
    model,
    context: messages,
    options: opts || {},
    simple: false,
  });
}

export async function completeSimple(model, prompt, opts = {}) {
  const args = completeSimpleArgs(model, prompt, opts);
  return await callProviderBridge("completeSimple", "completeAi", {
    model: args.model,
    context: args.prompt,
    options: args.opts || {},
    simple: true,
  });
}

export function getProviders() {
  return Object.keys(__piBuiltinModelRegistry);
}

export function getModel(provider, modelId) {
  if (arguments.length >= 2) {
    const modelKey = String(modelId ?? "").trim().toLowerCase();
    return modelsForProvider(provider).find((model) => model.id.toLowerCase() === modelKey);
  }
  return (async () => {
    await callProviderBridge("getModel", "getModels", {});
    return await callProviderBridge("getModel", "getModel", {});
  })();
}

export function getApiProvider(api) {
  if (arguments.length >= 1) {
    return apiProviderBridge(api);
  }
  return (async () => {
    await callProviderBridge("getApiProvider", "getModels", {});
    const model = await callProviderBridge("getApiProvider", "getModel", {});
    return model && typeof model === "object" ? model.provider : undefined;
  })();
}

export function getModels(provider) {
  if (arguments.length >= 1) {
    return modelsForProvider(provider);
  }
  return callProviderBridge("getModels", "getModels", {});
}

export async function loginOpenAICodex(_opts = {}) {
  failClosedUnsupported("loginOpenAICodex");
}

export async function refreshOpenAICodexToken(_refreshToken) {
  failClosedUnsupported("refreshOpenAICodexToken");
}

export default { StringEnum, calculateCost, getEnvApiKey, getOAuthApiKey, createAssistantMessageEventStream, streamSimpleAnthropic, streamSimpleOpenAIResponses, streamSimpleOpenAICompletions, complete, completeSimple, getProviders, getModel, getApiProvider, getModels, loginOpenAICodex, refreshOpenAICodexToken };