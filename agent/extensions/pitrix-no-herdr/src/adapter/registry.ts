import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLocalFsAdapter } from "./local-fs";
import type { PitrixAdapter } from "./types";

export interface AdapterOptions {
  /** Backend-specific connection target, e.g. a Restate ingress URL. */
  url?: string;
}

export type AdapterFactory = (opts: AdapterOptions) => PitrixAdapter;

/** Backend registry. The herdr-less build drops the Restate backend — the
 *  file mailbox is the only substrate. */
export const adapterRegistry: Record<string, AdapterFactory> = {
  local: () => createLocalFsAdapter(),
};

/** Resolve the configured backend. Herdr-less always uses local fs. */
export function createConfiguredAdapter(pi: ExtensionAPI): PitrixAdapter {
  const name = pi.getFlag("pnh-storage");
  const backend = typeof name === "string" && name ? name : "local";
  if (backend !== "local") {
    // herdr-less build dropped restate; fail loudly rather than silently
    // booting the wrong adapter.
    throw new Error(
      `--pnh-storage "${backend}" is not supported in the herdr-less build. Only "local" (the file mailbox) is available.`,
    );
  }
  return adapterRegistry.local({});
}
