/**
 * Agent Team Headless — RPC-mode dispatcher orchestrator
 *
 * Stripped-down version of agent-team.ts for headless/RPC operation.
 * No TUI dependencies. All output via notify() and setWidget(string[]).
 *
 * The dispatcher has NO codebase tools except dispatch_agent, read, bash.
 * Specialist agents spawn as separate pi processes with their own tools.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn, execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import {
  type AgentDef,
  getProjectBaseDir,
  getProjectAgentsDir,
  getProjectPiDir,
  getPiCodingAgentDir,
  mergeSystemPrompt,
  ensureDir,
  ensureGitignoreEntry,
  getGlobalTeamsPath,
  getProjectTeamsPath,
  getGlobalAgentModelsPath,
  getProjectAgentModelsPath,
  getGlobalAgentThinkingPath,
  getProjectAgentThinkingPath,
  getGlobalAgentStatelessPath,
  getProjectAgentStatelessPath,
  writeYamlMap,
  displayName,
  readTeamsFile,
  readAgentYamlMap,
  scanAgentDirs,
  mergeStringMaps,
  mergeTeams,
} from "./lib/agent-team-config.ts";
import {
  isStateless,
  markStateless,
  unmarkStateless,
  listStateless,
  getStatelessMode,
  setStatelessMode,
  load as loadStatelessConfig,
  save as saveStatelessConfig,
} from "./lib/agent-team-stateless.ts";

// ── Find Pi Executable ──────────────────────────

let cachedPiPath: string | null = null;

function findPiExecutable(): string {
  if (cachedPiPath) return cachedPiPath;
  const envPath = process.env.PI_PATH;
  if (envPath && existsSync(envPath)) { cachedPiPath = envPath; return cachedPiPath; }
  try {
    const whichOutput = execSync("which pi", { encoding: "utf-8" }).trim();
    if (whichOutput && existsSync(whichOutput)) { cachedPiPath = whichOutput; return cachedPiPath; }
  } catch {}
  const home = homedir();
  const commonPaths = ["/opt/homebrew/bin/pi", "/usr/local/bin/pi", "/usr/bin/pi"];
  for (const p of commonPaths) { if (existsSync(p)) { cachedPiPath = p; return cachedPiPath; } }
  try {
    const miseInstallsDir = join(home, ".local", "share", "mise", "installs");
    if (existsSync(miseInstallsDir)) {
      for (const version of readdirSync(miseInstallsDir)) {
        const piPath = join(miseInstallsDir, version, "bin", "pi");
        if (existsSync(piPath)) { cachedPiPath = piPath; return cachedPiPath; }
      }
    }
  } catch {}
  cachedPiPath = "/opt/homebrew/bin/pi";
  return cachedPiPath;
}

// ── Types ───────────────────────────────────────

interface AgentState {
  def: AgentDef;
  status: "idle" | "running" | "done" | "error";
  task: string;
  toolCount: number;
  elapsed: number;
  lastWork: string[];
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

const EXTENSIONS_DIR = fileURLToPath(new URL(".", import.meta.url));
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

// ── Extension ───────────────────────────────────

export default function (pi: ExtensionAPI) {
  const agentStates: Map<string, AgentState> = new Map();
  const agentLogs: Map<string, string[]> = new Map();
  const runningProcs: Map<string, ReturnType<typeof spawn>> = new Map();
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
  let orchestratorTools: string[] = ["dispatch_agent", "read", "bash"];
  let sessionDir = "";
  let globalStatelessPath = "";
  let projectStatelessPath = "";
  let widgetCtx: any;

  // ── Cleanup on exit ──────────────────────────

  pi.on("before_exit", async (_event, _ctx) => {
    for (const [key, proc] of runningProcs.entries()) {
      try { proc.kill("SIGKILL"); } catch {}
      runningProcs.delete(key);
    }
  });

  process.on("SIGINT", () => {
    for (const [key, proc] of runningProcs.entries()) {
      const state = agentStates.get(key);
      if (state && state.status === "running") {
        try { proc.kill("SIGINT"); } catch {}
        runningProcs.delete(key);
        if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
        state.status = "idle";
        if (isStateless(key) && state.sessionFile && existsSync(state.sessionFile)) {
          try { unlinkSync(state.sessionFile); } catch {}
          state.sessionFile = null;
        }
      }
    }
  });

  // ── Helpers ──────────────────────────────────

  function resolveAgentByInput(inputRaw: string): AgentState | null {
    const input = inputRaw.trim().toLowerCase();
    if (!input) return null;
    for (const state of agentStates.values()) {
      const rawName = state.def.name.toLowerCase();
      const display = displayName(state.def.name).toLowerCase();
      const slug = rawName.replace(/\s+/g, "-");
      if (input === rawName || input === display || input === slug) return state;
    }
    for (const state of agentStates.values()) {
      const rawName = state.def.name.toLowerCase();
      const display = displayName(state.def.name).toLowerCase();
      if (rawName.includes(input) || display.includes(input)) return state;
    }
    return null;
  }

  function renderStatus(): string[] {
    if (agentStates.size === 0) return ["No agents loaded."];
    const lines: string[] = [];
    const states = Array.from(agentStates.values());
    for (const s of states) {
      const icon = s.status === "running" ? "●" : s.status === "done" ? "✓" : s.status === "error" ? "✗" : "○";
      const elapsed = s.elapsed > 0 ? ` ${Math.round(s.elapsed / 1000)}s` : "";
      const runs = s.runCount > 0 ? ` ×${s.runCount}` : "";
      const task = s.task ? ` — ${s.task.slice(0, 60)}${s.task.length > 60 ? "…" : ""}` : "";
      lines.push(`${icon} ${displayName(s.def.name)} [${s.status}${elapsed}${runs}]${task}`);
    }
    return lines;
  }

  function updateStatusWidget() {
    if (widgetCtx?.ui?.setWidget) {
      widgetCtx.ui.setWidget("agent-team", renderStatus());
    }
  }

  // ── Load & Activate ──────────────────────────

  function loadAgents(cwd: string) {
    const projectRoot = getProjectBaseDir(cwd);
    sessionDir = join(getProjectPiDir(cwd), "agent-sessions");
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    ensureGitignoreEntry(projectRoot, ".pi/agent-sessions/");

    allAgentDefs = scanAgentDirs(cwd);

    const globalTeamsPath = getGlobalTeamsPath();
    const projectTeamsPath = getProjectTeamsPath(cwd);
    globalTeams = existsSync(globalTeamsPath) ? readTeamsFile(globalTeamsPath) : {};
    projectTeams = existsSync(projectTeamsPath) ? readTeamsFile(projectTeamsPath) : {};
    teams = mergeTeams(globalTeams, projectTeams);

    if (Object.keys(teams).length === 0) {
      teams = { all: allAgentDefs.map(d => d.name) };
    }

    const globalModelsPath = getGlobalAgentModelsPath();
    const projectModelsPath = getProjectAgentModelsPath(cwd);
    globalAgentModels = existsSync(globalModelsPath) ? readAgentYamlMap(globalModelsPath) : {};
    projectAgentModels = existsSync(projectModelsPath) ? readAgentYamlMap(projectModelsPath) : {};
    agentModels = mergeStringMaps(globalAgentModels, projectAgentModels);

    const globalThinkingPath = getGlobalAgentThinkingPath();
    const projectThinkingPath = getProjectAgentThinkingPath(cwd);
    globalAgentThinking = existsSync(globalThinkingPath) ? readAgentYamlMap(globalThinkingPath) : {};
    projectAgentThinking = existsSync(projectThinkingPath) ? readAgentYamlMap(projectThinkingPath) : {};
    agentThinking = mergeStringMaps(globalAgentThinking, projectAgentThinking);

    globalStatelessPath = getGlobalAgentStatelessPath();
    projectStatelessPath = getProjectAgentStatelessPath(cwd);
    loadStatelessConfig(globalStatelessPath, projectStatelessPath);
  }

  function activateTeam(teamName: string) {
    activeTeamName = teamName;
    const members = teams[teamName] || [];
    const defsByName = new Map(allAgentDefs.map(d => [d.name.toLowerCase(), d]));

    agentStates.clear();
    for (const member of members) {
      if (member.toLowerCase() === "caveman") continue;
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
        lastWork: [],
        sessionFile: existsSync(sessionFile) ? sessionFile : null,
        runCount: 0,
        model: assignedModel,
        thinking: assignedThinking,
      });
    }
  }

  // ── Provider Discovery ───────────────────────

  let cachedProviderExtensions: string[] | null = null;

  function discoverProviderExtensions(): string[] {
    if (cachedProviderExtensions) return cachedProviderExtensions;
    const providers: string[] = [];
    const home = homedir();
    const packageDirs = [
      join(home, ".pi", "agent", "git"),
      join(home, ".pi", "agent", "npm"),
    ];
    const commonEntryPoints = ["index.ts", "index.js", "kilo.ts", "provider.ts", "main.ts", "main.js"];
    for (const packageDir of packageDirs) {
      if (!existsSync(packageDir)) continue;
      try {
        for (const packageName of readdirSync(packageDir)) {
          const packagePath = join(packageDir, packageName);
          if (!existsSync(packagePath)) continue;
          let found = false;
          for (const entry of commonEntryPoints) {
            const entryPath = join(packagePath, entry);
            if (existsSync(entryPath)) {
              try {
                const content = readFileSync(entryPath, "utf-8");
                if (content.includes("registerProvider")) {
                  providers.push(entryPath);
                  found = true;
                  break;
                }
              } catch {}
            }
          }
          if (!found) {
            // Fallback: check package.json pi.extensions manifest
            const pkgJsonPath = join(packagePath, "package.json");
            if (existsSync(pkgJsonPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
                if (pkg.pi?.extensions) {
                  for (const extPath of pkg.pi.extensions) {
                    const fullPath = join(packagePath, extPath);
                    if (existsSync(fullPath)) providers.push(fullPath);
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }
    cachedProviderExtensions = providers;
    return providers;
  }

  function getSubagentExtensionArgs(agentName: string, loadProviders: boolean = true): string[] {
    const args: string[] = [];
    if (loadProviders) {
      for (const provider of discoverProviderExtensions()) {
        args.push("-e", provider);
      }
    }
    return args.length > 0 ? args : ["--no-extensions"];
  }

  function hasEditCapabilities(tools: string): boolean {
    return tools.split(",").map(t => t.trim()).some(t => t === "edit" || t === "write");
  }

  // ── Dispatch Agent ───────────────────────────

  function dispatchAgent(agentName: string, task: string, ctx: any): Promise<DispatchResult> {
    let sanitizedTask = task.replace(/@(?=(\/|\.\/|~\/))/g, "");
    const key = agentName.toLowerCase();
    const state = agentStates.get(key);
    if (!state) {
      return Promise.resolve({
        output: `Agent "${agentName}" not found. Available: ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`,
        exitCode: 1, elapsed: 0,
      });
    }
    if (state.status === "running") {
      return Promise.resolve({
        output: `Agent "${displayName(state.def.name)}" is already running.`,
        exitCode: 1, elapsed: 0,
      });
    }

    state.status = "running";
    state.task = sanitizedTask;
    state.toolCount = 0;
    state.elapsed = 0;
    state.lastWork = [];
    state.runCount++;
    updateStatusWidget();

    const startTime = Date.now();
    state.timer = setInterval(() => {
      state.elapsed = Date.now() - startTime;
      updateStatusWidget();
    }, 2000);

    const ctxModel = ctx.model as any;
    const model = state.model || state.def.model || (ctxModel?.provider && ctxModel?.id
      ? `${ctxModel.provider}/${ctxModel.id}`
      : "openrouter/google/gemini-3-flash-preview");

    const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
    const agentSessionFile = join(sessionDir, `${agentKey}.json`);

    if (isStateless(key)) {
      if (existsSync(agentSessionFile)) unlinkSync(agentSessionFile);
      state.sessionFile = null;
    }

    const globalAppendPath = join(homedir(), '.pi', 'agent', 'APPEND_SYSTEM.md');
    const globalAppendRaw = existsSync(globalAppendPath) ? readFileSync(globalAppendPath, 'utf-8').trim() : '';
    const excludedAgents = ['scout', 'tavily', 'documenter', 'designer', 'devops', 'sparky'];
    const globalAppend = excludedAgents.includes(state.def.name.toLowerCase()) ? '' : globalAppendRaw;

    const args = [
      "--mode", "json", "-p", "--no-extensions",
      ...getSubagentExtensionArgs(state.def.name, state.def.loadProviders ?? true),
      "--model", model,
      "--thinking", state.thinking || state.def.thinking || "off",
      "--tools", state.def.tools,
      "--append-system-prompt", mergeSystemPrompt(state.def.systemPrompt + (globalAppend ? "\n\n" + globalAppend : "")),
      "--session", agentSessionFile,
    ];

    if (state.sessionFile && existsSync(state.sessionFile)) args.push("-c");
    args.push(sanitizedTask);

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
            if (event.type === "tool_execution_start") {
              state.toolCount++;
              updateStatusWidget();
            }
          } catch {}
        }
      });

      proc.on("close", (code) => {
        runningProcs.delete(key);
        clearInterval(state.timer);
        state.elapsed = Date.now() - startTime;
        state.status = code === 0 ? "done" : "error";

        if (code === 0 && !isStateless(key)) {
          state.sessionFile = agentSessionFile;
        } else if (isStateless(key)) {
          state.sessionFile = null;
          if (existsSync(agentSessionFile)) unlinkSync(agentSessionFile);
        }

        const full = textChunks.join("");
        const summary = `[${displayName(state.def.name)}] ${state.status} in ${Math.round(state.elapsed / 1000)}s`;

        updateStatusWidget();
        if (widgetCtx?.ui?.notify) {
          widgetCtx.ui.notify(summary, state.status === "done" ? "success" : "error");
        }

        resolve({ output: full, exitCode: code ?? 1, elapsed: state.elapsed });
      });

      proc.on("error", (err) => {
        runningProcs.delete(key);
        clearInterval(state.timer);
        state.status = "error";
        state.lastWork = [err.message];
        updateStatusWidget();
        resolve({ output: `Error: ${err.message}`, exitCode: 1, elapsed: Date.now() - startTime });
      });
    });
  }

  // ── dispatch_agent Tool ──────────────────────

  pi.registerTool({
    name: "dispatch_agent",
    label: "Dispatch Agent",
    description: "Dispatch a task to a specialist agent. The agent executes and returns results.",
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name (case-insensitive)" }),
      task: Type.String({ description: "Task for the agent to execute" }),
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
        return {
          content: [{ type: "text", text: `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s\n\n${truncated}` }],
          details: { agent, task, status, elapsed: result.elapsed, exitCode: result.exitCode, fullOutput: result.output },
        };
      } catch (err: any) {
        const { agent, task } = params as { agent: string; task: string };
        return {
          content: [{ type: "text", text: `Error dispatching to ${agent}: ${err?.message || err}` }],
          details: { agent, task, status: "error", elapsed: 0, exitCode: 1, fullOutput: "" },
        };
      }
    },
  });

  // ── Commands ─────────────────────────────────

  pi.registerCommand("agents-team", {
    description: "Select a team: /agents-team <name>",
    getArgumentCompletions: (prefix: string) => {
      const items = Object.keys(teams).map(n => ({ value: n, label: n }));
      return items.filter(i => i.value.startsWith(prefix)) || items;
    },
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      const name = (args || "").trim();
      if (!name || !teams[name]) {
        const available = Object.keys(teams).join(", ");
        ctx.ui.notify(`Usage: /agents-team <name>. Available: ${available}`, "warning");
        return;
      }
      activateTeam(name);
      ctx.ui.notify(`Team: ${name} — ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`, "info");
    },
  });

  pi.registerCommand("agents-list", {
    description: "List loaded agents and their status",
    handler: async (_args, ctx) => {
      widgetCtx = ctx;
      const names = Array.from(agentStates.values())
        .map(s => `${displayName(s.def.name)} [${s.status}] — ${s.def.description}`)
        .join("\n");
      ctx.ui.notify(names || "No agents loaded", "info");
    },
  });

  pi.registerCommand("agents-tools", {
    description: "Show tool list for each agent",
    handler: async (_args, ctx) => {
      if (agentStates.size === 0) { ctx.ui.notify("No agents loaded.", "warning"); return; }
      const lines = Array.from(agentStates.values()).map(s => `${displayName(s.def.name)}: ${s.def.tools}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("agents-reset", {
    description: "Reset agent context: /agents-reset [agent name|all]",
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      if (agentStates.size === 0) { ctx.ui.notify("No agents loaded.", "warning"); return; }
      const target = (args || "all").trim().toLowerCase();
      let resetCount = 0;
      for (const state of agentStates.values()) {
        if (target !== "all" && !state.def.name.toLowerCase().includes(target) && displayName(state.def.name).toLowerCase() !== target) continue;
        const key = state.def.name.toLowerCase();
        if (state.status === "running") {
          const proc = runningProcs.get(key);
          if (proc) { try { proc.kill("SIGKILL"); } catch {}; runningProcs.delete(key); }
          if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
        }
        if (state.sessionFile && existsSync(state.sessionFile)) unlinkSync(state.sessionFile);
        state.sessionFile = null;
        state.runCount = 0;
        state.status = "idle";
        state.task = "";
        state.toolCount = 0;
        state.elapsed = 0;
        state.lastWork = [];
        resetCount++;
      }
      updateStatusWidget();
      ctx.ui.notify(`Reset ${resetCount} agent(s)`, "info");
    },
  });

  pi.registerCommand("agents-cancel", {
    description: "Cancel a running agent: /agents-cancel <agent>",
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      if (!args?.trim()) { ctx.ui.notify("Usage: /agents-cancel <agent>", "warning"); return; }
      const state = resolveAgentByInput(args);
      if (!state) { ctx.ui.notify(`Agent not found: ${args}`, "error"); return; }
      if (state.status !== "running") { ctx.ui.notify(`${displayName(state.def.name)} is not running.`, "warning"); return; }
      const key = state.def.name.toLowerCase();
      const proc = runningProcs.get(key);
      if (proc) { try { proc.kill("SIGINT"); } catch {}; runningProcs.delete(key); }
      if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
      state.status = "idle";
      updateStatusWidget();
      ctx.ui.notify(`Cancelled ${displayName(state.def.name)}`, "info");
    },
  });

  pi.registerCommand("agents-stateless", {
    description: "Mark agents stateless: /agents-stateless <agent1> [agent2 ...]",
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      const names = (args || "").trim().split(/\s+/).filter(Boolean);
      if (names.length === 0) { ctx.ui.notify("Usage: /agents-stateless <agent1> [agent2 ...]", "error"); return; }
      const marked: string[] = [];
      for (const name of names) {
        const s = resolveAgentByInput(name);
        if (!s) { ctx.ui.notify(`Agent not found: ${name}`, "warning"); continue; }
        markStateless(s.def.name.toLowerCase());
        marked.push(displayName(s.def.name));
      }
      if (marked.length > 0) {
        saveStatelessConfig(projectStatelessPath);
        ctx.ui.notify(`Stateless: ${marked.join(", ")}`, "info");
      }
    },
  });

  pi.registerCommand("agents-stateless-off", {
    description: "Remove from stateless: /agents-stateless-off <agent1> [agent2 ...]",
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      const names = (args || "").trim().split(/\s+/).filter(Boolean);
      if (names.length === 0) { ctx.ui.notify("Usage: /agents-stateless-off <agent1> [agent2 ...]", "error"); return; }
      const unmarked: string[] = [];
      for (const name of names) {
        const s = resolveAgentByInput(name);
        if (!s) { ctx.ui.notify(`Agent not found: ${name}`, "warning"); continue; }
        unmarkStateless(s.def.name.toLowerCase());
        unmarked.push(displayName(s.def.name));
      }
      if (unmarked.length > 0) {
        saveStatelessConfig(projectStatelessPath);
        ctx.ui.notify(`No longer stateless: ${unmarked.join(", ")}`, "info");
      }
    },
  });

  pi.registerCommand("agents-stateless-mode", {
    description: "Toggle global stateless: /agents-stateless-mode on|off",
    handler: async (args, ctx) => {
      widgetCtx = ctx;
      const mode = (args || "").trim().toLowerCase();
      if (mode !== "on" && mode !== "off") { ctx.ui.notify("Usage: /agents-stateless-mode on|off", "error"); return; }
      setStatelessMode(mode === "on");
      saveStatelessConfig(projectStatelessPath);
      ctx.ui.notify(`Global stateless mode: ${mode.toUpperCase()}`, "info");
    },
  });

  pi.registerCommand("agents-stateless-list", {
    description: "Show stateless agents",
    handler: async (_args, ctx) => {
      const mode = getStatelessMode();
      const agents = listStateless();
      const modeLine = `Global mode: ${mode ? "ON" : "OFF"}`;
      const agentsLine = agents.length > 0 ? `Stateless: ${agents.join(", ")}` : "No per-agent overrides";
      ctx.ui.notify(`${modeLine}\n${agentsLine}`, "info");
    },
  });

  pi.registerCommand("agents-models", {
    description: "Show current agent models",
    handler: async (_args, ctx) => {
      if (agentStates.size === 0) { ctx.ui.notify("No agents loaded.", "warning"); return; }
      const lines = Array.from(agentStates.values()).map(s => {
        const key = s.def.name.toLowerCase();
        const model = agentModels[key] || s.def.model || "(default)";
        const thinking = agentThinking[key] || s.def.thinking || "(default)";
        return `${displayName(s.def.name)}: ${model} · thinking: ${thinking}`;
      });
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── System Prompt Injection ──────────────────

  pi.on("before_agent_start", async (_event, _ctx) => {
    const agentCatalog = Array.from(agentStates.values())
      .map(s => `### ${displayName(s.def.name)}\n**Dispatch as:** \`${s.def.name}\`\n${s.def.description}\n**Tools:** ${s.def.tools}`)
      .join("\n\n");
    const teamMembers = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");

    // Read the orchestrator prompt
    const orchestratorPromptPath = resolve(getPiCodingAgentDir(), "agents", "morpheus.md");
    let orchestratorPrompt = "";
    if (existsSync(orchestratorPromptPath)) {
      try {
        const raw = readFileSync(orchestratorPromptPath, "utf-8");
        const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
          const toolsMatch = match[1].match(/^tools:\s*(.+)$/m);
          if (toolsMatch) orchestratorTools = toolsMatch[1].split(",").map((t: string) => t.trim()).filter(Boolean);
          orchestratorPrompt = match[2].trim();
        }
      } catch {}
    }
    if (!orchestratorPrompt) {
      orchestratorPrompt = `You are a dispatcher. Coordinate specialist agents via dispatch_agent.\n\n## Active Team: ${activeTeamName}\nMembers: ${teamMembers}\n\n${agentCatalog}`;
    }

    const finalPrompt = mergeSystemPrompt(orchestratorPrompt
      .replace(/\${agentCatalog}/g, agentCatalog)
      .replace(/\${teamMembers}/g, teamMembers)
      .replace(/\${activeTeamName}/g, activeTeamName));

    const globalAppendPath = join(homedir(), '.pi', 'agent', 'APPEND_SYSTEM.md');
    const globalAppend = existsSync(globalAppendPath) ? readFileSync(globalAppendPath, 'utf-8').trim() : '';

    return { systemPrompt: `${finalPrompt}${globalAppend ? `\n\n---\n\n${globalAppend}` : ``}` };
  });

  // ── Session Start ────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    widgetCtx = ctx;
    loadAgents(ctx.cwd);

    const teamNames = Object.keys(teams);
    // Use APH_TEAM env var if set, otherwise first team
    const envTeam = process.env.APH_TEAM?.trim();
    const defaultTeam = envTeam && teams[envTeam] ? envTeam : (teamNames[0] || "");
    if (defaultTeam) {
      activateTeam(defaultTeam);
      // Don't show widget here — session_start notification handles it below
    }

    const existingTools = pi.getActiveTools();
    const requestedTools = new Set([...existingTools, ...orchestratorTools]);
    pi.setActiveTools(Array.from(requestedTools));

    const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
    ctx.ui.notify(
      `Team: ${activeTeamName} (${members})\n` +
      `/agents-team <name>  Select team\n` +
      `/agents-list         List agents\n` +
      `/agents-reset <name> Reset agent\n` +
      `/agents-cancel <name> Cancel running agent\n` +
      `/agents-models       Show models\n` +
      `/agents-stateless    Mark stateless\n` +
      `/agents-tools        Show tools`,
      "info",
    );

    updateStatusWidget();

    ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size})`);
  });
}
