/**
 * Load pi-web-access tools for piii
 * 
 * Provides: web_search, code_search, fetch_content, get_search_content
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function(pi: ExtensionAPI) {
	// Try to load pi-web-access from common locations
	let webAccess: ((pi: ExtensionAPI) => void) | undefined;
	
	try {
		// macOS Homebrew
		webAccess = await import("/opt/homebrew/lib/node_modules/pi-web-access/index.ts");
	} catch {
		try {
			// Linux/global npm
			webAccess = await import("pi-web-access");
		} catch {
			try {
				// Fallback: try node_modules resolution
				webAccess = await import("pi-web-access/index.ts");
			} catch {
				console.warn("pi-web-access not found - web search tools unavailable");
				return;
			}
		}
	}
	
	if (webAccess) {
		// Load pi-web-access extension (registers tools)
		webAccess.default(pi);
		
		// Add web_search tools to active tool set
		pi.on("session_start", async (_event, ctx) => {
			const active = (ctx as any).sessionManager.getActiveTools?.() ?? [];
			const webTools = ["web_search", "code_search", "fetch_content", "get_search_content"];
			const toAdd = webTools.filter((t: string) => !active.includes(t));
			if (toAdd.length > 0) {
				pi.setActiveTools([...active, ...toAdd]);
			}
		});
	}
}
