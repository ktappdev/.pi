/**
 * Custom compaction — use the model configured in compact-flash.json.
 * Faster + cheaper than using the conversation model. Falls back to default
 * compaction if flash model is unavailable or fails.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai/compat";
import { convertToLlm, getAgentDir, serializeConversation } from "@earendil-works/pi-coding-agent";

const DEFAULT_CONFIG = {
	provider: "commandcode",
	model: "deepseek/deepseek-v4.1-flash-fast",
	maxTokens: 4096,
};

function loadConfig(): typeof DEFAULT_CONFIG {
	const path = join(getAgentDir(), "extensions", "compact-flash.json");
	mkdirSync(dirname(path), { recursive: true });
	try {
		writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx" });
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Config must be a JSON object");
	const config = { ...DEFAULT_CONFIG, ...raw };
	if (typeof config.provider !== "string" || !config.provider.trim() ||
		typeof config.model !== "string" || !config.model.trim() ||
		typeof config.maxTokens !== "number" || !Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0) {
		throw new Error("Config requires provider/model strings and a positive whole maxTokens");
	}
	return config;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("compact-model", {
		description: "Show or set the compaction model: /compact-model <provider> <model-id>",
		handler: async (args, ctx) => {
			try {
				const config = loadConfig();
				const input = args.trim();
				if (!input) {
					ctx.ui.notify(`Compaction model: ${config.provider} / ${config.model}. Summary limit: ${config.maxTokens} tokens. Usage: /compact-model <provider> <model-id>`, "info");
					return;
				}
				const parts = input.split(/\s+/);
				if (parts.length !== 2) {
					ctx.ui.notify("Usage: /compact-model commandcode deepseek/deepseek-v4.1-flash-fast", "error");
					return;
				}
				const [provider, model] = parts;
				if (!ctx.modelRegistry.find(provider, model)) {
					ctx.ui.notify(`Model not found: ${provider} / ${model}. Configuration unchanged.`, "error");
					return;
				}
				const path = join(getAgentDir(), "extensions", "compact-flash.json");
				writeFileSync(path, `${JSON.stringify({ ...config, provider, model }, null, 2)}\n`);
				ctx.ui.notify(`Compaction model saved: ${provider} / ${model}. Applies to the next compaction; no reload needed. Provider credentials are still required.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not read or save compact-flash config: ${error}`, "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		try {
			loadConfig();
		} catch (error) {
			ctx.ui.notify(`compact-flash config: ${error}. Using default compaction until fixed.`, "warning");
		}
	});
	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, signal } = event;

		let config: typeof DEFAULT_CONFIG;
		try {
			config = loadConfig();
		} catch (error) {
			ctx.ui.notify(`compact-flash config: ${error}. Using default compaction.`, "warning");
			return;
		}
		const model = ctx.modelRegistry.find(config.provider, config.model);
		if (!model) return; // fall back to default

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return;

		const allMessages = [
			...preparation.messagesToSummarize,
			...preparation.turnPrefixMessages,
		];
		const text = serializeConversation(convertToLlm(allMessages));
		const prev = preparation.previousSummary
			? `\n\nPrevious summary:\n${preparation.previousSummary}`
			: "";

		const msg = {
			role: "user" as const,
			content: [{
				type: "text" as const,
				text: `Summarize this coding session. Include: goals, decisions, files changed, current state, next steps.${prev}\n\n<conversation>\n${text}\n</conversation>`,
			}],
			timestamp: Date.now(),
		};

		try {
			const response = await complete(model, { messages: [msg] }, {
				apiKey: auth.apiKey,
				headers: auth.headers,
				maxTokens: config.maxTokens,
				signal,
			});

			const summary = response.content
				.filter(
					(c): c is { type: "text"; text: string } => c.type === "text",
				)
				.map((c) => c.text)
				.join("\n");

			if (!summary.trim()) return;

			return {
				compaction: {
					summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
				},
			};
		} catch {
			return; // fall back to default on error
		}
	});
}
