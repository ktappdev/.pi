import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/types.ts";
export const HEARTBEAT_MS = 20_000;
export const STALE_MS = 60_000;
export const PROCESSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_OBLIGATION_DEADLINE_MS = 15 * 60_000;
export const CLIENT_CAPABILITIES = [
    "urgency",
    "barriers",
    "deliverAfter",
    "expiresAt",
    "journal",
    "canary"
];
export function toSummary(s) {
    const stale = Date.now() - new Date(s.lastSeen).getTime() > STALE_MS;
    return {
        id: s.id,
        pid: s.pid,
        state: s.state,
        status: stale ? "stopped" : s.status,
        parent: s.parent,
        role: s.role ?? "worker",
        lastSeen: s.lastSeen,
        obligations: s.obligations?.length ?? 0,
        owed: s.owed?.length ?? 0,
        barriers: s.barriers?.length ?? 0
    };
}
