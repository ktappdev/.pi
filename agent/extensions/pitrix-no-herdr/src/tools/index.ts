import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PitrixStore } from "../core/types";
import type { Inbox } from "../inbox";
import { registerIntrospectionTools } from "./introspection";
import { registerMessagingTools } from "./messaging";
import { registerControlTools } from "./control";
import { registerSpawnTool } from "./spawn";
import { registerPurgeTool } from "./purge";
import { registerCleanupPanesTool } from "./cleanup-panes";
import { registerPanesTool } from "./panes";
import { registerPaneReadTool } from "./pane-read";

/** The model-facing pnh_* tools. Protocol/mailbox tools (send, wait, status,
 *  list, journal, suspend, resume, purge) are pure filesystem. The process
 *  tools (spawn_worker, panes, cleanup_panes, pane_read) are the herdr-less
 *  replacement for pane management — plain detached pi children. */

export function registerTools(pi: ExtensionAPI, store: PitrixStore, inbox: Inbox) {
  registerIntrospectionTools(pi, store);
  registerMessagingTools(pi, store, inbox);
  registerControlTools(pi, store, inbox);
  registerSpawnTool(pi, store);
  registerPurgeTool(pi, store);
  registerCleanupPanesTool(pi, store);
  registerPanesTool(pi);
  registerPaneReadTool(pi);
}
