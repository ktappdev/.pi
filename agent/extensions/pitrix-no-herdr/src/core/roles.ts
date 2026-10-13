/** Map of role name to a single emoji used as a visual identifier in the
 *  TUI footer status and terminal title. The fallback is for generic workers
 *  and unknown roles — never blank, so a missing mapping still renders
 *  something recognizable. */
export const WORKER_ROLES = [
  "tank",
  "trinity",
  "neo",
  "dozer",
  "switch",
  "cypher",
  "oracle",
  "link",
  "keymaker",
  "merovingian",
] as const;

/** Coordinator aliases — Matrix character names that mean "coordinator".
 *  "morpheus" is the canonical Matrix name; "coordinator" kept for
 *  compatibility with the picode lineage. Both resolve to the same role. */
const COORDINATOR_ALIASES = new Set(["coordinator", "morpheus"]);

/** Normalize a pitrix-id to its canonical coordinator id. If the id is a
 *  known coordinator alias (morpheus, coordinator), returns "coordinator".
 *  Otherwise returns the id unchanged. */
export function normalizePitrixId(id: string): string {
  return COORDINATOR_ALIASES.has(id.toLowerCase()) ? "coordinator" : id;
}

/** Is this pitrix-id a coordinator (by alias)? */
export function isCoordinatorId(id: string): boolean {
  return COORDINATOR_ALIASES.has(id.toLowerCase());
}

/** Explorer is a legacy alias for scout/tank. Keep one canonical runtime role. */
export function detectWorkerRole(id: string): string {
  const normalized = id.toLowerCase();
  const role = WORKER_ROLES.find(
    candidate =>
      normalized === candidate ||
      normalized.startsWith(`${candidate}-`) ||
      normalized.startsWith(`${candidate}_`) ||
      normalized.startsWith(`${candidate}.`),
  );
  if (role) return role;
  // Legacy role aliases → pitrix roles
  if (
    normalized === "scout" ||
    normalized.startsWith("scout-") ||
    normalized.startsWith("scout_") ||
    normalized.startsWith("scout.")
  ) {
    return "tank";
  }
  if (
    normalized === "explorer" ||
    normalized.startsWith("explorer-") ||
    normalized.startsWith("explorer_") ||
    normalized.startsWith("explorer.")
  ) {
    return "tank";
  }
  if (
    normalized === "builder" ||
    normalized.startsWith("builder-") ||
    normalized.startsWith("builder_") ||
    normalized.startsWith("builder.")
  ) {
    return "keymaker";
  }
  return "worker";
}

export const ROLE_EMOJI: Record<string, string> = {
  coordinator: "🟢", // Morpheus — green pill
  tank: "🛰️", // Operator — maps the Matrix
  trinity: "🖤", // Web infiltration
  neo: "💊", // The One — exploitation
  dozer: "📡", // Signal interceptor
  switch: "🔓", // Password cracker
  cypher: "🚪", // Persistence — backdoors
  oracle: "🔮", // AD seer
  link: "⚙️", // Infrastructure engineer
  keymaker: "🔑", // Code developer
  merovingian: "🏛️", // Reverse engineering — oldest program
};

export function roleEmoji(role: string | null | undefined): string {
  if (!role) return "👤";
  return ROLE_EMOJI[role] ?? "👤";
}
