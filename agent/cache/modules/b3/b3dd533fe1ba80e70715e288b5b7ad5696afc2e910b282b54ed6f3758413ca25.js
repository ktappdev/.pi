import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/roles.ts";
export const ROLE_EMOJI = {
    coordinator: "🧭",
    builder: "🔨",
    reviewer: "🛡️",
    scout: "🔍",
    explorer: "🔍",
    designer: "🎨",
    tester: "🧪"
};
export function roleEmoji(role) {
    if (!role) return "👷";
    return ROLE_EMOJI[role] ?? "👷";
}
