import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { displayName } from "./agent-team-config.ts";

export type AgentTeamViewMode = "grid" | "table" | "tactical" | "activity";

export interface ToolHistoryViewEntry {
	name: string;
	summary: string;
	durMs: number;
	isError: boolean;
}

export interface AgentTeamViewState {
	def: {
		name: string;
		description: string;
		thinking?: string;
	};
	status: "idle" | "running" | "done" | "error";
	task: string;
	toolCount: number;
	elapsed: number;
	lastWork: string[];
	contextPct: number;
	runCount: number;
	model?: string;
	thinking?: string;
	toolHistory: ToolHistoryViewEntry[];
	errorSummary: string | null;
	stuckToolMs: number;
}

type ThemeLike = {
	bold(text: string): string;
	fg(color: string, text: string): string;
};

function statusRank(status: AgentTeamViewState["status"]): number {
	return status === "running" ? 0 : status === "error" ? 1 : status === "done" ? 2 : 3;
}

function sortStates(statesRaw: AgentTeamViewState[]): AgentTeamViewState[] {
	return [...statesRaw].sort((a, b) => {
		const rank = statusRank(a.status) - statusRank(b.status);
		if (rank !== 0) return rank;
		return displayName(a.def.name).localeCompare(displayName(b.def.name));
	});
}

function getModelThinkLabel(state: AgentTeamViewState): string {
	const modelLabel = state.model || "default";
	const thinkingLevel = state.thinking || state.def.thinking || "off";
	return `${modelLabel} [${thinkingLevel}]`;
}

function getLastWorkLabel(state: AgentTeamViewState): string {
	return state.task ? (state.lastWork[state.lastWork.length - 1] || state.task) : state.def.description;
}

function getStatusDisplay(state: AgentTeamViewState): {
	color: string;
	icon: string;
	label: string;
} {
	const color = state.status === "idle"
		? "dim"
		: state.status === "running"
			? "accent"
			: state.status === "done"
				? "success"
				: "error";
	const icon = state.status === "idle"
		? "○"
		: state.status === "running"
			? "●"
			: state.status === "done"
				? "✓"
				: "✗";
	const label = state.status === "running" ? "run" : state.status;
	return { color, icon, label };
}

function renderCard(state: AgentTeamViewState, colWidth: number, theme: ThemeLike): string[] {
	const w = colWidth - 2;
	const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;
	const status = getStatusDisplay(state);
	const name = displayName(state.def.name);
	const modelLabel = getModelThinkLabel(state);
	const nameWithModel = `${name} (${modelLabel})`;
	const nameStr = theme.fg("accent", theme.bold(truncate(nameWithModel, w)));
	const nameVisible = Math.min(nameWithModel.length, w);

	const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
	const statusRaw = `${status.icon} ${state.status}${timeStr}`;
	const statusLine = theme.fg(status.color, statusRaw);
	const statusVisible = statusRaw.length;

	const filled = Math.ceil(state.contextPct / 20);
	const bar = "#".repeat(filled) + "-".repeat(5 - filled);
	const ctxRaw = `[${bar}] ${Math.ceil(state.contextPct)}%`;
	const ctxLine = theme.fg("dim", ctxRaw);
	const ctxVisible = ctxRaw.length;

	const taskText = state.task
		? truncate(state.task, Math.min(60, w - 1))
		: "";
	const taskLabel = theme.fg("dim", state.task ? taskText : state.status === "idle" ? "·" : "");
	const taskVisible = Math.max(1, taskText.length || 1);

	const workText = truncate(getLastWorkLabel(state), Math.min(50, w - 1));
	const workLine = theme.fg("muted", workText);
	const workVisible = workText.length;

	// Error or stuck indicator line
	let alertText = "";
	let alertVisible = 0;
	if (state.errorSummary) {
		alertText = theme.fg("error", `\u26a0 ${truncate(state.errorSummary, Math.min(48, w - 1))}`);
		alertVisible = Math.min(state.errorSummary.length + 2, w - 1);
	} else if (state.stuckToolMs > 30000) {
		alertText = theme.fg("warning", `\u23f1 stuck ${Math.round(state.stuckToolMs / 1000)}s`);
		alertVisible = 10;
	}

	const top = "┌" + "─".repeat(w) + "┐";
	const bottom = "└" + "─".repeat(w) + "┘";
	const border = (content: string, visible: number) =>
		theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visible)) + theme.fg("dim", "│");

	const cardLines = [
		theme.fg("dim", top),
		border(" " + nameStr, 1 + nameVisible),
		border(" " + statusLine, 1 + statusVisible),
		border(" " + taskLabel, 1 + taskVisible),
		border(" " + ctxLine, 1 + ctxVisible),
		border(" " + workLine, 1 + workVisible),
	];
	if (alertText) cardLines.push(border(" " + alertText, 1 + alertVisible));
	cardLines.push(theme.fg("dim", bottom));
	return cardLines;
}

export function renderGridView(
	statesRaw: AgentTeamViewState[],
	width: number,
	theme: ThemeLike,
	gridCols: number,
): string {
	const states = sortStates(statesRaw);
	const cols = Math.max(1, Math.min(gridCols, states.length));
	const gap = 1;
	const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
	const rows: string[][] = [];

	for (let i = 0; i < states.length; i += cols) {
		const rowStates = states.slice(i, i + cols);
		const cards = rowStates.map((state) => renderCard(state, colWidth, theme));

		const cardHeight = cards[0]?.length ?? 7;
		while (cards.length < cols) {
			cards.push(Array(cardHeight).fill(" ".repeat(colWidth)));
		}
		for (let line = 0; line < cardHeight; line++) {
			rows.push(cards.map((card) => card[line] || ""));
		}
	}

	return rows.map((row) => row.join(" ".repeat(gap))).join("\n");
}

export function renderTableView(
	statesRaw: AgentTeamViewState[],
	width: number,
	theme: ThemeLike,
): string {
	const gap = "  ";
	const gapLen = gap.length;
	const states = sortStates(statesRaw);

	let agentW = Math.min(18, Math.max(8, Math.floor(width * 0.144)));
	const statusW = 8;
	const timeW = 6;
	const ctxW = 5;
	let modelW = Math.min(36, Math.max(16, Math.floor(width * 0.30)));
	const minLastW = 12;
	const baseUsed = agentW + statusW + timeW + ctxW + modelW + gapLen * 5;
	let lastW = Math.max(1, width - baseUsed);
	if (lastW < minLastW) {
		const deficit = minLastW - lastW;
		modelW = Math.max(10, modelW - deficit);
		lastW = Math.max(1, width - (agentW + statusW + timeW + ctxW + modelW + gapLen * 5));
	}
	if (lastW < minLastW) {
		const deficit = minLastW - lastW;
		agentW = Math.max(8, agentW - deficit);
		lastW = Math.max(1, width - (agentW + statusW + timeW + ctxW + modelW + gapLen * 5));
	}

	const padRight = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
	const cell = (s: string, w: number) => padRight(truncateToWidth(s, w), w);

	const header = [
		cell(theme.bold("AGENT"), agentW),
		cell(theme.bold("ST"), statusW),
		cell(theme.bold("TIME"), timeW),
		cell(theme.bold("CTX"), ctxW),
		cell(theme.bold("MODEL/THINK"), modelW),
		cell(theme.bold("LAST"), lastW),
	].join(gap);

	const sep = theme.fg("dim", "-".repeat(Math.max(0, Math.min(width, 300))));

	const row = (state: AgentTeamViewState): string => {
		const status = getStatusDisplay(state);
		const statusText = theme.fg(status.color, `${status.icon} ${status.label}`);
		const timeText = state.status === "idle" ? "-" : `${Math.round(state.elapsed / 1000)}s`;
		const ctxText = state.contextPct > 0 ? `${Math.ceil(state.contextPct)}%` : "-";

		const lastBase = getLastWorkLabel(state);
		let lastText = lastBase;
		if (state.errorSummary) {
			lastText = `\u26a0 ${state.errorSummary.slice(0, lastW - 4)}`;
		} else if (state.stuckToolMs > 30000) {
			lastText = `\u23f1 stuck ${Math.round(state.stuckToolMs / 1000)}s`;
		}
		const lastColor = state.errorSummary ? "error" : state.stuckToolMs > 30000 ? "warning" : "muted";

		return [
			cell(theme.fg("accent", displayName(state.def.name)), agentW),
			cell(statusText, statusW),
			cell(theme.fg("dim", timeText), timeW),
			cell(theme.fg("dim", ctxText), ctxW),
			cell(theme.fg("dim", getModelThinkLabel(state)), modelW),
			cell(theme.fg(lastColor, lastText), lastW),
		].join(gap);
	};

	return [header, sep, ...states.map(row)].join("\n");
}

function pickTacticalFocus(statesRaw: AgentTeamViewState[]): AgentTeamViewState | null {
	const running = statesRaw
		.filter((state) => state.status === "running")
		.sort((a, b) => {
			if (a.runCount !== b.runCount) return b.runCount - a.runCount;
			return a.elapsed - b.elapsed;
		});
	return running[0] ?? null;
}

function buildTeamContextSummary(statesRaw: AgentTeamViewState[]): string {
	const used = [...statesRaw]
		.filter((state) => state.runCount > 0 || state.contextPct > 0)
		.sort((a, b) => {
			if (Math.ceil(b.contextPct) !== Math.ceil(a.contextPct)) {
				return Math.ceil(b.contextPct) - Math.ceil(a.contextPct);
			}
			return displayName(a.def.name).localeCompare(displayName(b.def.name));
		});

	if (used.length === 0) return "Team ctx: none yet";

	return `Team ctx: ${used
		.map((state) => `${displayName(state.def.name)} ${Math.ceil(state.contextPct)}%`)
		.join(" · ")}`;
}

function formatDur(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function renderTacticalView(
	statesRaw: AgentTeamViewState[],
	width: number,
	theme: ThemeLike,
): string {
	const focus = pickTacticalFocus(statesRaw);
	if (!focus) {
		return theme.fg("dim", "Tactical · idle");
	}

	const status = getStatusDisplay(focus);
	const focusName = displayName(focus.def.name);
	const modelLabel = getModelThinkLabel(focus);

	const header = [
		theme.fg("accent", `${status.icon} ${theme.bold(focusName)}`),
		theme.fg(status.color, `${focus.status}`),
		theme.fg("dim", `[${modelLabel}]`),
		theme.fg("dim", `${Math.round(focus.elapsed / 1000)}s · ctx ${Math.ceil(focus.contextPct)}%`),
	]
		.filter(Boolean)
		.join(" ");

	const hiddenRunning = statesRaw.filter((state) => state.status === "running" && state !== focus).length;

	const lines: string[] = [];
	lines.push(truncateToWidth(header, Math.max(8, width)));

	// Show tool history with durations if available, otherwise fall back to lastWork
	const toolLines = focus.toolHistory.length > 0
		? focus.toolHistory.slice(-5).map(t =>
			`${t.isError ? "\u26a0 " : ""}[${t.name}] ${t.summary} (${formatDur(t.durMs)})${t.isError ? " \u26a0" : ""}`
		)
		: (focus.lastWork.length > 0 ? focus.lastWork : [focus.task || focus.def.description]).slice(-5);
	const displayLines = toolLines;

	for (let i = 0; i < displayLines.length; i++) {
		const isLast = i === displayLines.length - 1;
		const prefix = theme.fg("dim", isLast ? "  └─ Doing: " : "  ├─ ");
		const body = theme.fg("muted", displayLines[i]);
		lines.push(truncateToWidth(prefix + body, Math.max(8, width)));
	}

	// Stuck indicator
	if (focus.stuckToolMs > 30000) {
		lines.push(truncateToWidth(
			theme.fg("warning", `  \u23f1 pending tool stuck for ${Math.round(focus.stuckToolMs / 1000)}s`),
			Math.max(8, width),
		));
	}

	// Error summary
	if (focus.errorSummary) {
		lines.push(truncateToWidth(
			theme.fg("error", `  \u26a0 ${focus.errorSummary.slice(0, 60)}`),
			Math.max(8, width),
		));
	}

	const contextLine = truncateToWidth(
		theme.fg("dim", `     ${buildTeamContextSummary(statesRaw)}`),
		Math.max(8, width),
	);
	lines.push(contextLine);

	if (hiddenRunning > 0) {
		lines.push(truncateToWidth(
			theme.fg("dim", `     ${hiddenRunning} other active agent${hiddenRunning === 1 ? "" : "s"} hidden`),
			Math.max(8, width),
		));
	}

	return lines.filter(Boolean).join("\n");
}

export function renderActivityView(
	statesRaw: AgentTeamViewState[],
	width: number,
	theme: ThemeLike,
): string {
	const states = sortStates(statesRaw);
	const running = states.filter(s => s.status === "running" || s.status === "error");
	if (running.length === 0) {
		return theme.fg("dim", "Activity · all idle");
	}

	const lines: string[] = [];
	const agentW = Math.min(14, Math.max(8, Math.floor(width * 0.16)));
	const timeW = 6;
	const toolsW = 7;
	const restW = Math.max(20, width - agentW - timeW - toolsW - 6);

	for (const state of running) {
		const status = getStatusDisplay(state);
		const name = displayName(state.def.name);
		const timeStr = `${Math.round(state.elapsed / 1000)}s`;

		// Build tool chain from history (last 3)
		let activity: string;
		if (state.toolHistory.length > 0) {
			const recent = state.toolHistory.slice(-3);
			activity = recent.map(t =>
				`${t.isError ? "\u26a0" : ""}[${t.name}] ${t.summary}${t.durMs > 0 ? ` (${formatDur(t.durMs)})` : ""}`
			).join(" → ");
		} else {
			activity = state.lastWork.length > 0
				? state.lastWork.slice(-3).join(" → ")
				: (state.task || state.def.description);
		}

		// Stuck detection: pending tool > 30s
		const stuckFlag = state.stuckToolMs > 30000 ? " \u23f1 stuck?" : "";

		// Error summary
		const errSuffix = state.errorSummary
			? ` \u26a0 ${state.errorSummary.slice(0, 40)}`
			: stuckFlag;

		const line = [
			theme.fg(status.color, `${status.icon} ${name}`),
			theme.fg("dim", timeStr),
			theme.fg("dim", `${state.toolCount}t`),
			truncateToWidth(theme.fg("muted", activity) + theme.fg("warning", errSuffix), restW),
		].join("  ");
		lines.push(truncateToWidth(line, Math.max(8, width)));
	}

	return lines.join("\n");
}
