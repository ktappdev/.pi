import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/format.ts";
export function formatThreadLine(t) {
    const load = [
        t.obligations ? `obligations=${t.obligations}` : "",
        t.owed ? `owed=${t.owed}` : "",
        t.barriers ? `barriers=${t.barriers}` : ""
    ].filter(Boolean).join(" ");
    return `${t.id.padEnd(16)} [${t.state}]  ${t.status}  role=${t.role ?? "-"}  parent=${t.parent ?? "-"}${load ? `  ${load}` : ""}  lastSeen=${t.lastSeen}`;
}
function itemize(items, render) {
    return items.length ? "\n" + items.map((i)=>`  - ${render(i)}`).join("\n") : " none";
}
export function obligationLines(obligations) {
    return itemize(obligations, (o)=>`request to ${o.to} #${o.id} "${o.summary}"${o.deadline ? ` (deadline ${o.deadline})` : ""}`);
}
export function barrierLines(barriers) {
    return itemize(barriers, (b)=>`${b.id} (${b.mode}) pending: ${b.pending.join(", ")}${b.deadline ? ` (deadline ${b.deadline})` : ""}`);
}
export function owedLines(owed) {
    return itemize(owed, (o)=>`you owe a reply to ${o.from} for their request #${o.id} "${o.summary}" — reply with re="${o.id}"`);
}
