import.meta.url = "pi://node:child_process";
const __pi_child_process_state = (() => {
  if (globalThis.__pi_child_process_state) {
    return globalThis.__pi_child_process_state;
  }
  const state = {
    nextPid: 1000,
    children: new Map(),
  };
  globalThis.__pi_child_process_state = state;
  return state;
})();

function __makeEmitter() {
  const listeners = new Map();
  const emitter = {
    on(event, listener) {
      const key = String(event);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(listener);
      return emitter;
    },
    once(event, listener) {
      const wrapper = (...args) => {
        emitter.off(event, wrapper);
        listener(...args);
      };
      return emitter.on(event, wrapper);
    },
    off(event, listener) {
      const key = String(event);
      const bucket = listeners.get(key);
      if (!bucket) return emitter;
      const idx = bucket.indexOf(listener);
      if (idx >= 0) bucket.splice(idx, 1);
      if (bucket.length === 0) listeners.delete(key);
      return emitter;
    },
    removeListener(event, listener) {
      return emitter.off(event, listener);
    },
    emit(event, ...args) {
      const key = String(event);
      const bucket = listeners.get(key) || [];
      for (const listener of [...bucket]) {
        try {
          listener(...args);
        } catch (_) {}
      }
      return emitter;
    },
  };
  return emitter;
}

function __emitCloseOnce(child, code, signal = null) {
  if (child.__pi_done) return;
  child.__pi_done = true;
  child.exitCode = code;
  child.signalCode = signal;
  __pi_child_process_state.children.delete(child.pid);
  child.emit("exit", code, signal);
  child.emit("close", code, signal);
}

function __parseSpawnOptions(raw) {
  const options = raw && typeof raw === "object" ? raw : {};
  const allowed = new Set(["cwd", "detached", "shell", "stdio", "timeout"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new Error(`node:child_process.spawn: unsupported option '${key}'`);
    }
  }

  if (options.shell !== undefined && options.shell !== false) {
    throw new Error("node:child_process.spawn: only shell=false is supported in PiJS");
  }

  let stdio = ["pipe", "pipe", "pipe"];
  if (options.stdio !== undefined) {
    if (!Array.isArray(options.stdio)) {
      throw new Error("node:child_process.spawn: options.stdio must be an array");
    }
    if (options.stdio.length !== 3) {
      throw new Error("node:child_process.spawn: options.stdio must have exactly 3 entries");
    }
    stdio = options.stdio.map((entry, idx) => {
      const value = String(entry ?? "");
      if (value !== "ignore" && value !== "pipe") {
        throw new Error(
          `node:child_process.spawn: unsupported stdio[${idx}] value '${value}'`,
        );
      }
      return value;
    });
  }

  const cwd =
    typeof options.cwd === "string" && options.cwd.trim().length > 0
      ? options.cwd
      : undefined;
  let timeoutMs = undefined;
  if (options.timeout !== undefined) {
    if (
      typeof options.timeout !== "number" ||
      !Number.isFinite(options.timeout) ||
      options.timeout < 0
    ) {
      throw new Error(
        "node:child_process.spawn: options.timeout must be a non-negative number",
      );
    }
    timeoutMs = Math.floor(options.timeout);
  }

  return {
    cwd,
    detached: Boolean(options.detached),
    stdio,
    timeoutMs,
  };
}

function __installProcessKillBridge() {
  globalThis.__pi_process_kill_impl = (pidValue, signal = "SIGTERM") => {
    const pidNumeric = Number(pidValue);
    if (!Number.isFinite(pidNumeric) || pidNumeric === 0) {
      const err = new Error(`kill EINVAL: invalid pid ${String(pidValue)}`);
      err.code = "EINVAL";
      throw err;
    }
    const pid = Math.abs(Math.trunc(pidNumeric));
    const child = __pi_child_process_state.children.get(pid);
    if (!child) {
      const err = new Error(`kill ESRCH: no such process ${pid}`);
      err.code = "ESRCH";
      throw err;
    }
    child.kill(signal);
    return true;
  };
}

__installProcessKillBridge();

export function spawn(command, args = [], options = {}) {
  const cmd = String(command ?? "").trim();
  if (!cmd) {
    throw new Error("node:child_process.spawn: command is required");
  }
  if (!Array.isArray(args)) {
    throw new Error("node:child_process.spawn: args must be an array");
  }

  const argv = args.map((arg) => String(arg));
  const opts = __parseSpawnOptions(options);

  const child = __makeEmitter();
  child.pid = __pi_child_process_state.nextPid++;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.__pi_done = false;
  child.__pi_call_id = null;
  child.stdout = opts.stdio[1] === "pipe" ? __makeEmitter() : null;
  child.stderr = opts.stdio[2] === "pipe" ? __makeEmitter() : null;
  child.stdin = opts.stdio[0] === "pipe" ? __makeEmitter() : null;

  child.kill = (signal = "SIGTERM") => {
    if (child.__pi_done) return false;
    if (
      child.__pi_call_id === null ||
      typeof __pi_cancel_hostcall_native !== "function"
    ) {
      return false;
    }
    try {
      if (!__pi_cancel_hostcall_native(child.__pi_call_id)) {
        return false;
      }
    } catch (_) {
      return false;
    }
    child.killed = true;
    __emitCloseOnce(child, null, String(signal || "SIGTERM"));
    return true;
  };

  __pi_child_process_state.children.set(child.pid, child);

  const execOptions = {};
  if (opts.cwd !== undefined) execOptions.cwd = opts.cwd;
  if (opts.timeoutMs !== undefined) execOptions.timeout = opts.timeoutMs;
  execOptions.stream = true;
  execOptions.onChunk = (chunk) => {
    if (child.__pi_done || !chunk || typeof chunk !== "object") {
      return;
    }
    if (child.stdout && chunk.stdout !== undefined && chunk.stdout !== null && chunk.stdout !== "") {
      child.stdout.emit("data", String(chunk.stdout));
    }
    if (child.stderr && chunk.stderr !== undefined && chunk.stderr !== null && chunk.stderr !== "") {
      child.stderr.emit("data", String(chunk.stderr));
    }
  };
  const onChunk = execOptions.onChunk;
  delete execOptions.onChunk;
  const execPromise = new Promise((resolve, reject) => {
    const callId = __pi_exec_native(cmd, argv, execOptions);
    child.__pi_call_id = callId;
    __pi_pending_hostcalls.set(callId, {
      onChunk,
      resolve,
      reject,
      extensionId: __pi_current_extension_id,
    });
  }).then(
    (result) => ({ kind: "result", result }),
    (error) => ({ kind: "error", error })
  );

  execPromise.then((outcome) => {
    if (!outcome || child.__pi_done) return;

    if (outcome.kind === "result") {
      const result = outcome.result || {};
      if (result.killed) {
        child.killed = true;
      }
      const code =
        typeof result.code === "number" && Number.isFinite(result.code)
          ? result.code
          : 0;
      const signal =
        result.killed || child.killed
          ? String(result.signal || "SIGTERM")
          : null;
      __emitCloseOnce(child, signal ? null : code, signal);
      return;
    }

    if (outcome.kind === "error") {
      const source = outcome.error || {};
      const error =
        source instanceof Error
          ? source
          : new Error(String(source.message || source || "spawn failed"));
      if (!error.code && source && source.code !== undefined) {
        error.code = String(source.code);
      }
      child.emit("error", error);
      __emitCloseOnce(child, 1, null);
    }
  });

  return child;
}

function __parseExecSyncResult(raw, command) {
  const result = JSON.parse(raw);
  if (result.error) {
    const err = new Error(`Command failed: ${command}\n${result.error}`);
    err.status = null;
    err.stdout = result.stdout || "";
    err.stderr = result.stderr || "";
    err.pid = result.pid || 0;
    err.signal = null;
    throw err;
  }
  if (result.killed) {
    const err = new Error(`Command timed out: ${command}`);
    err.killed = true;
    err.status = result.status;
    err.stdout = result.stdout || "";
    err.stderr = result.stderr || "";
    err.pid = result.pid || 0;
    err.signal = "SIGTERM";
    throw err;
  }
  return result;
}

export function spawnSync(command, argsInput, options) {
  const cmd = String(command ?? "").trim();
  if (!cmd) {
    throw new Error("node:child_process.spawnSync: command is required");
  }
  const args = Array.isArray(argsInput) ? argsInput.map(String) : [];
  const opts = (typeof argsInput === "object" && !Array.isArray(argsInput))
    ? argsInput
    : (options || {});
  const cwd = typeof opts.cwd === "string" ? opts.cwd : "";
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 0;
  const maxBuffer = typeof opts.maxBuffer === "number" ? opts.maxBuffer : 1024 * 1024;

  let result;
  try {
    const raw = __pi_exec_sync_native(cmd, JSON.stringify(args), cwd, timeout, maxBuffer);
    result = JSON.parse(raw);
  } catch (e) {
    return {
      pid: 0,
      output: [null, "", e.message || ""],
      stdout: "",
      stderr: e.message || "",
      status: null,
      signal: null,
      error: e,
    };
  }

  if (result.error) {
    const err = new Error(result.error);
    return {
      pid: result.pid || 0,
      output: [null, result.stdout || "", result.stderr || ""],
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      status: null,
      signal: result.killed ? "SIGTERM" : null,
      error: err,
    };
  }

  return {
    pid: result.pid || 0,
    output: [null, result.stdout || "", result.stderr || ""],
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 0,
    signal: result.killed ? "SIGTERM" : null,
    error: undefined,
  };
}

export function execSync(command, options) {
  const cmdStr = String(command ?? "").trim();
  if (!cmdStr) {
    throw new Error("node:child_process.execSync: command is required");
  }
  const opts = options || {};
  const cwd = typeof opts.cwd === "string" ? opts.cwd : "";
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 0;
  const maxBuffer = typeof opts.maxBuffer === "number" ? opts.maxBuffer : 1024 * 1024;

  // execSync runs through a shell, so pass via sh -c
  const raw = __pi_exec_sync_native("sh", JSON.stringify(["-c", cmdStr]), cwd, timeout, maxBuffer);
  const result = __parseExecSyncResult(raw, cmdStr);

  if (result.error) {
    result.error.status = result.status;
    result.error.stdout = result.stdout || "";
    result.error.stderr = result.stderr || "";
    result.error.pid = result.pid || 0;
    result.error.signal = result.signal;
    throw result.error;
  }

  if (result.status !== 0 && result.status !== null) {
    const err = new Error(
      `Command failed: ${cmdStr}\n${result.stderr || ""}`,
    );
    err.status = result.status;
    err.stdout = result.stdout || "";
    err.stderr = result.stderr || "";
    err.pid = result.pid || 0;
    err.signal = null;
    throw err;
  }

  const stdout = result.stdout || "";
  if (stdout.length > maxBuffer) {
    const err = new Error(`stdout maxBuffer length exceeded`);
    err.stdout = stdout.slice(0, maxBuffer);
    err.stderr = result.stderr || "";
    throw err;
  }

  const encoding = opts.encoding;
  if (encoding === "buffer" || encoding === null) {
    // Return a "buffer-like" string (QuickJS doesn't have real Buffer)
    return stdout;
  }
  return stdout;
}

function __normalizeExecOptions(raw) {
  const options = raw && typeof raw === "object" ? raw : {};
  let timeoutMs = undefined;
  if (
    typeof options.timeout === "number" &&
    Number.isFinite(options.timeout) &&
    options.timeout >= 0
  ) {
    timeoutMs = Math.floor(options.timeout);
  }
  const maxBuffer =
    typeof options.maxBuffer === "number" &&
    Number.isFinite(options.maxBuffer) &&
    options.maxBuffer > 0
      ? Math.floor(options.maxBuffer)
      : 1024 * 1024;
  return {
    cwd: typeof options.cwd === "string" && options.cwd.trim().length > 0 ? options.cwd : undefined,
    timeoutMs,
    maxBuffer,
    encoding: options.encoding,
  };
}

function __utf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
}

function __truncateToUtf8Bytes(value, maxBytes) {
  const text = String(value ?? "");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function __wrapExecLike(commandForError, child, opts, callback) {
  let stdoutChunks = [];
  let stderrChunks = [];
  let callbackDone = false;
  const finish = (err, outStr, errOutStr) => {
    if (callbackDone) return;
    callbackDone = true;
    const out = outStr !== undefined ? outStr : stdoutChunks.join("");
    const errOut = errOutStr !== undefined ? errOutStr : stderrChunks.join("");
    if (typeof callback === "function") {
      callback(err, out, errOut);
    }
  };

  let stdoutLen = 0;
  let stderrLen = 0;
  let killedForMaxBuffer = false;

  const checkMaxBuffer = (isStdout) => {
    if (stdoutLen > opts.maxBuffer || stderrLen > opts.maxBuffer) {
      if (!killedForMaxBuffer) {
        killedForMaxBuffer = true;
        child.kill("SIGTERM");
        const out = stdoutChunks.join("");
        const errOut = stderrChunks.join("");
        const err = new Error(`${isStdout ? "stdout" : "stderr"} maxBuffer length exceeded`);
        err.stdout = __truncateToUtf8Bytes(out, opts.maxBuffer);
        err.stderr = __truncateToUtf8Bytes(errOut, opts.maxBuffer);
        finish(err, err.stdout, err.stderr);
      }
    }
  };

  child.stdout?.on("data", (chunk) => {
    if (killedForMaxBuffer) return;
    const str = String(chunk ?? "");
    stdoutChunks.push(str);
    stdoutLen += __utf8ByteLength(str);
    checkMaxBuffer(true);
  });
  child.stderr?.on("data", (chunk) => {
    if (killedForMaxBuffer) return;
    const str = String(chunk ?? "");
    stderrChunks.push(str);
    stderrLen += __utf8ByteLength(str);
    checkMaxBuffer(false);
  });

  child.on("error", (error) => {
    if (killedForMaxBuffer) return;
    finish(
      error instanceof Error ? error : new Error(String(error)),
      "",
      "",
    );
  });

  child.on("close", (code) => {
    if (killedForMaxBuffer) return;
    let out = stdoutChunks.join("");
    let errOut = stderrChunks.join("");

    if (__utf8ByteLength(out) > opts.maxBuffer) {
      const err = new Error("stdout maxBuffer length exceeded");
      err.stdout = __truncateToUtf8Bytes(out, opts.maxBuffer);
      err.stderr = errOut;
      finish(err, err.stdout, errOut);
      return;
    }

    if (__utf8ByteLength(errOut) > opts.maxBuffer) {
      const err = new Error("stderr maxBuffer length exceeded");
      err.stdout = out;
      err.stderr = __truncateToUtf8Bytes(errOut, opts.maxBuffer);
      finish(err, out, err.stderr);
      return;
    }

    if (opts.encoding !== "buffer" && opts.encoding !== null) {
      out = String(out);
      errOut = String(errOut);
    }

    if (code !== 0 && code !== undefined && code !== null) {
      const err = new Error(`Command failed: ${commandForError}`);
      err.code = code;
      err.killed = Boolean(child.killed);
      err.stdout = out;
      err.stderr = errOut;
      finish(err, out, errOut);
      return;
    }

    if (child.killed) {
      const err = new Error(`Command timed out: ${commandForError}`);
      err.code = null;
      err.killed = true;
      err.signal = child.signalCode || "SIGTERM";
      err.stdout = out;
      err.stderr = errOut;
      finish(err, out, errOut);
      return;
    }

    finish(null, out, errOut);
  });

  return child;
}

export function exec(command, optionsOrCallback, callbackArg) {
  const opts = typeof optionsOrCallback === "object" ? optionsOrCallback : {};
  const callback = typeof optionsOrCallback === "function"
    ? optionsOrCallback
    : callbackArg;
  const cmdStr = String(command ?? "").trim();
  const normalized = __normalizeExecOptions(opts);
  const spawnOpts = {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (normalized.cwd !== undefined) spawnOpts.cwd = normalized.cwd;
  if (normalized.timeoutMs !== undefined) spawnOpts.timeout = normalized.timeoutMs;
  const child = spawn("sh", ["-c", cmdStr], spawnOpts);
  return __wrapExecLike(cmdStr, child, normalized, callback);
}

export function execFileSync(file, argsInput, options) {
  const fileStr = String(file ?? "").trim();
  if (!fileStr) {
    throw new Error("node:child_process.execFileSync: file is required");
  }
  const args = Array.isArray(argsInput) ? argsInput.map(String) : [];
  const opts = (typeof argsInput === "object" && !Array.isArray(argsInput))
    ? argsInput
    : (options || {});
  const cwd = typeof opts.cwd === "string" ? opts.cwd : "";
  const timeout = typeof opts.timeout === "number" ? opts.timeout : 0;
  const maxBuffer = typeof opts.maxBuffer === "number" ? opts.maxBuffer : 1024 * 1024;

  const raw = __pi_exec_sync_native(fileStr, JSON.stringify(args), cwd, timeout, maxBuffer);
  const result = __parseExecSyncResult(raw, fileStr);

  if (result.error) {
    result.error.status = result.status;
    result.error.stdout = result.stdout || "";
    result.error.stderr = result.stderr || "";
    result.error.pid = result.pid || 0;
    result.error.signal = result.signal;
    throw result.error;
  }

  if (result.status !== 0 && result.status !== null) {
    const err = new Error(
      `Command failed: ${fileStr}\n${result.stderr || ""}`,
    );
    err.status = result.status;
    err.stdout = result.stdout || "";
    err.stderr = result.stderr || "";
    err.pid = result.pid || 0;
    throw err;
  }

  return result.stdout || "";
}

export function execFile(file, argsOrOptsOrCb, optsOrCb, callbackArg) {
  const fileStr = String(file ?? "").trim();
  let args = [];
  let opts = {};
  let callback;
  if (typeof argsOrOptsOrCb === "function") {
    callback = argsOrOptsOrCb;
  } else if (Array.isArray(argsOrOptsOrCb)) {
    args = argsOrOptsOrCb.map(String);
    if (typeof optsOrCb === "function") {
      callback = optsOrCb;
    } else {
      opts = optsOrCb || {};
      callback = callbackArg;
    }
  } else if (typeof argsOrOptsOrCb === "object") {
    opts = argsOrOptsOrCb || {};
    callback = typeof optsOrCb === "function" ? optsOrCb : callbackArg;
  }

  const normalized = __normalizeExecOptions(opts);
  const spawnOpts = {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (normalized.cwd !== undefined) spawnOpts.cwd = normalized.cwd;
  if (normalized.timeoutMs !== undefined) spawnOpts.timeout = normalized.timeoutMs;
  const child = spawn(fileStr, args, spawnOpts);
  return __wrapExecLike(fileStr, child, normalized, callback);
}

export function fork(_modulePath, _args, _opts) {
  throw new Error("node:child_process.fork is not available in PiJS");
}

export default { spawn, spawnSync, execSync, execFileSync, exec, execFile, fork };