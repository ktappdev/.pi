import.meta.url = "file:///Users/kentaylor/.pi/agent/extensions/copy-all.ts";
import { spawn } from "node:child_process";
function textFromContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((block)=>{
        if (!block || typeof block !== "object") return "";
        if (!("type" in block)) return "";
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
            return block.text;
        }
        if (block.type === "image") return "[image]";
        return "";
    }).filter(Boolean).join("\n");
}
function getClipboardCommand() {
    if (process.platform === "darwin") {
        return {
            cmd: "pbcopy",
            args: []
        };
    }
    return {
        cmd: "sh",
        args: [
            "-c",
            "wl-copy 2>/dev/null || xclip -selection clipboard"
        ]
    };
}
function copyToClipboard(text) {
    return new Promise((resolve, reject)=>{
        const { cmd, args } = getClipboardCommand();
        const child = spawn(cmd, args);
        let stderr = "";
        child.stderr.on("data", (chunk)=>{
            stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code)=>{
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
            }
        });
        child.stdin.end(text);
    });
}
export default function(pi) {
    pi.registerCommand("copy-all", {
        description: "Copy all previous user and assistant messages in this thread to the clipboard",
        handler: async (_args, ctx)=>{
            await ctx.waitForIdle();
            const messages = ctx.sessionManager.getBranch().filter((entry)=>entry.type === "message").map((entry)=>entry.message).filter((message)=>message.role === "user" || message.role === "assistant");
            const text = messages.map((message)=>{
                const content = textFromContent(message.content).trim();
                return `${message.role.toUpperCase()}:\n${content}`;
            }).filter((section)=>!section.endsWith(":\n")).join("\n\n---\n\n");
            if (!text) {
                ctx.ui.notify("No user or assistant messages to copy", "info");
                return;
            }
            await copyToClipboard(text);
            ctx.ui.notify(`Copied ${messages.length} messages to clipboard`, "info");
        }
    });
}
