import.meta.url = "pi://node:net";
import EventEmitter from 'node:events';

// Stub net module - socket operations are not available in PiJS (no network I/O)

function __pi_net_schedule(fn) {
  if (typeof globalThis.setTimeout === 'function') {
    globalThis.setTimeout(fn, 0);
    return;
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
    return;
  }
  fn();
}

function __pi_net_bytes(data) {
  if (typeof data === 'string') return data.length;
  if (data && typeof data.byteLength === 'number') return data.byteLength;
  if (data && typeof data.length === 'number') return data.length;
  return 0;
}

function __pi_net_parse_args(args) {
  let options = {};
  let connectListener = null;
  if (!args || args.length === 0) return { options, connectListener };

  const first = args[0];
  if (typeof first === 'function') {
    connectListener = first;
    return { options, connectListener };
  }

  if (first && typeof first === 'object' && !Array.isArray(first)) {
    options = { ...first };
    if (typeof args[1] === 'function') connectListener = args[1];
    return { options, connectListener };
  }

  if (typeof first === 'number' || typeof first === 'string') {
    options.port = first;
    if (typeof args[1] === 'string') {
      options.host = args[1];
      if (typeof args[2] === 'function') connectListener = args[2];
    } else if (typeof args[1] === 'function') {
      connectListener = args[1];
    }
  }

  return { options, connectListener };
}

function __pi_net_apply_options(socket, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const host = opts.host ?? opts.hostname ?? socket.remoteAddress ?? '127.0.0.1';
  const port = opts.port ?? socket.remotePort ?? 0;
  socket.remoteAddress = String(host);
  socket.remotePort = Number(port) || 0;
  socket.localAddress = socket.localAddress || '127.0.0.1';
  socket.localPort = socket.localPort || 0;
}

function __pi_net_finish_connect(socket) {
  __pi_net_schedule(() => {
    if (socket.destroyed) return;
    socket.connecting = false;
    socket.readyState = 'open';
    socket.emit('connect');
  });
}

export class Socket extends EventEmitter {
  constructor(options = {}) {
    super();
    this.destroyed = false;
    this.connecting = false;
    this.readyState = 'closed';
    this.bytesWritten = 0;
    this.bytesRead = 0;
    this.localAddress = '127.0.0.1';
    this.localPort = 0;
    this.remoteAddress = '127.0.0.1';
    this.remotePort = 0;
    __pi_net_apply_options(this, options);
  }

  connect(...args) {
    const { options, connectListener } = __pi_net_parse_args(args);
    __pi_net_apply_options(this, options);
    if (typeof connectListener === 'function') this.once('connect', connectListener);
    this.connecting = true;
    this.readyState = 'opening';
    __pi_net_finish_connect(this);
    return this;
  }

  write(data, _encoding, cb) {
    this.bytesWritten += __pi_net_bytes(data);
    if (typeof cb === 'function') cb(null);
    return true;
  }

  end(data, _encoding, cb) {
    if (data !== undefined) this.write(data);
    if (typeof cb === 'function') cb(null);
    this.destroy();
    return this;
  }

  destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.connecting = false;
    this.readyState = 'closed';
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }

  setTimeout(ms, cb) {
    if (typeof cb === 'function' && typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(cb, ms);
    }
    return this;
  }

  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }
  address() { return { address: this.localAddress, port: this.localPort, family: 'IPv4' }; }
}

export function createConnection(...args) {
  const socket = new Socket();
  socket.connect(...args);
  return socket;
}

export function connect(...args) {
  return createConnection(...args);
}

export function createServer(_opts, _callback) {
  throw new Error('node:net.createServer is not available in PiJS');
}

function __pi_net_is_ipv4(input) {
  const value = String(input ?? '');
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    if (!Number.isFinite(num) || num < 0 || num > 255) return false;
  }
  return true;
}

function __pi_net_ipv6_segment_count(segments) {
  if (segments.length === 1 && segments[0] === '') return 0;
  let count = 0;
  for (const seg of segments) {
    if (seg === '') return null;
    if (seg.includes('.')) {
      if (!__pi_net_is_ipv4(seg)) return null;
      count += 2;
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
    count += 1;
  }
  return count;
}

function __pi_net_is_ipv6(input) {
  const value = String(input ?? '').toLowerCase();
  if (!value.includes(':')) return false;
  if (value.indexOf('::') !== value.lastIndexOf('::')) return false;
  const parts = value.split('::');
  const head = parts[0] ? parts[0].split(':') : [''];
  const tail = parts[1] ? parts[1].split(':') : [''];
  const headCount = __pi_net_ipv6_segment_count(head);
  const tailCount = __pi_net_ipv6_segment_count(tail);
  if (headCount === null || tailCount === null) return false;
  if (parts.length === 1) return headCount === 8;
  return headCount + tailCount <= 8;
}

export function isIP(input) {
  if (__pi_net_is_ipv4(input)) return 4;
  if (__pi_net_is_ipv6(input)) return 6;
  return 0;
}

export function isIPv4(input) { return __pi_net_is_ipv4(input); }
export function isIPv6(input) { return __pi_net_is_ipv6(input); }

export class Server {
  constructor() {
    throw new Error('node:net.Server is not available in PiJS');
  }
}

export default { createConnection, createServer, connect, isIP, isIPv4, isIPv6, Socket, Server };