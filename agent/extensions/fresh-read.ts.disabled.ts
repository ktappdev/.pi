/** Fresh Read Guard Extension */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fs = require("fs/promises");
const path = require("path");

interface FileRecord {
  lastRead: number;
  lastEdit: number | null;
  mtime: number;
}

interface FreshReadConfig {
  enabled: boolean;
  autoReread: boolean;
  protectedPaths: string[];
  ignoredPaths: string[];
}

interface ToolPathInput {
  path?: unknown;
  multi?: unknown;
  patch?: unknown;
}

export default function (pi: ExtensionAPI) {
  let fileMap: Map<string, FileRecord> | null = null;
  const reReadInProgress = new Set<string>();
  const editLocks = new Set<string>();
  let config: FreshReadConfig = {
    enabled: true,
    autoReread: true,
    protectedPaths: [],
    ignoredPaths: [],
  };

  async function loadConfig(): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      console.log("[fresh-read] HOME not set, using default configuration");
      return;
    }

    const configPath = path.join(homeDir, ".pi/agent/extensions/fresh-read.config.json");

    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      const loaded = JSON.parse(configContent);
      config = { ...config, ...loaded };
      console.log("[fresh-read] Configuration loaded from", configPath);
    } catch (error) {
      console.log("[fresh-read] Using default configuration");
    }
  }

  function shouldIgnore(filePath: string): boolean {
    if (config.ignoredPaths.length === 0) return false;
    
    for (const pattern of config.ignoredPaths) {
      if (pattern.startsWith("**/")) {
        const suffix = pattern.slice(3);
        if (filePath.endsWith(suffix)) return true;
      } else if (pattern.endsWith("/**")) {
        const prefix = pattern.slice(0, -3);
        if (filePath.startsWith(prefix)) return true;
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }

  function resolvePath(inputPath: string, cwd: string): string {
    const resolved = path.isAbsolute(inputPath) 
      ? inputPath 
      : path.join(cwd, inputPath);
    return path.normalize(resolved);
  }

  function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths)];
  }

  function extractPatchPaths(patchText: string, cwd: string): string[] {
    const paths: string[] = [];
    const prefixes = ["*** Add File: ", "*** Delete File: ", "*** Update File: "];
    const lines = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const prefix = prefixes.find((candidate) => line.startsWith(candidate));
      if (!prefix) continue;

      const patchPath = line.slice(prefix.length).trim();
      if (!patchPath) continue;
      paths.push(resolvePath(patchPath, cwd));
    }

    return uniquePaths(paths);
  }

  function extractTargetPaths(
    toolName: string,
    input: ToolPathInput | undefined,
    cwd: string
  ): string[] {
    if (!input || typeof input !== "object") {
      return [];
    }

    const paths: string[] = [];

    if (typeof input.path === "string" && input.path.trim()) {
      paths.push(resolvePath(input.path, cwd));
    }

    if (toolName !== "edit") {
      return uniquePaths(paths);
    }

    if (Array.isArray(input.multi)) {
      for (const item of input.multi) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.path === "string" && item.path.trim()) {
          paths.push(resolvePath(item.path, cwd));
        }
      }
    }

    if (typeof input.patch === "string" && input.patch.trim()) {
      paths.push(...extractPatchPaths(input.patch, cwd));
    }

    return uniquePaths(paths);
  }

  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function isFileStale(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<boolean> {
    const record = map.get(filePath);
    
    if (!record) {
      return true;
    }

    try {
      const stats = await fs.stat(filePath);
      const currentMtime = stats.mtimeMs;
      
      return currentMtime > record.mtime + 1;
    } catch (error) {
      console.log(`[fresh-read] Cannot stat ${filePath}, treating as stale`);
      return true;
    }
  }

  async function recordRead(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const mtime = stats.mtimeMs;
      
      map.set(filePath, {
        lastRead: Date.now(),
        lastEdit: map.get(filePath)?.lastEdit ?? null,
        mtime,
      });
    } catch (error) {
      console.log(`[fresh-read] Failed to record read for ${filePath}:`, error);
    }
  }

  async function recordEdit(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<void> {
    const now = Date.now();

    try {
      const stats = await fs.stat(filePath);
      map.set(filePath, {
        lastRead: now,
        lastEdit: now,
        mtime: stats.mtimeMs,
      });
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        map.delete(filePath);
        return;
      }

      console.log(`[fresh-read] Failed to record edit for ${filePath}:`, error);
    }
  }

  async function init(): Promise<void> {
    await loadConfig();
    console.log("[fresh-read] Extension initialized");
  }

  pi.on("session_start", async (_event, ctx) => {
    fileMap = new Map();
    reReadInProgress.clear();
    console.log("[fresh-read] Session started, file tracking initialized");
  });

  pi.on("session_end", async () => {
    fileMap = null;
    reReadInProgress.clear();
    editLocks.clear();
    console.log("[fresh-read] Session ended, file tracking cleared");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!config.enabled) return;
    if (!fileMap) return;

    const { toolName, input } = event;

    if (toolName !== "edit" && toolName !== "write") {
      return;
    }

    const filePaths = extractTargetPaths(toolName, input, ctx.sessionManager.cwd);
    if (filePaths.length === 0) {
      console.log("[fresh-read] No trackable file paths in tool input, skipping");
      return;
    }

    const trackedPaths: string[] = [];
    for (const filePath of filePaths) {
      if (shouldIgnore(filePath)) {
        console.log(`[fresh-read] ${filePath} is in ignored paths, skipping`);
        continue;
      }

      const exists = await fileExists(filePath);
      if (!exists) {
        console.log(`[fresh-read] ${filePath} does not exist, skipping freshness check`);
        continue;
      }

      trackedPaths.push(filePath);
    }

    if (trackedPaths.length === 0) {
      return;
    }

    for (const filePath of trackedPaths) {
      if (editLocks.has(filePath)) {
        console.log(`[fresh-read] ${filePath} is locked by another edit, blocking`);
        return { block: true, reason: "Another edit operation in progress for this file" };
      }
    }

    const stalePaths: string[] = [];
    for (const filePath of trackedPaths) {
      if (await isFileStale(filePath, fileMap)) {
        stalePaths.push(filePath);
      }
    }

    if (stalePaths.length > 0) {
      const fileLabel = stalePaths.length === 1 ? "File was" : "Files were";
      const statusLabel = stalePaths.length === 1 ? "file" : `${stalePaths.length} files`;
      console.log(`[fresh-read] ${stalePaths.join(", ")} ${stalePaths.length === 1 ? "is" : "are"} stale, blocking ${toolName}`);
      
      ctx.ui.notify(`${fileLabel} modified externally. Re-reading...`, "info");
      ctx.ui.setStatus(`🔄 Re-reading ${statusLabel}...`);

      if (config.autoReread) {
        if (stalePaths.some((filePath) => reReadInProgress.has(filePath))) {
          ctx.ui.setStatus("⚠️ Re-read loop detected, proceeding with edit");
          console.log(`[fresh-read] Re-read loop detected for ${stalePaths.join(", ")}`);
          return;
        }

        stalePaths.forEach((filePath) => reReadInProgress.add(filePath));

        try {
          if (typeof ctx.tools?.read !== 'function') {
            ctx.ui.notify("Auto re-read not supported in this Pi version", "error");
            return { block: true, reason: "Cannot auto re-read" };
          }

          for (const filePath of stalePaths) {
            await ctx.tools.read({ path: filePath });
            console.log(`[fresh-read] Re-read successful for ${filePath}`);
          }
          ctx.ui.notify("File re-read complete", "info");
        } catch (error) {
          ctx.ui.notify(`Failed to re-read ${statusLabel}`, "error");
          ctx.ui.setStatus("⚠️ Re-read failed");
          console.log(`[fresh-read] Re-read failed for ${stalePaths.join(", ")}:`, error);
        } finally {
          stalePaths.forEach((filePath) => reReadInProgress.delete(filePath));
          ctx.ui.setStatus("");
        }
      } else {
        ctx.ui.notify(`${fileLabel} modified. Please read ${statusLabel} again.`, "warning");
      }

      return {
        block: true,
        reason: `${fileLabel} modified externally. Re-read completed, please retry edit.`
      };
    }

    trackedPaths.forEach((filePath) => editLocks.add(filePath));
    console.log(`[fresh-read] ${trackedPaths.join(", ")} ${trackedPaths.length === 1 ? "is" : "are"} fresh, allowing ${toolName}`);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!config.enabled) return;
    if (!fileMap) return;

    const { toolName, input } = event;
    const filePaths = extractTargetPaths(toolName, input, ctx.sessionManager.cwd);

    if (filePaths.length === 0) {
      return;
    }

    if (toolName === "read") {
      if (!event.result?.success) return;

      for (const filePath of filePaths) {
        await recordRead(filePath, fileMap);
        console.log(`[fresh-read] Recorded read for ${filePath}`);
      }
      return;
    }

    if (toolName === "edit" || toolName === "write") {
      if (event.result?.success) {
        for (const filePath of filePaths) {
          await recordEdit(filePath, fileMap);
        }
      }

      for (const filePath of filePaths) {
        editLocks.delete(filePath);
      }

      console.log(
        `[fresh-read] ${event.result?.success ? "Recorded" : "Released lock after failed"} ${toolName} for ${filePaths.join(", ")}`
      );
    }
  });

  pi.registerCommand("fresh-read-status", {
    description: "Show fresh-read extension status and tracked files",
    handler: async (_args, ctx) => {
      if (!fileMap) {
        ctx.ui.notify("No active session", "warning");
        return;
      }

      const count = fileMap.size;
      const files = Array.from(fileMap.entries()).map(([path, record]) => {
        const age = Date.now() - record.lastRead;
        const ageSec = Math.round(age / 1000);
        return `• ${path} (read ${ageSec}s ago)`;
      }).join("\n");

      const message = `**Fresh Read Status**\n\n` +
        `Tracking ${count} file(s)\n\n` +
        (files || "No files tracked yet");

      ctx.ui.notify(message, "info");
    },
  });

  pi.registerCommand("fresh-read-clear", {
    description: "Clear fresh-read file tracking for current session",
    handler: async (_args, ctx) => {
      if (!fileMap) {
        ctx.ui.notify("No active session", "warning");
        return;
      }

      fileMap.clear();
      reReadInProgress.clear();
      editLocks.clear();
      ctx.ui.notify("Fresh read tracking cleared", "info");
      console.log("[fresh-read] Tracking cleared via command");
    },
  });

  init();
}
