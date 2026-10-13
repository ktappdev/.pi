import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { err } from "./shared";
import type { PitrixStore } from "../core/types";
import {
  trackPane,
  spawnWorkerProc,
  isPidAlive,
  pidFromState,
} from "../proc/substrate";
import { piSelfCommand } from "../journal";

/** Module-level cache for .pnh/pnh-models.json */
let modelsJson: Record<string, string> | null = null;
let modelsJsonMtime: number | null = null;

/** Role name validation — prevents shell injection via params.role */
function validateRole(role: string): string | null {
  if (role.length > 32) {
    return `role too long: ${role.length} chars (max 32)`;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(role)) {
    return `role contains invalid characters: ${role} (only a-z, A-Z, 0-9, hyphen)`;
  }
  return null;
}

export function loadModelsJson(): Record<string, string> {
  try {
    let root: string;
    try {
      root = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
    } catch {
      root = process.cwd();
    }
    const path = join(root, ".pnh", "pnh-models.json");
    if (existsSync(path)) {
      const mtime = statSync(path).mtimeMs;
      if (!modelsJson || mtime !== modelsJsonMtime) {
        modelsJson = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
        modelsJsonMtime = mtime;
      }
      return modelsJson;
    }
    if (!modelsJson) {
      modelsJson = {};
    }
    return modelsJson;
  } catch {
    if (!modelsJson) {
      modelsJson = {};
    }
    return modelsJson;
  }
}

function resolveModel(role: string, override?: string): string {
  if (override) return override;
  const cfg = loadModelsJson();
  if (cfg[role]) return cfg[role];
  const prefix = role.split("-")[0];
  if (prefix !== role && cfg[prefix]) return cfg[prefix];
  if (cfg["default"]) return cfg["default"];
  return "";
}

function resolveTheme(override?: string): string | null {
  const themeName = override || loadModelsJson()["theme"] || "pnh-matrix";
  if (themeName.includes("/") || themeName.includes(".json")) return themeName;
  const themesDir = process.env.PNH_THEMES_DIR;
  if (themesDir) {
    const fullPath = join(themesDir, `${themeName}.json`);
    if (existsSync(fullPath)) return fullPath;
  }
  return themeName; // bare name — pi resolves against its own theme registry
}

/** Check if a pitrix-id is already running: its state.json says "running"
 *  AND its pid is still alive. (In the herdr build this also scanned pane
 *  labels; with no multiplexer, state.json+pid is the source of truth.) */
function threadIdExists(pitrixId: string): boolean {
  const cwd = process.cwd();
  const statePath = join(cwd, ".pnh", "pnh-threads", pitrixId, "state.json");
  if (!existsSync(statePath)) return false;
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8")) as {
      status?: string;
      pid?: number;
    };
    if (s.status !== "running") return false;
    if (typeof s.pid === "number" && !isPidAlive(s.pid)) return false; // stale
    return true;
  } catch {
    return false;
  }
}

/** Generate a unique pitrix-id by suffixing -1, -2, etc. if needed. */
function uniquePitrixId(role: string): string {
  if (!threadIdExists(role)) return role;
  let suffix = 1;
  while (threadIdExists(`${role}-${suffix}`)) suffix++;
  return `${role}-${suffix}`;
}

/** Absolute path to this extension's index.ts, so the spawned pi loads
 *  the SAME extension (not the real pitrix one on PATH/config). Deriving
 *  from import.meta.url keeps the worker inside this extension dir. */
function thisExtensionEntry(): string {
  return join(new URL("..", import.meta.url).pathname, "index.ts");
}

export function registerSpawnTool(pi: ExtensionAPI, store: PitrixStore) {
  pi.registerTool({
    name: "pnh_spawn_worker",
    label: "Spawn Worker",
    description:
      "Spawn a new worker as a detached `pi` process (herdr-less). Forks `pi --mode rpc` in the worker's cwd with --pnh-id <role>, --model/--pnh-theme resolved from .pnh/pnh-models.json or overrides. Returns the pid; the worker's output lands in .pnh/pnh-threads/<id>/output.log and its task arrives via pnh_send.",
    promptSnippet:
      "Spawn a worker as a detached pi process (no multiplexer). Returns {ok, pid, pitrix_id}.",
    parameters: Type.Object({
      role: Type.String({
        description: "Worker role / pitrix-id (e.g. 'tank', 'keymaker', 'worker-1')",
      }),
      model: Type.Optional(
        Type.String({
          description: "Override model (provider/model). Omit to read from .pnh/pnh-models.json",
        }),
      ),
      theme: Type.Optional(
        Type.String({
          description: "Override theme name or path. Omit to read from .pnh/pnh-models.json",
        }),
      ),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory for the worker. Default: the coordinator's cwd (shared .pnh mailbox).",
        }),
      ),
      reuse: Type.Optional(
        Type.Boolean({
          description:
            "If a pitrix with this exact id is already running (live pid), reuse it instead of spawning a duplicate. Default: true.",
        }),
      ),
    }),
    async execute(_id, params) {
      if (store.role !== "coordinator") {
        return err("pnh_spawn_worker is coordinator-only — send work to your coordinator instead.");
      }

      try {
        const roleErr = validateRole(params.role);
        if (roleErr) return err(`invalid role: ${roleErr}`);

        // Reuse: if a live pitrix already holds this id, don't double-spawn.
        const uniqueId = uniquePitrixId(params.role);
        if (params.reuse !== false && uniqueId === params.role && threadIdExists(uniqueId)) {
          const pid = pidFromState(process.cwd(), uniqueId);
          const result = {
            ok: true,
            pid: pid ?? null,
            pitrix_id: uniqueId,
            role: uniqueId,
            reused: true,
            note: "a live pitrix already owns this id — reused, no new process spawned",
          };
          trackPane(uniqueId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: result,
          };
        }

        const model = resolveModel(params.role, params.model);
        const theme = resolveTheme(params.theme);
        const cwd = params.cwd ?? process.cwd();

        // Build the pi argv for the worker. Mirror the launch construction
        // used elsewhere (journal.ts piSelfCommand + wake-launch): pass the
        // pitrix id, model, theme, and load THIS extension explicitly so the
        // worker runs the same herdr-less build. --append-system-prompt gives
        // workers their Pitrix persona file instead of the global append.
        const args: string[] = [];
        if (model) args.push("--model", model);
        if (theme) args.push("--pnh-theme", theme);
        args.push("--pnh-id", uniqueId);
        const extEntry = thisExtensionEntry();
        if (existsSync(extEntry)) args.push("--extension", extEntry);
        // The operator's Pitrix persona file, same as real pitrix uses.
        const pitrixPromptPath = `${process.env.HOME ?? ""}/.pi/agent/PITRIX_APPEND_SYSTEM.md`;
        if (existsSync(pitrixPromptPath)) {
          args.push("--append-system-prompt", pitrixPromptPath);
        }

        const sp = spawnWorkerProc(uniqueId, args, cwd, {
          ...process.env,
          // Recoverable provenance: state.ts writes spawnedBy into the
          // worker's state.json; pane_read uses PNH_SELF_ID for the
          // don't-read-yourself guard.
          PNH_SPAWNED_BY: store.pitrixId,
          PNH_SELF_ID: uniqueId,
        });

        // Record spawn provenance into the worker's dir (spawnedBy + pid)
        // so liveness/ownership is recoverable from the mailbox dir itself.
        try {
          mkdirSync(join(cwd, ".pnh", "pnh-threads", uniqueId), { recursive: true });
          writeFileSync(
            join(cwd, ".pnh", "pnh-threads", uniqueId, "spawned-by.json"),
            JSON.stringify(
              {
                spawnedBy: store.pitrixId,
                pid: sp.pid,
                argv: [piSelfCommand(args).cmd, ...piSelfCommand(args).args],
                at: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
        } catch {
          /* best-effort provenance */
        }

        trackPane(uniqueId);

        const result = {
          ok: true,
          pid: sp.pid,
          pitrix_id: uniqueId,
          role: params.role,
          model: model || "(pi default)",
          theme: theme || "(none)",
          reused: false,
          output_log: sp.outputLog,
          note: "worker boots idle; send its task via pnh_send — the mailbox injects it. Watch progress with pnh_pane_read / pnh_panes.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: result,
        };
      } catch (e) {
        return err(`pnh_spawn_worker unexpected error: ${String(e)}`);
      }
    },
  });
}
