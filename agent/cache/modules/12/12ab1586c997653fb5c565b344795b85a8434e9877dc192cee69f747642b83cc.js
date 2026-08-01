import.meta.url = "file:///Users/kentaylor/.pi/agent/extensions/permission-gate.ts";
export default function(pi) {
    const dangerousPatterns = [
        /\brm\s+(-rf?|--recursive)/i,
        /\bsudo\b/i,
        /\b(chmod|chown)\b.*777/i
    ];
    pi.on("tool_call", async (event, ctx)=>{
        if (event.toolName !== "bash") return undefined;
        const command = event.input.command;
        const isDangerous = dangerousPatterns.some((p)=>p.test(command));
        if (isDangerous) {
            if (!ctx.hasUI) {
                return {
                    block: true,
                    reason: "Dangerous command blocked (no UI for confirmation)"
                };
            }
            const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, [
                "Yes",
                "No"
            ]);
            if (choice !== "Yes") {
                return {
                    block: true,
                    reason: "Blocked by user"
                };
            }
        }
        return undefined;
    });
}
