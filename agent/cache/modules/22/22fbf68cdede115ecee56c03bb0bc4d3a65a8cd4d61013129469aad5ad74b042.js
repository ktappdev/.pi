import.meta.url = "file:///Users/kentaylor/.pi/agent/extensions/herdr-agent-state.ts";
import { createConnection } from "node:net";
const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:pi";
function enabled() {
    return HERDR_ENV === "1" && !!socketPath && !!paneId;
}
function sendRequestAttempt(request, timeoutMs) {
    if (!enabled()) {
        return Promise.resolve(true);
    }
    return new Promise((resolve)=>{
        let done = false;
        let timeout;
        const finish = (delivered)=>{
            if (done) return;
            done = true;
            if (timeout) {
                clearTimeout(timeout);
            }
            socket.destroy();
            resolve(delivered);
        };
        const socket = createConnection(socketPath);
        socket.on("error", ()=>finish(false));
        socket.on("connect", ()=>socket.write(`${JSON.stringify(request)}\n`));
        socket.on("data", ()=>finish(true));
        socket.on("end", ()=>finish(false));
        timeout = setTimeout(()=>finish(false), timeoutMs);
        timeout.unref?.();
    });
}
async function sendRequest(request) {
    if (await sendRequestAttempt(request, 500)) {
        return;
    }
    await sendRequestAttempt(request, 1500);
}
const idleDebounceMs = parseDurationEnv("HERDR_PI_IDLE_DEBOUNCE_MS", 250);
const retryGraceMs = parseDurationEnv("HERDR_PI_RETRY_GRACE_MS", 2500);
const retryableErrorPattern = /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;
let reportSeq = Date.now() * 1000;
let currentAgentSessionId;
let currentAgentSessionPath;
function nextReportSeq() {
    reportSeq += 1;
    return reportSeq;
}
function parseDurationEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}
function updateSessionRef(ctx) {
    try {
        const file = ctx?.sessionManager?.getSessionFile?.();
        currentAgentSessionPath = typeof file === "string" && file.startsWith("/") ? file : undefined;
    } catch  {
        currentAgentSessionPath = undefined;
    }
    try {
        const id = ctx?.sessionManager?.getSessionId?.();
        currentAgentSessionId = typeof id === "string" && id.length > 0 ? id : undefined;
    } catch  {
        currentAgentSessionId = undefined;
    }
}
function withSessionRef(params) {
    if (currentAgentSessionPath) {
        return {
            ...params,
            agent_session_path: currentAgentSessionPath
        };
    }
    if (currentAgentSessionId) {
        return {
            ...params,
            agent_session_id: currentAgentSessionId
        };
    }
    return params;
}
function currentSessionRef() {
    if (currentAgentSessionPath) {
        return {
            agent_session_path: currentAgentSessionPath
        };
    }
    if (currentAgentSessionId) {
        return {
            agent_session_id: currentAgentSessionId
        };
    }
    return undefined;
}
function reportSession(sessionStartSource) {
    const sessionRef = currentSessionRef();
    if (!sessionRef) {
        return Promise.resolve();
    }
    return sendRequest({
        id: `${source}:session:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        method: "pane.report_agent_session",
        params: {
            pane_id: paneId,
            source,
            agent: "pi",
            seq: nextReportSeq(),
            session_start_source: sessionStartSource,
            ...sessionRef
        }
    });
}
function sendState(state, message, seq = nextReportSeq()) {
    return sendRequest({
        id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        method: "pane.report_agent",
        params: withSessionRef({
            pane_id: paneId,
            source,
            agent: "pi",
            state,
            message,
            seq
        })
    });
}
function releaseAgent() {
    return sendRequest({
        id: `${source}:release:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        method: "pane.release_agent",
        params: {
            pane_id: paneId,
            source,
            agent: "pi",
            seq: nextReportSeq()
        }
    });
}
function shouldReleaseOnSessionShutdown(event) {
    const reason = event?.reason;
    return reason === "quit";
}
let sendInFlight = false;
let queuedState;
function queueState(state, message) {
    queuedState = {
        state,
        message,
        seq: nextReportSeq()
    };
    if (!sendInFlight) {
        void drainStateQueue();
    }
}
async function drainStateQueue() {
    if (sendInFlight) {
        return;
    }
    sendInFlight = true;
    try {
        while(queuedState){
            const next = queuedState;
            queuedState = undefined;
            await sendState(next.state, next.message, next.seq);
        }
    } finally{
        sendInFlight = false;
        if (queuedState) {
            void drainStateQueue();
        }
    }
}
function lastAssistantMessage(messages) {
    for(let i = messages.length - 1; i >= 0; i -= 1){
        const message = messages[i];
        if (message?.role === "assistant") {
            return message;
        }
    }
    return undefined;
}
function retryableErrorMessage(event) {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    const assistant = lastAssistantMessage(messages);
    if (assistant?.stopReason !== "error") {
        return undefined;
    }
    const errorMessage = String(assistant.errorMessage ?? "");
    if (!retryableErrorPattern.test(errorMessage)) {
        return undefined;
    }
    return errorMessage || "retryable provider error";
}
export default function(pi) {
    if (!enabled()) {
        return;
    }
    let agentActive = false;
    let retryHoldActive = false;
    let failureBlocked = false;
    let failureMessage;
    let blockedCount = 0;
    let blockedMessage;
    let lastState;
    let lastMessage;
    let idleTimer;
    let retryTimer;
    let rootSession = false;
    function clearTimer(timer) {
        if (timer) {
            clearTimeout(timer);
        }
    }
    function clearPendingTimers() {
        clearTimer(idleTimer);
        clearTimer(retryTimer);
        idleTimer = undefined;
        retryTimer = undefined;
    }
    function clearFailureState() {
        retryHoldActive = false;
        failureBlocked = false;
        failureMessage = undefined;
    }
    function desiredState() {
        if (blockedCount > 0) {
            return {
                state: "blocked",
                message: blockedMessage
            };
        }
        if (failureBlocked) {
            return {
                state: "blocked",
                message: failureMessage
            };
        }
        if (agentActive || retryHoldActive) {
            return {
                state: "working",
                message: undefined
            };
        }
        return {
            state: "idle",
            message: undefined
        };
    }
    function publishState(force = false) {
        const next = desiredState();
        if (!force && next.state === lastState && next.message === lastMessage) {
            return;
        }
        lastState = next.state;
        lastMessage = next.message;
        queueState(next.state, next.message);
    }
    function scheduleIdle() {
        clearPendingTimers();
        clearFailureState();
        idleTimer = setTimeout(()=>{
            idleTimer = undefined;
            publishState();
        }, idleDebounceMs);
        idleTimer.unref?.();
    }
    function holdForRetry(message) {
        clearPendingTimers();
        retryHoldActive = true;
        failureBlocked = false;
        failureMessage = message;
        publishState();
        retryTimer = setTimeout(()=>{
            retryTimer = undefined;
            retryHoldActive = false;
            failureBlocked = true;
            publishState();
        }, retryGraceMs);
        retryTimer.unref?.();
    }
    pi.events.on("herdr:blocked", (data)=>{
        if (!rootSession) {
            return;
        }
        if (!data?.active) {
            blockedCount = Math.max(0, blockedCount - 1);
            if (blockedCount === 0) {
                blockedMessage = undefined;
            }
            publishState();
            return;
        }
        clearPendingTimers();
        blockedCount += 1;
        blockedMessage = data.label;
        publishState();
    });
    pi.on("session_start", async (event, ctx)=>{
        if (ctx?.hasUI !== true) {
            return;
        }
        rootSession = true;
        updateSessionRef(ctx);
        await reportSession(event?.reason);
        agentActive = ctx?.isIdle?.() === false;
        publishState(true);
    });
    pi.on("agent_start", (_event, ctx)=>{
        if (!rootSession) {
            return;
        }
        updateSessionRef(ctx);
        void reportSession();
        clearPendingTimers();
        clearFailureState();
        agentActive = true;
        publishState();
    });
    pi.on("agent_end", (event)=>{
        if (!rootSession) {
            return;
        }
        if (!agentActive) {
            return;
        }
        agentActive = false;
        const retryableMessage = retryableErrorMessage(event);
        if (retryableMessage) {
            holdForRetry(retryableMessage);
            return;
        }
        scheduleIdle();
    });
    pi.on("session_shutdown", async (event)=>{
        if (!rootSession) {
            return;
        }
        clearPendingTimers();
        if (shouldReleaseOnSessionShutdown(event)) {
            await releaseAgent();
        }
    });
}
