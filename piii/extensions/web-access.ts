/**
 * Load pi-web-access tools for piii
 * 
 * Provides: web_search, code_search, fetch_content, get_search_content
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import webAccess from "/opt/homebrew/lib/node_modules/pi-web-access/index.ts";

export default function(pi: ExtensionAPI) {
	// Load pi-web-access extension (registers tools)
	webAccess(pi);
	
	// Add web_search tools to active tool set
	pi.on("session_start", async (_event, ctx) => {
		const active = ctx.sessionManager.getActiveTools?.() ?? [];
		const webTools = ["web_search", "code_search", "fetch_content", "get_search_content"];
		const toAdd = webTools.filter(t => !active.includes(t));
		if (toAdd.length > 0) {
			pi.setActiveTools([...active, ...toAdd]);
		}
	});
}
