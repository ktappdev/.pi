import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPitrixStore } from "./state";
import { createInbox } from "./inbox";
import { registerLifecycle } from "./lifecycle";
import { registerTools } from "./tools/index";
import { registerCommands } from "./commands";
import { createConfiguredAdapter } from "./adapter/registry";

/** Extension entry point: register the CLI flags, build the configured
 *  storage adapter → store → inbox stack, and attach the three surfaces
 *  (lifecycle hooks, model-facing tools, human-facing slash commands). */
export default function (pi: ExtensionAPI) {
  pi.registerFlag("pnh-id", {
    type: "string",
    description: "Stable id for this pitrix, used for cross-pitrix addressing (e.g. pitrix-b)",
  });
  pi.registerFlag("pnh", {
    type: "boolean",
    description:
      "Shorthand for --pnh-id coordinator. Use when you want the default coordinator role.",
  });
  pi.registerFlag("pnh-parent", {
    type: "string",
    description: "Parent pitrix id, for Blocker escalation",
  });
  pi.registerFlag("pnh-role", {
    type: "string",
    description:
      "Role label for this pitrix (e.g. dev, qa) — targetable via pnh_send role:<role>",
  });
  pi.registerFlag("pnh-journal", {
    type: "string",
    description:
      'Journal cadence: "turn", "done" (default, one entry per run at agent_end), or "off". Overrides .pnh/pnh-models.json "journal-cadence" key.',
  });
  pi.registerFlag("pnh-journal-model", {
    type: "string",
    description:
      'Model for journal fork entries (e.g. deepseek/deepseek-chat). Overrides .pnh/pnh-models.json "journal" key. Default: the pitrix\'s own model — a pinned model must resolve on this machine or journaling fails.',
  });
  pi.registerFlag("pnh-storage", {
    type: "string",
    description: 'Storage backend — herdr-less build only supports "local" (the file mailbox)',
  });
  pi.registerFlag("pnh-storage-url", {
    type: "string",
    description: "Unused — the herdr-less build only has the local file-mailbox backend",
  });
  pi.registerFlag("pnh-theme", {
    type: "string",
    description:
      "Theme override (default: matrix). Pass a theme name or path to .json file.",
  });

  const adapter = createConfiguredAdapter(pi);
  const store = createPitrixStore(pi, adapter);
  const inbox = createInbox(store, pi);

  registerLifecycle(pi, store, inbox);
  registerTools(pi, store, inbox);
  registerCommands(pi, store, inbox);
}
