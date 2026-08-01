import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/restate/adapter.ts";
import { connect } from "@restatedev/restate-sdk-clients";
import { toSummary } from "../core/types";
const ThreadObjectRef = {
    name: "Thread"
};
const RegistryRef = {
    name: "ThreadRegistry"
};
const POLL_MS = 2000;
export function createRestateAdapter(opts) {
    const ingress = connect({
        url: opts.url ?? "http://localhost:8080"
    });
    const thread = (id)=>ingress.objectClient(ThreadObjectRef, id);
    return {
        async configure () {},
        async loadState (threadId) {
            return (await thread(threadId).loadState()) ?? undefined;
        },
        async saveState (threadId, state) {
            await thread(threadId).saveState(state);
        },
        async appendJournal (threadId, entry) {
            await this.acquireJournalLock(threadId);
            try {
                await thread(threadId).appendJournal(entry);
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async readJournal (threadId) {
            return (await thread(threadId).readJournal()) ?? undefined;
        },
        async setJournal (threadId, content) {
            await this.acquireJournalLock(threadId);
            try {
                await thread(threadId).setJournal(content);
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async deleteJournal (threadId) {
            await this.acquireJournalLock(threadId);
            try {
                await thread(threadId).setJournal("");
            } finally{
                await this.releaseJournalLock(threadId);
            }
        },
        async acquireJournalLock (_threadId) {},
        async releaseJournalLock (_threadId) {},
        async listThreads () {
            const ids = await ingress.objectClient(RegistryRef, "all").list();
            const out = [];
            for (const id of ids){
                const s = await thread(id).loadState();
                if (s) out.push(toSummary(s));
            }
            return out;
        },
        async threadExists (threadId) {
            return (await thread(threadId).loadState()) != null;
        },
        async enqueueMessage (message) {
            await thread(message.to).enqueueMessage(message);
        },
        async drainInbox (threadId) {
            return thread(threadId).drainInbox();
        },
        async finalizeDrain (_threadId) {},
        watchInbox (_threadId, cb) {
            const timer = setInterval(cb, POLL_MS);
            return ()=>clearInterval(timer);
        }
    };
}
