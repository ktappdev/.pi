import.meta.url = "pi://@mariozechner/pi-coding-agent";
export const VERSION = "0.0.0";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 1_000_000;

export function formatSize(bytes) {
  const b = Number(bytes ?? 0);
  const KB = 1024;
  const MB = 1024 * 1024;
  if (b >= MB) return `${(b / MB).toFixed(1)}MB`;
  if (b >= KB) return `${(b / KB).toFixed(1)}KB`;
  return `${Math.trunc(b)}B`;
}

function jsBytes(value) {
  return String(value ?? "").length;
}

export function truncateHead(text, opts = {}) {
  const raw = String(text ?? "");
  const maxLines = Number(opts.maxLines ?? DEFAULT_MAX_LINES);
  const maxBytes = Number(opts.maxBytes ?? DEFAULT_MAX_BYTES);

  const lines = raw.split("\n");
  const totalLines = lines.length;
  const totalBytes = jsBytes(raw);

  const out = [];
  let outBytes = 0;
  let truncatedBy = null;

  for (const line of lines) {
    if (out.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }

    const candidate = out.length ? `\n${line}` : line;
    const candidateBytes = jsBytes(candidate);
    if (outBytes + candidateBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    out.push(line);
    outBytes += candidateBytes;
  }

  const content = out.join("\n");
  return {
    content,
    truncated: truncatedBy != null,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: out.length,
    outputBytes: jsBytes(content),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

export function truncateTail(text, opts = {}) {
  const raw = String(text ?? "");
  const maxLines = Number(opts.maxLines ?? DEFAULT_MAX_LINES);
  const maxBytes = Number(opts.maxBytes ?? DEFAULT_MAX_BYTES);

  const lines = raw.split("\n");
  const totalLines = lines.length;
  const totalBytes = jsBytes(raw);

  const out = [];
  let outBytes = 0;
  let truncatedBy = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (out.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }
    const line = lines[i];
    const candidate = out.length ? `${line}\n` : line;
    const candidateBytes = jsBytes(candidate);
    if (outBytes + candidateBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    out.unshift(line);
    outBytes += candidateBytes;
  }

  const content = out.join("\n");
  return {
    content,
    truncated: truncatedBy != null,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: out.length,
    outputBytes: jsBytes(content),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

export function parseSessionEntries(text) {
  const raw = String(text ?? "");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

export function convertToLlm(entries) {
  return entries;
}

export function serializeConversation(entries) {
  try {
    return JSON.stringify(entries ?? []);
  } catch {
    return String(entries ?? "");
  }
}

export function buildSessionContext(entries = [], _leafId = null, _byId = null) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  return {
    messages: list,
    thinkingLevel: null,
    model: null,
  };
}

export function parseFrontmatter(text) {
  const raw = String(text ?? "");
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: raw };

  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const frontmatter = {};
  for (const line of header.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

export function getMarkdownTheme() {
  return {};
}

export function getSettingsListTheme() {
  return {};
}

export function getSelectListTheme() {
  return {};
}

export class DynamicBorder {
  constructor(..._args) {}
}

export class BorderedLoader {
  constructor(..._args) {}
}

export class CustomEditor {
  constructor(_opts = {}) {
    this.value = "";
  }

  handleInput(_data) {}

  render(_width) {
    return [];
  }
}

export function createBashTool(_cwd, _opts = {}) {
  return {
    name: "bash",
    label: "bash",
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 1MB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        timeout: { type: "number", description: "Optional timeout in seconds" },
      },
      required: ["command"],
    },
    async execute(_id, params) {
      return { content: [{ type: "text", text: String(params?.command ?? "") }], details: {} };
    },
  };
}

export function createReadTool(_cwd, _opts = {}) {
  return {
    name: "read",
    label: "read",
    description: "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 1MB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file to read" },
        offset: { type: "number", description: "Line offset to start reading from (0-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function createLsTool(_cwd, _opts = {}) {
  return {
    name: "ls",
    label: "ls",
    description: "List files and directories. Returns names, sizes, and metadata.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to list" },
      },
      required: ["path"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function createGrepTool(_cwd, _opts = {}) {
  return {
    name: "grep",
    label: "grep",
    description: "Search file contents using regular expressions.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The regex pattern to search for" },
        path: { type: "string", description: "The path to search in" },
      },
      required: ["pattern"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function createFindTool(_cwd, _opts = {}) {
  return {
    name: "find",
    label: "find",
    description: "Find files and directories by glob or name pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The file name or glob pattern to match" },
        path: { type: "string", description: "The path to search in" },
      },
      required: ["pattern"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function createReadOnlyTools(cwd, opts = {}) {
  return [
    createGrepTool(cwd, opts),
    createFindTool(cwd, opts),
    createReadTool(cwd, opts),
    createLsTool(cwd, opts),
  ];
}

export function createWriteTool(_cwd, _opts = {}) {
  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file to write" },
        content: { type: "string", description: "The content to write to the file" },
      },
      required: ["path", "content"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function createEditTool(_cwd, _opts = {}) {
  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file to edit" },
        oldText: { type: "string", minLength: 1, description: "The exact text to find and replace" },
        newText: { type: "string", description: "The text to replace oldText with" },
      },
      required: ["path", "oldText", "newText"],
    },
    async execute(_id, _params) {
      return { content: [{ type: "text", text: "" }], details: {} };
    },
  };
}

export function copyToClipboard(_text) {
  return;
}

export function getAgentDir() {
  const home =
    globalThis.pi && globalThis.pi.env && typeof globalThis.pi.env.get === "function"
      ? globalThis.pi.env.get("HOME")
      : undefined;
  return home ? `${home}/.pi/agent` : "/home/unknown/.pi/agent";
}

// Stub: keyHint returns a keyboard shortcut hint string for UI display
export function keyHint(action, fallback = "") {
  // Map action names to default key bindings
  const keyMap = {
    expandTools: "Ctrl+E",
    copy: "Ctrl+C",
    paste: "Ctrl+V",
    save: "Ctrl+S",
    quit: "Ctrl+Q",
    help: "?",
  };
  return keyMap[action] || fallback || action;
}

export function rawKeyHint(action, fallback = "") {
  return keyHint(action, fallback);
}

// Stub: compact performs conversation compaction via LLM
export async function compact(_preparation, _model, _apiKey, _customInstructions, _signal) {
  // Return a minimal compaction result
  return {
    summary: "Conversation summary placeholder",
    firstKeptEntryId: null,
    tokensBefore: 0,
    tokensAfter: 0,
  };
}

/// Stub: AssistantMessageComponent for rendering assistant messages
export class AssistantMessageComponent {
  constructor(message, editable = false) {
    this.message = message;
    this.editable = editable;
  }

  render() {
    return [];
  }
}

// Stub: ToolExecutionComponent for rendering tool executions
export class ToolExecutionComponent {
  constructor(toolName, args, opts = {}, result, ui) {
    this.toolName = toolName;
    this.args = args;
    this.opts = opts;
    this.result = result;
    this.ui = ui;
  }

  render() {
    return [];
  }
}

// Stub: UserMessageComponent for rendering user messages
export class UserMessageComponent {
  constructor(text) {
    this.text = text;
  }

  render() {
    return [];
  }
}

export class ModelSelectorComponent {
  constructor(_opts = {}) {
    this.opts = _opts;
  }

  render() {
    return [];
  }
}

export class SessionManager {
  constructor() {}
  static inMemory() { return new SessionManager(); }
  getSessionFile() { return ""; }
  getSessionDir() { return ""; }
  getSessionId() { return ""; }
  buildSessionContext() { return buildSessionContext([]); }
}

export class SettingsManager {
  constructor(cwd = "", agentDir = "") {
    this.cwd = String(cwd ?? "");
    this.agentDir = String(agentDir ?? "");
  }
  static create(cwd, agentDir) { return new SettingsManager(cwd, agentDir); }
}

export class DefaultResourceLoader {
  constructor(opts = {}) {
    this.opts = opts;
  }
  async reload() { return; }
}

export function highlightCode(code, _lang, _theme) {
  return String(code ?? "");
}

export function getLanguageFromPath(filePath) {
  const ext = String(filePath ?? "").split(".").pop() || "";
  const map = { ts: "typescript", js: "javascript", py: "python", rs: "rust", go: "go", md: "markdown", json: "json", html: "html", css: "css", sh: "bash" };
  return map[ext] || ext;
}

export function isBashToolResult(result) {
  return result && typeof result === "object" && result.name === "bash";
}

export async function loadSkills() {
  return [];
}

export function truncateToVisualLines(text, maxLines = DEFAULT_MAX_LINES) {
  const raw = String(text ?? "");
  const lines = raw.split(/\r?\n/);
  if (!Number.isFinite(maxLines) || maxLines <= 0) return "";
  return lines.slice(0, Math.floor(maxLines)).join("\n");
}

export function estimateTokens(input) {
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? "");
  // Deterministic rough heuristic (chars / 4).
  return Math.max(1, Math.ceil(String(raw).length / 4));
}

export function isToolCallEventType(value) {
  const t = String(value?.type ?? value ?? "").toLowerCase();
  return t === "tool_call" || t === "tool-call" || t === "toolcall";
}

export class AuthStorage {
  constructor() {}
  static load() { return new AuthStorage(); }
  static async loadAsync() { return new AuthStorage(); }
  resolveApiKey(_provider) { return undefined; }
  get(_provider) { return undefined; }
}

export function createAgentSession(opts = {}) {
  const state = {
    id: String(opts.id ?? "session"),
    messages: Array.isArray(opts.messages) ? opts.messages.slice() : [],
  };
  return {
    id: state.id,
    messages: state.messages,
    append(entry) { state.messages.push(entry); },
    toJSON() { return { id: state.id, messages: state.messages.slice() }; },
  };
}

export default {
  VERSION,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  truncateTail,
  parseSessionEntries,
  convertToLlm,
  serializeConversation,
  buildSessionContext,
  parseFrontmatter,
  getMarkdownTheme,
  getSettingsListTheme,
  getSelectListTheme,
  DynamicBorder,
  BorderedLoader,
  CustomEditor,
  createBashTool,
  createReadTool,
  createLsTool,
  createGrepTool,
  createFindTool,
  createReadOnlyTools,
  createWriteTool,
  createEditTool,
  copyToClipboard,
  getAgentDir,
  keyHint,
  rawKeyHint,
  compact,
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  ModelSelectorComponent,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  highlightCode,
  getLanguageFromPath,
  isBashToolResult,
  loadSkills,
  truncateToVisualLines,
  estimateTokens,
  isToolCallEventType,
  AuthStorage,
  createAgentSession,
};