import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/lifecycle.ts";
import { threadModelPrompt } from "./core/system-prompt";
import { journalMode, shouldJournal } from "./journal";
import { roleEmoji } from "./core/roles";
import * as path from "node:path";
import { basename } from "node:path";
function restingState(store, whenFree) {
    if (store.state === "on-hold") return "on-hold";
    return whenFree;
}
function hasThreadIdentity(ctx) {
    try {
        for (const e of ctx.sessionManager.getEntries()){
            if (e.type === "custom" && e.customType === "thread-identity") return true;
        }
    } catch  {}
    return false;
}
export function registerLifecycle(pi, store, inbox) {
    let toolUsedThisTurn = false;
    let active = false;
    pi.on("session_start", async (_event, ctx)=>{
        const flagId = pi.getFlag("thread-id");
        active = (typeof flagId === "string" && flagId.length > 0) || hasThreadIdentity(ctx);
        if (!active) {
            pi.setActiveTools(pi.getActiveTools().filter((name)=>!name.startsWith("thread_")));
            return;
        }
        try {
            await store.init(ctx.cwd, ctx);
        } catch (e) {
            if (e instanceof Error) {
                ctx.ui.notify(e.message, "error");
                ctx.shutdown();
                return;
            }
            ctx.ui.notify(String(e), "error");
            ctx.shutdown();
            return;
        }
        if (store.role === "coordinator" && process.env.HERDR_ENV !== "1") {
            ctx.ui.notify("Coordinator must run inside herdr (HERDR_ENV=1). Shutting down.", "error");
            ctx.shutdown();
            return;
        }
        if (store.role === "coordinator") {
            console.log(`[thread] Coordinator started. Models config: ${path.join(ctx.cwd, ".thread", "models.json")}`);
        }
        ctx.ui.setTitle(`pi · ${roleEmoji(store.role)} ${store.role ?? "worker"} · ${basename(ctx.cwd)}`);
        const READ_ONLY_ROLES = new Set([
            "coordinator",
            "reviewer",
            "scout",
            "designer"
        ]);
        if (READ_ONLY_ROLES.has(store.role)) {
            const active = pi.getActiveTools();
            const ALLOWED = new Set([
                "read",
                "bash",
                "thread_send",
                "thread_wait",
                "thread_list",
                "thread_status",
                "thread_journal",
                "thread_suspend",
                "thread_resume"
            ]);
            const filtered = active.filter((name)=>ALLOWED.has(name));
            pi.setActiveTools(filtered);
            console.log(`[thread] ${store.role} mode: restricted to ${filtered.length} tools (${filtered.join(", ")})`);
        }
        setImmediate(()=>void inbox.drainInbox(ctx));
        store.startWatcher(inbox.drainInbox, ctx);
        store.startHeartbeat(async ()=>{
            const parts = [];
            await inbox.drainInbox(ctx, parts);
            await inbox.checkDeadlines(ctx, parts);
            inbox.inject(parts, ctx);
            await inbox.finalizeDrain();
        });
    });
    pi.on("session_before_compact", async ()=>{
        if (active) inbox.noteCompactionStart();
    });
    pi.on("session_compact", async (_event, ctx)=>{
        if (!active) return;
        inbox.noteCompactionEnd();
        await inbox.drainInbox(ctx);
    });
    pi.on("session_shutdown", async (event)=>{
        if (active) await store.shutdown(event.reason);
    });
    pi.on("turn_start", async (_event, ctx)=>{
        if (!active) return;
        inbox.noteRunStarted();
        const wasOnHold = store.state === "on-hold";
        toolUsedThisTurn = false;
        await store.transition("thinking", ctx);
        if (wasOnHold) {
            store.holdReason = null;
            await store.persist();
            await inbox.drainInbox(ctx);
        }
    });
    pi.on("tool_execution_start", async (_event, ctx)=>{
        if (!active) return;
        toolUsedThisTurn = true;
        await store.transition("working", ctx);
    });
    pi.on("turn_end", async (_event, ctx)=>{
        if (!active) return;
        await store.transition(restingState(store, "open"), ctx);
        if (toolUsedThisTurn) {
            store.owedSilentStreak = 0;
            store.owedNudgePending = false;
        } else if (store.owed.length > 0) {
            store.owedSilentStreak = Math.min(store.owedSilentStreak + 1, 3);
            if (!store.owedNudgePending) {
                store.owedNudgePending = true;
                const items = store.owed.map((o)=>`${o.from} (re #${o.id})`).join(", ");
                const escalation = store.owedSilentStreak >= 2 ? ` This is turn ${store.owedSilentStreak} with no reply — restating it as plain text is invisible to them.` : "";
                pi.sendMessage({
                    customType: "thread-owed-reminder",
                    content: `[thread-system] Automated reminder (not from the human): you still owe a reply to ${items}. Plain text reaches only the human — never them. Reply for real via thread_send with the re id.${escalation} Still working on it? Acknowledge with "Standing by". Missing information from the requester? Pass the ball: reply with what you need and expects=true.`,
                    display: true
                }, {
                    triggerTurn: false,
                    deliverAs: "nextTurn"
                });
            }
        }
        if (journalMode(pi) === "turn" && shouldJournal(store, toolUsedThisTurn, "turn")) {
            const sf = ctx.sessionManager.getSessionFile();
            if (sf) store.forkJournal(sf);
        }
        await inbox.drainInbox(ctx);
    });
    pi.on("agent_end", async (_event, ctx)=>{
        if (!active) return;
        await store.transition(restingState(store, "done"), ctx);
        store.owedNudgePending = false;
        const mode = journalMode(pi);
        const write = mode === "done" ? shouldJournal(store, toolUsedThisTurn, "done") : mode === "turn" && shouldJournal(store, toolUsedThisTurn, "run-end");
        if (write) {
            const sf = ctx.sessionManager.getSessionFile();
            if (sf) store.forkJournal(sf);
        }
        if (journalMode(pi) !== "off") {
            const sf = ctx.sessionManager.getSessionFile();
            if (sf) store.compactJournal(sf);
        }
        await inbox.drainInbox(ctx);
    });
    pi.on("before_agent_start", async (event)=>{
        if (!active) return;
        return {
            systemPrompt: event.systemPrompt + "\n\n" + threadModelPrompt(store)
        };
    });
}
