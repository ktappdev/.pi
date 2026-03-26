declare module "@mariozechner/pi-coding-agent" {
	export interface ExtensionCommandContext {
		cwd: string;
		ui: {
			notify(message: string, level: "info" | "success" | "warning" | "error"): void;
		};
	}

	export interface ExtensionAPI {
		registerCommand(
			name: string,
			config: {
				description?: string;
				handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>;
				getArgumentCompletions?: (prefix: string) => unknown;
			},
		): void;
	}
}
