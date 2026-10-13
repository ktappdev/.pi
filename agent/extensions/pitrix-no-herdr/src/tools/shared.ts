import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STALE_MS } from "../core/types";
import { isPidAlive } from "../proc/substrate";

/** Uniform tool-error payload: message for the model, ok:false for callers. */
export function err(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { ok: false },
  };
}

/** Strip emoji prefix from label to get the role name.
 *  Labels may have emoji prefix like "🔨 builder" — take the last word. */
export function extractRole(label: string): string {
  const parts = label.trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

/** Herdr-free agent status. With no multiplexer, "agent_status" is derived
 *  from the pitrix's own heartbeat: a live pid + fresh lastSeen means the
 *  stored `state` is trustworthy; a dead pid or stale heartbeat means the
 *  process is gone regardless of what state.json last claimed.
 *
 *  `claimedStatus` is the raw `state`/`status` read from state.json by the
 *  caller (or whatever derived value it computed). We only downgrade — a
 *  process that reports working but has a dead pid/stale heartbeat reads
 *  `unknown` (a lie), matching the original herdr cross-check contract.
 *  Returns the input if state.json can't be read (fail-open). */
export function effectiveAgentStatus(
  claimedStatus: string,
  pitrixId: string,
  staleMs = STALE_MS,
  now: number = Date.now(),
): string {
  if (claimedStatus !== "working" && claimedStatus !== "blocked") return claimedStatus;

  const statePath = join(process.cwd(), ".pnh", "pnh-threads", pitrixId, "state.json");
  if (!existsSync(statePath)) return claimedStatus; // fail-open
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8")) as {
      lastSeen?: string;
      pid?: number;
    };
    // Dead pid → the process is gone, any working/blocked claim is stale.
    if (typeof s.pid === "number" && !isPidAlive(s.pid)) return "unknown";
    if (!s.lastSeen) return claimedStatus;
    if (now - new Date(s.lastSeen).getTime() > staleMs) return "unknown";
    return claimedStatus;
  } catch {
    return claimedStatus; // fail-open on corrupt/unreadable state
  }
}

/** In the herdr-less build a "pane id" is just a pitrix id. Validate the
 *  same charset as role names so a caller can't smuggle a path/flag. */
export function isValidPaneId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/** Shell-quote a value for safe inclusion in a shell argument. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
