import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-commandcode-provider/src/oauth.ts";
import { randomBytes } from "node:crypto";
import { startAuthServer } from "./auth-server.ts";
const STUDIO_BASE_URL = "https://commandcode.ai";
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const DEFAULT_AUTH_TIMEOUT_MS = 15_000;
class AuthTimeoutError extends Error {
    constructor(){
        super("Browser authentication timed out");
        this.name = "AuthTimeoutError";
    }
}
function generateStateToken() {
    return randomBytes(32).toString("base64url");
}
function getAuthTimeoutMs() {
    const raw = process.env.COMMANDCODE_AUTH_TIMEOUT_MS;
    if (!raw) return DEFAULT_AUTH_TIMEOUT_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTH_TIMEOUT_MS;
}
function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject)=>{
        const timer = setTimeout(()=>reject(new AuthTimeoutError()), timeoutMs);
        promise.then((value)=>{
            clearTimeout(timer);
            resolve(value);
        }, (error)=>{
            clearTimeout(timer);
            reject(error);
        });
    });
}
function credentialsFromApiKey(apiKey) {
    return {
        refresh: apiKey,
        access: apiKey,
        expires: Date.now() + TEN_YEARS_MS
    };
}
export function sanitizeApiKey(input) {
    const esc = String.fromCharCode(27);
    return Array.from(input.replaceAll(`${esc}[200~`, "").replaceAll(`${esc}[201~`, "").replaceAll("[200~", "").replaceAll("[201~", "")).filter((char)=>{
        const code = char.charCodeAt(0);
        return code > 31 && code !== 127;
    }).join("").trim();
}
async function promptForApiKey(callbacks, message) {
    const apiKey = sanitizeApiKey(await callbacks.onPrompt({
        message
    }));
    if (!apiKey) throw new Error("No Command Code API key provided");
    return credentialsFromApiKey(apiKey);
}
export async function login(callbacks) {
    let authServer;
    try {
        authServer = await startAuthServer();
    } catch  {
        return promptForApiKey(callbacks, "Could not start browser auth. Paste your Command Code API key:");
    }
    const stateToken = generateStateToken();
    const callbackUrl = `http://localhost:${authServer.port}/callback`;
    const authUrl = `${STUDIO_BASE_URL}/studio/auth/cli?callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(stateToken)}`;
    callbacks.onAuth({
        url: authUrl
    });
    let callback;
    try {
        callback = await withTimeout(authServer.waitForCallback, getAuthTimeoutMs());
    } catch (error) {
        authServer.server.close();
        if (error instanceof AuthTimeoutError) {
            return promptForApiKey(callbacks, "Automatic transfer failed or timed out. Paste your Command Code API key:");
        }
        throw error;
    }
    if (callback.state !== stateToken) {
        authServer.server.close();
        throw new Error("State token mismatch. Authentication may have been tampered with.");
    }
    return credentialsFromApiKey(callback.apiKey);
}
export async function refreshToken(credentials) {
    return credentialsFromApiKey(credentials.refresh);
}
export function getApiKey(credentials) {
    return credentials.access;
}
