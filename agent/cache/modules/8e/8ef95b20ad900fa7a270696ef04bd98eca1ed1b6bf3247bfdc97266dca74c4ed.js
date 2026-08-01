import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/tools/index.ts";
import { registerIntrospectionTools } from "./introspection";
import { registerMessagingTools } from "./messaging";
import { registerControlTools } from "./control";
export function registerTools(pi, store, inbox) {
    registerIntrospectionTools(pi, store);
    registerMessagingTools(pi, store, inbox);
    registerControlTools(pi, store, inbox);
}
