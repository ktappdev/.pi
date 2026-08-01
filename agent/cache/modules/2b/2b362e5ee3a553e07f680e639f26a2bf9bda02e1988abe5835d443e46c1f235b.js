import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/tools/shared.ts";
export function err(text) {
    return {
        content: [
            {
                type: "text",
                text
            }
        ],
        details: {
            ok: false
        }
    };
}
