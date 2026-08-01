import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/state.ts";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { HEARTBEAT_MS, CLIENT_CAPABILITIES } from "./core/types";
import { nowIso } from "./core/time";
import { forkJournalEntry, compactJournal as compactJournalFn } from "./journal";
import { roleEmoji } from "./core/roles";
import { createLocalFsAdapter } from "./adapter/local-fs";
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        if (e instanceof Error && (e).code === "ESRCH") {
            return false;
        }
        return true;
    }
}
const KNOWN_STATES = [
    "idle",
    "thinking",
    "working",
    "open",
    "on-hold",
    "stopped",
    "done"
];
export function createThreadStore(pi, adapter = createLocalFsAdapter()) {
    let heartbeat = null;
    let stopWatching = null;
    const store = {
        adapter,
        threadId: "",
        threadDir: "",
        threadsRootDir: "",
        parent: null,
        role: "worker",
        sessionFile: null,
        startedAt: "",
        state: "idle",
        status: "running",
        holdReason: null,
        obligations: [],
        owed: [],
        barriers: [],
        owedNudgePending: false,
        owedSilentStreak: 0,
        lastJournalSignature: null,
        lastJournalAt: 0,
        journalDebt: false,
        async transition (next, ctx) {
            store.state = next;
            await store.persist();
            ctx?.ui.setStatus("thread", `${roleEmoji(store.role)} ${store.role ?? "worker"}: ${store.state}`);
        },
        async persist () {
            if (!store.threadId) return;
            const payload = {
                id: store.threadId,
                pid: process.pid,
                cwd: process.cwd(),
                parent: store.parent,
                role: store.role,
                sessionFile: store.sessionFile,
                state: store.state,
                status: store.status,
                holdReason: store.holdReason,
                obligations: store.obligations,
                owed: store.owed,
                barriers: store.barriers,
                startedAt: store.startedAt,
                lastSeen: nowIso(),
                updatedAt: nowIso(),
                capabilities: [
                    ...CLIENT_CAPABILITIES
                ],
                ...(process.env.PI_THREAD_WAKE ? {
                    wake: process.env.PI_THREAD_WAKE
                } : {})
            };
            await store.adapter.saveState(store.threadId, payload);
        },
        async init (cwd, ctx) {
            await store.adapter.configure(cwd);
            store.threadsRootDir = path.join(cwd, ".thread", "threads");
            const flagId = pi.getFlag("thread-id");
            if (typeof flagId === "string" && flagId) {
                store.threadId = flagId;
            } else {
                let existingId;
                try {
                    const entries = ctx.sessionManager.getEntries();
                    for (const e of entries){
                        if (e.type === "custom" && e.customType === "thread-identity") {
                            const entry = e;
                            if (entry.data?.id) existingId = entry.data.id;
                        }
                    }
                } catch  {}
                store.threadId = existingId ?? `thread-${crypto.randomUUID().slice(0, 8)}`;
                if (!existingId) pi.appendEntry("thread-identity", {
                    id: store.threadId
                });
            }
            const flagParent = pi.getFlag("thread-parent");
            store.parent = typeof flagParent === "string" && flagParent ? flagParent : store.threadId !== "coordinator" ? "coordinator" : null;
            const flagRole = pi.getFlag("thread-role");
            if (typeof flagRole === "string" && flagRole) {
                store.role = flagRole;
            } else if (store.threadId === "coordinator") {
                store.role = "coordinator";
            } else {
                const KNOWN_ROLES = [
                    "builder",
                    "reviewer",
                    "scout",
                    "designer",
                    "explorer",
                    "tester"
                ];
                const prefix = KNOWN_ROLES.find((r)=>store.threadId === r || store.threadId.startsWith(r + "-") || store.threadId.startsWith(r + "_") || store.threadId.startsWith(r + "."));
                store.role = prefix ?? "worker";
            }
            if (store.role === "coordinator") {
                const modelsPath = path.join(cwd, ".thread", "models.json");
                if (!fs.existsSync(modelsPath)) {
                    const defaultModels = {
                        builder: "deepseek/deepseek-v4-pro",
                        reviewer: "deepseek/deepseek-v4-pro",
                        tester: "deepseek/deepseek-v4-pro",
                        designer: "deepseek/deepseek-v4-pro",
                        explorer: "deepseek/deepseek-v4-flash",
                        scout: "deepseek/deepseek-v4-flash",
                        default: "deepseek/deepseek-v4-flash"
                    };
                    fs.writeFileSync(modelsPath, JSON.stringify(defaultModels, null, 2) + "\n");
                    console.log(`[thread] Default models written to ${modelsPath}`);
                }
            }
            store.threadDir = path.join(store.threadsRootDir, store.threadId);
            const s = await store.adapter.loadState(store.threadId);
            if (s) {
                store.obligations = s.obligations ?? [];
                store.owed = s.owed ?? [];
                store.barriers = s.barriers ?? [];
                store.state = s.state === "done" || s.state === "stopped" ? "idle" : KNOWN_STATES.includes(s.state) ? s.state : "open";
                store.holdReason = store.state === "on-hold" ? (s.holdReason ?? null) : null;
                store.parent = store.parent ?? s.parent ?? null;
                store.role = store.role ?? s.role ?? "worker";
            }
            fs.mkdirSync(store.threadDir, {
                recursive: true
            });
            const lockPath = path.join(store.threadDir, "init.lock");
            let lockFd = null;
            try {
                lockFd = fs.openSync(lockPath, "wx");
                fs.writeSync(lockFd, String(process.pid));
            } catch (e) {
                if (e instanceof Error && (e).code === "EEXIST") {
                    let stale = false;
                    try {
                        const content = fs.readFileSync(lockPath, "utf-8").trim();
                        const holderPid = parseInt(content, 10);
                        if (!Number.isNaN(holderPid) && !isPidAlive(holderPid)) {
                            stale = true;
                        }
                    } catch  {
                        stale = true;
                    }
                    if (stale) {
                        try {
                            fs.unlinkSync(lockPath);
                        } catch  {}
                        lockFd = fs.openSync(lockPath, "wx");
                        fs.writeSync(lockFd, String(process.pid));
                    } else {
                        throw new Error(`Thread "${store.threadId}" is already starting (init.lock held). ` + `Wait a moment and retry, or use a different --thread-id.`);
                    }
                } else {
                    throw new Error(`Failed to acquire init lock for thread "${store.threadId}": ${String(e)}`);
                }
            }
            try {
                {
                    const all = await store.listThreads();
                    const dup = all.find((t)=>t.id === store.threadId && t.status === "running");
                    if (dup) {
                        if (typeof dup.pid === "number" && !isPidAlive(dup.pid)) {} else {
                            throw new Error(`Thread "${store.threadId}" already exists and is running. ` + `Use a unique --thread-id (e.g. --thread-id ${store.threadId}-2).`);
                        }
                    }
                }
                if (store.role === "coordinator") {
                    const threads = await store.listThreads();
                    const activeCoord = threads.find((t)=>t.id !== store.threadId && t.role === "coordinator" && t.status === "running");
                    if (activeCoord) {
                        if (typeof activeCoord.pid === "number" && !isPidAlive(activeCoord.pid)) {} else {
                            throw new Error(`Coordinator "${activeCoord.id}" already exists. Cannot start another coordinator. ` + `Use a different role (e.g. --thread-role worker).`);
                        }
                    }
                }
                try {
                    store.sessionFile = ctx.sessionManager.getSessionFile() ?? null;
                } catch  {
                    store.sessionFile = null;
                }
                store.startedAt = nowIso();
                store.status = "running";
                await store.persist();
                ctx.ui.setStatus("thread", `${roleEmoji(store.role)} ${store.role ?? "worker"}: ${store.state}`);
            } finally{
                if (lockFd !== null) {
                    fs.closeSync(lockFd);
                    try {
                        fs.unlinkSync(lockPath);
                    } catch  {}
                }
            }
        },
        async shutdown (reason) {
            store.stopHeartbeat();
            store.stopWatcher();
            if (reason !== "quit") {
                store.state = "stopped";
            } else {
                const preserved = new Set([
                    "done",
                    "on-hold"
                ]);
                if (!preserved.has(store.state)) store.state = "stopped";
            }
            store.status = "stopped";
            await store.persist();
        },
        async listThreads () {
            return store.adapter.listThreads();
        },
        async threadExists (threadId) {
            return store.adapter.threadExists(threadId);
        },
        async readJournal (threadId) {
            return store.adapter.readJournal?.(threadId);
        },
        forkJournal (sessionFile) {
            const m = pi.getFlag("thread-journal-model");
            forkJournalEntry(store, sessionFile, typeof m === "string" && m ? m : undefined);
        },
        compactJournal (sessionFile) {
            if (!store.sessionFile) return;
            const m = pi.getFlag("thread-journal-model");
            compactJournalFn(store, sessionFile, typeof m === "string" && m ? m : undefined);
        },
        startHeartbeat (onTick) {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = setInterval(()=>{
                void (async ()=>{
                    await store.persist();
                    await onTick?.();
                })().catch((err)=>console.error("[thread] heartbeat tick failed:", err));
            }, HEARTBEAT_MS);
        },
        stopHeartbeat () {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = null;
        },
        startWatcher (drainInbox, ctx) {
            stopWatching?.();
            stopWatching = store.adapter.watchInbox(store.threadId, ()=>drainInbox(ctx));
        },
        stopWatcher () {
            if (stopWatching) stopWatching();
            stopWatching = null;
        }
    };
    return store;
}
