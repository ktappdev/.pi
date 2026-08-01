import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/adapter/local-fs.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROCESSED_TTL_MS, toSummary } from "../core/types";
import { ulid } from "../core/ids";
function pruneProcessed(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch  {
        return;
    }
    const cutoff = Date.now() - PROCESSED_TTL_MS;
    for (const f of files){
        try {
            if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) {
                fs.rmSync(path.join(dir, f), {
                    force: true
                });
            }
        } catch  {}
    }
}
function envelopeFileName(id) {
    const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    const safe = tail.replace(/[^A-Za-z0-9._-]/g, "_");
    return `${safe || ulid()}.json`;
}
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
export function createLocalFsAdapter() {
    let root = "";
    const lastPruned = new Map();
    function threadDir(id) {
        return path.join(root, id);
    }
    function statePath(id) {
        return path.join(threadDir(id), "state.json");
    }
    function journalPath(id) {
        return path.join(threadDir(id), "journal.md");
    }
    function journalLockPath(id) {
        return path.join(threadDir(id), "journal.lock");
    }
    function inboxDir(id) {
        return path.join(threadDir(id), "inbox");
    }
    function stagingDir(id) {
        return path.join(threadDir(id), "inbox.tmp");
    }
    return {
        async configure (baseDir) {
            root = path.join(baseDir, ".thread", "threads");
            fs.mkdirSync(root, {
                recursive: true
            });
            if (fs.existsSync(root)) {
                for (const d of fs.readdirSync(root, {
                    withFileTypes: true
                })){
                    if (!d.isDirectory()) continue;
                    const claimedDir = path.join(root, d.name, "inbox", "claimed");
                    if (!fs.existsSync(claimedDir)) continue;
                    const inbox = path.join(root, d.name, "inbox");
                    for (const f of fs.readdirSync(claimedDir)){
                        if (!f.endsWith(".json")) continue;
                        try {
                            fs.renameSync(path.join(claimedDir, f), path.join(inbox, f));
                        } catch  {}
                    }
                }
            }
        },
        async loadState (threadId) {
            const f = statePath(threadId);
            if (!fs.existsSync(f)) return undefined;
            try {
                return JSON.parse(fs.readFileSync(f, "utf8"));
            } catch (err) {
                console.error("[thread] failed to read state.json:", err);
                return undefined;
            }
        },
        async saveState (threadId, state) {
            fs.mkdirSync(threadDir(threadId), {
                recursive: true
            });
            const tmp = statePath(threadId) + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
            fs.renameSync(tmp, statePath(threadId));
        },
        async appendJournal (threadId, entry) {
            fs.mkdirSync(threadDir(threadId), {
                recursive: true
            });
            await this.acquireJournalLock(threadId);
            try {
                fs.appendFileSync(journalPath(threadId), entry);
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async setJournal (threadId, content) {
            fs.mkdirSync(threadDir(threadId), {
                recursive: true
            });
            await this.acquireJournalLock(threadId);
            try {
                const target = journalPath(threadId);
                const tmp = target + ".tmp";
                fs.writeFileSync(tmp, content);
                fs.renameSync(tmp, target);
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async deleteJournal (threadId) {
            fs.mkdirSync(threadDir(threadId), {
                recursive: true
            });
            await this.acquireJournalLock(threadId);
            try {
                try {
                    fs.unlinkSync(journalPath(threadId));
                } catch  {}
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async acquireJournalLock (threadId) {
            const lockPath = journalLockPath(threadId);
            fs.mkdirSync(threadDir(threadId), {
                recursive: true
            });
            const STALE_MS = 10_000;
            const MAX_RETRIES = 40;
            for(let i = 0; i < MAX_RETRIES; i++){
                try {
                    const fd = fs.openSync(lockPath, "wx");
                    fs.closeSync(fd);
                    return;
                } catch (e) {
                    if (e instanceof Error && (e).code === "EEXIST") {
                        try {
                            const stat = fs.statSync(lockPath);
                            if (Date.now() - stat.mtimeMs > STALE_MS) {
                                try {
                                    fs.unlinkSync(lockPath);
                                } catch  {}
                                continue;
                            }
                        } catch  {
                            continue;
                        }
                        await new Promise((resolve)=>setTimeout(resolve, 50));
                        continue;
                    }
                    throw e;
                }
            }
            throw new Error(`Failed to acquire journal lock for thread "${threadId}" after ${MAX_RETRIES} retries.`);
        },
        async releaseJournalLock (threadId) {
            const lockPath = journalLockPath(threadId);
            try {
                fs.unlinkSync(lockPath);
            } catch  {}
        },
        async readJournal (threadId) {
            const f = journalPath(threadId);
            if (!fs.existsSync(f)) return undefined;
            const content = fs.readFileSync(f, "utf8").trim();
            return content || undefined;
        },
        async listThreads () {
            if (!fs.existsSync(root)) return [];
            const ids = fs.readdirSync(root, {
                withFileTypes: true
            }).filter((d)=>d.isDirectory()).map((d)=>d.name);
            const out = [];
            for (const id of ids){
                const f = statePath(id);
                if (!fs.existsSync(f)) continue;
                try {
                    const s = JSON.parse(fs.readFileSync(f, "utf8"));
                    out.push(toSummary(s));
                } catch  {}
            }
            return out;
        },
        async threadExists (threadId) {
            return fs.existsSync(statePath(threadId));
        },
        async enqueueMessage (message) {
            const dir = inboxDir(message.to);
            const staging = stagingDir(message.to);
            fs.mkdirSync(dir, {
                recursive: true
            });
            fs.mkdirSync(staging, {
                recursive: true
            });
            const fname = envelopeFileName(message.id);
            const tmp = path.join(staging, fname);
            fs.writeFileSync(tmp, JSON.stringify(message, null, 2));
            fs.renameSync(tmp, path.join(dir, fname));
        },
        async drainInbox (threadId) {
            const dir = inboxDir(threadId);
            const claimedDir = path.join(dir, "claimed");
            const processedDir = path.join(dir, "processed");
            let files;
            try {
                files = fs.readdirSync(dir).filter((f)=>f.endsWith(".json")).sort();
            } catch  {
                return [];
            }
            fs.mkdirSync(claimedDir, {
                recursive: true
            });
            fs.mkdirSync(processedDir, {
                recursive: true
            });
            const last = lastPruned.get(threadId) ?? 0;
            if (Date.now() - last >= PRUNE_INTERVAL_MS) {
                lastPruned.set(threadId, Date.now());
                pruneProcessed(processedDir);
            }
            const now = Date.now();
            const claimed = [];
            for (const f of files){
                const full = path.join(dir, f);
                let msg;
                try {
                    msg = JSON.parse(fs.readFileSync(full, "utf8"));
                } catch  {
                    continue;
                }
                if (msg.deliverAfter && new Date(msg.deliverAfter).getTime() > now) continue;
                if (msg.expiresAt && new Date(msg.expiresAt).getTime() <= now) {
                    try {
                        fs.renameSync(full, path.join(processedDir, f));
                    } catch  {}
                    continue;
                }
                try {
                    fs.renameSync(full, path.join(claimedDir, f));
                } catch  {
                    continue;
                }
                claimed.push(msg);
            }
            return claimed;
        },
        async finalizeDrain (threadId) {
            const dir = inboxDir(threadId);
            const claimedDir = path.join(dir, "claimed");
            const processedDir = path.join(dir, "processed");
            if (!fs.existsSync(claimedDir)) return;
            fs.mkdirSync(processedDir, {
                recursive: true
            });
            for (const f of fs.readdirSync(claimedDir)){
                if (!f.endsWith(".json")) continue;
                try {
                    fs.renameSync(path.join(claimedDir, f), path.join(processedDir, f));
                } catch  {}
            }
        },
        watchInbox (threadId, cb) {
            try {
                fs.mkdirSync(inboxDir(threadId), {
                    recursive: true
                });
                const watcher = fs.watch(inboxDir(threadId), cb);
                return ()=>watcher.close();
            } catch (err) {
                console.error("[thread] failed to watch inbox:", err);
                return ()=>{};
            }
        }
    };
}
