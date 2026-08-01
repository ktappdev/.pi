import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/kilo-pi-provider/kilo.ts";
const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;
const KILO_DEVICE_AUTH_ENDPOINT = `${KILO_API_BASE}/api/device-auth/codes`;
const POLL_INTERVAL_MS = 3000;
const MODELS_FETCH_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000;
const KILO_TOS_URL = "https://kilo.ai/terms";
const KILO_PROFILE_ENDPOINT = `${KILO_API_BASE}/api/profile`;
async function fetchKiloBalance(token) {
    try {
        const response = await fetch(`${KILO_PROFILE_ENDPOINT}/balance`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
        if (!response.ok) {
            return null;
        }
        const data = (await response.json());
        return data.balance ?? null;
    } catch  {
        return null;
    }
}
function formatCredits(balance) {
    if (balance >= 1000) {
        return `$${(balance / 1000).toFixed(1)}k`;
    } else {
        return `$${balance.toFixed(2)}`;
    }
}
function abortableSleep(ms, signal) {
    return new Promise((resolve, reject)=>{
        if (signal?.aborted) {
            reject(new Error("Login cancelled"));
            return;
        }
        const timeout = setTimeout(resolve, ms);
        signal?.addEventListener("abort", ()=>{
            clearTimeout(timeout);
            reject(new Error("Login cancelled"));
        }, {
            once: true
        });
    });
}
async function initiateDeviceAuth() {
    const response = await fetch(KILO_DEVICE_AUTH_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    });
    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Too many pending authorization requests. Please try again later.");
        }
        throw new Error(`Failed to initiate device authorization: ${response.status}`);
    }
    return (await response.json());
}
async function pollDeviceAuth(code) {
    const response = await fetch(`${KILO_DEVICE_AUTH_ENDPOINT}/${code}`);
    if (response.status === 202) return {
        status: "pending"
    };
    if (response.status === 403) return {
        status: "denied"
    };
    if (response.status === 410) return {
        status: "expired"
    };
    if (!response.ok) {
        throw new Error(`Failed to poll device authorization: ${response.status}`);
    }
    return (await response.json());
}
async function loginKilo(callbacks) {
    callbacks.onProgress?.("Initiating device authorization...");
    const authData = await initiateDeviceAuth();
    const { code, verificationUrl, expiresIn } = authData;
    callbacks.onAuth({
        url: verificationUrl,
        instructions: `Enter code: ${code}`
    });
    callbacks.onProgress?.("Waiting for browser authorization...");
    const deadline = Date.now() + expiresIn * 1000;
    while(Date.now() < deadline){
        if (callbacks.signal?.aborted) {
            throw new Error("Login cancelled");
        }
        await abortableSleep(POLL_INTERVAL_MS, callbacks.signal);
        const result = await pollDeviceAuth(code);
        if (result.status === "approved") {
            if (!result.token) {
                throw new Error("Authorization approved but no token received");
            }
            callbacks.onProgress?.("Login successful!");
            return {
                refresh: result.token,
                access: result.token,
                expires: Date.now() + TOKEN_EXPIRATION_MS
            };
        }
        if (result.status === "denied") {
            throw new Error("Authorization denied by user.");
        }
        if (result.status === "expired") {
            throw new Error("Authorization code expired. Please try again.");
        }
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        callbacks.onProgress?.(`Waiting for browser authorization... (${remaining}s remaining)`);
    }
    throw new Error("Authentication timed out. Please try again.");
}
async function refreshKiloToken(credentials) {
    if (credentials.expires > Date.now()) {
        return credentials;
    }
    throw new Error("Kilo token expired. Please run /login kilo to re-authenticate.");
}
function parsePrice(price) {
    if (!price) return 0;
    const parsed = parseFloat(price);
    if (isNaN(parsed)) return 0;
    return parsed * 1_000_000;
}
function isFreeModel(m) {
    const prompt = parseFloat(m.pricing?.prompt ?? "1");
    const completion = parseFloat(m.pricing?.completion ?? "1");
    if (prompt !== 0 || completion !== 0) return false;
    if (m.id.includes(":free")) return true;
    if (!m.id.includes("/")) return true;
    if (m.id.startsWith("kilo/") || m.id.startsWith("openrouter/")) return true;
    return false;
}
function mapOpenRouterModel(m) {
    const inputModalities = m.architecture?.input_modalities ?? [
        "text"
    ];
    const supportsImages = inputModalities.includes("image");
    const supportsReasoning = m.supported_parameters?.includes("reasoning") ?? false;
    const maxTokens = m.top_provider?.max_completion_tokens ?? m.max_completion_tokens ?? Math.ceil(m.context_length * 0.2);
    return {
        id: m.id,
        name: m.name,
        reasoning: supportsReasoning,
        input: supportsImages ? [
            "text",
            "image"
        ] : [
            "text"
        ],
        cost: {
            input: parsePrice(m.pricing?.prompt),
            output: parsePrice(m.pricing?.completion),
            cacheRead: parsePrice(m.pricing?.input_cache_read),
            cacheWrite: parsePrice(m.pricing?.input_cache_write)
        },
        contextWindow: m.context_length,
        maxTokens: maxTokens,
        compat: KILO_COMPAT
    };
}
async function fetchKiloModels(options) {
    const headers = {
        "Content-Type": "application/json",
        "User-Agent": "pi-kilo-provider"
    };
    if (options?.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    const response = await fetch(`${KILO_GATEWAY_BASE}/models`, {
        headers,
        signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json());
    if (!json.data || !Array.isArray(json.data)) {
        throw new Error("Invalid models response: missing data array");
    }
    return json.data.filter((m)=>{
        const outputMods = m.architecture?.output_modalities ?? [];
        if (outputMods.includes("image")) return false;
        if (options?.freeOnly && !isFreeModel(m)) return false;
        return true;
    }).map(mapOpenRouterModel);
}
const KILO_PROVIDER_CONFIG = {
    baseUrl: KILO_GATEWAY_BASE,
    apiKey: "KILO_API_KEY",
    api: "openai-completions",
    headers: {
        "X-KILOCODE-EDITORNAME": "Pi",
        "User-Agent": "pi-kilo-provider"
    }
};
const KILO_COMPAT = {
    supportsDeveloperRole: false,
    supportsReasoningEffort: true
};
export default async function(pi) {
    let freeModels = [];
    try {
        freeModels = await fetchKiloModels({
            freeOnly: true
        });
    } catch (error) {
        console.warn("[kilo] Failed to fetch free models at startup:", error instanceof Error ? error.message : error);
    }
    let cachedAllModels = [];
    function makeOAuthConfig() {
        return {
            name: "Kilo",
            login: async (callbacks)=>{
                const cred = await loginKilo(callbacks);
                try {
                    cachedAllModels = await fetchKiloModels({
                        token: cred.access
                    });
                } catch (error) {
                    console.warn("[kilo] Failed to fetch models after login:", error instanceof Error ? error.message : error);
                }
                return cred;
            },
            refreshToken: refreshKiloToken,
            getApiKey: (cred)=>cred.access,
            modifyModels: (models, _cred)=>{
                if (cachedAllModels.length === 0) return models;
                const template = models.find((m)=>m.provider === "kilo");
                if (!template) return models;
                const nonKilo = models.filter((m)=>m.provider !== "kilo");
                const fullModels = cachedAllModels.map((m)=>({
                        ...template,
                        id: m.id,
                        name: m.name,
                        reasoning: m.reasoning,
                        input: m.input,
                        cost: m.cost,
                        contextWindow: m.contextWindow,
                        maxTokens: m.maxTokens
                    }));
                return [
                    ...nonKilo,
                    ...fullModels
                ];
            }
        };
    }
    pi.registerProvider("kilo", {
        ...KILO_PROVIDER_CONFIG,
        models: freeModels,
        oauth: makeOAuthConfig()
    });
    pi.on("session_start", async (_event, ctx)=>{
        const cred = ctx.modelRegistry.authStorage.get("kilo");
        if (cred?.type !== "oauth") {
            ctx.ui.setStatus("kilo-credits", undefined);
            return;
        }
        try {
            cachedAllModels = await fetchKiloModels({
                token: cred.access
            });
        } catch (error) {
            console.warn("[kilo] Failed to fetch models at session start:", error instanceof Error ? error.message : error);
            return;
        }
        if (cachedAllModels.length > 0) {
            ctx.modelRegistry.registerProvider("kilo", {
                ...KILO_PROVIDER_CONFIG,
                models: freeModels,
                oauth: makeOAuthConfig()
            });
        }
        try {
            const balance = await fetchKiloBalance(cred.access);
            if (balance !== null) {
                const theme = ctx.ui.theme;
                ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
            }
        } catch (error) {
            console.warn("[kilo] Failed to fetch balance:", error instanceof Error ? error.message : error);
        }
    });
    pi.on("model_select", async (event, ctx)=>{
        if (event.model?.provider !== "kilo") return;
        const cred = ctx.modelRegistry.authStorage.get("kilo");
        if (cred?.type !== "oauth") return;
        try {
            const balance = await fetchKiloBalance(cred.access);
            if (balance !== null) {
                const theme = ctx.ui.theme;
                ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
            }
        } catch (error) {
            console.warn("[kilo] Failed to fetch balance on model select:", error instanceof Error ? error.message : error);
        }
    });
    pi.on("turn_end", async (_event, ctx)=>{
        const cred = ctx.modelRegistry.authStorage.get("kilo");
        if (cred?.type !== "oauth") return;
        try {
            const balance = await fetchKiloBalance(cred.access);
            if (balance !== null) {
                const theme = ctx.ui.theme;
                ctx.ui.setStatus("kilo-credits", theme.fg("accent", `💰 ${formatCredits(balance)}`));
            }
        } catch (error) {
            console.warn("[kilo] Failed to fetch balance on turn end:", error instanceof Error ? error.message : error);
        }
    });
    let tosShown = false;
    pi.on("before_agent_start", async (_event, ctx)=>{
        if (tosShown) return;
        if (ctx.model?.provider !== "kilo") return;
        const cred = ctx.modelRegistry.authStorage.get("kilo");
        if (cred?.type === "oauth") {
            tosShown = true;
            return;
        }
        tosShown = true;
        return {
            message: {
                customType: "kilo",
                content: `By using Kilo, you agree to the Terms of Service: ${KILO_TOS_URL}`,
                display: "inline"
            }
        };
    });
}
