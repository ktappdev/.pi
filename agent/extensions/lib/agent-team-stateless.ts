/**
 * Agent Team Stateless Mode
 *
 * In-memory control over whether agents retain context across dispatches.
 * Stateless agents start fresh every dispatch — session file is deleted before
 * spawn and never saved after completion.
 *
 * Two layers:
 *  - Global mode: /agents-stateless-mode on|off — affects ALL agents
 *  - Per-agent set: /agents-stateless <name> — affects specific agents
 *
 * All state is in-memory; resets on Pi restart.
 */

const statelessAgents: Set<string> = new Set();
let statelessMode = false;

/** Check whether an agent should lose context on next dispatch */
export function isStateless(agentKey: string): boolean {
	return statelessMode || statelessAgents.has(agentKey);
}

/** Mark one or more agents as stateless */
export function markStateless(agentKey: string): void {
	statelessAgents.add(agentKey);
}

/** Remove an agent from the stateless set */
export function unmarkStateless(agentKey: string): void {
	statelessAgents.delete(agentKey);
}

/** Return all currently marked stateless agents */
export function listStateless(): string[] {
	return Array.from(statelessAgents);
}

/** Get global stateless mode state */
export function getStatelessMode(): boolean {
	return statelessMode;
}

/** Set global stateless mode */
export function setStatelessMode(on: boolean): void {
	statelessMode = on;
}
