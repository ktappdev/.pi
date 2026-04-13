import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mergeSystemPrompt } from "./agent-team-config.ts";

const BACKGROUND_SUBAGENT_TOOLS = "read,bash,grep,find,ls";
const BACKGROUND_SUBAGENT_PROMPT = mergeSystemPrompt(`You are a lightweight background research subagent working for Caveman.

## Role
- Execute only the narrow task you are given.
- Gather facts, inspect files, run non-mutating CLI commands, and report concise findings.
- Favor concrete evidence over speculation.

## Hard Non-Editing Rule
- You must NEVER modify project files.
- You must NEVER create, rewrite, patch, append to, delete, rename, move, or chmod project files.
- You must NEVER use bash as a workaround to edit files.
- Forbidden examples include: echo > file, cat <<EOF > file, tee, sed -i, perl -pi, python/node scripts that write files, apply_patch, git checkout -- <file>, or any equivalent mutation.
- If the task requires changing repository files, refuse and say Caveman must use a normal specialist agent instead.

## Allowed Work
- Read files, search the repo, inspect structure, compare code paths, summarize findings.
- Use installed CLI tools for operational tasks when they do not mutate the project.
- Bash is allowed only for non-mutating investigation and operational commands.

## Output
- Return a concise report for Caveman.
- Include useful file paths, commands run, and evidence.
- Stay tightly scoped. Do not wander into unrelated exploration.`);

export const BACKGROUND_SUBAGENT_TOOL_NAMES = [
	"sub_spawn",
	"sub_list",
	"sub_collect",
	"sub_remove",
] as const;

export const BACKGROUND_SUBAGENT_PROMPT_GUIDANCE = `
## Background Subagents

You have background subagent tools for user-triggered fan-out research.

- Only use these tools when the user explicitly asks you to launch subagents/background workers.
- These subagents are lightweight, run with thinking off, and may use read/bash/grep/find/ls.
- They are strictly non-editing and must never modify project files.
- Use \`sub_spawn\` to launch them and continue with other work without waiting.
- Completed subagent results are queued back to you automatically as follow-up messages.
- Use \`sub_collect\` when you have a natural pause and want any completed results that were not already delivered.
- Use \`sub_list\` to check status and \`sub_remove\` to cancel/remove one.
- If the work may require edits, use \`dispatch_agent\` instead.
`.trim();

type BackgroundStatus = "running" | "done" | "error";

interface BackgroundSubagentState {
	id: number;
	status: BackgroundStatus;
	task: string;
	createdAt: number;
	completedAt?: number;
	elapsed: number;
	toolCount: number;
	textChunks: string[];
	resultText: string;
	collected: boolean;
	delivered: boolean;
	sessionFile: string;
	suppressed?: boolean;
	proc?: ChildProcessWithoutNullStreams;
}

function makeSessionFile(id: number): string {
	const dir = join(homedir(), ".pi", "agent", "sessions", "background-subagents");
	mkdirSync(dir, { recursive: true });
	return join(dir, `background-subagent-${id}-${Date.now()}.jsonl`);
}

function truncate(text: string, limit = 6000): string {
	return text.length > limit ? `${text.slice(0, limit)}\n\n... [truncated]` : text;
}

function formatDeliveredResult(state: BackgroundSubagentState): string {
	const header = `Background subagent #${state.id} finished in ${Math.round(state.elapsed / 1000)}s with status ${state.status.toUpperCase()}.`;
	const task = `Task: ${state.task}`;
	const result = `Result:\n${truncate(state.resultText || "(no output)", 8000)}`;
	return `${header}\n${task}\n\n${result}`;
}

function formatDisplayedSnippet(state: BackgroundSubagentState): string {
	const header = `Background subagent #${state.id} finished in ${Math.round(state.elapsed / 1000)}s with status ${state.status.toUpperCase()}.`;
	const task = `Task: ${state.task}`;
	const snippet = truncate(state.resultText || "(no output)", 280);
	return `${header}\n${task}\n\nSnippet:\n${snippet}\n\n[Full result queued to Caveman]`;
}

export function registerBackgroundSubagentTools(
	pi: ExtensionAPI,
	options: { getPiExecutable: () => string; getModelOverride?: () => string | undefined },
) {
	const states = new Map<number, BackgroundSubagentState>();
	let nextId = 1;
	let widgetCtx: any;

	function killAllRunning() {
		for (const state of states.values()) {
			if (state.proc && state.status === "running") {
				state.suppressed = true;
				state.proc.kill("SIGTERM");
			}
		}
	}

	function reset(ctx?: any) {
		killAllRunning();
		states.clear();
		nextId = 1;
		widgetCtx = ctx;
	}

	function spawnBackgroundSubagent(state: BackgroundSubagentState, task: string, ctx: any) {
		let spawnErrored = false;
		const ctxModel = ctx.model as any;
		const modelOverride = options.getModelOverride?.();
		const model = modelOverride || (ctxModel?.provider && ctxModel?.id
			? `${ctxModel.provider}/${ctxModel.id}`
			: "openrouter/google/gemini-3-flash-preview");

		const proc = spawn(options.getPiExecutable(), [
			"--mode", "json",
			"-p",
			"--session", state.sessionFile,
			"--no-extensions",
			"--model", model,
			"--tools", BACKGROUND_SUBAGENT_TOOLS,
			"--thinking", "off",
			"--append-system-prompt", BACKGROUND_SUBAGENT_PROMPT,
			task,
		], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
			shell: false,
		});

		state.proc = proc;
		const startedAt = Date.now();

		proc.stdout.setEncoding("utf-8");
		proc.stderr.setEncoding("utf-8");

		let stdoutBuffer = "";
		proc.stdout.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta") {
							state.textChunks.push(delta.delta || "");
						}
					} else if (event.type === "tool_execution_start") {
						state.toolCount++;
					}
				} catch {
					// ignore malformed JSON lines
				}
			}
		});

		proc.stderr.on("data", (chunk: string) => {
			if (chunk.trim()) state.textChunks.push(chunk);
		});

		proc.on("close", (code) => {
			if (stdoutBuffer.trim()) {
				try {
					const event = JSON.parse(stdoutBuffer);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta") state.textChunks.push(delta.delta || "");
					}
				} catch {
					// ignore malformed tail buffer
				}
			}

			state.proc = undefined;
			state.elapsed = Date.now() - startedAt;
			state.completedAt = Date.now();
			state.status = code === 0 ? "done" : "error";
			const derivedResult = state.textChunks.join("").trim();
			if (!spawnErrored || !state.resultText) {
				state.resultText = derivedResult;
			}
			if (!state.suppressed && states.has(state.id) && !state.delivered) {
				pi.sendMessage({
					customType: "background-subagent-result-preview",
					content: formatDisplayedSnippet(state),
					display: true,
				}, {
					deliverAs: "followUp",
					triggerTurn: false,
				});
				pi.sendMessage({
					customType: "background-subagent-result",
					content: formatDeliveredResult(state),
					display: false,
				}, {
					deliverAs: "followUp",
					triggerTurn: true,
				});
				state.delivered = true;
			}
			if (!spawnErrored && !state.suppressed && states.has(state.id) && widgetCtx?.ui) {
				widgetCtx.ui.notify(
					`Background subagent #${state.id} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error",
				);
			}
		});

		proc.on("error", (err) => {
			spawnErrored = true;
			state.proc = undefined;
			state.elapsed = Date.now() - startedAt;
			state.completedAt = Date.now();
			state.status = "error";
			state.resultText = `Error spawning background subagent: ${err.message}`;
			if (!state.suppressed && states.has(state.id) && widgetCtx?.ui) {
				widgetCtx.ui.notify(`Background subagent #${state.id} failed: ${err.message}`, "error");
			}
		});
	}

	pi.registerTool({
		name: "sub_spawn",
		description: "Launch a lightweight non-editing background subagent. Returns immediately so Caveman can continue working without waiting.",
		parameters: Type.Object({
			task: Type.String({ description: "The narrow research/inspection task for the background subagent" }),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			widgetCtx = ctx;
			const state: BackgroundSubagentState = {
				id: nextId++,
				status: "running",
				task: params.task,
				createdAt: Date.now(),
				elapsed: 0,
				toolCount: 0,
				textChunks: [],
				resultText: "",
				collected: false,
				delivered: false,
				sessionFile: "",
			};
			state.sessionFile = makeSessionFile(state.id);
			states.set(state.id, state);
			spawnBackgroundSubagent(state, params.task, ctx);
			return {
				content: [{
					type: "text",
					text: `Subagent #${state.id} launched. It is running asynchronously and you do not need to wait. Its completed result will be queued back automatically; sub_collect remains available as a fallback.`,
				}],
			};
		},
	});

	pi.registerTool({
		name: "sub_list",
		description: "List background subagents and their status.",
		parameters: Type.Object({}),
		execute: async () => {
			if (states.size === 0) {
				return { content: [{ type: "text", text: "No background subagents." }] };
			}

			const rows = Array.from(states.values())
				.sort((a, b) => a.id - b.id)
				.map((state) => {
					const collected = state.status !== "running"
						? ` collected:${state.collected ? "yes" : "no"} delivered:${state.delivered ? "yes" : "no"}`
						: "";
					return `#${state.id} [${state.status.toUpperCase()}] tools:${state.toolCount}${collected} — ${state.task}`;
				})
				.join("\n");

			return { content: [{ type: "text", text: `Background subagents:\n${rows}` }] };
		},
	});

	pi.registerTool({
		name: "sub_collect",
		description: "Collect completed background subagent results that have not been collected yet.",
		parameters: Type.Object({}),
		execute: async () => {
			const completed = Array.from(states.values())
				.filter((state) => state.status !== "running" && !state.collected && !state.delivered)
				.sort((a, b) => a.id - b.id);

			if (completed.length === 0) {
				return { content: [{ type: "text", text: "No completed background subagent results are waiting." }] };
			}

			for (const state of completed) state.collected = true;

			const text = completed.map((state) => {
				const header = `#${state.id} [${state.status.toUpperCase()}] ${Math.round(state.elapsed / 1000)}s — ${state.task}`;
				const body = truncate(state.resultText || "(no output)", 5000);
				return `${header}\n${body}`;
			}).join("\n\n---\n\n");

			return { content: [{ type: "text", text: `Collected background subagent results:\n\n${text}` }] };
		},
	});

	pi.registerTool({
		name: "sub_remove",
		description: "Remove a background subagent. If it is still running, it will be stopped first.",
		parameters: Type.Object({
			id: Type.Number({ description: "The background subagent ID to remove" }),
		}),
		execute: async (_toolCallId, params) => {
			const state = states.get(params.id);
			if (!state) {
				return { content: [{ type: "text", text: `No background subagent #${params.id} found.` }] };
			}
			if (state.proc && state.status === "running") {
				state.suppressed = true;
				state.proc.kill("SIGTERM");
			}
			states.delete(params.id);
			return { content: [{ type: "text", text: `Background subagent #${params.id} removed.` }] };
		},
	});

	return {
		reset,
		toolNames: [...BACKGROUND_SUBAGENT_TOOL_NAMES],
		promptGuidance: BACKGROUND_SUBAGENT_PROMPT_GUIDANCE,
	};
}
