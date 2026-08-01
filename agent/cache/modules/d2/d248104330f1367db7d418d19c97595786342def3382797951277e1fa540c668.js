import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-threading/src/core/ids.ts";
import * as crypto from "node:crypto";
let seq = 0;
export function mintId(prefix) {
    return `${prefix}.${Date.now()}.${(seq++).toString(36)}`;
}
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastMs = -1;
let lastRand = [];
export function ulid(now = Date.now()) {
    if (now === lastMs) {
        for(let i = 15; i >= 0; i--){
            if (lastRand[i] < 31) {
                lastRand[i]++;
                break;
            }
            lastRand[i] = 0;
        }
    } else {
        lastMs = now;
        lastRand = Array.from(crypto.randomBytes(16)).map((b)=>b & 31);
    }
    let t = "";
    let ms = now;
    for(let i = 0; i < 10; i++){
        t = B32[ms % 32] + t;
        ms = Math.floor(ms / 32);
    }
    return t + lastRand.map((i)=>B32[i]).join("");
}
export function mintEnvelopeId(from) {
    return `${from}/${ulid()}`;
}
