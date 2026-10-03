/**
 * Reapply the configured context cap after model-catalog refreshes.
 *
 * pi-context-cap applies its cap during session_start. Some model pickers call
 * ctx.modelRegistry.refresh(), which replaces model objects after that event;
 * the original cap is then lost. This companion keeps the cap attached to the
 * live registry and also repairs the model selected by a picker.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type CapConfig = {
	cap: number;
	appliesOver: number;
	matchPatterns: string[];
	models: Record<string, number>;
};

type ModelLike = {
	id: string;
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

function wrapRefresh(registry: RegistryWithRefresh, config: CapConfig): void {
	const originalRefresh = registry.refresh;
	if (!originalRefresh) {
		applyCaps(registry, config);
		return;
	}

	registry.refresh = async (options?: unknown) => {
		try {
			return await originalRefresh.call(registry, options);
		} finally {
			applyCaps(registry, config);
		}
	};
	applyCaps(registry, config);
}

export default function contextCapReapplyExtension(pi: ExtensionAPI): void {
	let activeConfig: CapConfig | undefined;
	const wrappedRegistries = new WeakSet<object>();

	pi.on("session_start", (_event, ctx) => {
		activeConfig = loadConfig(ctx.cwd);
		const registry = ctx.modelRegistry as unknown as RegistryWithRefresh;
		if (!wrappedRegistries.has(registry)) {
			wrappedRegistries.add(registry);
			wrapRefresh(registry, activeConfig);
		} else {
			applyCaps(registry, activeConfig);
		}
	});

	pi.on("model_select", (event, ctx) => {
		if (!activeConfig) return;
		applyCaps(ctx.modelRegistry as unknown as RegistryWithRefresh, activeConfig);
		applyCap(event.model as unknown as ModelLike, activeConfig);
	});
}
