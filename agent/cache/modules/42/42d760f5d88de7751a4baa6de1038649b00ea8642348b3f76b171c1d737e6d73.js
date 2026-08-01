import.meta.url = "file:///Users/kentaylor/.pi/agent/extensions/context.ts";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, Text, matchesKey } from "@mariozechner/pi-tui";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
function formatUsd(cost) {
    if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    if (cost >= 0.1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(4)}`;
}
function estimateTokens(text) {
    return Math.max(0, Math.ceil(text.length / 4));
}
function normalizeReadPath(inputPath, cwd) {
    let p = inputPath;
    if (p.startsWith("@")) p = p.slice(1);
    if (p === "~") p = os.homedir();
    else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
    if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
    return path.resolve(p);
}
function getAgentDir() {
    const envCandidates = [
        "PI_CODING_AGENT_DIR",
        "TAU_CODING_AGENT_DIR"
    ];
    let envDir;
    for (const k of envCandidates){
        if (process.env[k]) {
            envDir = process.env[k];
            break;
        }
    }
    if (!envDir) {
        for (const [k, v] of Object.entries(process.env)){
            if (k.endsWith("_CODING_AGENT_DIR") && v) {
                envDir = v;
                break;
            }
        }
    }
    if (envDir) {
        if (envDir === "~") return os.homedir();
        if (envDir.startsWith("~/")) return path.join(os.homedir(), envDir.slice(2));
        return envDir;
    }
    return path.join(os.homedir(), ".pi", "agent");
}
async function readFileIfExists(filePath) {
    if (!existsSync(filePath)) return null;
    try {
        const buf = await fs.readFile(filePath);
        return {
            path: filePath,
            content: buf.toString("utf8"),
            bytes: buf.byteLength
        };
    } catch  {
        return null;
    }
}
async function loadProjectContextFiles(cwd) {
    const out = [];
    const seen = new Set();
    const loadFromDir = async (dir)=>{
        for (const name of [
            "AGENTS.md",
            "CLAUDE.md"
        ]){
            const p = path.join(dir, name);
            const f = await readFileIfExists(p);
            if (f && !seen.has(f.path)) {
                seen.add(f.path);
                out.push({
                    path: f.path,
                    tokens: estimateTokens(f.content),
                    bytes: f.bytes
                });
                return;
            }
        }
    };
    await loadFromDir(getAgentDir());
    const stack = [];
    let current = path.resolve(cwd);
    while(true){
        stack.push(current);
        const parent = path.resolve(current, "..");
        if (parent === current) break;
        current = parent;
    }
    stack.reverse();
    for (const dir of stack)await loadFromDir(dir);
    return out;
}
function normalizeSkillName(name) {
    return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}
function buildSkillIndex(pi, cwd) {
    return pi.getCommands().filter((c)=>c.source === "skill").map((c)=>{
        const p = c.path ? normalizeReadPath(c.path, cwd) : "";
        return {
            name: normalizeSkillName(c.name),
            skillFilePath: p,
            skillDir: p ? path.dirname(p) : ""
        };
    }).filter((x)=>x.name && x.skillDir);
}
const SKILL_LOADED_ENTRY = "context:skill_loaded";
function getLoadedSkillsFromSession(ctx) {
    const out = new Set();
    for (const e of ctx.sessionManager.getEntries()){
        if ((e)?.type !== "custom") continue;
        if ((e)?.customType !== SKILL_LOADED_ENTRY) continue;
        const data = (e)?.data;
        if (data?.name) out.add(data.name);
    }
    return out;
}
function extractCostTotal(usage) {
    if (!usage) return 0;
    const c = usage?.cost;
    if (typeof c === "number") return Number.isFinite(c) ? c : 0;
    if (typeof c === "string") {
        const n = Number(c);
        return Number.isFinite(n) ? n : 0;
    }
    const t = c?.total;
    if (typeof t === "number") return Number.isFinite(t) ? t : 0;
    if (typeof t === "string") {
        const n = Number(t);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
function sumSessionUsage(ctx) {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let totalCost = 0;
    for (const entry of ctx.sessionManager.getEntries()){
        if ((entry)?.type !== "message") continue;
        const msg = (entry)?.message;
        if (!msg || msg.role !== "assistant") continue;
        const usage = msg.usage;
        if (!usage) continue;
        input += Number(usage.input ?? 0) || 0;
        output += Number(usage.output ?? 0) || 0;
        cacheRead += Number(usage.cacheRead ?? 0) || 0;
        cacheWrite += Number(usage.cacheWrite ?? 0) || 0;
        totalCost += extractCostTotal(usage);
    }
    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        totalCost
    };
}
function shortenPath(p, cwd) {
    const rp = path.resolve(p);
    const rc = path.resolve(cwd);
    if (rp === rc) return ".";
    if (rp.startsWith(rc + path.sep)) return "./" + rp.slice(rc.length + 1);
    return rp;
}
function renderUsageBar(theme, parts, total, width) {
    const w = Math.max(10, width);
    if (total <= 0) return "";
    const toCols = (n)=>Math.round((n / total) * w);
    let sys = toCols(parts.system);
    let tools = toCols(parts.tools);
    let con = toCols(parts.convo);
    let rem = w - sys - tools - con;
    if (rem < 0) rem = 0;
    while(sys + tools + con + rem < w)rem++;
    while(sys + tools + con + rem > w && rem > 0)rem--;
    const block = "█";
    const sysStr = theme.fg("accent", block.repeat(sys));
    const toolsStr = theme.fg("warning", block.repeat(tools));
    const conStr = theme.fg("success", block.repeat(con));
    const remStr = theme.fg("dim", block.repeat(rem));
    return `${sysStr}${toolsStr}${conStr}${remStr}`;
}
function joinComma(items) {
    return items.join(", ");
}
function joinCommaStyled(items, renderItem, sep) {
    return items.map(renderItem).join(sep);
}
class ContextView {
    tui;
    theme;
    onDone;
    data;
    container;
    body;
    cachedWidth;
    constructor(tui, theme, data, onDone){
        this.tui = tui;
        this.theme = theme;
        this.data = data;
        this.onDone = onDone;
        this.container = new Container();
        this.container.addChild(new DynamicBorder((s)=>theme.fg("accent", s)));
        this.container.addChild(new Text(theme.fg("accent", theme.bold("Context")) + theme.fg("dim", "  (Esc/q/Enter to close)"), 1, 0));
        this.container.addChild(new Text("", 1, 0));
        this.body = new Text("", 1, 0);
        this.container.addChild(this.body);
        this.container.addChild(new Text("", 1, 0));
        this.container.addChild(new DynamicBorder((s)=>theme.fg("accent", s)));
    }
    rebuild(width) {
        const muted = (s)=>this.theme.fg("muted", s);
        const dim = (s)=>this.theme.fg("dim", s);
        const text = (s)=>this.theme.fg("text", s);
        const lines = [];
        if (!this.data.usage) {
            lines.push(muted("Window: ") + dim("(unknown)"));
        } else {
            const u = this.data.usage;
            lines.push(muted("Window: ") + text(`~${u.effectiveTokens.toLocaleString()} / ${u.contextWindow.toLocaleString()}`) + muted(`  (${u.percent.toFixed(1)}% used, ~${u.remainingTokens.toLocaleString()} left)`));
            const barWidth = Math.max(10, Math.min(36, width - 10));
            const sysInMessages = Math.min(u.systemPromptTokens, u.messageTokens);
            const convoInMessages = Math.max(0, u.messageTokens - sysInMessages);
            const bar = renderUsageBar(this.theme, {
                system: sysInMessages,
                tools: 0,
                convo: convoInMessages,
                remaining: u.remainingTokens
            }, u.contextWindow, barWidth) + " " + dim("sys") + this.theme.fg("accent", "█") + " " + dim("convo") + this.theme.fg("success", "█") + " " + dim("free") + this.theme.fg("dim", "█");
            lines.push(bar);
        }
        lines.push("");
        if (this.data.usage) {
            const u = this.data.usage;
            lines.push(muted("System: ") + text(`~${u.systemPromptTokens.toLocaleString()} tok`) + muted(` (AGENTS ~${u.agentTokens.toLocaleString()})`));
            lines.push(muted("Tools: ") + text(`~${u.toolsTokens.toLocaleString()} tok`) + muted(` (${u.activeTools} active)`));
        }
        lines.push(muted(`AGENTS (${this.data.agentFiles.length}): `) + text(this.data.agentFiles.length ? joinComma(this.data.agentFiles) : "(none)"));
        lines.push("");
        lines.push(muted(`Extensions (${this.data.extensions.length}): `) + text(this.data.extensions.length ? joinComma(this.data.extensions) : "(none)"));
        const loaded = new Set(this.data.loadedSkills);
        const skillsRendered = this.data.skills.length ? joinCommaStyled(this.data.skills, (name)=>(loaded.has(name) ? this.theme.fg("success", name) : this.theme.fg("muted", name)), this.theme.fg("muted", ", ")) : "(none)";
        lines.push(muted(`Skills (${this.data.skills.length}): `) + skillsRendered);
        lines.push("");
        lines.push(muted("Session: ") + text(`${this.data.session.totalTokens.toLocaleString()} tokens`) + muted(" · ") + text(formatUsd(this.data.session.totalCost)));
        this.body.setText(lines.join("\n"));
        this.cachedWidth = width;
    }
    handleInput(data) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "q" || data === "\r") {
            this.onDone();
            return;
        }
    }
    invalidate() {
        this.container.invalidate();
        this.cachedWidth = undefined;
    }
    render(width) {
        if (this.cachedWidth !== width) this.rebuild(width);
        return this.container.render(width);
    }
}
export default function contextExtension(pi) {
    let lastSessionId = null;
    let cachedLoadedSkills = new Set();
    let cachedSkillIndex = [];
    const ensureCaches = (ctx)=>{
        const sid = ctx.sessionManager.getSessionId();
        if (sid !== lastSessionId) {
            lastSessionId = sid;
            cachedLoadedSkills = getLoadedSkillsFromSession(ctx);
            cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
        }
        if (cachedSkillIndex.length === 0) {
            cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
        }
    };
    const matchSkillForPath = (absPath)=>{
        let best = null;
        for (const s of cachedSkillIndex){
            if (!s.skillDir) continue;
            if (absPath === s.skillFilePath || absPath.startsWith(s.skillDir + path.sep)) {
                if (!best || s.skillDir.length > best.skillDir.length) best = s;
            }
        }
        return best?.name ?? null;
    };
    pi.on("tool_result", (event, ctx)=>{
        if ((event).toolName !== "read") return;
        if ((event).isError) return;
        const input = (event).input;
        const p = typeof input?.path === "string" ? input.path : "";
        if (!p) return;
        ensureCaches(ctx);
        const abs = normalizeReadPath(p, ctx.cwd);
        const skillName = matchSkillForPath(abs);
        if (!skillName) return;
        if (!cachedLoadedSkills.has(skillName)) {
            cachedLoadedSkills.add(skillName);
            pi.appendEntry(SKILL_LOADED_ENTRY, {
                name: skillName,
                path: abs
            });
        }
    });
    pi.registerCommand("context", {
        description: "Show loaded context overview",
        handler: async (_args, ctx)=>{
            const commands = pi.getCommands();
            const extensionCmds = commands.filter((c)=>c.source === "extension");
            const skillCmds = commands.filter((c)=>c.source === "skill");
            const extensionsByPath = new Map();
            for (const c of extensionCmds){
                const p = c.path ?? "<unknown>";
                const arr = extensionsByPath.get(p) ?? [];
                arr.push(c.name);
                extensionsByPath.set(p, arr);
            }
            const extensionFiles = [
                ...extensionsByPath.keys()
            ].map((p)=>(p === "<unknown>" ? p : path.basename(p))).sort((a, b)=>a.localeCompare(b));
            const skills = skillCmds.map((c)=>normalizeSkillName(c.name)).sort((a, b)=>a.localeCompare(b));
            const agentFiles = await loadProjectContextFiles(ctx.cwd);
            const agentFilePaths = agentFiles.map((f)=>shortenPath(f.path, ctx.cwd));
            const agentTokens = agentFiles.reduce((a, f)=>a + f.tokens, 0);
            const systemPrompt = ctx.getSystemPrompt();
            const systemPromptTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;
            const usage = ctx.getContextUsage();
            const messageTokens = usage?.tokens ?? null;
            const ctxWindow = usage?.contextWindow ?? 0;
            const TOOL_FUDGE = 1.5;
            const activeToolNames = pi.getActiveTools();
            const toolInfoByName = new Map(pi.getAllTools().map((t)=>[
                    t.name,
                    t
                ]));
            let toolsTokens = 0;
            for (const name of activeToolNames){
                const info = toolInfoByName.get(name);
                const blob = `${name}\n${info?.description ?? ""}`;
                toolsTokens += estimateTokens(blob);
            }
            toolsTokens = Math.round(toolsTokens * TOOL_FUDGE);
            const effectiveTokens = messageTokens ?? 0;
            const percent = ctxWindow > 0 && messageTokens != null ? (messageTokens / ctxWindow) * 100 : 0;
            const remainingTokens = ctxWindow > 0 && messageTokens != null ? Math.max(0, ctxWindow - messageTokens) : 0;
            const sessionUsage = sumSessionUsage(ctx);
            const makePlainText = ()=>{
                const lines = [];
                lines.push("Context");
                if (messageTokens != null) {
                    lines.push(`Window: ~${effectiveTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} (${percent.toFixed(1)}% used, ~${remainingTokens.toLocaleString()} left)`);
                } else {
                    lines.push("Window: (unknown)");
                }
                lines.push(`System: ~${systemPromptTokens.toLocaleString()} tok (AGENTS ~${agentTokens.toLocaleString()})`);
                lines.push(`Tools: ~${toolsTokens.toLocaleString()} tok (${activeToolNames.length} active)`);
                lines.push(`AGENTS: ${agentFilePaths.length ? joinComma(agentFilePaths) : "(none)"}`);
                lines.push(`Extensions (${extensionFiles.length}): ${extensionFiles.length ? joinComma(extensionFiles) : "(none)"}`);
                lines.push(`Skills (${skills.length}): ${skills.length ? joinComma(skills) : "(none)"}`);
                lines.push(`Session: ${sessionUsage.totalTokens.toLocaleString()} tokens · ${formatUsd(sessionUsage.totalCost)}`);
                return lines.join("\n");
            };
            if (!ctx.hasUI) {
                pi.sendMessage({
                    customType: "context",
                    content: makePlainText(),
                    display: true
                }, {
                    triggerTurn: false
                });
                return;
            }
            const loadedSkills = Array.from(getLoadedSkillsFromSession(ctx)).sort((a, b)=>a.localeCompare(b));
            const viewData = {
                usage: messageTokens != null ? {
                    messageTokens,
                    contextWindow: ctxWindow,
                    effectiveTokens,
                    percent,
                    remainingTokens,
                    systemPromptTokens,
                    agentTokens,
                    toolsTokens,
                    activeTools: activeToolNames.length
                } : null,
                agentFiles: agentFilePaths,
                extensions: extensionFiles,
                skills,
                loadedSkills,
                session: {
                    totalTokens: sessionUsage.totalTokens,
                    totalCost: sessionUsage.totalCost
                }
            };
            await ctx.ui.custom((tui, theme, _kb, done)=>{
                return new ContextView(tui, theme, viewData, done);
            });
        }
    });
}
