import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { err, isValidPaneId } from "./shared";

/** Read a worker's pi output (scrollback). Herdr-less: the worker's `script`
 *  pty appends everything it renders to `.pnh/pnh-threads/<id>/output.log`,
 *  so "reading the pane" is tailing that file. Use for silent worker
 *  recovery — when a worker owes a reply but hasn't sent one via
 *  pnh_send, read its output to find a plain-text answer the worker
 *  wrote instead of sending through the protocol. */
export function registerPaneReadTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pnh_pane_read",
    label: "Read Worker Output",
    description:
      "Read a worker's terminal output (scrollback). The pane_id is the worker's pitrix_id — its output is in .pnh/pnh-threads/<id>/output.log. Use for silent worker recovery, blocked workers, or error output.",
    promptSnippet:
      "Read a worker's output.log — silent worker recovery, inspect blocked/stuck workers.",
    parameters: Type.Object({
      pane_id: Type.String({
        description:
          "Worker pitrix_id to read (e.g. 'tank', 'keymaker-1'). Get from pnh_panes() or pnh_spawn_worker return.",
      }),
      lines: Type.Optional(
        Type.Number({
          description: "Number of lines to read from the end of the log. Default: 80.",
        }),
      ),
      source: Type.Optional(
        Type.String({
          description:
            "Accepted for call-compat with the herdr build; ignored — output.log is a linear transcript.",
        }),
      ),
      format: Type.Optional(
        Type.String({
          description:
            "'text' (default) or 'ansi' (keeps raw escape codes — the pty log already contains them).",
        }),
      ),
    }),
    async execute(_id, params) {
      const pitrixId = (params.pane_id || "").trim();
      if (!pitrixId) {
        return err("pane_id (worker pitrix_id) is required — get it from pnh_panes() or pnh_spawn_worker.");
      }
      if (!isValidPaneId(pitrixId)) {
        return err(`Invalid pane_id "${pitrixId}" — expected a pitrix id like tank or keymaker-1.`);
      }

      // Safety: don't read our own output (the coordinator's log isn't a
      // worker's and would just be noise).
      const myId = process.env.PNH_SELF_ID || "";
      if (pitrixId === myId) {
        return err(`pane_id ${pitrixId} is this coordinator — reading your own log is not useful.`);
      }

      const lines = params.lines ?? 80;
      if (lines < 1 || lines > 500) {
        return err(`lines must be between 1 and 500, got ${lines}.`);
      }

      const logPath = join(process.cwd(), ".pnh", "pnh-threads", pitrixId, "output.log");
      if (!existsSync(logPath)) {
        return err(
          `No output log for "${pitrixId}" at ${logPath}. It may not have been spawned yet, or it was spawned by a different cwd. Run pnh_panes() to see live workers.`,
        );
      }

      try {
        const raw = readFileSync(logPath, "utf8");
        const all = raw.split("\n");
        const tail = all.slice(-lines).join("\n");
        const size = statSync(logPath).size;
        return {
          content: [
            {
              type: "text" as const,
              text:
                tail.trim() ||
                `(output.log for ${pitrixId} is empty — the worker may still be booting)`,
            },
          ],
          details: {
            ok: true,
            pane_id: pitrixId,
            lines,
            bytes: raw.length,
            total_log_bytes: size,
            path: logPath,
          },
        };
      } catch (e) {
        return err(`pnh_pane_read failed: ${String(e)}`);
      }
    },
  });
}
