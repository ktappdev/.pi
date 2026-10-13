import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { piSelfCommand } from "../journal";

/**
 * proc/substrate.ts — the herdr-less replacement for src/herdr/ and the
 * herdr-backed half of spawn/cleanup.
 *
 * In real pitrix, workers are panes in a Herdr multiplexer: herdr owns the
 * pty, the geometry, the pane→pi lifetime, the agent_status heuristics, and
 * the exit events. Here there is no multiplexer. Each worker is a plain
 * detached `pi` child running in **RPC mode** (`pi --mode rpc`), which is
 * pi's long-lived headless interface: it boots the extension, activates the
 * pitrix, and sits waiting — no TTY required. Its stdout/stderr append to
 * `.pnh/pnh-threads/<id>/output.log`.
 *
 * The file mailbox (.pnh/...) is untouched: workers still receive tasks
 * and send replies over that protocol. Only the process substrate changed.
 *
 * "pane_id" is redefined: a worker's pane_id IS its pitrix_id.
 *
 * Child lifetime: the coordinator holds the write end of each worker's stdin.
 * That pipe is never written to, but its existence keeps RPC mode alive; when
 * the coordinator exits, the write end closes → the worker's stdin hits EOF →
 * pi shuts down. So workers are cleaned up with their coordinator for free.
 */

/** Check whether a PID is alive (same logic as state.ts). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    return true; // EPERM or other — process exists
  }
}

/** A spawned worker process handle tracked in memory. */
export interface SpawnedProc {
  pitrixId: string;
  pid: number;
  proc: ChildProcess;
  outputLog: string;
  startedAt: number;
}

const spawned = new Map<number, SpawnedProc>();
const byPitrixId = new Map<string, number>();

const SWEEP_MS = 10_000;
/** Grace: don't report a death within this window of spawn (pi still booting). */
const STARTUP_GRACE_MS = 8_000;

/** Handle for the running PID-death watcher — mirrors HerdrListenerHandle. */
export interface ProcWatcherHandle {
  stop: () => void;
  trackPane: (pitrixId: string) => void;
  untrackPane: (pitrixId: string) => void;
  trackedPaneCount: () => number;
}

let activeHandle: ProcWatcherHandle | null = null;
export function setWatcherHandle(h: ProcWatcherHandle | null): void {
  activeHandle = h;
}
export function trackPane(pitrixId: string): void {
  activeHandle?.trackPane(pitrixId);
}
export function untrackPane(pitrixId: string): void {
  activeHandle?.untrackPane(pitrixId);
}
export function getTrackedPaneCount(): number {
  return activeHandle?.trackedPaneCount() ?? 0;
}

/** Read the pid a worker wrote into its own state.json. The worker's own
 *  state.ts persists `pid: process.pid`, so this is recoverable across a
 *  coordinator restart without any sidecar file. */
export function pidFromState(cwd: string, pitrixId: string): number | null {
  try {
    const s = JSON.parse(
      readFileSync(join(cwd, ".pnh", "pnh-threads", pitrixId, "state.json"), "utf8"),
    ) as { pid?: number };
    return typeof s.pid === "number" ? s.pid : null;
  } catch {
    return null;
  }
}

/**
 * Spawn a worker `pi` process in RPC mode. `piArgv` are the pi args (should
 * include --pnh-id, --model, etc. — NOT --mode rpc; it's added here).
 * Returns the SpawnedProc.
 */
export function spawnWorkerProc(
  pitrixId: string,
  piArgv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): SpawnedProc {
  const pitrixDir = join(cwd, ".pnh", "pnh-threads", pitrixId);
  mkdirSync(pitrixDir, { recursive: true });
  const outputLog = join(pitrixDir, "output.log");
  const outFd = openSync(outputLog, "a");

  const args = ["--mode", "rpc", ...piArgv];
  // Prefer an explicit PI_BIN (same convention as wake-launch.ts: "pi" on
  // PATH, or a real executable when the npm shim can't be spawned). Fall
  // back to re-invoking exactly what started this process.
  const launch = env.PI_BIN
    ? { cmd: env.PI_BIN, args }
    : piSelfCommand(args);

  const proc = spawn(launch.cmd, launch.args, {
    cwd,
    env,
    detached: true,
    // stdin stays an OPEN pipe we never write to: it keeps RPC mode alive and
    // auto-closes on coordinator exit → workers shut down with their parent.
    stdio: ["pipe", outFd, outFd],
  });
  proc.unref();

  const sp: SpawnedProc = {
    pitrixId,
    pid: proc.pid ?? -1,
    proc,
    outputLog,
    startedAt: Date.now(),
  };
  if (proc.pid != null) {
    spawned.set(proc.pid, sp);
    byPitrixId.set(pitrixId, proc.pid);
  }

  proc.on("exit", () => {
    if (proc.pid != null) spawned.delete(proc.pid);
    byPitrixId.delete(pitrixId);
  });
  proc.on("error", () => {
    /* spawn failed — liveness sweep will report it */
  });

  return sp;
}

/** Start the PID-death watcher. Replaces startHerdrListener: no socket, just
 *  a periodic `kill(pid,0)` sweep over tracked ids (catches externally-killed
 *  or crashed crew) plus the direct `proc.on("exit")` hooks installed at
 *  spawn. On death we inject the same urgent "crew died" steer. */
export function startProcWatcher(pi: ExtensionAPI): ProcWatcherHandle {
  const tracked = new Set<string>();
  const deadReported = new Set<string>();
  let stopped = false;

  function reportDeath(pitrixId: string, pid: number) {
    if (deadReported.has(pitrixId)) return;
    deadReported.add(pitrixId);
    pi.sendUserMessage(
      `[pitrix-system] Crew process ${pitrixId} (pid ${pid}) exited or died. Its scrollback is at .pnh/pnh-threads/${pitrixId}/output.log — read it via pnh_pane_read("${pitrixId}") to see why.`,
      { deliverAs: "steer" },
    );
  }

  const sweep = setInterval(() => {
    if (stopped) return;
    for (const id of tracked) {
      const pid = byPitrixId.get(id) ?? pidFromState(process.cwd(), id);
      if (pid == null) continue;
      const sp = spawned.get(pid);
      const age = sp ? Date.now() - sp.startedAt : Infinity;
      if (age < STARTUP_GRACE_MS) continue;
      if (!isPidAlive(pid)) reportDeath(id, pid);
    }
  }, SWEEP_MS);
  sweep.unref();

  const handle: ProcWatcherHandle = {
    stop: () => {
      stopped = true;
      clearInterval(sweep);
    },
    trackPane: id => tracked.add(id),
    untrackPane: id => tracked.delete(id),
    trackedPaneCount: () => tracked.size,
  };
  activeHandle = handle;
  return handle;
}

/** Kill a worker by pid: SIGTERM the process group (detached → own group). */
export function killWorkerProc(pid: number): boolean {
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

/** Look up a spawned proc by pitrix id (this session's children). */
export function spawnedById(pitrixId: string): SpawnedProc | undefined {
  const pid = byPitrixId.get(pitrixId);
  return pid != null ? spawned.get(pid) : undefined;
}

/** Kill every worker this coordinator spawned. Called on coordinator
 *  shutdown — closing our stdin pipes also ends them, this is belt-and-braces. */
export function killAllSpawned(): void {
  for (const sp of spawned.values()) {
    try {
      process.kill(-sp.pid, "SIGTERM");
    } catch {
      try {
        process.kill(sp.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
  spawned.clear();
  byPitrixId.clear();
}
