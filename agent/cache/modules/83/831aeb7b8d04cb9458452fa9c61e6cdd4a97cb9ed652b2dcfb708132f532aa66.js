import.meta.url = "file:///Users/kentaylor/.pi/agent/extensions/compact-flash.ts";
import { complete } from "@earendil-works/pi-ai/compat";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
export default function(pi) {
    pi.on("session_before_compact", async (event, ctx)=>{
        const { preparation, signal } = event;
        const model = ctx.modelRegistry.find("deepseek", "deepseek-v4-flash");
        if (!model) return;
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok || !auth.apiKey) return;
        const allMessages = [
            ...preparation.messagesToSummarize,
            ...preparation.turnPrefixMessages
        ];
        const text = serializeConversation(convertToLlm(allMessages));
        const prev = preparation.previousSummary ? `\n\nPrevious summary:\n${preparation.previousSummary}` : "";
        const msg = {
            role: "user",
            content: [
                {
                    type: "text",
                    text: `Summarize this coding session. Include: goals, decisions, files changed, current state, next steps.${prev}\n\n<conversation>\n${text}\n</conversation>`
                }
            ],
            timestamp: Date.now()
        };
        try {
            const response = await complete(model, {
                messages: [
                    msg
                ]
            }, {
                apiKey: auth.apiKey,
                headers: auth.headers,
                maxTokens: 4096,
                signal
            });
            const summary = response.content.filter((c)=>c.type === "text").map((c)=>c.text).join("\n");
            if (!summary.trim()) return;
            return {
                compaction: {
                    summary,
                    firstKeptEntryId: preparation.firstKeptEntryId,
                    tokensBefore: preparation.tokensBefore
                }
            };
        } catch  {
            return;
        }
    });
}
