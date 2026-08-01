import.meta.url = "pi://node:stream";
import EventEmitter from "node:events";

function __streamToError(err) {
  return err instanceof Error ? err : new Error(String(err ?? "stream error"));
}

function __streamQueueMicrotask(fn) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
    return;
  }
  Promise.resolve().then(fn);
}

function __normalizeChunk(chunk, encoding) {
  if (chunk === null || chunk === undefined) return chunk;
  if (typeof chunk === "string") return chunk;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(chunk)) {
    return encoding ? chunk.toString(encoding) : chunk;
  }
  if (chunk instanceof Uint8Array) {
    return encoding && typeof Buffer !== "undefined" && Buffer.from
      ? Buffer.from(chunk).toString(encoding)
      : chunk;
  }
  if (chunk instanceof ArrayBuffer) {
    const view = new Uint8Array(chunk);
    return encoding && typeof Buffer !== "undefined" && Buffer.from
      ? Buffer.from(view).toString(encoding)
      : view;
  }
  if (ArrayBuffer.isView(chunk)) {
    const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return encoding && typeof Buffer !== "undefined" && Buffer.from
      ? Buffer.from(view).toString(encoding)
      : view;
  }
  return encoding ? String(chunk) : chunk;
}

class Stream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
  }

  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (err) this.emit("error", __streamToError(err));
    this.emit("close");
    return this;
  }
}

class Readable extends Stream {
  constructor(opts = {}) {
    super();
    this._readableState = { flowing: null, ended: false, encoding: opts.encoding || null };
    this.readable = true;
    this._queue = [];
    this._pipeCleanup = new Map();
    this._autoDestroy = opts.autoDestroy !== false;
  }

  push(chunk) {
    if (chunk === null) {
      if (this._readableState.ended) return false;
      this._readableState.ended = true;
      __streamQueueMicrotask(() => {
        this.emit("end");
        if (this._autoDestroy) this.emit("close");
      });
      return false;
    }
    const normalized = __normalizeChunk(chunk, this._readableState.encoding);
    this._queue.push(normalized);
    this.emit("data", normalized);
    return true;
  }

  read(_size) {
    return this._queue.length > 0 ? this._queue.shift() : null;
  }

  pipe(dest) {
    if (!dest || typeof dest.write !== "function") {
      throw new Error("stream.pipe destination must implement write()");
    }

    const onData = (chunk) => {
      const writable = dest.write(chunk);
      if (writable === false && typeof this.pause === "function") {
        this.pause();
      }
    };
    const onDrain = () => {
      if (typeof this.resume === "function") this.resume();
    };
    const onEnd = () => {
      if (typeof dest.end === "function") dest.end();
      cleanup();
    };
    const onError = (err) => {
      cleanup();
      if (typeof dest.destroy === "function") {
        dest.destroy(err);
      } else if (typeof dest.emit === "function") {
        dest.emit("error", err);
      }
    };
    const cleanup = () => {
      this.removeListener("data", onData);
      this.removeListener("end", onEnd);
      this.removeListener("error", onError);
      if (typeof dest.removeListener === "function") {
        dest.removeListener("drain", onDrain);
      }
      this._pipeCleanup.delete(dest);
    };

    this.on("data", onData);
    this.on("end", onEnd);
    this.on("error", onError);
    if (typeof dest.on === "function") {
      dest.on("drain", onDrain);
    }
    this._pipeCleanup.set(dest, cleanup);
    return dest;
  }

  unpipe(dest) {
    if (dest) {
      const cleanup = this._pipeCleanup.get(dest);
      if (cleanup) cleanup();
      return this;
    }
    for (const cleanup of this._pipeCleanup.values()) {
      cleanup();
    }
    this._pipeCleanup.clear();
    return this;
  }

  resume() {
    this._readableState.flowing = true;
    return this;
  }

  pause() {
    this._readableState.flowing = false;
    return this;
  }

  [Symbol.asyncIterator]() {
    const stream = this;
    const queue = [];
    const waiters = [];
    let done = false;
    let failure = null;

    const settleDone = () => {
      done = true;
      while (waiters.length > 0) {
        waiters.shift().resolve({ value: undefined, done: true });
      }
    };
    const settleError = (err) => {
      failure = __streamToError(err);
      while (waiters.length > 0) {
        waiters.shift().reject(failure);
      }
    };
    const onData = (value) => {
      if (waiters.length > 0) {
        waiters.shift().resolve({ value, done: false });
      } else {
        queue.push(value);
      }
    };
    const onEnd = () => settleDone();
    const onError = (err) => settleError(err);
    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);

    return {
      async next() {
        if (queue.length > 0) return { value: queue.shift(), done: false };
        if (failure) throw failure;
        if (done) return { value: undefined, done: true };
        return await new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      },
      async return() {
        cleanup();
        settleDone();
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  }

  static from(iterable, opts = {}) {
    const readable = new Readable(opts);
    (async () => {
      try {
        for await (const chunk of iterable) {
          readable.push(chunk);
        }
        readable.push(null);
      } catch (err) {
        readable.emit("error", __streamToError(err));
      }
    })();
    return readable;
  }

  static fromWeb(webReadable, opts = {}) {
    if (!webReadable || typeof webReadable.getReader !== "function") {
      throw new Error("Readable.fromWeb expects a Web ReadableStream");
    }
    const reader = webReadable.getReader();
    const readable = new Readable(opts);
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          readable.push(value);
        }
        readable.push(null);
      } catch (err) {
        readable.emit("error", __streamToError(err));
      } finally {
        try { reader.releaseLock(); } catch (_) {}
      }
    })();
    return readable;
  }

  static toWeb(nodeReadable) {
    if (typeof ReadableStream !== "function") {
      throw new Error("Readable.toWeb requires global ReadableStream");
    }
    if (!nodeReadable || typeof nodeReadable.on !== "function") {
      throw new Error("Readable.toWeb expects a Node Readable stream");
    }
    return new ReadableStream({
      start(controller) {
        const onData = (chunk) => controller.enqueue(chunk);
        const onEnd = () => {
          cleanup();
          controller.close();
        };
        const onError = (err) => {
          cleanup();
          controller.error(__streamToError(err));
        };
        const cleanup = () => {
          nodeReadable.removeListener?.("data", onData);
          nodeReadable.removeListener?.("end", onEnd);
          nodeReadable.removeListener?.("error", onError);
        };
        nodeReadable.on("data", onData);
        nodeReadable.on("end", onEnd);
        nodeReadable.on("error", onError);
        if (typeof nodeReadable.resume === "function") nodeReadable.resume();
      },
      cancel(reason) {
        if (typeof nodeReadable.destroy === "function") {
          nodeReadable.destroy(__streamToError(reason ?? "stream cancelled"));
        }
      },
    });
  }
}

class Writable extends Stream {
  constructor(opts = {}) {
    super();
    this._writableState = { ended: false, finished: false };
    this.writable = true;
    this._autoDestroy = opts.autoDestroy !== false;
    this._writeImpl = typeof opts.write === "function" ? opts.write.bind(this) : null;
    this._finalImpl = typeof opts.final === "function" ? opts.final.bind(this) : null;
  }

  _write(chunk, encoding, callback) {
    if (this._writeImpl) {
      this._writeImpl(chunk, encoding, callback);
      return;
    }
    callback(null);
  }

  write(chunk, encoding, callback) {
    let cb = callback;
    let enc = encoding;
    if (typeof encoding === "function") {
      cb = encoding;
      enc = undefined;
    }
    if (this._writableState.ended) {
      const err = new Error("write after end");
      if (typeof cb === "function") cb(err);
      this.emit("error", err);
      return false;
    }

    try {
      this._write(chunk, enc, (err) => {
        if (err) {
          const normalized = __streamToError(err);
          if (typeof cb === "function") cb(normalized);
          this.emit("error", normalized);
          return;
        }
        if (typeof cb === "function") cb(null);
        this.emit("drain");
      });
    } catch (err) {
      const normalized = __streamToError(err);
      if (typeof cb === "function") cb(normalized);
      this.emit("error", normalized);
      return false;
    }
    return true;
  }

  _finish(callback) {
    if (this._finalImpl) {
      try {
        this._finalImpl(callback);
      } catch (err) {
        callback(__streamToError(err));
      }
      return;
    }
    callback(null);
  }

  end(chunk, encoding, callback) {
    let cb = callback;
    let enc = encoding;
    if (typeof encoding === "function") {
      cb = encoding;
      enc = undefined;
    }

    const finalize = () => {
      if (this._writableState.ended) {
        if (typeof cb === "function") cb(null);
        return;
      }
      this._writableState.ended = true;
      this._finish((err) => {
        if (err) {
          const normalized = __streamToError(err);
          if (typeof cb === "function") cb(normalized);
          this.emit("error", normalized);
          return;
        }
        this._writableState.finished = true;
        this.emit("finish");
        if (this._autoDestroy) this.emit("close");
        if (typeof cb === "function") cb(null);
      });
    };

    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, enc, (err) => {
        if (err) {
          if (typeof cb === "function") cb(err);
          return;
        }
        finalize();
      });
      return this;
    }

    finalize();
    return this;
  }

  static fromWeb(webWritable, opts = {}) {
    if (!webWritable || typeof webWritable.getWriter !== "function") {
      throw new Error("Writable.fromWeb expects a Web WritableStream");
    }
    const writer = webWritable.getWriter();
    return new Writable({
      ...opts,
      write(chunk, _encoding, callback) {
        Promise.resolve(writer.write(chunk))
          .then(() => callback(null))
          .catch((err) => callback(__streamToError(err)));
      },
      final(callback) {
        Promise.resolve(writer.close())
          .then(() => {
            try { writer.releaseLock(); } catch (_) {}
            callback(null);
          })
          .catch((err) => callback(__streamToError(err)));
      },
    });
  }

  static toWeb(nodeWritable) {
    if (typeof WritableStream !== "function") {
      throw new Error("Writable.toWeb requires global WritableStream");
    }
    if (!nodeWritable || typeof nodeWritable.write !== "function") {
      throw new Error("Writable.toWeb expects a Node Writable stream");
    }
    return new WritableStream({
      write(chunk) {
        return new Promise((resolve, reject) => {
          try {
            const ok = nodeWritable.write(chunk, (err) => {
              if (err) reject(__streamToError(err));
              else resolve();
            });
            if (ok === true) resolve();
          } catch (err) {
            reject(__streamToError(err));
          }
        });
      },
      close() {
        return new Promise((resolve, reject) => {
          try {
            nodeWritable.end((err) => {
              if (err) reject(__streamToError(err));
              else resolve();
            });
          } catch (err) {
            reject(__streamToError(err));
          }
        });
      },
      abort(reason) {
        if (typeof nodeWritable.destroy === "function") {
          nodeWritable.destroy(__streamToError(reason ?? "stream aborted"));
        }
      },
    });
  }
}

class Duplex extends Readable {
  constructor(opts = {}) {
    super(opts);
    this._writableState = { ended: false, finished: false };
    this.writable = true;
    this._autoDestroy = opts.autoDestroy !== false;
    this._writeImpl = typeof opts.write === "function" ? opts.write.bind(this) : null;
    this._finalImpl = typeof opts.final === "function" ? opts.final.bind(this) : null;
  }

  _write(chunk, encoding, callback) {
    if (this._writeImpl) {
      this._writeImpl(chunk, encoding, callback);
      return;
    }
    callback(null);
  }

  _finish(callback) {
    if (this._finalImpl) {
      try {
        this._finalImpl(callback);
      } catch (err) {
        callback(__streamToError(err));
      }
      return;
    }
    callback(null);
  }

  write(chunk, encoding, callback) {
    return Writable.prototype.write.call(this, chunk, encoding, callback);
  }

  end(chunk, encoding, callback) {
    return Writable.prototype.end.call(this, chunk, encoding, callback);
  }
}

class Transform extends Duplex {
  constructor(opts = {}) {
    super(opts);
    this._transformImpl = typeof opts.transform === "function" ? opts.transform.bind(this) : null;
  }

  _transform(chunk, encoding, callback) {
    if (this._transformImpl) {
      this._transformImpl(chunk, encoding, callback);
      return;
    }
    callback(null, chunk);
  }

  write(chunk, encoding, callback) {
    let cb = callback;
    let enc = encoding;
    if (typeof encoding === "function") {
      cb = encoding;
      enc = undefined;
    }
    try {
      this._transform(chunk, enc, (err, data) => {
        if (err) {
          const normalized = __streamToError(err);
          if (typeof cb === "function") cb(normalized);
          this.emit("error", normalized);
          return;
        }
        if (data !== undefined && data !== null) {
          this.push(data);
        }
        if (typeof cb === "function") cb(null);
      });
    } catch (err) {
      const normalized = __streamToError(err);
      if (typeof cb === "function") cb(normalized);
      this.emit("error", normalized);
      return false;
    }
    return true;
  }

  end(chunk, encoding, callback) {
    let cb = callback;
    let enc = encoding;
    if (typeof encoding === "function") {
      cb = encoding;
      enc = undefined;
    }
    const finalize = () => {
      this.push(null);
      this.emit("finish");
      this.emit("close");
      if (typeof cb === "function") cb(null);
    };
    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, enc, (err) => {
        if (err) {
          if (typeof cb === "function") cb(err);
          return;
        }
        finalize();
      });
      return this;
    }
    finalize();
    return this;
  }
}

class PassThrough extends Transform {
  _transform(chunk, _encoding, callback) { callback(null, chunk); }
}

function finished(stream, callback) {
  if (!stream || typeof stream.on !== "function") {
    const err = new Error("finished expects a stream-like object");
    if (typeof callback === "function") callback(err);
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.removeListener?.("finish", onDone);
      stream.removeListener?.("end", onDone);
      stream.removeListener?.("close", onDone);
      stream.removeListener?.("error", onError);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onDone = () => {
      if (typeof callback === "function") callback(null, stream);
      settle(resolve, stream);
    };
    const onError = (err) => {
      const normalized = __streamToError(err);
      if (typeof callback === "function") callback(normalized);
      settle(reject, normalized);
    };
    stream.on("finish", onDone);
    stream.on("end", onDone);
    stream.on("close", onDone);
    stream.on("error", onError);
  });
}

function pipeline(...args) {
  const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
  const streams = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!Array.isArray(streams) || streams.length < 2) {
    const err = new Error("pipeline requires at least two streams");
    if (callback) callback(err);
    throw err;
  }

  for (let i = 0; i < streams.length - 1; i += 1) {
    streams[i].pipe(streams[i + 1]);
  }
  const last = streams[streams.length - 1];
  const done = (err) => {
    if (callback) callback(err || null, last);
  };
  last.on?.("finish", () => done(null));
  last.on?.("end", () => done(null));
  last.on?.("error", (err) => done(__streamToError(err)));
  return last;
}

const promises = {
  pipeline: (...args) =>
    new Promise((resolve, reject) => {
      try {
        pipeline(...args, (err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      } catch (err) {
        reject(__streamToError(err));
      }
    }),
  finished: (stream) => finished(stream),
};

export { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished, promises };
export default { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished, promises };