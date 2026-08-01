import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/adapter/registry.ts";
import { createLocalFsAdapter } from "./local-fs";
import { createRestateAdapter } from "../restate/adapter";
export const adapterRegistry = {
    local: ()=>createLocalFsAdapter(),
    restate: (opts)=>createRestateAdapter(opts)
};
export function createConfiguredAdapter(pi) {
    const name = pi.getFlag("thread-storage");
    const backend = typeof name === "string" && name ? name : "local";
    const factory = adapterRegistry[backend];
    if (!factory) {
        const known = Object.keys(adapterRegistry).join(", ");
        throw new Error(`Unknown --thread-storage "${backend}". Known backends: ${known}.`);
    }
    const url = pi.getFlag("thread-storage-url");
    return factory({
        url: typeof url === "string" && url ? url : undefined
    });
}
