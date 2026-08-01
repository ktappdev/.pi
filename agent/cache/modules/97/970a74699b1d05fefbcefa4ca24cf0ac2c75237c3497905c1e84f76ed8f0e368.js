import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-commandcode-provider/src/auth-server.ts";
import { createServer } from "node:http";
const DEFAULT_PORT = 5959;
const DEFAULT_PORT_RANGE = 10;
function listenOnAvailablePort(server, startPort = DEFAULT_PORT, range = DEFAULT_PORT_RANGE) {
    return new Promise((resolve, reject)=>{
        let offset = 0;
        const tryListen = ()=>{
            const useFallbackPort = startPort === 0 || offset >= range;
            const port = useFallbackPort ? 0 : startPort + offset;
            const onError = (err)=>{
                server.off("listening", onListening);
                if (err.code === "EADDRINUSE" && !useFallbackPort) {
                    offset += 1;
                    tryListen();
                    return;
                }
                reject(err);
            };
            const onListening = ()=>{
                server.off("error", onError);
                const address = server.address();
                resolve(address.port);
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(port, "127.0.0.1");
        };
        tryListen();
    });
}
function closeServer(server) {
    server.close((err)=>{
        if (err && err.code !== "ERR_SERVER_NOT_RUNNING") {}
    });
}
export async function startAuthServer(options = {}) {
    let resolveCallback;
    let rejectCallback;
    const waitForCallback = new Promise((resolve, reject)=>{
        resolveCallback = resolve;
        rejectCallback = reject;
    });
    const server = createServer((req, res)=>{
        const origin = req.headers.origin || "";
        const allowedOrigins = [
            "http://localhost:3000",
            "https://staging.commandcode.ai",
            "https://commandcode.ai"
        ];
        const responseOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
        const requestedHeaders = req.headers["access-control-request-headers"];
        res.setHeader("Access-Control-Allow-Origin", responseOrigin);
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", typeof requestedHeaders === "string" && requestedHeaders.length > 0 ? requestedHeaders : "Content-Type");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url !== "/callback") {
            res.writeHead(404);
            res.end(JSON.stringify({
                success: false,
                error: "Not found"
            }));
            return;
        }
        if (req.method !== "POST") {
            res.writeHead(405);
            res.end(JSON.stringify({
                success: false,
                error: "Method not allowed. Use POST."
            }));
            return;
        }
        let body = "";
        req.on("data", (chunk)=>{
            body += chunk.toString();
            if (body.length > 10_000) req.destroy();
        });
        req.on("end", ()=>{
            try {
                const parsed = JSON.parse(body);
                if (parsed.error) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true
                    }));
                    const description = typeof parsed.error_description === "string" ? parsed.error_description : String(parsed.error);
                    if (parsed.error === "access_denied") {
                        rejectCallback(new Error(description || "Authorization was denied by the user"));
                    } else {
                        rejectCallback(new Error(description || String(parsed.error)));
                    }
                    closeServer(server);
                    return;
                }
                const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
                const state = typeof parsed.state === "string" ? parsed.state : "";
                const userId = typeof parsed.userId === "string" ? parsed.userId : "";
                const userName = typeof parsed.userName === "string" ? parsed.userName : "";
                const keyName = typeof parsed.keyName === "string" ? parsed.keyName : "";
                if (!apiKey || !state || !userId || !userName || !keyName) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        success: false,
                        error: "Missing required fields"
                    }));
                    return;
                }
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true
                }));
                resolveCallback({
                    apiKey,
                    state,
                    userId,
                    userName,
                    keyName
                });
                closeServer(server);
            } catch  {
                res.writeHead(400);
                res.end(JSON.stringify({
                    success: false,
                    error: "Invalid JSON"
                }));
            }
        });
        req.on("error", ()=>{
            res.writeHead(500);
            res.end(JSON.stringify({
                success: false,
                error: "Request error"
            }));
        });
    });
    try {
        const port = await listenOnAvailablePort(server, options.startPort ?? DEFAULT_PORT, options.portRange ?? DEFAULT_PORT_RANGE);
        return {
            server,
            port,
            waitForCallback
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const error = new Error(`Failed to start auth server: ${message}`);
        rejectCallback(error);
        throw error;
    }
}
