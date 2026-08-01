import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/time.ts";
import { DEFAULT_OBLIGATION_DEADLINE_MS } from "./types";
export function nowIso() {
    return new Date().toISOString();
}
export function deadlineFromSeconds(seconds) {
    const ms = (seconds ?? DEFAULT_OBLIGATION_DEADLINE_MS / 1000) * 1000;
    return new Date(Date.now() + ms).toISOString();
}
