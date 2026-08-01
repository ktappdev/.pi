import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/thread-ops.ts";
export async function suspendThread(store, reason, ctx) {
    store.holdReason = reason;
    await store.transition("on-hold", ctx);
}
export async function resumeThread(store, drain, ctx) {
    if (store.state !== "on-hold") return false;
    store.holdReason = null;
    await store.transition("open", ctx);
    await drain();
    return true;
}
