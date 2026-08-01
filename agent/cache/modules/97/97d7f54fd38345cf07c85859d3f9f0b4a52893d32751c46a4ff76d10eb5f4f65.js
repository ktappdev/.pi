import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/utils.ts";
export async function mapWithConcurrencyLimit(items, concurrency, fn) {
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({
        length: limit
    }, async ()=>{
        while(true){
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
export function truncateToBytes(text, maxBytes, suffix = "") {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
    const buf = Buffer.from(text, "utf8").subarray(0, maxBytes);
    let end = buf.length;
    let start = end - 1;
    while(start >= 0 && (buf[start] & 0xc0) === 0x80)start--;
    if (start >= 0) {
        const lead = buf[start];
        const expected = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
        if (start + expected > end) end = start;
    }
    return buf.subarray(0, end).toString("utf8") + suffix;
}
export function extractJson(text) {
    try {
        return JSON.parse(text);
    } catch  {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced && fenced[1]) {
        try {
            return JSON.parse(fenced[1]);
        } catch  {}
    }
    const brace = text.match(/\{[\s\S]*\}/);
    if (brace) {
        try {
            return JSON.parse(brace[0]);
        } catch  {}
    }
    return undefined;
}
