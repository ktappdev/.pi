/**
 * Reapply the configured context cap after model-catalog refreshes.
 *
 * pi-context-cap applies its cap during session_start. Some model pickers call
 * ctx.modelRegistry.refresh(), which replaces model objects after that event;
 * the original cap is then lost. This companion keeps the cap attached to the
 * live registry and also repairs the model selected by a picker.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CapConfig = {
	cap: number;
	appliesOver: number;
	matchPatterns: string[];
	models: Record<string, number>;
};

type ModelLike = {
	id: string;
	provider?: string;
	contextWindow?: number;
};

type RegistryWithRefresh = {
	getAll(): ModelLike[];
	refresh?: (options?: unknown) => Promise<unknown>;
};

const DEFAULT_CONFIG: CapConfig = {
	cap: 200_000,
	appliesOver: 200_000,
	matchPatterns: ["anthropic", "claude"],
	models: {},
};

function getAgentDir(): string {
	const candidates = ["PI_CODING_AGENT_DIR", "TAU_CODING_AGENT_DIR"];
	let configured = candidates.map((name) => process.env[name]).find(Boolean);
	if (!configured) {
		configured = Object.entries(process.env).find(([name, value]) => name.endsWith("_CODING_AGENT_DIR") && value)?.[1];
	}
	if (!configured) return join(os.homedir(), ".pi", "agent");
	if (configured === "~") return os.homedir();
	if (configured.startsWith("~/")) return join(os.homedir(), configured.slice(2));
	return configured;
}

function finitePositive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function loadConfig(cwd: string): CapConfig {
	const paths = [
		join(getAgentDir(), "extensions", "context-cap.json"),
		join(cwd, ".pi", "extensions", "context-cap.json"),
	];
	let config: CapConfig = {
		...DEFAULT_CONFIG,
		matchPatterns: [...DEFAULT_CONFIG.matchPatterns],
		models: {},
	};

	for (const filePath of paths) {
		if (!existsSync(filePath)) continue;
		try {
			const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
			if (!raw || typeof raw !== "object") continue;
			const value = raw as Record<string, unknown>;
			if (finitePositive(value.cap)) config.cap = value.cap;
			if (finitePositive(value.appliesOver)) config.appliesOver = value.appliesOver;
			if (Array.isArray(value.matchPatterns)) {
				config.matchPatterns = value.matchPatterns.filter((pattern): pattern is string => typeof pattern === "string");
			}
			if (value.models && typeof value.models === "object") {
				for (const [modelId, cap] of Object.entries(value.models)) {
					if (finitePositive(cap)) config.models[modelId] = cap;
				}
			}
		} catch (error) {
			console.error(`[context-cap-reapply] could not parse ${filePath}: ${error}`);
		}
	}

	return config;
}

function matchesPatterns(modelId: string, patterns: string[]): boolean {
	const id = modelId.toLowerCase();
	return patterns.some((pattern) => pattern === "*" || id.includes(pattern.toLowerCase()));
}

function applyCap(model: ModelLike, config: CapConfig): void {
	const native = model.contextWindow;
	if (!finitePositive(native)) return;

	const perModelCap = config.models[model.id];
	const target = perModelCap !== undefined
		? perModelCap
		: native > config.appliesOver && matchesPatterns(model.id, config.matchPatterns)
			? config.cap
			: undefined;
	if (target !== undefined && native > target) model.contextWindow = target;
}

function applyCaps(registry: RegistryWithRefresh, config: CapConfig): void {
	for (const model of registry.getAll()) applyCap(model, config);
}

function wrapRefresh(registry: RegistryWithRefresh, getConfig: () => CapConfig): void {
	const originalRefresh = registry.refresh;
	if (!originalRefresh) {
		applyCaps(registry, getConfig());
		return;
	}

	registry.refresh = async (options?: unknown) => {
		try {
			return await originalRefresh.call(registry, options);
		} finally {
			applyCaps(registry, getConfig());
		}
	};
	applyCaps(registry, getConfig());
}

export default function contextCapReapplyExtension(pi: ExtensionAPI): void {
	let activeConfig: CapConfig | undefined;
	const wrappedRegistries = new WeakSet<object>();

	pi.on("session_start", async (_event, ctx) => {
		activeConfig = loadConfig(ctx.cwd);
		const registry = ctx.modelRegistry as unknown as RegistryWithRefresh;
		if (!wrappedRegistries.has(registry)) {
			wrappedRegistries.add(registry);
			wrapRefresh(registry, () => activeConfig ?? DEFAULT_CONFIG);
		} else {
			applyCaps(registry, activeConfig);
		}
		// Reload native windows: the package may already have lowered these objects.
		await ctx.modelRegistry.refresh({ allowNetwork: false });
		const selected = ctx.model && ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
		if (selected && ctx.model) ctx.model.contextWindow = selected.contextWindow;
	});

	pi.registerCommand("context-cap", {
		description: "Show or set the context cap live, e.g. /context-cap 300k",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				const config = activeConfig ?? loadConfig(ctx.cwd);
				ctx.ui.notify(`Configured cap: ${config.cap.toLocaleString()} tokens. Active model window: ${ctx.model?.contextWindow.toLocaleString() ?? "none"}. Usage: /context-cap 300k`, "info");
				return;
			}
			const match = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(input);
			const cap = match ? Number(match[1]) * (match[2].toLowerCase() === "m" ? 1_000_000 : match[2].toLowerCase() === "k" ? 1_000 : 1) : NaN;
			if (!Number.isSafeInteger(cap) || cap <= 0) {
				ctx.ui.notify("Use a positive whole token count, e.g. /context-cap 300k or /context-cap 300000.", "error");
				return;
			}
			await ctx.waitForIdle();
			// Honor the same project-over-global precedence as the original package.
			const projectPath = join(ctx.cwd, ".pi", "extensions", "context-cap.json");
			const filePath = existsSync(projectPath) ? projectPath : join(getAgentDir(), "extensions", "context-cap.json");
			try {
				const raw: unknown = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : {};
				if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Config must be a JSON object");
				mkdirSync(dirname(filePath), { recursive: true });
				writeFileSync(filePath, `${JSON.stringify({ ...raw, cap, appliesOver: cap }, null, 2)}\n`);
				activeConfig = loadConfig(ctx.cwd);
			} catch (error) {
				ctx.ui.notify(`Could not save context cap: ${error}`, "error");
				return;
			}
			try {
				// Refresh restores native limits before reapplying, supporting increases too.
				await ctx.modelRegistry.refresh({ allowNetwork: false });
				applyCaps(ctx.modelRegistry as unknown as RegistryWithRefresh, activeConfig);
				const selected = ctx.model && ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
				if (selected && ctx.model) ctx.model.contextWindow = selected.contextWindow;
				ctx.ui.notify(`Saved cap: ${cap.toLocaleString()} tokens (${filePath}). Active model window: ${ctx.model?.contextWindow.toLocaleString() ?? "none"}. Effective for the next request; no reload needed. Native limits and per-model overrides still apply.`, "info");
			} catch (error) {
				ctx.ui.notify(`Cap saved, but live update failed: ${error}. Reload or restart Pi to retry.`, "error");
			}
		},
	});

	pi.on("model_select", (event, ctx) => {
		if (!activeConfig) return;
		applyCaps(ctx.modelRegistry as unknown as RegistryWithRefresh, activeConfig);
		applyCap(event.model as unknown as ModelLike, activeConfig);
	});
}
