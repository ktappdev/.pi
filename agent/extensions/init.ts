import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

type StackDetection = {
	projectName: string;
	stack: string[];
	packageManager: string | null;
	keyDirectories: string[];
	notes: string[];
};

const AGENTS_FILE = "AGENTS.md";
const MAX_DIR_SCAN = 40;
const IGNORED_ENTRIES = new Set([
	".git",
	".idea",
	".next",
	".nuxt",
	".turbo",
	".vite",
	"coverage",
	"build",
	"dist",
	"node_modules",
	"out",
	"target",
]);

async function safeReadJson<T>(filePath: string): Promise<T | null> {
	try {
		const text = await fs.readFile(filePath, "utf8");
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function pushUnique(items: string[], value: string | null | undefined): void {
	if (!value) return;
	if (!items.includes(value)) items.push(value);
}

function describeDirectory(name: string): string {
	const descriptions: Record<string, string> = {
		app: "application entrypoints or routes",
		apps: "multiple app entrypoints or workspaces",
		api: "API handlers or server endpoints",
		components: "reusable UI components",
		desktop: "desktop-specific application code",
		docs: "project documentation",
		e2e: "end-to-end tests",
		electron: "Electron desktop shell code",
		frontend: "client-side UI code",
		lib: "shared libraries or helpers",
		packages: "workspace packages",
		server: "backend or server runtime code",
		src: "main source code",
		tauri: "Tauri desktop configuration or Rust glue",
		test: "tests",
		tests: "tests",
		"__tests__": "tests",
	};

	return descriptions[name] ?? "project code";
}

function detectPackageManager(entries: string[]): string | null {
	if (entries.includes("pnpm-lock.yaml")) return "pnpm";
	if (entries.includes("yarn.lock")) return "yarn";
	if (entries.includes("bun.lock") || entries.includes("bun.lockb")) return "bun";
	if (entries.includes("package-lock.json")) return "npm";
	return null;
}

function detectFromPackageJson(pkg: any, stack: string[], notes: string[]): void {
	const deps = {
		...(pkg?.dependencies ?? {}),
		...(pkg?.devDependencies ?? {}),
	};
	const hasDep = (name: string) => Boolean(deps[name]);

	pushUnique(stack, "Node.js");
	if (hasDep("typescript") || pkg?.type === "module") pushUnique(stack, "TypeScript/ESM");
	if (hasDep("react")) pushUnique(stack, "React");
	if (hasDep("next")) pushUnique(stack, "Next.js");
	if (hasDep("vite")) pushUnique(stack, "Vite");
	if (hasDep("astro")) pushUnique(stack, "Astro");
	if (hasDep("vue")) pushUnique(stack, "Vue");
	if (hasDep("svelte") || hasDep("@sveltejs/kit")) pushUnique(stack, "Svelte");
	if (hasDep("solid-js")) pushUnique(stack, "Solid");
	if (hasDep("electron")) pushUnique(stack, "Electron desktop app");
	if (hasDep("react-native") || hasDep("expo")) pushUnique(stack, "React Native");
	if (hasDep("tauri") || hasDep("@tauri-apps/api")) pushUnique(stack, "Tauri desktop app");
	if (hasDep("playwright")) pushUnique(stack, "Playwright");
	if (hasDep("vitest")) pushUnique(stack, "Vitest");
	if (hasDep("jest")) pushUnique(stack, "Jest");

	const scripts = pkg?.scripts ?? {};
	if (typeof scripts.dev === "string") pushUnique(notes, `Dev script: ${scripts.dev}`);
	if (typeof scripts.build === "string") pushUnique(notes, `Build script: ${scripts.build}`);
	if (typeof scripts.test === "string") pushUnique(notes, `Test script: ${scripts.test}`);
}

async function detectStack(cwd: string): Promise<StackDetection> {
	const allEntries = (await fs.readdir(cwd)).sort();
	const visibleEntries = allEntries.filter((entry) => !IGNORED_ENTRIES.has(entry)).slice(0, MAX_DIR_SCAN);
	const stack: string[] = [];
	const notes: string[] = [];
	const packageManager = detectPackageManager(allEntries);
	const packageJson = await safeReadJson<any>(path.join(cwd, "package.json"));

	if (packageJson) {
		detectFromPackageJson(packageJson, stack, notes);
	}

	if (await pathExists(path.join(cwd, "tsconfig.json"))) pushUnique(stack, "TypeScript");
	if (await pathExists(path.join(cwd, "Cargo.toml"))) pushUnique(stack, "Rust");
	if (await pathExists(path.join(cwd, "pyproject.toml"))) pushUnique(stack, "Python");
	if (await pathExists(path.join(cwd, "go.mod"))) pushUnique(stack, "Go");
	if (await pathExists(path.join(cwd, "composer.json"))) pushUnique(stack, "PHP");
	if (await pathExists(path.join(cwd, "flake.nix"))) pushUnique(notes, "Uses Nix for environment setup");
	if (allEntries.includes("src-tauri")) pushUnique(stack, "Tauri desktop app");
	if (allEntries.includes("app") && !stack.includes("Next.js")) pushUnique(notes, "Has an app/ directory; verify routing/framework conventions");
	if (packageManager) pushUnique(notes, `Package manager: ${packageManager}`);

	const keyDirectories = visibleEntries.filter((entry) => {
		if (entry.startsWith(".")) return false;
		const fullPath = path.join(cwd, entry);
		return existsSync(fullPath) && !IGNORED_ENTRIES.has(entry);
	});

	return {
		projectName: packageJson?.name || path.basename(cwd),
		stack,
		packageManager,
		keyDirectories,
		notes,
	};
}

function formatProjectSnapshot(detection: StackDetection): string[] {
	const lines = [`- Project: ${detection.projectName}`];
	lines.push(`- Stack: ${detection.stack.length > 0 ? detection.stack.join(", ") : "Not confidently detected yet"}`);
	if (detection.packageManager) lines.push(`- Package manager: ${detection.packageManager}`);

	const priorityDirs = detection.keyDirectories.filter((entry) => {
		const fullPath = entry.toLowerCase();
		return ["src", "app", "components", "lib", "packages", "apps", "server", "api", "desktop", "electron", "tauri", "docs", "test", "tests", "e2e"].includes(fullPath);
	});

	if (priorityDirs.length > 0) {
		lines.push(`- Key directories: ${priorityDirs.map((dir) => `\`${dir}/\``).join(", ")}`);
	}

	return lines;
}

function formatStructureSection(detection: StackDetection): string {
	const priorityDirs = detection.keyDirectories.filter((entry) => {
		const fullPath = entry.toLowerCase();
		return ["src", "app", "components", "lib", "packages", "apps", "server", "api", "desktop", "electron", "tauri", "docs", "test", "tests", "__tests__", "e2e", "frontend", "backend"].includes(fullPath);
	});

	if (priorityDirs.length === 0) {
		return "- Keep this section updated with the most important source and test directories.\n";
	}

	return `${priorityDirs.map((dir) => `- \`${dir}/\` — ${describeDirectory(dir.toLowerCase())}`).join("\n")}\n`;
}

function buildAgentsContent(detection: StackDetection): string {
	const snapshot = formatProjectSnapshot(detection).join("\n");
	const notes = detection.notes.length > 0
		? `${detection.notes.map((note) => `- ${note}`).join("\n")}\n`
		: "- Add project-specific commands, architecture notes, or environment gotchas here as they become clear.\n";

	return `# AGENTS.md

## Project Snapshot
${snapshot}

## Working Preferences
- Prefer small, focused components and modules over giant files.
- Avoid files growing past roughly 300-400 lines when a clean split is reasonable.
- Optimize for readability and maintainability so the code stays easy to understand later.
- Keep context files concise and only add guidance that will actually help future agent sessions.
- For JavaScript or TypeScript changes, \`npx tsc --noEmit\` is an acceptable validation step.
- Never run the project automatically; ask the user to run it when runtime verification is needed.

## Project Structure
${formatStructureSection(detection)}
## Notes For Future Agents
${notes}- If this file already exists, preserve user-authored guidance and extend it sparingly.
- Update this file when the stack, workflow, or important project conventions materially change.
`;
}

export default function initExtension(pi: ExtensionAPI): void {
	pi.registerCommand("init", {
		description: "Create a concise AGENTS.md for the current project if one does not already exist",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const agentsPath = path.join(cwd, AGENTS_FILE);

			if (await pathExists(agentsPath)) {
				ctx.ui.notify(`Init skipped: ${AGENTS_FILE} already exists at ${agentsPath}`, "info");
				return;
			}

			const detection = await detectStack(cwd);
			const content = buildAgentsContent(detection);
			await fs.writeFile(agentsPath, content, { encoding: "utf8", flag: "wx" });

			const summary = [
				`Created ${agentsPath}`,
				`Detected stack: ${detection.stack.length > 0 ? detection.stack.join(", ") : "generic project"}`,
			].join("\n");

			ctx.ui.notify(summary, "success");
		},
	});
}
