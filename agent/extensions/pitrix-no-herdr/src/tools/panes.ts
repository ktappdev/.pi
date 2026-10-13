import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { err, effectiveAgentStatus } from "./shared";
import { isPidAlive } from "../proc/substrate";
import type { PitrixState } from "../core/types";

interface StateFileShim {
  id?: string;
  pid?: number;
  role?: string;
  state?: PitrixState;
  status?: string;
  lastSeen?: string;
  cwd?: string;
}

/** One row in the pnh_panes report — keeps the same shape the
 *  coordinator's prompt contract expects (agent_status + suggestion). */
interface ProcSummary {
  pane_id: string; // == pitrix_id (no multiplexer; the process slot is the pitrix)
  label: string;
  agent_status: string;
  pid: number | null;
  pid_alive: boolean;
  lastSeen: string;
  cwd: string;
  suggestion?: string;
}

/** Derive the agent_status the coordinator sees from state.json + pid
 *  liveness. Mapping from stored state → agent_status vocabulary:
 *    working/thinking → working ; idle/open → idle ; on-hold → blocked
 *    done → done ; stopped/dead-pid/stale-heartbeat → unknown
 *  This preserves the "working/blocked/idle/done/unknown" contract the
 *  coordinator prompt relies on, sourced from heartbeat truth not a
 *  multiplexer's guess. */
function deriveStatus(s: StateFileShim, now: number): { status: string; alive: boolean } {
  const pid = typeof s.pid === "number" ? s.pid : null;
  const alive = pid != null && isPidAlive(pid);
  const stale = s.lastSeen ? now - new Date(s.lastSeen).getTime() > 60_000 : true;

  if (!alive || stale) return { status: "unknown", alive };
  switch (s.state) {
    case "working":
    case "thinking":
      return { status: "working", alive };
    case "on-hold":
      return { status: "blocked", alive };
    case "idle":
    case "open":
      return { status: "idle", alive };
    case "done":
      return { status: "done", alive };
    case "stopped":
      return { status: "unknown", alive };
    default:
      return { status: "unknown", alive };
  }
}

export function registerPanesTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pnh_panes",
    label: "Pitrix Panes",
    description:
      "Survey all pitrix processes in the workspace (herdr-less: reads .pnh/pnh-threads/*/state.json and checks each pid's liveness). Shows agent status and role for each worker. Use this to check which workers are idle (reuse), working (leave alone), or dead (clean up). Prefer reusing idle workers over spawning new ones.",
    promptSnippet:
      "Survey all pitrix processes: heartbeat-derived status, pid liveness, role (find idle workers to reuse).",
    parameters: Type.Object({
      workspace: Type.Optional(
        Type.String({
          description: "Ignored in herdr-less mode (single workspace = the cwd .pnh dir).",
        }),
      ),
      status: Type.Optional(
        Type.String({
          description:
            "Filter by agent_status: idle, working, blocked, done, unknown. Default: all.",
        }),
      ),
      includeLayout: Type.Optional(
        Type.Boolean({
          description: "No-op in herdr-less mode (no pane geometry). Kept for call-compat.",
        }),
      ),
    }),
    async execute(_id, params) {
      const root = join(process.cwd(), ".pnh", "pnh-threads");
      if (!existsSync(root)) {
        return {
          content: [{ type: "text" as const, text: "(no .pnh/pnh-threads dir — no workers yet)" }],
          details: { ok: true, total: 0, panes: [] },
        };
      }

      try {
        const now = Date.now();
        const summaries: ProcSummary[] = [];

        for (const entry of readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const pitrixId = entry.name;
          const statePath = join(root, pitrixId, "state.json");
          if (!existsSync(statePath)) continue;
          let s: StateFileShim;
          try {
            s = JSON.parse(readFileSync(statePath, "utf8")) as StateFileShim;
          } catch {
            continue;
          }
          const { status, alive } = deriveStatus(s, now);
          const agent_status = effectiveAgentStatus(status, pitrixId, 60_000, now);

          let suggestion: string | undefined;
          if (agent_status === "idle" || agent_status === "done") {
            suggestion = "REUSE: idle and available for new work";
          } else if (agent_status === "working") {
            suggestion = "LEAVE: currently working";
          } else if (agent_status === "blocked") {
            suggestion = "CHECK: blocked/on-hold — may need input";
          } else {
            suggestion = "CLEANUP: process dead or heartbeat stale, candidate for removal";
          }

          summaries.push({
            pane_id: pitrixId,
            label: pitrixId,
            agent_status,
            pid: typeof s.pid === "number" ? s.pid : null,
            pid_alive: alive,
            lastSeen: s.lastSeen ?? "",
            cwd: s.cwd ?? "",
            suggestion,
          });
        }

        let filtered = summaries;
        if (params.status) filtered = filtered.filter(p => p.agent_status === params.status);

        const idleCount = filtered.filter(s => s.agent_status === "idle" || s.agent_status === "done").length;
        const workingCount = filtered.filter(s => s.agent_status === "working").length;
        const blockedCount = filtered.filter(s => s.agent_status === "blocked").length;
        const unknownCount = filtered.filter(s => s.agent_status === "unknown").length;

        const lines: string[] = [];
        lines.push(
          `Processes: ${filtered.length} total (${workingCount} working, ${idleCount} idle, ${blockedCount} blocked, ${unknownCount} unknown/dead)`,
        );
        lines.push("");
        for (const p of filtered) {
          lines.push(
            `  ${p.pane_id.padEnd(18)} ${p.agent_status.padEnd(9)} pid=${p.pid ?? "-"} ${p.pid_alive ? "alive" : "DEAD"}  lastSeen=${p.lastSeen || "-"}`,
          );
          lines.push(`      → ${p.suggestion}  (log: .pnh/pnh-threads/${p.pane_id}/output.log)`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            ok: true,
            total: filtered.length,
            byStatus: { working: workingCount, idle: idleCount, blocked: blockedCount, unknown: unknownCount },
            panes: filtered,
          },
        };
      } catch (e) {
        return err(`pnh_panes unexpected error: ${String(e)}`);
      }
    },
  });
}
