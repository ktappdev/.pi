/**
 * Custom Footer Extension - demonstrates ctx.ui.setFooter()
 *
 * footerData exposes data not otherwise accessible:
 * - getGitBranch(): current git branch
 * - getExtensionStatuses(): texts from ctx.ui.setStatus()
 *
 * Token stats come from ctx.sessionManager/ctx.model (already accessible).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getProjectPiDir(cwd: string): string {
	return cwd.endsWith("/.pi") || cwd.endsWith("/.pi/")
		? cwd
		: join(cwd, ".pi");
}

function readJsonObject(path: string): Record<string, any> {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return {};
	}
}

function getThinkingLevelFromSettings(cwd: string): string {
	const globalSettings = readJsonObject(join(homedir(), ".pi", "agent", "settings.json"));
	const projectSettings = readJsonObject(join(getProjectPiDir(cwd), "settings.json"));
	const lvl = projectSettings.defaultThinkingLevel ?? globalSettings.defaultThinkingLevel;
	return typeof lvl === "string" && lvl.trim().length > 0 ? lvl.trim() : "off";
}

export default function (pi: ExtensionAPI) {
	let footerTui: any | null = null;
	let assistantMsgStartMs: number | null = null;
	let assistantFirstDeltaMs: number | null = null;
	let assistantStreaming = false;
	let assistantStreamingChars = 0;
	let liveApproxTokensPerSec: number | null = null;
	let lastOutputTokensPerSec: number | null = null;

	// Track assistant throughput (tokens/sec). Usage is only final at message_end.
	pi.on("message_start", async (event: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			assistantMsgStartMs = typeof event.message.timestamp === "number" ? event.message.timestamp : Date.now();
			assistantFirstDeltaMs = null;
			assistantStreaming = false;
			assistantStreamingChars = 0;
			liveApproxTokensPerSec = null;
		} catch {}
	});

	pi.on("message_update", async (event: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			const delta = event?.assistantMessageEvent;
			if (delta?.type !== "text_delta") return;
			const now = Date.now();
			if (assistantFirstDeltaMs == null) assistantFirstDeltaMs = now;
			assistantStreaming = true;
			assistantStreamingChars += String(delta.delta ?? "").length;
			const startMs = assistantFirstDeltaMs ?? now;
			const seconds = Math.max(0.05, (now - startMs) / 1000);
			liveApproxTokensPerSec = (assistantStreamingChars / 4) / seconds;
			footerTui?.requestRender?.();
		} catch {}
	});

	pi.on("message_end", async (event: any) => {
		try {
			if (event?.message?.role !== "assistant") return;

			assistantStreaming = false;
			assistantStreamingChars = 0;
			liveApproxTokensPerSec = null;

			const outputTokens = Number(event?.message?.usage?.output ?? 0);
			if (!Number.isFinite(outputTokens) || outputTokens <= 0) return;
			// Use wall-clock timings we captured from streaming deltas.
			const endMs = Date.now();
			const startMs = assistantFirstDeltaMs ?? assistantMsgStartMs ?? endMs;
			const seconds = Math.max(0.05, (endMs - startMs) / 1000);
			lastOutputTokensPerSec = outputTokens / seconds;
			footerTui?.requestRender?.();
		} catch {}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			footerTui = tui;
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					unsub();
					if (footerTui === tui) footerTui = null;
				},
				invalidate() {},
				render(width: number): string[] {
					// LINE 1: Context usage progress bar and model info
					const contextUsage = ctx.getContextUsage();
					let contextPct = Number(contextUsage?.percentage);
					if (!Number.isFinite(contextPct)) {
						const used = Number(contextUsage?.used ?? contextUsage?.input ?? contextUsage?.tokens);
						const limit = Number(contextUsage?.limit ?? contextUsage?.max ?? contextUsage?.contextWindow);
						contextPct = Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? (used / limit) * 100 : 0;
					}
					contextPct = Math.max(0, Math.min(100, contextPct));
					const modelName = ctx.model?.id || "no-model";
					const thinking = (ctx as any)?.thinkingLevel || (ctx.model as any)?.thinkingLevel || (ctx.model as any)?.thinking || getThinkingLevelFromSettings(ctx.cwd);
					const modelLabel = `${modelName} [${thinking}]`;
					
					// Build progress bar: [####------] 40%
					const barWidth = 20;
					const filled = Math.max(0, Math.min(barWidth, Math.round((contextPct / 100) * barWidth)));
					const empty = barWidth - filled;
					const bar = "[" + "#".repeat(filled) + "-".repeat(empty) + "]";
					
					const modelLeft = theme.fg("dim", modelLabel);
					const contextRight = theme.fg("dim", bar + ` ${Math.round(contextPct)}%`);
					const pad1 = " ".repeat(Math.max(1, width - visibleWidth(modelLeft) - visibleWidth(contextRight)));
					const line1 = truncateToWidth(modelLeft + pad1 + contextRight, width);

					// LINE 2: Output throughput (avg tok/s for last assistant message)
					let tpsText = "↓-- tok/s";
					const displayTps =
						assistantStreaming && liveApproxTokensPerSec != null && Number.isFinite(liveApproxTokensPerSec)
							? { prefix: "~", value: liveApproxTokensPerSec }
							: lastOutputTokensPerSec != null && Number.isFinite(lastOutputTokensPerSec)
								? { prefix: "", value: lastOutputTokensPerSec }
								: null;
					if (displayTps) {
						const n = displayTps.value;
						const formatted = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
						tpsText = `↓${displayTps.prefix}${formatted} tok/s`;
					}
					const tpsRight = theme.fg("dim", ` ${tpsText} `);
					const padTps = " ".repeat(Math.max(0, width - visibleWidth(tpsRight)));
					const lineTps = truncateToWidth(padTps + tpsRight, width);

					// LINE 3: Current working directory and git branch
					const cwd = ctx.cwd;
					const branch = footerData.getGitBranch();
					
					const pathIcon = theme.fg("dim", "📁 ");
					const pathText = theme.fg("text", cwd);
					let line2 = pathIcon + pathText;
					
					if (branch) {
						const separator = theme.fg("dim", " │ ");
						const branchIcon = theme.fg("accent", "⎇ ");
						const branchText = theme.fg("success", branch);
						line2 += separator + branchIcon + branchText;
					}

					const rawStatuses = footerData.getExtensionStatuses?.();
					let statuses: string[] = [];
					if (Array.isArray(rawStatuses)) {
						statuses = rawStatuses.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
					} else if (rawStatuses && typeof rawStatuses === "object") {
						statuses = Object.values(rawStatuses)
							.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
					}

					if (statuses.length > 0) {
						line2 += theme.fg("dim", " │ ") + theme.fg("muted", statuses.join(" · "));
					}
					
					line2 = truncateToWidth(line2, width, "");

					return [line1, lineTps, line2];
				},
			};
		});
	});
}
