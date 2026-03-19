/**
 * Agent Team — Dispatcher-only orchestrator with team dashboards
 *
 * The primary Pi agent has NO codebase tools. It can ONLY delegate work
 * to specialist agents via the `dispatch_agent` tool. Each specialist
 * maintains its own Pi session for cross-invocation memory.
 *
 * Loads agent definitions from agents/*.md and .pi/agents/*.md.
 * Teams are defined in .pi/agents/teams.yaml (local) or ~/.pi/agent/agents/teams.yaml (global fallback) — on boot a select dialog lets
 * you pick which team to work with. Only team members are available for dispatch.
 *
 * Commands:
 *   /agents-team          — switch active team
 *   /agents-list          — list loaded agents
 *   /agents-models        — configure models for agents
 *   /agents-reset         — reset agent context (clear session memory)
 *   /agents-grid N        — set column count (default 2)
 *   /agents-view <mode>   — switch grid/table/tactical view
 *
 * Usage: pi -e extensions/agent-team.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, type AutocompleteItem, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn, execSync } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync, appendFileSync, readdir } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { applyExtensionDefaults } from "./themeMap.ts";
import {
	createFooterMetricsState,
	formatFooterMetrics,
	recordFooterDelta,
	resetFooterMetrics,
	completeFooterMetrics,
} from "./lib/agent-team-footer-metrics.ts";
import {
	type AgentDef,
	getProjectBaseDir,
	getProjectAgentsDir,
	getProjectPiDir,
	mergeSystemPrompt,
	ensureDir,
	ensureGitignoreEntry,
	getAgentTeamViewMode,
	persistAgentTeamViewMode,
	getSessionThinkingLevelFallback,
	getGlobalTeamsPath,
	getProjectTeamsPath,
	getGlobalAgentModelsPath,
	getProjectAgentModelsPath,
	getGlobalAgentThinkingPath,
	getProjectAgentThinkingPath,
	writeYamlMap,
	displayName,
	readTeamsFile,
	readAgentYamlMap,
	scanAgentDirs,
	getTeamsSources,
	mergeStringMaps,
	mergeTeams,
} from "./lib/agent-team-config.ts";
import {
	renderGridView,
	renderTableView,
	renderTacticalView,
	type AgentTeamViewMode,
} from "./lib/agent-team-views.ts";

// ── Helper: Find Pi Executable ───────────────────

let cachedPiPath: string | null = null;

function findPiExecutable(): string {
	if (cachedPiPath) return cachedPiPath;

	// 1. Check environment variable override
	const envPath = process.env.PI_PATH;
	if (envPath && existsSync(envPath)) {
		cachedPiPath = envPath;
		return cachedPiPath;
	}

	// 2. Try 'which pi' command
	try {
		const whichOutput = execSync("which pi", { encoding: "utf-8" }).trim();
		if (whichOutput && existsSync(whichOutput)) {
			cachedPiPath = whichOutput;
			return cachedPiPath;
		}
	} catch {
		// which command failed or pi not in PATH
	}

	// 3. Check common installation paths
	const home = homedir();
	const commonPaths: string[] = [
		// macOS Homebrew
		"/opt/homebrew/bin/pi",
		"/usr/local/bin/pi",
		// Linux mise
		join(home, ".local", "share", "mise", "installs", "node", "25.2.1", "bin", "pi"),
		// nvm (common versions)
		join(home, ".nvm", "versions", "node", "v20.11.0", "bin", "pi"),
		join(home, ".nvm", "versions", "node", "v18.19.0", "bin", "pi"),
		// Global npm
		"/usr/bin/pi",
	];

	for (const path of commonPaths) {
		if (existsSync(path)) {
			cachedPiPath = path;
			return cachedPiPath;
		}
	}

	// 4. Try to find mise-installed pi dynamically
	try {
		const miseInstallsDir = join(home, ".local", "share", "mise", "installs");
		if (existsSync(miseInstallsDir)) {
			const nodeVersions = readdirSync(miseInstallsDir);
			for (const version of nodeVersions) {
				const piPath = join(miseInstallsDir, version, "bin", "pi");
				if (existsSync(piPath)) {
					cachedPiPath = piPath;
					return cachedPiPath;
				}
			}
		}
	} catch {
		// mise directory not accessible
	}

	// 5. Last resort: try nvm directories dynamically
	try {
		const nvmDir = join(home, ".nvm", "versions", "node");
		if (existsSync(nvmDir)) {
			const versions = readdirSync(nvmDir);
			for (const version of versions) {
				const piPath = join(nvmDir, version, "bin", "pi");
				if (existsSync(piPath)) {
					cachedPiPath = piPath;
					return cachedPiPath;
				}
			}
		}
	} catch {
		// nvm directory not accessible
	}

	// If nothing found, return the Homebrew path as default (will fail with clear error)
	cachedPiPath = "/opt/homebrew/bin/pi";
	return cachedPiPath;
}

// ── Types ────────────────────────────────────────

interface AgentState {
	def: AgentDef;
	status: "idle" | "running" | "done" | "error";
	task: string;
	toolCount: number;
	elapsed: number;
	lastWork: string;
	contextPct: number;
	sessionFile: string | null;
	runCount: number;
	model?: string;
	thinking?: string;
	timer?: ReturnType<typeof setInterval>;
}

interface DispatchResult {
	output: string;
	exitCode: number;
	elapsed: number;
}

const MAX_AGENT_LOG_LINES = 500;
const BUILDER_ONLY_EXTENSIONS = ["multi-edit.ts", "fresh-read.ts"];
const EXTENSIONS_DIR = fileURLToPath(new URL(".", import.meta.url));

function hasEditCapabilities(tools: string): boolean {
	return tools
		.split(",")
		.map((tool) => tool.trim())
		.some((tool) => tool === "edit" || tool === "write");
}

function getSubagentExtensionArgs(agentName: string, tools: string): string[] {
	if (!hasEditCapabilities(tools)) {
		return ["--no-extensions"];
	}

	const extensionNames = agentName.toLowerCase() === "builder" ? BUILDER_ONLY_EXTENSIONS : [];
	const args: string[] = [];
	for (const extensionName of extensionNames) {
		const extensionPath = join(EXTENSIONS_DIR, extensionName);
		if (existsSync(extensionPath)) {
			args.push("-e", extensionPath);
		}
	}

	return args.length > 0 ? args : ["--no-extensions"];
}

// ── Fetch Available Models ───────────────────────

async function fetchAvailableModels(): Promise<string[]> {
	return new Promise((resolve) => {
		const proc = spawn(findPiExecutable(), ["--list-models"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			stdout += chunk;
		});

		proc.on("close", () => {
			const models: string[] = [];
			const lines = stdout.split("\n");
			
			for (const line of lines) {
				// Skip header and empty lines
				if (!line.trim() || line.includes("PROVIDER") || line.includes("---")) continue;
				
				// Parse table format: provider    model-id    context    output    thinking    vision
				const parts = line.trim().split(/\s{2,}/);
				if (parts.length >= 2) {
					const provider = parts[0].trim();
					const modelId = parts[1].trim();
					// Always return a full `provider/model` identifier.
					// Some model ids themselves contain `/` (e.g. OpenRouter uses `ai21/jamba...`),
					// so we must not treat that as already provider-qualified.
					if (provider && modelId) {
						const full = modelId.startsWith(`${provider}/`) ? modelId : `${provider}/${modelId}`;
						models.push(full);
					}
				}
			}
			
			resolve(Array.from(new Set(models)));
		});

		proc.on("error", () => {
			// Fallback to empty list on error
			resolve([]);
		});
	});
}

// ── Extension ────────────────────────────────────


export default function (pi: ExtensionAPI) {
	const agentStates: Map<string, AgentState> = new Map();
	const agentLogs: Map<string, string[]> = new Map();
	const runningProcs: Map<string, ReturnType<typeof spawn>> = new Map();
	let footerTui: any | null = null;
	let allAgentDefs: AgentDef[] = [];
	let globalTeams: Record<string, string[]> = {};
	let projectTeams: Record<string, string[]> = {};
	let teams: Record<string, string[]> = {};
	let globalAgentModels: Record<string, string> = {};
	let projectAgentModels: Record<string, string> = {};
	let agentModels: Record<string, string> = {};
	let globalAgentThinking: Record<string, string> = {};
	let projectAgentThinking: Record<string, string> = {};
	let agentThinking: Record<string, string> = {};
	let activeTeamName = "";
	let gridCols = 2;
	let viewMode: AgentTeamViewMode = "grid";
	let watchAgentKey: string | null = null;
	let widgetCtx: any;
	let sessionDir = "";
	let contextWindow = 0;
	let footerMetrics = createFooterMetricsState();
	let backgroundSubagents = {
		reset: (_ctx?: any) => {},
		toolNames: [] as string[],
		promptGuidance: "",
	};
	const backgroundSubagentsLoader = import("./lib/agent-team-background-subagents.ts")
		.then(({ registerBackgroundSubagentTools }) => {
			backgroundSubagents = registerBackgroundSubagentTools(pi, {
				getPiExecutable: findPiExecutable,
				getModelOverride: () => agentModels["subagents"],
			});
		})
		.catch(() => {
			backgroundSubagents = {
				reset: (_ctx?: any) => {},
				toolNames: [],
				promptGuidance: "",
			};
		});

	const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

	// Ensure sub-agents are terminated when Pi exits
	pi.on("before_exit", async (_event, _ctx) => {
		backgroundSubagents.reset();
		for (const [key, proc] of runningProcs.entries()) {
			try {
				proc.kill("SIGKILL");
			} catch {}
			runningProcs.delete(key);
		}
	});

	// Handle Ctrl+C (SIGINT) - stop running agent but keep Pi session alive
	process.on("SIGINT", () => {
		// Find any running agent
		for (const [key, proc] of runningProcs.entries()) {
			const state = agentStates.get(key);
			if (state && state.status === "running") {
				// Kill the agent process gracefully
				try {
					proc.kill("SIGINT");
				} catch {}
				runningProcs.delete(key);

				// Clear the agent's timer
				if (state.timer) {
					clearInterval(state.timer);
					state.timer = undefined;
				}

				// Update agent status to idle (not error - intentional stop)
				state.elapsed = Date.now() - (Date.now() - state.elapsed);
				state.status = "idle";

				// Keep session file intact for context preservation
				// Don't delete state.sessionFile

				// Update widget display
				updateWidget();

				// Notify user
				if (widgetCtx) {
					widgetCtx.ui.notify(`Stopped ${displayName(state.def.name)} (context preserved)`, "info");
				}

				// Prevent default exit - stay in Pi session
				return;
			}
		}

		// No agent running - let default SIGINT behavior occur
		// This allows normal Pi exit when nothing is running
	});

	pi.on("message_start", async (event: any, _ctx: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			const startMs = typeof event.message.timestamp === "number" ? event.message.timestamp : Date.now();
			footerMetrics = resetFooterMetrics(startMs);
		} catch {}
	});

	pi.on("message_update", async (event: any, _ctx: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			const delta = event?.assistantMessageEvent;
			footerMetrics = recordFooterDelta(footerMetrics, delta, Date.now());
			footerTui?.requestRender?.();
		} catch {}
	});

	pi.on("message_end", async (event: any, _ctx: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			footerMetrics = completeFooterMetrics(footerMetrics, event.message.usage, Date.now());
			footerTui?.requestRender?.();
		} catch {}
	});

	function appendAgentLog(agentKey: string, line: string) {
		const cleaned = line.replace(/\r/g, "");
		if (!cleaned.trim()) return;
		const lines = agentLogs.get(agentKey) ?? [];
		lines.push(cleaned);
		if (lines.length > MAX_AGENT_LOG_LINES) {
			lines.splice(0, lines.length - MAX_AGENT_LOG_LINES);
		}
		agentLogs.set(agentKey, lines);
	}

	function resolveAgentByInput(inputRaw: string): AgentState | null {
		const input = inputRaw.trim().toLowerCase();
		if (!input) return null;

		for (const state of agentStates.values()) {
			const rawName = state.def.name.toLowerCase();
			const display = displayName(state.def.name).toLowerCase();
			const slug = rawName.replace(/\s+/g, "-");
			if (input === rawName || input === display || input === slug) {
				return state;
			}
		}

		for (const state of agentStates.values()) {
			const rawName = state.def.name.toLowerCase();
			const display = displayName(state.def.name).toLowerCase();
			const slug = rawName.replace(/\s+/g, "-");
			if (rawName.includes(input) || display.includes(input) || slug.includes(input)) {
				return state;
			}
		}

		return null;
	}

	function loadAgents(cwd: string) {
		const projectRoot = getProjectBaseDir(cwd);
		sessionDir = join(getProjectPiDir(cwd), "agent-sessions");
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		ensureGitignoreEntry(projectRoot, ".pi/agent-sessions/");

		// Load all agent definitions
		allAgentDefs = scanAgentDirs(cwd);

		const globalTeamsPath = getGlobalTeamsPath();
		const projectTeamsPath = getProjectTeamsPath(cwd);
		globalTeams = existsSync(globalTeamsPath)
			? readTeamsFile(globalTeamsPath)
			: {};
		projectTeams = existsSync(projectTeamsPath)
			? readTeamsFile(projectTeamsPath)
			: {};
		teams = mergeTeams(globalTeams, projectTeams);

		// If no teams defined, create a default "all" team
		if (Object.keys(teams).length === 0) {
			teams = { all: allAgentDefs.map(d => d.name) };
		}

		const globalModelsPath = getGlobalAgentModelsPath();
		const projectModelsPath = getProjectAgentModelsPath(cwd);
		globalAgentModels = existsSync(globalModelsPath)
			? readAgentYamlMap(globalModelsPath)
			: {};
		projectAgentModels = existsSync(projectModelsPath)
			? readAgentYamlMap(projectModelsPath)
			: {};
		agentModels = mergeStringMaps(globalAgentModels, projectAgentModels);

		const globalThinkingPath = getGlobalAgentThinkingPath();
		const projectThinkingPath = getProjectAgentThinkingPath(cwd);
		globalAgentThinking = existsSync(globalThinkingPath)
			? readAgentYamlMap(globalThinkingPath)
			: {};
		projectAgentThinking = existsSync(projectThinkingPath)
			? readAgentYamlMap(projectThinkingPath)
			: {};
		agentThinking = mergeStringMaps(globalAgentThinking, projectAgentThinking);
	}

	function activateTeam(teamName: string) {
		activeTeamName = teamName;
		const members = teams[teamName] || [];
		const defsByName = new Map(allAgentDefs.map(d => [d.name.toLowerCase(), d]));

		agentStates.clear();
		for (const member of members) {
			if (member.toLowerCase() === "kyrie") continue;
			const def = defsByName.get(member.toLowerCase());
			if (!def) continue;
			const key = def.name.toLowerCase().replace(/\s+/g, "-");
			const sessionFile = join(sessionDir, `${key}.json`);
			const assignedModel = agentModels[def.name.toLowerCase()];
			const assignedThinking = agentThinking[def.name.toLowerCase()];
			if (!agentLogs.has(def.name.toLowerCase())) {
				agentLogs.set(def.name.toLowerCase(), []);
			}
			agentStates.set(def.name.toLowerCase(), {
				def,
				status: "idle",
				task: "",
				toolCount: 0,
				elapsed: 0,
				lastWork: "",
				contextPct: 0,
				sessionFile: existsSync(sessionFile) ? sessionFile : null,
				runCount: 0,
				model: assignedModel,
				thinking: assignedThinking,
			});
		}

		// Auto-size grid columns based on team size
		const size = agentStates.size;
		gridCols = size <= 3 ? size : size === 4 ? 2 : 3;

		if (watchAgentKey && !agentStates.has(watchAgentKey)) {
			watchAgentKey = null;
		}
	}

	function updateWidget() {
		if (!widgetCtx) return;

		widgetCtx.ui.setWidget("agent-team", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					if (agentStates.size === 0) {
						text.setText(theme.fg("dim", "No agents found. Add .md files to agents/"));
						return text.render(width);
					}

					if (watchAgentKey) {
						const watchState = agentStates.get(watchAgentKey);
						if (!watchState) {
							watchAgentKey = null;
						} else {
							const title = theme.fg("accent", theme.bold(`Watching ${displayName(watchState.def.name)}`));
							const statusColor = watchState.status === "running"
								? "accent"
								: watchState.status === "done"
									? "success"
									: watchState.status === "error"
										? "error"
										: "dim";
							const meta = theme.fg("dim", "  status: ") +
								theme.fg(statusColor, watchState.status) +
								theme.fg("dim", ` · ${Math.round(watchState.elapsed / 1000)}s · tools ${watchState.toolCount}`);
							const hint = theme.fg("muted", "/agents-watch-off to return to team view");

							const lines = agentLogs.get(watchState.def.name.toLowerCase()) ?? [];
							const bodyHeight = Math.max(4, 50);
							const tail = lines.slice(-bodyHeight);
							const body = tail.length > 0
								? tail.map(line => theme.fg("muted", line))
								: [theme.fg("dim", "No output yet. Dispatch a task to this agent.")];

							text.setText([title, meta, hint, "", ...body].join("\n"));
							return text.render(width);
						}
					}

					const agents = Array.from(agentStates.values());
					if (viewMode === "table") {
						text.setText(renderTableView(agents, width, theme));
						return text.render(width);
					}
					if (viewMode === "tactical") {
						text.setText(renderTacticalView(agents, width, theme));
						return text.render(width);
					}

					text.setText(renderGridView(agents, width, theme, gridCols));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	// ── Dispatch Agent (returns Promise) ─────────



	function dispatchAgent(
		agentName: string,
		task: string,
		ctx: any,
	): Promise<DispatchResult> {
		// Strip Pi's "@" tag prefix from local file references so the model sees clean paths
		const sanitizedTask = task.replace(/@(?=(\/|\.\/|~\/))/g, "");
		const key = agentName.toLowerCase();
		const state = agentStates.get(key);
		if (!state) {
			return Promise.resolve({
				output: `Agent "${agentName}" not found. Available: ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		if (state.status === "running") {
			return Promise.resolve({
				output: `Agent "${displayName(state.def.name)}" is already running. Wait for it to finish.`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		state.status = "running";
		state.task = sanitizedTask;
		state.toolCount = 0;
		state.elapsed = 0;
		state.lastWork = "";
		state.runCount++;
		appendAgentLog(key, `[run] ${new Date().toLocaleTimeString()} — ${task}`);
		updateWidget();

		const startTime = Date.now();
		let isRunning = true;
		state.timer = setInterval(() => {
			if (isRunning) {
				state.elapsed = Date.now() - startTime;
				updateWidget();
			}
		}, 1000);

		// Use agent-specific model if assigned, otherwise use session default
		// Priority: 1. agent-models.yaml (what you set via /agents-models), 2. agent frontmatter, 3. session default
		const ctxModel = ctx.model as any;
		const model = state.model || state.def.model || (ctxModel?.provider && ctxModel?.id
			? `${ctxModel.provider}/${ctxModel.id}`
			: "openrouter/google/gemini-3-flash-preview");

		// Session file for this agent
		const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
		const agentSessionFile = join(sessionDir, `${agentKey}.json`);

		// Build args
		const args = [
			"--mode", "json",
			"-p",
			...getSubagentExtensionArgs(state.def.name, state.def.tools),
			"--model", model,
			"--thinking", state.thinking || state.def.thinking || "off",
			"--tools", state.def.tools,
				"--append-system-prompt", mergeSystemPrompt(state.def.systemPrompt),
			"--session", agentSessionFile,
		];

		if (state.sessionFile && existsSync(state.sessionFile)) {
			args.push("-c");
		}

		// Add the task
		args.push(sanitizedTask);

		// Use shell: false like the subagent example
		const textChunks: string[] = [];

		return new Promise((resolve) => {
			const proc = spawn(findPiExecutable(), args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
				shell: false,
			});

			runningProcs.set(key, proc);

			let buffer = "";
			let liveTextBuffer = "";

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") {
								const deltaText = delta.delta || "";
								textChunks.push(deltaText);
								liveTextBuffer += deltaText;
								const completed = liveTextBuffer.split("\n");
								liveTextBuffer = completed.pop() || "";
								for (const completedLine of completed) {
									appendAgentLog(key, completedLine);
								}
								const lastComplete = completed.slice().reverse().find((l: string) => l.trim());
								if (lastComplete && lastComplete.trim()) {
									state.lastWork = lastComplete;
								} else if (liveTextBuffer.trim()) {
									state.lastWork = liveTextBuffer.trim();
								}
								updateWidget();
							}
						} else if (event.type === "tool_execution_start") {
							state.toolCount++;
							const toolName = event.toolCall?.name || event.toolName || "tool";
							appendAgentLog(key, `[tool] ${toolName}`);
							updateWidget();
						} else if (event.type === "message_end") {
							const msg = event.message;
							if (msg?.usage && contextWindow > 0) {
								state.contextPct = ((msg.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						} else if (event.type === "agent_end") {
							const msgs = event.messages || [];
							const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
							if (last?.usage && contextWindow > 0) {
								state.contextPct = ((last.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", () => { });

			proc.on("close", (code) => {
				runningProcs.delete(key);
				try {
					const event = JSON.parse(buffer);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta") {
							const deltaText = delta.delta || "";
							textChunks.push(deltaText);
							liveTextBuffer += deltaText;
						}
					}
				} catch {}

				if (liveTextBuffer.trim()) {
					appendAgentLog(key, liveTextBuffer.trim());
				}

			clearInterval(state.timer);
			isRunning = false;
			state.elapsed = Date.now() - startTime;
				const isSuccess = code === 0;
				state.status = isSuccess ? "done" : "error";

				// Mark session file as available for resume
				if (isSuccess) {
					state.sessionFile = agentSessionFile;
				}

				const full = textChunks.join("");
				const fullLines = full.split("\n").map(l => l.trim()).filter(Boolean);
				
				// Build detailed output with error info if failed
				let output = full;
				if (!isSuccess) {
					const errorLines = fullLines.slice(-10).join("\n");
					output = `[Agent failed with exit code ${code}]\n\nLast output:\n${errorLines}\n\nModel: ${model}\nThinking: ${state.thinking || state.def.thinking || "off"}`;
				}
				
				appendAgentLog(key, `[${isSuccess ? "done" : "error"}] exit=${code ?? 1} in ${Math.round(state.elapsed / 1000)}s`);
				const lastWorkLine = fullLines[fullLines.length - 1] || (isSuccess ? "" : "Agent failed");
				state.lastWork = lastWorkLine;
				if (fullLines.length > 0) {
					appendAgentLog(key, `[summary] ${fullLines[fullLines.length - 1]}`);
				}
				updateWidget();

				ctx.ui.notify(
					`${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error"
				);

				resolve({
					output: output,
					exitCode: code ?? 1,
					elapsed: state.elapsed,
				});
			});

			proc.on("error", (err) => {
				runningProcs.delete(key);
				clearInterval(state.timer);
				isRunning = false;
				state.status = "error";
				const errorDetails = `Error spawning agent "${state.def.name}": ${err.message}\n\nThis may indicate:\n- The model is invalid or unavailable\n- The model doesn't support the requested thinking level\n- System resources are low\n\nAgent config:\n- Model: ${model}\n- Thinking: ${state.thinking || state.def.thinking || "off"}\n- Tools: ${state.def.tools}`;
				state.lastWork = errorDetails;
				appendAgentLog(key, `[error] ${err.message}`);
				appendAgentLog(key, `[hint] Check model availability with: pi --list-models`);
				updateWidget();
				resolve({
					output: errorDetails,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	// ── dispatch_agent Tool (registered at top level) ──

	pi.registerTool({
		name: "dispatch_agent",
		label: "Dispatch Agent",
		description: "Dispatch a task to a specialist agent. The agent will execute the task and return the result. Use the system prompt to see available agent names.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name (case-insensitive)" }),
			task: Type.String({ description: "Task description for the agent to execute" }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			try {
				const { agent, task } = params as { agent: string; task: string };

				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Dispatching to ${agent}...` }],
						details: { agent, task, status: "dispatching" },
					});
				}

				const result = await dispatchAgent(agent, task, ctx);

				const truncated = result.output.length > 8000
					? result.output.slice(0, 8000) + "\n\n... [truncated]"
					: result.output;

				const status = result.exitCode === 0 ? "done" : "error";
				const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

				return {
					content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
					details: {
						agent,
						task,
						status,
						elapsed: result.elapsed,
						exitCode: result.exitCode,
						fullOutput: result.output,
					},
				};
			} catch (err: any) {
				const { agent, task } = params as { agent: string; task: string };
				return {
					content: [{ type: "text", text: `Error dispatching to ${agent}: ${err?.message || err}` }],
					details: { agent, task, status: "error", elapsed: 0, exitCode: 1, fullOutput: "" },
				};
			}
		},

		renderCall(args, theme) {
			const agentName = (args as any).agent || "?";
			const task = (args as any).task || "";
			return new Text(
				theme.fg("toolTitle", theme.bold("dispatch_agent ")) +
				theme.fg("accent", agentName) +
				theme.fg("dim", " — ") +
				theme.fg("muted", task),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (options.isPartial || details.status === "dispatching") {
				return new Text(
					theme.fg("accent", `● ${details.agent || "?"}`) +
					theme.fg("dim", " working..."),
					0, 0,
				);
			}

			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const elapsed = typeof details.elapsed === "number" ? Math.round(details.elapsed / 1000) : 0;
			const header = theme.fg(color, `${icon} ${details.agent}`) +
				theme.fg("dim", ` ${elapsed}s`);

			if (options.expanded && details.fullOutput) {
				const output = details.fullOutput.length > 4000
					? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
					: details.fullOutput;
				return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
			}

			return new Text(header, 0, 0);
		},
	});

	pi.registerCommand("agents-watch", {
		description: "Watch one agent's live output: /agents-watch [agent]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = Array.from(agentStates.values()).map(s => ({
				value: s.def.name,
				label: `${displayName(s.def.name)} (${s.status})`,
			}));
			const p = prefix.trim().toLowerCase();
			if (!p) return items;
			const filtered = items.filter(i => i.value.toLowerCase().includes(p) || i.label.toLowerCase().includes(p));
			return filtered.length > 0 ? filtered : items;
		},
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			if (agentStates.size === 0) {
				ctx.ui.notify("No agents loaded. Load a team first.", "warning");
				return;
			}

			let target: AgentState | null = null;
			const fromArgs = args?.trim();
			if (fromArgs) {
				target = resolveAgentByInput(fromArgs);
				if (!target) {
					ctx.ui.notify(`Agent not found: ${fromArgs}`, "error");
					return;
				}
			} else {
				const states = Array.from(agentStates.values());
				const options = states.map(s => {
					const model = s.model || "default";
					return `${displayName(s.def.name)} (${s.status}, ${model})`;
				});
				const choice = await ctx.ui.select("Watch which agent?", options);
				if (choice === undefined) return;
				const selectedIndex = options.indexOf(choice);
				target = states[selectedIndex] || null;
			}

			if (!target) {
				ctx.ui.notify("Could not resolve selected agent", "error");
				return;
			}

			watchAgentKey = target.def.name.toLowerCase();
			updateWidget();
			ctx.ui.notify(`Watching ${displayName(target.def.name)}. Use /agents-watch-off to return to team view.`, "info");
		},
	});

	pi.registerCommand("agents-watch-off", {
		description: "Return widget to team view",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			watchAgentKey = null;
			updateWidget();
			ctx.ui.notify("Returned to team view.", "info");
		},
	});

	// ── Commands ─────────────────────────────────

	pi.registerCommand("agents-team", {
		description: "Select a team to work with",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			const teamNames = Object.keys(teams);
			if (teamNames.length === 0) {
				ctx.ui.notify("No teams defined in project or global agent config.", "warning");
				return;
			}

			const options = teamNames.map(name => {
				const available = new Set(allAgentDefs.map(d => d.name.toLowerCase()));
				const members = teams[name]
					.filter(m => m.toLowerCase() !== "kyrie")
					.filter(m => available.has(m.toLowerCase()))
					.map(m => displayName(m));
				return `${name} — ${members.join(", ")}`;
			});

			const choice = await ctx.ui.select("Select Team", options);
			if (choice === undefined) return;

			const idx = options.indexOf(choice);
			const name = teamNames[idx];
			activateTeam(name);
			updateWidget();
			ctx.ui.setStatus("agent-team", `Team: ${name} (${agentStates.size}) [${viewMode}]`);
			ctx.ui.notify(`Team: ${name} — ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`, "info");
		},
	});

	pi.registerCommand("agents-list", {
		description: "List all loaded agents",
		handler: async (_args, _ctx) => {
			widgetCtx = _ctx;
			const names = Array.from(agentStates.values())
				.map(s => {
					const session = s.sessionFile ? "resumed" : "new";
					return `${displayName(s.def.name)} (${s.status}, ${session}, runs: ${s.runCount}): ${s.def.description}`;
				})
				.join("\n");
			_ctx.ui.notify(names || "No agents loaded", "info");
		},
	});

	pi.registerCommand("agents-tools", {
		description: "Show the tool list for each loaded agent",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (agentStates.size === 0) {
				ctx.ui.notify("No agents loaded. Load a team first.", "warning");
				return;
			}
			const lines = Array.from(agentStates.values()).map(state => `${displayName(state.def.name)}: ${state.def.tools}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("agents-view", {
		description: "Switch team widget view: /agents-view <grid|table|tactical>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{ value: "grid", label: "Grid view (cards)" },
				{ value: "table", label: "Table view (dense)" },
				{ value: "tactical", label: "Tactical view (active focus)" },
			];
			const p = prefix.trim().toLowerCase();
			if (!p) return items;
			const filtered = items.filter(i => i.value.toLowerCase().startsWith(p) || i.label.toLowerCase().includes(p));
			return filtered.length > 0 ? filtered : items;
		},
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const raw = (args || "").trim().toLowerCase();
			if (raw !== "grid" && raw !== "table" && raw !== "tactical") {
				ctx.ui.notify("Usage: /agents-view <grid|table|tactical>", "error");
				return;
			}
			viewMode = raw;
			persistAgentTeamViewMode(ctx.cwd, viewMode);
			ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size}) [${viewMode}]`);
			ctx.ui.notify(`View set to ${viewMode}`, "info");
			updateWidget();
		},
	});

	pi.registerCommand("agents-grid", {
		description: "Set grid columns: /agents-grid <1-6>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = ["1", "2", "3", "4", "5", "6"].map(n => ({
				value: n,
				label: `${n} columns`,
			}));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : items;
		},
		handler: async (args, _ctx) => {
			widgetCtx = _ctx;
			const n = parseInt(args?.trim() || "", 10);
			if (n >= 1 && n <= 6) {
				gridCols = n;
				_ctx.ui.notify(`Grid set to ${gridCols} columns`, "info");
				updateWidget();
			} else {
				_ctx.ui.notify("Usage: /agents-grid <1-6>", "error");
			}
		},
	});

	pi.registerCommand("agents-reset", {
		description: "Reset agent (kills running task, clears context, fresh start)",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (agentStates.size === 0) {
				ctx.ui.notify("No agents loaded. Load a team first.", "warning");
				return;
			}

			const agents = Array.from(agentStates.values());
			
			// Ask which agents to reset
			const modeChoice = await ctx.ui.select(
				"Reset agent context",
				[
					"Reset all agents",
					"Select specific agent",
				]
			);

			if (modeChoice === undefined) {
				return;
			}

			let agentsToReset = agents;
			if (modeChoice === "Select specific agent") {
				const agentNames = agents.map(s => {
					const sessionStatus = s.sessionFile ? "has context" : "fresh";
					return `${displayName(s.def.name)} (${sessionStatus}, ${s.runCount} runs)`;
				});
				
				const agentChoice = await ctx.ui.select(
					"Select agent to reset",
					agentNames
				);

				if (agentChoice === undefined) {
					return;
				}

				const selectedIndex = agentNames.indexOf(agentChoice);
				agentsToReset = [agents[selectedIndex]];
			}

			// Reset selected agents
			let resetCount = 0;
			for (const state of agentsToReset) {
				const key = state.def.name.toLowerCase();

				// Kill running process if agent is running
				if (state.status === "running") {
					const proc = runningProcs.get(key);
					if (proc) {
						try {
							proc.kill("SIGKILL");
						} catch {}
						runningProcs.delete(key);
					}
					// Clear the timer
					if (state.timer) {
						clearInterval(state.timer);
						state.timer = undefined;
					}
				}

				// Delete session file
				if (state.sessionFile && existsSync(state.sessionFile)) {
					unlinkSync(state.sessionFile);
				}

				// Full reset of agent state
				state.sessionFile = null;
				state.runCount = 0;
				state.status = "idle";
				state.task = "";
				state.toolCount = 0;
				state.elapsed = 0;
				state.lastWork = "";
				state.contextPct = 0;
				agentLogs.set(key, []);
				resetCount++;
			}

			updateWidget();
			
			const agentList = agentsToReset.map(s => displayName(s.def.name)).join(", ");
			ctx.ui.notify(
				`Reset ${resetCount} agent(s): ${agentList}\nKilled running tasks, cleared timers, fresh context.`,
				"info"
			);
		},
	});

	pi.registerCommand("agents-models", {
		description: "Configure models for agents",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (agentStates.size === 0) {
				ctx.ui.notify("No agents loaded. Load a team first.", "warning");
				return;
			}

			const modelsPath = getProjectAgentModelsPath(ctx.cwd);
			const thinkingPath = getProjectAgentThinkingPath(ctx.cwd);

			// Ask user if they want to configure all or select specific agent
			const agents = Array.from(agentStates.values());
			const configTargets = [
				...agents.map((state) => ({
					kind: "agent" as const,
					key: state.def.name.toLowerCase(),
					label: displayName(state.def.name),
					state,
				})),
				{
					kind: "subagents" as const,
					key: "subagents",
					label: "Subagents",
					state: null,
				},
			];
			const modeChoice = await ctx.ui.select(
				"Configure models for agents",
				[
					"Configure all agents",
					"Select specific agent",
				]
			);

			if (modeChoice === undefined) {
				return; // User cancelled
			}

			// If selecting specific agent, let them choose which one
			let targetsToConfig = configTargets;
			if (modeChoice === "Select specific agent") {
				const targetNames = configTargets.map((target) => {
					const model = agentModels[target.key] || (target.kind === "agent" ? (target.state?.model || "default") : "default");
					return `${target.label} (${model})`;
				});
				
				const agentChoice = await ctx.ui.select(
					"Select agent to configure",
					targetNames
				);

				if (agentChoice === undefined) {
					return; // User cancelled
				}

				// Find the selected target
				const selectedIndex = targetNames.indexOf(agentChoice);
				targetsToConfig = [configTargets[selectedIndex]];
			}

			// Fetch available models from Pi
			ctx.ui.notify("Fetching available models...", "info");
			const availableModels = await fetchAvailableModels();
			
			// Build model options with session default and custom entry
			const modelOptions = [
				"(use session default)",
				...availableModels,
				"--- Enter custom model ---",
			];

			// Configure selected agent(s)
			const newProjectModels: Record<string, string> = { ...projectAgentModels };
			const newProjectThinking: Record<string, string> = { ...projectAgentThinking };

			for (const target of targetsToConfig) {
				const agentKey = target.key;
				const currentModel = agentModels[agentKey]
					|| (target.kind === "agent" ? target.state?.model : undefined)
					|| "(use session default)";

				let selectedModel: string | undefined;
				let searchTerm = currentModel !== "(use session default)" ? currentModel : "";

				// Loop until user selects a model or cancels
				while (!selectedModel) {
					// Ask for a search filter
					const inputResult = await ctx.ui.input(
						`Filter models for ${target.label} (or press Enter for all)`,
						searchTerm
					);

					if (inputResult === undefined) {
						// User cancelled - save progress so far and exit
						break;
					}

					searchTerm = inputResult;

					// Filter models based on search term
					let filteredModels = modelOptions;
					if (searchTerm && searchTerm.trim()) {
						const search = searchTerm.toLowerCase();
						filteredModels = modelOptions.filter(opt => 
							opt.toLowerCase().includes(search) || 
							opt === "(use session default)" || 
							opt === "--- Enter custom model ---"
						);
					}

					// If filter resulted in too many models, limit to reasonable number
					const maxDisplay = 20;
					let displayModels = filteredModels;
					let hiddenCount = 0;
					
					if (filteredModels.length > maxDisplay + 2) { // +2 for default and custom options
						const specialOptions = filteredModels.filter(opt => 
							opt === "(use session default)" || opt === "--- Enter custom model ---"
						);
						const regularModels = filteredModels.filter(opt => 
							opt !== "(use session default)" && opt !== "--- Enter custom model ---"
						);
						hiddenCount = regularModels.length - maxDisplay;
						displayModels = [
							...specialOptions.filter(opt => opt === "(use session default)"),
							...regularModels.slice(0, maxDisplay),
							"--- Refine search ---",
							...specialOptions.filter(opt => opt === "--- Enter custom model ---"),
						];
					} else {
						// Add refine option even when under limit, in case user wants to search differently
						const specialOptions = filteredModels.filter(opt => 
							opt === "(use session default)" || opt === "--- Enter custom model ---"
						);
						const regularModels = filteredModels.filter(opt => 
							opt !== "(use session default)" && opt !== "--- Enter custom model ---"
						);
						displayModels = [
							...specialOptions.filter(opt => opt === "(use session default)"),
							...regularModels,
							"--- Refine search ---",
							...specialOptions.filter(opt => opt === "--- Enter custom model ---"),
						];
					}

					const options = displayModels.map(opt =>
						opt === currentModel ? `${opt} ✓` : opt
					);

					const matchCount = filteredModels.length - 2; // Exclude special options
					const promptSuffix = hiddenCount > 0 
						? ` (showing 20 of ${matchCount})`
						: ` (${matchCount} matches)`;

					const choice = await ctx.ui.select(
						`Model for ${target.label}${promptSuffix}`,
						options
					);

					if (choice === undefined) {
						// User cancelled - save progress so far and exit
						break;
					}

					const choiceClean = choice.replace(" ✓", "");

					// Handle refine search - loop back to input
					if (choiceClean === "--- Refine search ---") {
						continue; // Go back to filter input
					}

					// Handle custom model input
					if (choiceClean === "--- Enter custom model ---") {
						const customModel = await ctx.ui.input(
							`Enter model for ${target.label}`,
							"e.g., google/gemini-3-flash-preview"
						);
						if (!customModel) {
							continue; // Go back to filter input
						}
						selectedModel = customModel.trim();
						break; // Exit loop with custom model
					}

					// Regular model selected
					selectedModel = choiceClean;
					break; // Exit loop
				}

				// Update the models map (only if user selected something)
				if (selectedModel) {
					if (selectedModel === "(use session default)") {
						delete newProjectModels[agentKey];
					} else {
						newProjectModels[agentKey] = selectedModel;
					}
				}
				
				// If user cancelled (selectedModel is undefined), break out of agent loop
				if (!selectedModel) {
					break;
				}

				if (target.kind === "subagents") {
					delete newProjectThinking[agentKey];
					continue;
				}

				// Now ask for thinking level
				const currentThinking = target.state!.thinking || target.state!.def.thinking || "(use default)";
				const thinkingChoice = await ctx.ui.select(
					`Thinking level for ${target.label}`,
					["(use default)", ...THINKING_LEVELS]
				);

				if (thinkingChoice === undefined) {
					break; // User cancelled
				}

				// Store thinking selection
				const thinkingKey = target.state!.def.name.toLowerCase();
				if (thinkingChoice === "(use default)") {
					delete newProjectThinking[thinkingKey];
				} else {
					newProjectThinking[thinkingKey] = thinkingChoice;
				}
			}

			projectAgentModels = newProjectModels;
			projectAgentThinking = newProjectThinking;
			agentModels = mergeStringMaps(globalAgentModels, projectAgentModels);
			agentThinking = mergeStringMaps(globalAgentThinking, projectAgentThinking);

			writeYamlMap(modelsPath, projectAgentModels);
			writeYamlMap(thinkingPath, projectAgentThinking);

			// Apply model and thinking changes in-place so session context is preserved
			for (const state of agentStates.values()) {
				const key = state.def.name.toLowerCase();
				state.model = agentModels[key];
				state.thinking = agentThinking[key];
			}
			updateWidget();

			const modelSummary = agents
				.map(s => {
					const key = s.def.name.toLowerCase();
					const model = agentModels[key] || "(default)";
					const thinking = agentThinking[key] || "(default)";
					return `${displayName(s.def.name)}: ${model} · thinking:${thinking}`;
				})
				.concat([`Subagents: ${agentModels["subagents"] || "(default)"} · thinking:off`])
				.join("\n");

			ctx.ui.notify(
				`Updated project-local overrides for active team:\n\n${modelSummary}\n\nSaved to:\n${modelsPath}\n${thinkingPath}`,
				"info"
			);
		},
	});

	// ── System Prompt Override ───────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		await backgroundSubagentsLoader;
		const agentCatalog = Array.from(agentStates.values())
			.map(s => `### ${displayName(s.def.name)}\n**Dispatch as:** \`${s.def.name}\`\n${s.def.description}\n**Tools:** ${s.def.tools}`)
			.join("\n\n");

		const teamMembers = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");

		// Read the Kyrie prompt from the agents directory
		const kyriePromptPath = resolve(homedir(), ".pi", "agent", "agents", "kyrie.md");
		let kyriePrompt = "";
		if (existsSync(kyriePromptPath)) {
			try {
				const raw = readFileSync(kyriePromptPath, "utf-8");
				const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
				if (match) {
					kyriePrompt = match[2].trim();
				}
			} catch {}
		}

		// Fallback to dispatcher prompt if Kyrie file not found
		if (!kyriePrompt) {
			kyriePrompt = `You are a dispatcher agent. You coordinate specialist agents to accomplish tasks.
You do NOT have direct access to the codebase. You MUST delegate all work through
agents using the dispatch_agent tool.

## Active Team: ${activeTeamName}
Members: ${teamMembers}

## How to Work
- Analyze the user's request and break into sub-tasks
- If there's an error, give a brief diagnosis first
- Dispatch to the right specialist using dispatch_agent
- Review results and dispatch follow-ups as needed

## Dispatch Format
- Objective: one sentence outcome
- Context: key facts, file paths, prior attempts
- Action Steps: short numbered list
- Deliverables: expected output

## Agents

${agentCatalog}`;
		}

		// Inject dynamic content into the Kyrie prompt
		const finalPrompt = mergeSystemPrompt(kyriePrompt
			.replace(/\${agentCatalog}/g, agentCatalog)
			.replace(/\${teamMembers}/g, teamMembers)
			.replace(/\${activeTeamName}/g, activeTeamName));

		return {
			systemPrompt: `${finalPrompt}\n\n---\n\n${backgroundSubagents.promptGuidance}`,
		};
	});

	// ── Session Start ────────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		await backgroundSubagentsLoader;
		applyExtensionDefaults(import.meta.url, _ctx);
		backgroundSubagents.reset(_ctx);

		// Clear widgets from previous session
		if (widgetCtx) {
			widgetCtx.ui.setWidget("agent-team", undefined);
		}
		widgetCtx = _ctx;
		contextWindow = _ctx.model?.contextWindow || 0;
		viewMode = getAgentTeamViewMode(_ctx.cwd);

		loadAgents(_ctx.cwd);

		// Default to first team — use /agents-team to switch
		const teamNames = Object.keys(teams);
		if (teamNames.length > 0) {
			activateTeam(teamNames[0]);
		}

		// Lock down to dispatcher-only (tool already registered at top level)
		pi.setActiveTools([
			"dispatch_agent",
			"questionnaire",
			"read",
			"bash",
			...backgroundSubagents.toolNames,
			"signal_loop_success",
		]);

		_ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size}) [${viewMode}]`);
		const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
		const teamSources = getTeamsSources(_ctx.cwd).loadedFrom;
		const sourceText = teamSources.length > 0
			? teamSources.join("\n")
			: `${getProjectTeamsPath(_ctx.cwd)} (project-local, not created yet)`;
		_ctx.ui.notify(
			`Team: ${activeTeamName} (${members})\n` +
			`Team sets loaded from:\n${sourceText}\n\n` +
			`/agents-team          Select a team\n` +
			`/agents-list          List active agents and status\n` +
			`/agents-models        Configure models for agents\n` +
			`/agents-reset         Reset agent context\n` +
			`/agents-cancel        Cancel a running agent\n` +
			`/agents-grid <1-6>    Set grid column count\n` +
			`/agents-view <mode>   Switch grid/table/tactical view\n` +
			`/agents-watch [agent] Focus on one agent's live output\n` +
			`/agents-watch-off     Return to team view`,
			"info",
		);
		updateWidget();

		// Footer: model | team | context bar (+ local response speed metrics)
		_ctx.ui.setFooter((tui, theme, _footerData) => {
			footerTui = tui;
			return {
			dispose: () => {
				if (footerTui === tui) footerTui = null;
			},
			invalidate() {},
			render(width: number): string[] {
				const model = _ctx.model?.id || "no-model";
				const thinking = (_ctx as any)?.thinkingLevel || (_ctx.model as any)?.thinkingLevel || (_ctx.model as any)?.thinking || getSessionThinkingLevelFallback(_ctx.cwd);
				const modelWithThinking = `${model} [${thinking}]`;
				const usage = _ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const left = theme.fg("dim", ` ${modelWithThinking}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", activeTeamName);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				const line1 = truncateToWidth(left + pad + right, width);

				const metricsText = formatFooterMetrics(footerMetrics, Date.now());
				const right2 = theme.fg("dim", ` ${metricsText} `);
				const pad2 = " ".repeat(Math.max(0, width - visibleWidth(right2)));
				const line2 = truncateToWidth(pad2 + right2, width);

				return [line1, line2];
			},
		};
		});
	});
}
