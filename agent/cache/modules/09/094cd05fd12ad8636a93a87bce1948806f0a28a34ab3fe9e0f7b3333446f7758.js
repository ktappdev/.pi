import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/inbox.ts";
import { STALE_MS } from "./core/types";
import { mintEnvelopeId } from "./core/ids";
import { nowIso } from "./core/time";
export const INJECTION_GRACE_MS = 3_000;
export const COMPACTION_HOLD_MAX_MS = 180_000;
export function createInbox(store, pi) {
    let inFlightSince = null;
    let compactingSince = null;
    function canInject() {
        const now = Date.now();
        if (compactingSince !== null && now - compactingSince < COMPACTION_HOLD_MAX_MS) return false;
        if (inFlightSince !== null && now - inFlightSince < INJECTION_GRACE_MS) return false;
        return true;
    }
    function inject(parts, ctx) {
        if (parts.length === 0) return;
        const steer = parts.some((p)=>p.urgency === "high");
        if (ctx.isIdle?.() ?? false) inFlightSince = Date.now();
        pi.sendUserMessage(parts.map((p)=>p.text).join("\n\n"), {
            deliverAs: steer ? "steer" : "followUp"
        });
    }
    function noteCompactionStart() {
        compactingSince = Date.now();
    }
    function noteCompactionEnd() {
        compactingSince = null;
    }
    function noteRunStarted() {
        inFlightSince = null;
        compactingSince = null;
    }
    async function isTargetLive(to) {
        const s = await store.adapter.loadState(to);
        if (!s) return false;
        return s.status === "running" && Date.now() - new Date(s.lastSeen).getTime() < STALE_MS;
    }
    async function resolveTargets(to) {
        if (to !== "*" && !to.startsWith("role:") && !to.includes(",")) return [
            to
        ];
        const all = (await store.listThreads()).filter((t)=>t.id !== store.threadId);
        if (to === "*") return all.map((t)=>t.id);
        if (to.startsWith("role:")) {
            const role = to.slice(5);
            return all.filter((t)=>t.role === role).map((t)=>t.id);
        }
        return to.split(",").map((s)=>s.trim()).filter((s)=>s && s !== store.threadId);
    }
    async function sendEnvelope(to, body, opts = {}) {
        if (!store.threadId || !store.threadsRootDir) {
            throw new Error("Thread system not initialized yet — cannot send.");
        }
        const id = mintEnvelopeId(store.threadId);
        const msg = {
            id,
            from: store.threadId,
            to,
            body,
            sentAt: nowIso(),
            ...(opts.re ? {
                re: opts.re
            } : {}),
            ...(opts.expects ? {
                expects: true
            } : {}),
            ...(opts.urgency === "high" ? {
                urgency: "high"
            } : {}),
            ...(opts.deliverAfter ? {
                deliverAfter: opts.deliverAfter
            } : {}),
            ...(opts.expiresAt ? {
                expiresAt: opts.expiresAt
            } : {})
        };
        const delivered = (await isTargetLive(to)) ? "live" : "queued";
        await store.adapter.enqueueMessage(msg);
        if (opts.re) {
            const owedMatch = store.owed.find((o)=>o.id === opts.re);
            if (owedMatch && owedMatch.from === to) {
                store.owed = store.owed.filter((o)=>o.id !== opts.re);
                await store.persist();
            }
        }
        if (opts.expects) {
            const deadline = opts.deadline;
            store.obligations.push({
                id,
                to,
                summary: body.slice(0, 80),
                sentAt: msg.sentAt,
                deadline
            });
            await store.persist();
        }
        return {
            id,
            delivered
        };
    }
    async function sendToMany(targets, body, opts = {}) {
        const sent = [];
        for (const to of targets){
            sent.push({
                to,
                ...(await sendEnvelope(to, body, opts))
            });
        }
        return sent;
    }
    async function findMissingTargets(targets) {
        const missing = [];
        for (const t of targets){
            if (!(await store.threadExists(t))) missing.push(t);
        }
        return missing;
    }
    function resolveBarriers(re) {
        const remaining = [];
        const notes = [];
        const payloads = [];
        for (const b of store.barriers){
            if (!b.pending.includes(re)) {
                remaining.push(b);
                continue;
            }
            const pending = b.pending.filter((id)=>id !== re);
            const done = b.mode === "any" || pending.length === 0;
            if (done) {
                notes.push(`[barrier "${b.id}" resolved]: ${b.mode === "any" ? `first reply arrived (${re})` : "all awaited replies have arrived"}.`);
                if (b.message) payloads.push({
                    text: b.message,
                    urgency: "high"
                });
            } else {
                remaining.push({
                    ...b,
                    pending
                });
            }
        }
        store.barriers = remaining;
        return {
            notes,
            payloads
        };
    }
    function renderEnvelope(msg) {
        const kind = msg.expects && msg.re ? "reply+request" : msg.expects ? "request" : msg.re ? "reply" : "note";
        const reTag = msg.re ? ` re #${msg.re}` : "";
        const header = `[${kind} from ${msg.from} #${msg.id}${reTag}]`;
        const hint = msg.expects ? `\n(this expects a reply — send it with: thread_send to="${msg.from}" re="${msg.id}")` : "";
        return `${header}\n${msg.body}${hint}`;
    }
    async function deliver(msg, _ctx) {
        const parts = [];
        let barrierNotes = [];
        if (msg.re) {
            const obMatch = store.obligations.find((o)=>o.id === msg.re);
            if (!obMatch || obMatch.to === msg.from) {
                store.obligations = store.obligations.filter((o)=>o.id !== msg.re);
                const resolved = resolveBarriers(msg.re);
                barrierNotes = resolved.notes;
                parts.push(...resolved.payloads);
            }
        }
        if (msg.expects) {
            if (!store.owed.some((o)=>o.id === msg.id)) {
                store.owed.push({
                    id: msg.id,
                    from: msg.from,
                    summary: msg.body.slice(0, 80),
                    receivedAt: msg.sentAt
                });
            }
        }
        const extra = barrierNotes.length ? "\n\n" + barrierNotes.join("\n") : "";
        parts.push({
            text: renderEnvelope(msg) + extra,
            urgency: msg.urgency ?? "low"
        });
        await store.persist();
        return parts;
    }
    function emit(parts, ctx, collect) {
        if (collect) collect.push(...parts);
        else inject(parts, ctx);
    }
    async function drainInbox(ctx, collect) {
        if (store.state === "on-hold") return;
        if (!canInject()) return;
        const messages = await store.adapter.drainInbox(store.threadId);
        if (messages.length === 0) return;
        const parts = [];
        for (const msg of messages){
            parts.push(...(await deliver(msg, ctx)));
        }
        emit(parts, ctx, collect);
        if (!collect) await store.adapter.finalizeDrain(store.threadId);
    }
    async function checkDeadlines(ctx, collect) {
        if (!canInject()) return;
        const now = Date.now();
        const parts = [];
        for (const ob of store.obligations){
            if (!ob.deadline || ob.nudged || new Date(ob.deadline).getTime() > now) continue;
            ob.nudged = true;
            parts.push({
                text: `[obligation overdue #${ob.id}]: your request to ${ob.to} ("${ob.summary}") passed its deadline with no reply. Follow up with ${ob.to}${store.parent ? `, or escalate to ${store.parent}` : ""}.`,
                urgency: "high"
            });
        }
        for (const b of store.barriers){
            if (!b.deadline || b.nudged || new Date(b.deadline).getTime() > now) continue;
            b.nudged = true;
            parts.push({
                text: `[barrier overdue "${b.id}"]: still waiting on ${b.mode} of ${b.pending.length} repl${b.pending.length === 1 ? "y" : "ies"} (${b.pending.join(", ")}) — none arrived by the deadline. Check in with the target thread(s), or the barrier will keep waiting silently.`,
                urgency: "high"
            });
        }
        if (parts.length === 0) return;
        await store.persist();
        emit(parts, ctx, collect);
    }
    return {
        sendEnvelope,
        sendToMany,
        resolveTargets,
        findMissingTargets,
        deliver,
        drainInbox,
        isTargetLive,
        checkDeadlines,
        finalizeDrain: ()=>store.adapter.finalizeDrain(store.threadId),
        inject,
        canInject,
        noteCompactionStart,
        noteCompactionEnd,
        noteRunStarted
    };
}
