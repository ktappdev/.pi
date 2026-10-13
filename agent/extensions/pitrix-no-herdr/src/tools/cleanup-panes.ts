import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { err, isValidPaneId, effectiveAgentStatus } from "./shared";
import { isPidAlive, killWorkerProc, untrackPane } from "../proc/substrate";
import type { PitrixStore, PitrixState } from "../core/types";

/** Worker role labels to clean up. With no multiplexer a worker is just a
 *  pitrix dir + a pid; any non-coordinator pitrix is a cleanup candidate. */
const COORDINATOR_IDS = new Set(["coordinator", "morpheus"]);

interface WorkerState {
  pid?: number;
  role?: string;
  state?: PitrixState;
  status?: string;
  lastSeen?: string;
}

function readWorkerState(root: string, id: string): WorkerState | null {
  const p = join(root, id, "state.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as WorkerState;
  } catch {
    return null;
  }
}

/** Whether this worker's process is still doing something we must protect.
 *  Working/blocked + a live pid + fresh heartbeat → protect. Anything else
 *  (dead pid, stale heartbeat, done/stopped) is a cleanup candidate. */
function isProtected(root: string, id: string, s: WorkerState, now: number): boolean {
  const pidAlive = typeof s.pid === "number" && isPidAlive(s.pid);
  const stale = s.lastSeen ? now - new Date(s.lastSeen).getTime() > 60_000 : true;
  const claimed = s.state === "working" || s.state === "thinking" ? "working"
    : s.state === "on-hold" ? "blocked"
    : "idle";
  const effective = effectiveAgentStatus(claimed, id, 60_000, now);
  return pidAlive && !stale && (effective === "working" || effective === "blocked");
}

export function registerCleanupPanesTool(pi: ExtensionAPI, store: PitrixStore) {
  pi.registerTool({
    name: "pnh_cleanup_panes",
    label: "Cleanup Workers",
    description:
      "Kill stale/dead worker processes (SIGTERM their pids). Removes workers that are not working — dead pids, stale heartbeats, done/stopped. Use when the pitrix list is cluttered with dead workers. Pass pane_id to target one worker, force=true to also kill idle/done workers.",
    promptSnippet: "Kill stale worker processes by pid (use when workers are dead/cluttered).",
    parameters: Type.Object({
      dry_run: Type.Optional(
        Type.Boolean({ description: "If true, list what would be killed without actually killing." }),
      ),
      pane_id: Type.Optional(
        Type.String({
          description:
            "Target a specific worker by pitrix_id. When provided, only that worker is targeted — no bulk scan.",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({
          description:
            "If true, kill idle/done workers too — not just dead/stale ones. Default: false.",
        }),
      ),
    }),
    async execute(_id, params) {
      if (store.role !== "coordinator") {
        return err("pnh_cleanup_panes is coordinator-only — report worker problems to your coordinator.");
      }

      const root = join(process.cwd(), ".pnh", "pnh-threads");
      const now = Date.now();
      const myId = store.pitrixId;

      // --- Targeted mode: kill a specific worker ---
      if (params.pane_id) {
        const targetId = params.pane_id.trim();
        if (!isValidPaneId(targetId)) {
          return err(`Invalid pane_id "${targetId}" — expected a pitrix id.`);
        }
        if (targetId === myId) {
          return err(`pane_id ${targetId} is this coordinator — refusing to kill. Pass a worker id.`);
        }
        const s = readWorkerState(root, targetId);
        if (!s) {
          return err(`No state.json for "${targetId}" — it may already be reaped. Run pnh_panes().`);
        }
        if (isProtected(root, targetId, s, now)) {
          return err(`Worker ${targetId} is working/blocked — protected. Inspect or unblock it first.`);
        }
        const pidAlive = typeof s.pid === "number" && isPidAlive(s.pid);
        if (!pidAlive) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: true, action: "already dead", closed: [targetId], count: 1 }) }],
            details: { ok: true, action: "already dead", closed: [targetId], count: 1 },
          };
        }
        if (params.dry_run) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: true, action: "would kill", closed: [targetId], count: 1 }) }],
            details: { ok: true, action: "would kill", closed: [targetId], count: 1 },
          };
        }
        const okKill = killWorkerProc(s.pid!);
        untrackPane(targetId);
        if (!okKill) return err(`Failed to kill pid ${s.pid} for ${targetId}.`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true, action: "killed", closed: [targetId], count: 1 }) }],
          details: { ok: true, action: "killed", closed: [targetId], count: 1 },
        };
      }

      // --- Bulk mode: sweep all dead/stale workers ---
      if (!existsSync(root)) {
        return {
          content: [{ type: "text" as const, text: "(no .pnh/pnh-threads dir — nothing to clean)" }],
          details: { ok: true, action: "none", closed: [], skipped: [], count: 0 },
        };
      }

      const toKill: Array<{ id: string; pid: number }> = [];
      const skipped: string[] = [];

      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        if (id === myId || COORDINATOR_IDS.has(id)) {
          skipped.push(id);
          continue;
        }
        const s = readWorkerState(root, id);
        if (!s) continue;
        const pidAlive = typeof s.pid === "number" && isPidAlive(s.pid);
        const stale = s.lastSeen ? now - new Date(s.lastSeen).getTime() > 60_000 : true;

        // Working/blocked + alive + fresh → always protect.
        if (isProtected(root, id, s, now)) {
          skipped.push(id);
          continue;
        }
        // Idle/done but alive and fresh → protect unless force.
        const resting = s.state === "idle" || s.state === "open" || s.state === "done";
        if (pidAlive && !stale && resting && !params.force) {
          skipped.push(id);
          continue;
        }
        if (pidAlive && typeof s.pid === "number") {
          toKill.push({ id, pid: s.pid });
        } else {
          // Dead already — nothing to signal; note as reaped.
          skipped.push(id);
        }
      }

      const killed: string[] = [];
      if (!params.dry_run) {
        for (const w of toKill) {
          if (killWorkerProc(w.pid)) {
            killed.push(w.id);
            untrackPane(w.id);
          }
        }
      }

      const count = params.dry_run ? toKill.length : killed.length;
      const action = params.dry_run ? "would kill" : "killed";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              action,
              closed: params.dry_run ? toKill.map(w => w.id) : killed,
              skipped,
              count,
            }),
          },
        ],
        details: {
          ok: true,
          action,
          closed: params.dry_run ? toKill.map(w => w.id) : killed,
          skipped,
          count,
        },
      };
    },
  });
}
