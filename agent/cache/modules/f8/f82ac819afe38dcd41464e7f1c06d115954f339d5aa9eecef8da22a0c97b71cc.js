import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/journal.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
const JOURNAL_PROMPT = `You are this thread's journal keeper. Based on the conversation above, write a brief status update in exactly this format:

Working on: <the main task in one line>
Done: <what was completed this turn>
Doing: <what is in progress or will continue>
Next: <planned next step>
Blockers: <blockers or "none">

No preamble. No extra text. Just the five lines.`;
const COMPACTION_PROMPT = `You are summarizing old journal entries from a long-running thread. Produce a compact block (5-10 lines max) preserving: key tasks completed, key decisions made, current state at the time, ongoing obligations. Drop: routine tool turns, restated waits, anything that doesn't carry news. Format: a single paragraph OR short bulleted list. No headers. No preamble. Just the summary text.

Entries to summarize:
---
ENTRIES_HERE
---`;
export const JOURNAL_MIN_INTERVAL_MS = 120_000;
export const JOURNAL_COMPACT_THRESHOLD = 500;
export const JOURNAL_COMPACT_KEEP_RECENT = 100;
export const JOURNAL_COMPACT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export function isCompactionEntry(entry) {
    return /^<!--\s*COMPACTION\s/.test(entry.trimStart());
}
export function splitJournalEntries(content) {
    return content.split(/\n(?=<!--)/).filter(Boolean);
}
export function journalFingerprint(entry) {
    return entry.split("\n").filter((l)=>/^(Working on|Done):/i.test(l.trim())).join("\n").toLowerCase().replace(/\s+/g, " ").trim();
}
export function isDuplicateOfLastEntry(journalContent, entry) {
    const content = journalContent?.trim();
    if (!content) return false;
    const entries = splitJournalEntries(content);
    const last = entries[entries.length - 1];
    if (!last) return false;
    return journalFingerprint(last) === journalFingerprint(entry);
}
export function journalMode(pi) {
    const v = pi.getFlag("thread-journal");
    return v === "done" || v === "off" ? v : "turn";
}
export function journalSignature(store) {
    return [
        store.state,
        store.obligations.map((o)=>o.id).sort().join(","),
        store.barriers.map((b)=>b.id).sort().join(",")
    ].join("|");
}
export function shouldJournal(store, toolUsedThisTurn, phase = "turn") {
    const sig = journalSignature(store);
    const changed = sig !== store.lastJournalSignature;
    let write;
    if (phase === "run-end") {
        write = store.journalDebt;
    } else if (phase === "done") {
        write = changed || toolUsedThisTurn;
    } else {
        if (!changed && !toolUsedThisTurn) return false;
        write = changed || Date.now() - store.lastJournalAt >= JOURNAL_MIN_INTERVAL_MS;
        if (!write) store.journalDebt = true;
    }
    if (write) {
        store.lastJournalSignature = sig;
        store.lastJournalAt = Date.now();
        store.journalDebt = false;
    }
    return write;
}
export function piSelfCommand(args, execPath = process.execPath, entryScript = process.argv[1]) {
    const exe = (execPath.split(/[\\/]/).pop() ?? "").toLowerCase();
    if (exe.startsWith("node")) {
        if (entryScript) return {
            cmd: execPath,
            args: [
                entryScript,
                ...args
            ]
        };
        return {
            cmd: "pi",
            args
        };
    }
    return {
        cmd: execPath,
        args
    };
}
export function journalForkArgs(sessionFile, sessionDir, model) {
    return [
        "--fork",
        sessionFile,
        "--session-dir",
        sessionDir,
        "--no-extensions",
        ...(model ? [
            "--model",
            model
        ] : []),
        "--thinking",
        "off",
        "--print",
        JOURNAL_PROMPT
    ];
}
export function forkJournalEntry(store, sessionFile, model) {
    if (!store.adapter.appendJournal) return;
    const tmpSes = fs.mkdtempSync(path.join(os.tmpdir(), "pi-journal-"));
    let out = "";
    let errOut = "";
    const launch = piSelfCommand(journalForkArgs(sessionFile, tmpSes, model));
    const proc = spawn(launch.cmd, launch.args, {
        stdio: [
            "ignore",
            "pipe",
            "pipe"
        ]
    });
    proc.on("error", (err)=>{
        console.error("[thread] journal fork failed to spawn:", err);
        fs.rmSync(tmpSes, {
            recursive: true,
            force: true
        });
    });
    proc.stdout.on("data", (d)=>{
        out += d.toString();
    });
    proc.stderr.on("data", (d)=>{
        errOut += d.toString();
    });
    proc.on("close", (code)=>{
        void (async ()=>{
            fs.rmSync(tmpSes, {
                recursive: true,
                force: true
            });
            const entry = out.trim();
            if (!entry) {
                console.error(`[thread] journal fork produced no entry (exit ${code})${errOut.trim() ? `: ${errOut.trim().slice(0, 300)}` : ""}`);
                return;
            }
            const existing = await store.adapter.readJournal?.(store.threadId);
            if (isDuplicateOfLastEntry(existing, entry)) return;
            const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
            await store.adapter.appendJournal?.(store.threadId, `\n<!-- ${ts} -->\n${entry}\n`);
        })();
    });
}
export function decideCompaction(content, now = Date.now()) {
    const entries = splitJournalEntries(content);
    if (entries.length <= JOURNAL_COMPACT_THRESHOLD) return null;
    const last = entries[entries.length - 1];
    if (isCompactionEntry(last)) {
        const m = /^<!--\s*COMPACTION\s+(.+?)\s*-->/.exec(last);
        if (m) {
            const ts = new Date(m[1].replace(" ", "T") + ":00Z").getTime();
            if (Number.isFinite(ts) && now - ts < JOURNAL_COMPACT_COOLDOWN_MS) return null;
        }
    }
    return {
        toSummarize: entries.slice(0, entries.length - JOURNAL_COMPACT_KEEP_RECENT),
        toKeep: entries.slice(entries.length - JOURNAL_COMPACT_KEEP_RECENT)
    };
}
export function compactJournal(store, sessionFile, model) {
    if (!store.adapter.appendJournal || !store.adapter.readJournal) return;
    void (async ()=>{
        const existing = await store.adapter.readJournal(store.threadId);
        if (!existing) return;
        const plan = decideCompaction(existing);
        if (!plan) return;
        const tmpSes = fs.mkdtempSync(path.join(os.tmpdir(), "pi-journal-compact-"));
        const prompt = COMPACTION_PROMPT.replace("ENTRIES_HERE", plan.toSummarize.join("\n---\n"));
        const launch = piSelfCommand(journalForkArgs(sessionFile, tmpSes, model).map((a)=>(a === JOURNAL_PROMPT ? prompt : a)));
        let out = "";
        let errOut = "";
        const proc = spawn(launch.cmd, launch.args, {
            stdio: [
                "ignore",
                "pipe",
                "pipe"
            ]
        });
        proc.on("error", (err)=>{
            console.error("[thread] journal compaction fork failed to spawn:", err);
            fs.rmSync(tmpSes, {
                recursive: true,
                force: true
            });
        });
        proc.stdout.on("data", (d)=>{
            out += d.toString();
        });
        proc.stderr.on("data", (d)=>{
            errOut += d.toString();
        });
        proc.on("close", (code)=>{
            fs.rmSync(tmpSes, {
                recursive: true,
                force: true
            });
            const summary = out.trim();
            if (!summary) {
                console.error(`[thread] journal compaction produced no summary (exit ${code})${errOut.trim() ? `: ${errOut.trim().slice(0, 300)}` : ""}`);
                return;
            }
            void (async ()=>{
                await store.adapter.acquireJournalLock?.(store.threadId);
                try {
                    const fresh = (await store.adapter.readJournal(store.threadId)) ?? "";
                    const freshEntries = splitJournalEntries(fresh);
                    const keepFromFresh = freshEntries.slice(-JOURNAL_COMPACT_KEEP_RECENT);
                    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
                    const compactionEntry = `<!-- COMPACTION ${ts} -->\n${summary}\n`;
                    const newContent = compactionEntry + "\n" + keepFromFresh.join("\n") + "\n";
                    await store.adapter.setJournal(store.threadId, newContent);
                    console.log(`[thread] journal compacted: ${freshEntries.length} → ${keepFromFresh.length + 1} entries`);
                } finally{
                    await store.adapter.releaseJournalLock?.(store.threadId);
                }
            })();
        });
    })();
}
