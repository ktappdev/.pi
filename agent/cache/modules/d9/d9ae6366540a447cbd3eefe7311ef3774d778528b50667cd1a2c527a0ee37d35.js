import.meta.url = "pi://node:fs";
import { Readable, Writable } from "node:stream";

export const constants = {
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  F_OK: 0,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
};
const __pi_vfs = (() => {
  if (globalThis.__pi_vfs_state) {
    return globalThis.__pi_vfs_state;
  }

  const state = {
    files: new Map(),
    dirs: new Set(["/"]),
    symlinks: new Map(),
    fds: new Map(),
    nextFd: 100,
  };
  const extensionTmpRoot = "/__pi_extension_tmp";

  function checkWriteAccess(resolved) {
    const normalized = normalizePath(resolved);
    if (isCurrentExtensionTempPath(normalized)) {
      return;
    }
    if (typeof globalThis.__pi_host_check_write_access === "function") {
      globalThis.__pi_host_check_write_access(normalized);
    }
  }

  function checkWorkspaceWriteAccess(resolved) {
    const normalized = normalizePath(resolved);
    if (isCurrentExtensionTempPath(normalized)) {
      return;
    }
    const cwd = normalizePath(
      globalThis.process && typeof globalThis.process.cwd === "function"
        ? globalThis.process.cwd()
        : "/"
    );
    if (normalized !== cwd && !normalized.startsWith(`${cwd}/`)) {
      throw new Error("host write denied: path outside extension root");
    }
    checkWriteAccess(normalized);
  }

  function currentExtensionId() {
    if (typeof __pi_current_extension_id === "undefined") {
      return "";
    }
    return String(__pi_current_extension_id || "").trim();
  }

  function encodeExtensionTempSegment(raw) {
    let out = "";
    for (const ch of String(raw || "")) {
      if (/^[A-Za-z0-9._-]$/.test(ch)) {
        out += ch;
      } else {
        out += "_" + ch.codePointAt(0).toString(16) + "_";
      }
    }
    return out || "anonymous";
  }

  function currentExtensionTempRoot() {
    const id = currentExtensionId();
    if (!id) {
      return "";
    }
    return `${extensionTmpRoot}/${encodeExtensionTempSegment(id)}`;
  }

  function isAbsoluteTmpInput(input) {
    const raw = String(input ?? "").replace(/\\/g, "/");
    return raw === "/tmp" || raw.startsWith("/tmp/");
  }

  function mapExtensionTempPath(input, normalized) {
    const root = currentExtensionTempRoot();
    if (!root || !isAbsoluteTmpInput(input)) {
      return normalized;
    }
    if (normalized !== "/tmp" && !normalized.startsWith("/tmp/")) {
      return normalized;
    }
    return `${root}${normalized.slice("/tmp".length)}`;
  }

  function unmapExtensionTempPath(normalized) {
    const root = currentExtensionTempRoot();
    if (!root) {
      return normalized;
    }
    if (normalized === root) {
      return "/tmp";
    }
    if (normalized.startsWith(`${root}/`)) {
      return `/tmp${normalized.slice(root.length)}`;
    }
    return normalized;
  }

  function isCurrentExtensionTempPath(normalized) {
    const root = currentExtensionTempRoot();
    return !!root && (normalized === root || normalized.startsWith(`${root}/`));
  }

  function normalizePath(input) {
    let raw = String(input ?? "").replace(/\\/g, "/");
    // Strip Windows UNC verbatim prefix that canonicalize() produces.
    // \\?\C:\... becomes /?/C:/... after separator normalization.
    if (raw.startsWith("/?/") && raw.length > 5 && /^[A-Za-z]:/.test(raw.substring(3, 5))) {
      raw = raw.slice(3);
    }
    // Detect Windows drive-letter absolute paths (e.g. "C:/Users/...")
    const hasDriveLetter = raw.length >= 3 && /^[A-Za-z]:\//.test(raw);
    const isAbsolute = raw.startsWith("/") || hasDriveLetter;
    const base = isAbsolute
      ? raw
      : `${(globalThis.process && typeof globalThis.process.cwd === "function" ? globalThis.process.cwd() : "/").replace(/\\/g, "/")}/${raw}`;
    const parts = [];
    for (const part of base.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (parts.length > 0) parts.pop();
        continue;
      }
      parts.push(part);
    }
    // Preserve drive letter prefix on Windows (D:/...) instead of /D:/...
    if (parts.length > 0 && /^[A-Za-z]:$/.test(parts[0])) {
      return `${parts[0]}/${parts.slice(1).join("/")}`;
    }
    return `/${parts.join("/")}`;
  }

  function dirname(path) {
    const normalized = normalizePath(path);
    if (normalized === "/") return "/";
    const idx = normalized.lastIndexOf("/");
    return idx <= 0 ? "/" : normalized.slice(0, idx);
  }

  function ensureDir(path) {
    const normalized = normalizePath(path);
    if (normalized === "/") return "/";
    const parts = normalized.slice(1).split("/");
    let current = "";
    for (const part of parts) {
      current = `${current}/${part}`;
      state.dirs.add(current);
    }
    return normalized;
  }

  function toBytes(data, opts) {
    const encoding =
      typeof opts === "string"
        ? opts
        : opts && typeof opts === "object" && typeof opts.encoding === "string"
          ? opts.encoding
          : undefined;
    const normalizedEncoding = normalizeFsEncoding(encoding, "utf8");

    if (typeof data === "string") {
      if (normalizedEncoding === "base64") {
        return Buffer.from(data, "base64");
      }
      if (normalizedEncoding === "hex") {
        return Buffer.from(data, "hex");
      }
      if (
        normalizedEncoding === "latin1" ||
        normalizedEncoding === "binary" ||
        normalizedEncoding === "ascii"
      ) {
        return oneByteStringToBytes(data);
      }
      return new TextEncoder().encode(data);
    }
    if (data instanceof Uint8Array) {
      return new Uint8Array(data);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Array.isArray(data)) {
      return new Uint8Array(data);
    }
    return new TextEncoder().encode(String(data ?? ""));
  }

  function normalizeFsEncoding(encoding, defaultEncoding) {
    if (encoding === undefined || encoding === null || encoding === "") {
      return defaultEncoding;
    }
    const normalized = String(encoding).toLowerCase();
    return normalized === "utf-8" ? "utf8" : normalized;
  }

  function oneByteStringToBytes(input) {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      bytes[i] = input.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function oneByteBytesToString(bytes, stripHighBit) {
    let output = "";
    let chunk = [];
    for (let i = 0; i < bytes.length; i++) {
      chunk.push(stripHighBit ? (bytes[i] & 0x7f) : bytes[i]);
      if (chunk.length >= 4096) {
        output += String.fromCharCode.apply(null, chunk);
        chunk.length = 0;
      }
    }
    if (chunk.length > 0) {
      output += String.fromCharCode.apply(null, chunk);
    }
    return output;
  }

  function decodeBytes(bytes, opts) {
    const encoding =
      typeof opts === "string"
        ? opts
        : opts && typeof opts === "object" && typeof opts.encoding === "string"
          ? opts.encoding
          : undefined;
    const normalized = normalizeFsEncoding(encoding, "buffer");
    if (normalized === "buffer") {
      return Buffer.from(bytes);
    }
    if (normalized === "base64") {
      let binChunks = [];
      let chunk = [];
      for (let i = 0; i < bytes.length; i++) {
        chunk.push(bytes[i]);
        if (chunk.length >= 4096) {
          binChunks.push(String.fromCharCode.apply(null, chunk));
          chunk.length = 0;
        }
      }
      if (chunk.length > 0) {
        binChunks.push(String.fromCharCode.apply(null, chunk));
      }
      return btoa(binChunks.join(''));
    }
    if (normalized === "hex") {
      const hex = new Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        hex[i] = (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
      }
      return hex.join("");
    }
    if (normalized === "latin1" || normalized === "binary") {
      return oneByteBytesToString(bytes, false);
    }
    if (normalized === "ascii") {
      return oneByteBytesToString(bytes, true);
    }
    return new TextDecoder().decode(bytes);
  }

  function resolveSymlinkPath(linkPath, target) {
    const raw = String(target ?? "");
    if (raw.startsWith("/")) {
      return normalizePath(raw);
    }
    return normalizePath(`${dirname(linkPath)}/${raw}`);
  }

  function resolvePath(path, followSymlinks = true) {
    let normalized = mapExtensionTempPath(path, normalizePath(path));
    if (!followSymlinks) {
      return normalized;
    }

    const seen = new Set();
    while (state.symlinks.has(normalized)) {
      if (seen.has(normalized)) {
        throw new Error(`ELOOP: too many symbolic links encountered, stat '${String(path ?? "")}'`);
      }
      seen.add(normalized);
      normalized = resolveSymlinkPath(normalized, state.symlinks.get(normalized));
    }
    return normalized;
  }

  function parseOpenFlags(rawFlags) {
    if (typeof rawFlags === "number" && Number.isFinite(rawFlags)) {
      const flags = rawFlags | 0;
      const accessMode = flags & 3;
      const readable = accessMode === constants.O_RDONLY || accessMode === constants.O_RDWR;
      const writable = accessMode === constants.O_WRONLY || accessMode === constants.O_RDWR;
      return {
        readable,
        writable,
        append: (flags & constants.O_APPEND) !== 0,
        create: (flags & constants.O_CREAT) !== 0,
        truncate: (flags & constants.O_TRUNC) !== 0,
        exclusive: (flags & constants.O_EXCL) !== 0,
      };
    }

    const normalized = String(rawFlags ?? "r");
    switch (normalized) {
      case "r":
      case "rs":
        return { readable: true, writable: false, append: false, create: false, truncate: false, exclusive: false };
      case "r+":
      case "rs+":
        return { readable: true, writable: true, append: false, create: false, truncate: false, exclusive: false };
      case "w":
        return { readable: false, writable: true, append: false, create: true, truncate: true, exclusive: false };
      case "w+":
        return { readable: true, writable: true, append: false, create: true, truncate: true, exclusive: false };
      case "wx":
        return { readable: false, writable: true, append: false, create: true, truncate: true, exclusive: true };
      case "wx+":
        return { readable: true, writable: true, append: false, create: true, truncate: true, exclusive: true };
      case "a":
      case "as":
        return { readable: false, writable: true, append: true, create: true, truncate: false, exclusive: false };
      case "a+":
      case "as+":
        return { readable: true, writable: true, append: true, create: true, truncate: false, exclusive: false };
      case "ax":
        return { readable: false, writable: true, append: true, create: true, truncate: false, exclusive: true };
      case "ax+":
        return { readable: true, writable: true, append: true, create: true, truncate: false, exclusive: true };
      default:
        throw new Error(`EINVAL: invalid open flags '${normalized}'`);
    }
  }

  function getFdEntry(fd) {
    const entry = state.fds.get(fd);
    if (!entry) {
      throw new Error(`EBADF: bad file descriptor, fd ${String(fd)}`);
    }
    return entry;
  }

  function toWritableView(buffer) {
    if (buffer instanceof Uint8Array) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }
    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    throw new Error("TypeError: buffer must be an ArrayBuffer view");
  }

  function makeDirent(name, entryKind) {
    return {
      name,
      isDirectory() { return entryKind === "dir"; },
      isFile() { return entryKind === "file"; },
      isSymbolicLink() { return entryKind === "symlink"; },
    };
  }

  function listChildren(path, withFileTypes) {
    const normalized = normalizePath(path);
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const children = new Map();

    for (const dir of state.dirs) {
      if (!dir.startsWith(prefix) || dir === normalized) continue;
      const rest = dir.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      children.set(rest, "dir");
    }
    for (const file of state.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      if (!children.has(rest)) children.set(rest, "file");
    }
    for (const link of state.symlinks.keys()) {
      if (!link.startsWith(prefix)) continue;
      const rest = link.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      if (!children.has(rest)) children.set(rest, "symlink");
    }

    const names = Array.from(children.keys()).sort();
    if (withFileTypes) {
      return names.map((name) => makeDirent(name, children.get(name)));
    }
    return names;
  }

  function makeStat(path, followSymlinks = true) {
    const normalized = followSymlinks ? resolvePath(path, true) : resolvePath(path, false);
    const linkTarget = state.symlinks.get(normalized);
    if (linkTarget !== undefined) {
      if (!followSymlinks) {
        const size = new TextEncoder().encode(String(linkTarget)).byteLength;
        return {
          isFile() { return false; },
          isDirectory() { return false; },
          isSymbolicLink() { return true; },
          isBlockDevice() { return false; },
          isCharacterDevice() { return false; },
          isFIFO() { return false; },
          isSocket() { return false; },
          size,
          mode: 0o777,
          uid: 0,
          gid: 0,
          atimeMs: 0,
          mtimeMs: 0,
          ctimeMs: 0,
          birthtimeMs: 0,
          atime: new Date(0),
          mtime: new Date(0),
          ctime: new Date(0),
          birthtime: new Date(0),
          dev: 0,
          ino: 0,
          nlink: 1,
          rdev: 0,
          blksize: 4096,
          blocks: 0,
        };
      }
      return makeStat(resolvePath(normalized, true), true);
    }

    const isDir = state.dirs.has(normalized);
    let bytes = state.files.get(normalized);
    let hostStat = null;
    if (!isDir && bytes === undefined && !isCurrentExtensionTempPath(normalized) && typeof globalThis.__pi_host_stat_sync === "function") {
      try {
        hostStat = JSON.parse(globalThis.__pi_host_stat_sync(normalized, !!followSymlinks));
      } catch (e) {
        /* not on host FS */
      }
    }
    const hostKind = hostStat && typeof hostStat.kind === "string" ? hostStat.kind : "";
    const isHostDir = hostKind === "dir";
    const isHostFile = hostKind === "file";
    const isHostSymlink = hostKind === "symlink";
    const isHostOther = hostKind === "other";
    const isFile = bytes !== undefined || isHostFile;
    if (!isDir && !isHostDir && !isFile && !isHostSymlink && !isHostOther) {
      throw new Error(`ENOENT: no such file or directory, stat '${String(path ?? "")}'`);
    }
    const hostSize =
      hostStat && typeof hostStat.size === "number" && Number.isFinite(hostStat.size)
        ? hostStat.size
        : 0;
    const size = bytes !== undefined ? bytes.byteLength : hostSize;
    return {
      isFile() { return isFile; },
      isDirectory() { return isDir || isHostDir; },
      isSymbolicLink() { return isHostSymlink; },
      isBlockDevice() { return false; },
      isCharacterDevice() { return false; },
      isFIFO() { return false; },
      isSocket() { return false; },
      size,
      mode: (isDir || isHostDir) ? 0o755 : isHostSymlink ? 0o777 : 0o644,
      uid: 0,
      gid: 0,
      atimeMs: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      atime: new Date(0),
      mtime: new Date(0),
      ctime: new Date(0),
      birthtime: new Date(0),
      dev: 0,
      ino: 0,
      nlink: 1,
      rdev: 0,
      blksize: 4096,
      blocks: 0,
    };
  }

  state.normalizePath = normalizePath;
  state.dirname = dirname;
  state.ensureDir = ensureDir;
  state.toBytes = toBytes;
  state.decodeBytes = decodeBytes;
  state.listChildren = listChildren;
  state.makeDirent = makeDirent;
  state.makeStat = makeStat;
  state.resolvePath = resolvePath;
  state.mapExtensionTempPath = mapExtensionTempPath;
  state.unmapExtensionTempPath = unmapExtensionTempPath;
  state.isCurrentExtensionTempPath = isCurrentExtensionTempPath;
  state.checkWriteAccess = checkWriteAccess;
  state.checkWorkspaceWriteAccess = checkWorkspaceWriteAccess;
  state.parseOpenFlags = parseOpenFlags;
  state.getFdEntry = getFdEntry;
  state.toWritableView = toWritableView;
  globalThis.__pi_vfs_state = state;
  return state;
})();

export function existsSync(path) {
  try {
    statSync(path);
    return true;
  } catch (_err) {
    return false;
  }
}

export function readFileSync(path, encoding) {
  const resolved = __pi_vfs.resolvePath(path, true);
  let bytes = __pi_vfs.files.get(resolved);
  let hostError;
  if (!bytes && !__pi_vfs.isCurrentExtensionTempPath(resolved) && typeof globalThis.__pi_host_read_file_sync === "function") {
    try {
      const content = globalThis.__pi_host_read_file_sync(resolved);
      // Host read payload is base64-encoded to preserve binary file fidelity.
      bytes = __pi_vfs.toBytes(content, "base64");
      __pi_vfs.ensureDir(__pi_vfs.dirname(resolved));
      __pi_vfs.files.set(resolved, bytes);
    } catch (e) {
      const message = String((e && e.message) ? e.message : e);
      if (message.includes("host read denied")) {
        throw e;
      }
      hostError = message;
      /* fall through to ENOENT */
    }
  }
  if (!bytes) {
    const detail = hostError ? ` (host: ${hostError})` : "";
    throw new Error(`ENOENT: no such file or directory, open '${String(path ?? "")}'${detail}`);
  }
  return __pi_vfs.decodeBytes(bytes, encoding);
}

export function appendFileSync(path, data, opts) {
  const resolved = __pi_vfs.resolvePath(path, true);
  __pi_vfs.checkWriteAccess(resolved);
  const current = __pi_vfs.files.get(resolved) || new Uint8Array();
  const next = __pi_vfs.toBytes(data, opts);
  const merged = new Uint8Array(current.byteLength + next.byteLength);
  merged.set(current, 0);
  merged.set(next, current.byteLength);
  __pi_vfs.ensureDir(__pi_vfs.dirname(resolved));
  __pi_vfs.files.set(resolved, merged);
}

export function writeFileSync(path, data, opts) {
  const resolved = __pi_vfs.resolvePath(path, true);
  __pi_vfs.checkWriteAccess(resolved);
  __pi_vfs.ensureDir(__pi_vfs.dirname(resolved));
  __pi_vfs.files.set(resolved, __pi_vfs.toBytes(data, opts));
}

export function readdirSync(path, opts) {
  const resolved = __pi_vfs.resolvePath(path, true);
  const withFileTypes = !!(opts && typeof opts === "object" && opts.withFileTypes);
  const children = new Map();
  let foundDir = __pi_vfs.dirs.has(resolved);

  if (foundDir) {
    for (const entry of __pi_vfs.listChildren(resolved, true)) {
      const kind = entry.isDirectory()
        ? "dir"
        : entry.isFile()
          ? "file"
          : entry.isSymbolicLink()
            ? "symlink"
            : "other";
      children.set(entry.name, kind);
    }
  }

  let hostError;
  if (!__pi_vfs.isCurrentExtensionTempPath(resolved) && typeof globalThis.__pi_host_read_dir_sync === "function") {
    try {
      const hostEntries = JSON.parse(globalThis.__pi_host_read_dir_sync(resolved));
      foundDir = true;
      __pi_vfs.ensureDir(resolved);
      for (const entry of hostEntries) {
        if (!entry || typeof entry.name !== "string") continue;
        children.set(entry.name, typeof entry.kind === "string" ? entry.kind : "other");
      }
    } catch (e) {
      const message = String((e && e.message) ? e.message : e);
      if (message.includes("host readdir denied") && !foundDir) {
        throw e;
      }
      hostError = message;
    }
  }

  if (!foundDir) {
    const detail = hostError ? ` (host: ${hostError})` : "";
    throw new Error(`ENOENT: no such file or directory, scandir '${String(path ?? "")}'${detail}`);
  }

  const names = Array.from(children.keys()).sort();
  if (withFileTypes) {
    return names.map((name) => __pi_vfs.makeDirent(name, children.get(name)));
  }
  return names;
}

const __fakeStat = {
  isFile() { return false; },
  isDirectory() { return false; },
  isSymbolicLink() { return false; },
  isBlockDevice() { return false; },
  isCharacterDevice() { return false; },
  isFIFO() { return false; },
  isSocket() { return false; },
  size: 0, mode: 0o644, uid: 0, gid: 0,
  atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
  atime: new Date(0), mtime: new Date(0), ctime: new Date(0), birthtime: new Date(0),
  dev: 0, ino: 0, nlink: 1, rdev: 0, blksize: 4096, blocks: 0,
};
export function statSync(path) { return __pi_vfs.makeStat(path, true); }
export function lstatSync(path) { return __pi_vfs.makeStat(path, false); }
export function mkdtempSync(prefix, _opts) {
  const p = String(prefix ?? "/tmp/tmp-");
  const out = `${p}${Date.now().toString(36)}`;
  const resolved = __pi_vfs.resolvePath(out, true);
  __pi_vfs.checkWorkspaceWriteAccess(resolved);
  __pi_vfs.ensureDir(resolved);
  return out;
}
export function realpathSync(path, _opts) {
  return __pi_vfs.unmapExtensionTempPath(__pi_vfs.resolvePath(path, true));
}
export function unlinkSync(path) {
  const normalized = __pi_vfs.resolvePath(path, false);
  __pi_vfs.checkWriteAccess(normalized);
  if (__pi_vfs.symlinks.delete(normalized)) {
    return;
  }
  if (!__pi_vfs.files.delete(normalized)) {
    throw new Error(`ENOENT: no such file or directory, unlink '${String(path ?? "")}'`);
  }
}
export function rmdirSync(path, _opts) {
  const normalized = __pi_vfs.resolvePath(path, false);
  __pi_vfs.checkWriteAccess(normalized);
  if (normalized === "/") {
    throw new Error("EBUSY: resource busy or locked, rmdir '/'");
  }
  if (__pi_vfs.symlinks.has(normalized)) {
    throw new Error(`ENOTDIR: not a directory, rmdir '${String(path ?? "")}'`);
  }
  for (const filePath of __pi_vfs.files.keys()) {
    if (filePath.startsWith(`${normalized}/`)) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${String(path ?? "")}'`);
    }
  }
  for (const dirPath of __pi_vfs.dirs) {
    if (dirPath.startsWith(`${normalized}/`)) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${String(path ?? "")}'`);
    }
  }
  for (const linkPath of __pi_vfs.symlinks.keys()) {
    if (linkPath.startsWith(`${normalized}/`)) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${String(path ?? "")}'`);
    }
  }
  if (!__pi_vfs.dirs.delete(normalized)) {
    throw new Error(`ENOENT: no such file or directory, rmdir '${String(path ?? "")}'`);
  }
}
export function rmSync(path, opts) {
  const normalized = __pi_vfs.resolvePath(path, false);
  __pi_vfs.checkWriteAccess(normalized);
  if (__pi_vfs.files.has(normalized)) {
    __pi_vfs.files.delete(normalized);
    return;
  }
  if (__pi_vfs.symlinks.has(normalized)) {
    __pi_vfs.symlinks.delete(normalized);
    return;
  }
  if (__pi_vfs.dirs.has(normalized)) {
    const recursive = !!(opts && typeof opts === "object" && opts.recursive);
    if (!recursive) {
      rmdirSync(normalized);
      return;
    }
    for (const filePath of Array.from(__pi_vfs.files.keys())) {
      if (filePath === normalized || filePath.startsWith(`${normalized}/`)) {
        __pi_vfs.files.delete(filePath);
      }
    }
    for (const dirPath of Array.from(__pi_vfs.dirs)) {
      if (dirPath === normalized || dirPath.startsWith(`${normalized}/`)) {
        __pi_vfs.dirs.delete(dirPath);
      }
    }
    for (const linkPath of Array.from(__pi_vfs.symlinks.keys())) {
      if (linkPath === normalized || linkPath.startsWith(`${normalized}/`)) {
        __pi_vfs.symlinks.delete(linkPath);
      }
    }
    if (!__pi_vfs.dirs.has("/")) {
      __pi_vfs.dirs.add("/");
    }
    return;
  }
  throw new Error(`ENOENT: no such file or directory, rm '${String(path ?? "")}'`);
}
export function copyFileSync(src, dest, _mode) {
  writeFileSync(dest, readFileSync(src));
}
export function renameSync(oldPath, newPath) {
  const src = __pi_vfs.resolvePath(oldPath, false);
  const dst = __pi_vfs.resolvePath(newPath, false);
  __pi_vfs.checkWriteAccess(src);
  __pi_vfs.checkWriteAccess(dst);
  const linkTarget = __pi_vfs.symlinks.get(src);
  if (linkTarget !== undefined) {
    __pi_vfs.ensureDir(__pi_vfs.dirname(dst));
    __pi_vfs.symlinks.set(dst, linkTarget);
    __pi_vfs.symlinks.delete(src);
    return;
  }
  const bytes = __pi_vfs.files.get(src);
  if (bytes !== undefined) {
    __pi_vfs.ensureDir(__pi_vfs.dirname(dst));
    __pi_vfs.files.set(dst, bytes);
    __pi_vfs.files.delete(src);
    return;
  }
  throw new Error(`ENOENT: no such file or directory, rename '${String(oldPath ?? "")}'`);
}
export function mkdirSync(path, _opts) {
  const resolved = __pi_vfs.resolvePath(path, true);
  __pi_vfs.checkWriteAccess(resolved);
  __pi_vfs.ensureDir(resolved);
  return __pi_vfs.normalizePath(path);
}
export function accessSync(path, _mode) {
  if (!existsSync(path)) {
    throw new Error("ENOENT: no such file or directory");
  }
}
export function chmodSync(path, _mode) { accessSync(path); return; }
export function chownSync(path, _uid, _gid) { accessSync(path); return; }
export function readlinkSync(path, opts) {
  const normalized = __pi_vfs.normalizePath(path);
  if (!__pi_vfs.symlinks.has(normalized)) {
    if (__pi_vfs.files.has(normalized) || __pi_vfs.dirs.has(normalized)) {
      throw new Error(`EINVAL: invalid argument, readlink '${String(path ?? "")}'`);
    }
    throw new Error(`ENOENT: no such file or directory, readlink '${String(path ?? "")}'`);
  }
  const target = String(__pi_vfs.symlinks.get(normalized));
  const encoding =
    typeof opts === "string"
      ? opts
      : opts && typeof opts === "object" && typeof opts.encoding === "string"
        ? opts.encoding
        : undefined;
  if (encoding && String(encoding).toLowerCase() === "buffer") {
    return Buffer.from(target, "utf8");
  }
  return target;
}
export function symlinkSync(target, path, _type) {
  const normalized = __pi_vfs.resolvePath(path, false);
  __pi_vfs.checkWriteAccess(normalized);
  const parent = __pi_vfs.dirname(normalized);
  if (!__pi_vfs.dirs.has(parent)) {
    throw new Error(`ENOENT: no such file or directory, symlink '${String(path ?? "")}'`);
  }
  if (__pi_vfs.files.has(normalized) || __pi_vfs.dirs.has(normalized) || __pi_vfs.symlinks.has(normalized)) {
    throw new Error(`EEXIST: file already exists, symlink '${String(path ?? "")}'`);
  }
  __pi_vfs.symlinks.set(normalized, String(target ?? ""));
}
export function openSync(path, flags = "r", _mode) {
  const resolved = __pi_vfs.resolvePath(path, true);
  const opts = __pi_vfs.parseOpenFlags(flags);

  if (opts.writable || opts.create || opts.append || opts.truncate) {
    __pi_vfs.checkWriteAccess(resolved);
  }

  if (__pi_vfs.dirs.has(resolved)) {
    throw new Error(`EISDIR: illegal operation on a directory, open '${String(path ?? "")}'`);
  }

  const exists = __pi_vfs.files.has(resolved);
  if (!exists && !opts.create) {
    throw new Error(`ENOENT: no such file or directory, open '${String(path ?? "")}'`);
  }
  if (exists && opts.create && opts.exclusive) {
    throw new Error(`EEXIST: file already exists, open '${String(path ?? "")}'`);
  }
  if (!exists && opts.create) {
    __pi_vfs.ensureDir(__pi_vfs.dirname(resolved));
    __pi_vfs.files.set(resolved, new Uint8Array());
  }
  if (opts.truncate && opts.writable) {
    __pi_vfs.files.set(resolved, new Uint8Array());
  }

  const fd = __pi_vfs.nextFd++;
  const current = __pi_vfs.files.get(resolved) || new Uint8Array();
  __pi_vfs.fds.set(fd, {
    path: resolved,
    readable: opts.readable,
    writable: opts.writable,
    append: opts.append,
    position: opts.append ? current.byteLength : 0,
  });
  return fd;
}
export function closeSync(fd) {
  if (!__pi_vfs.fds.delete(fd)) {
    throw new Error(`EBADF: bad file descriptor, fd ${String(fd)}`);
  }
}
export function readSync(fd, buffer, offset = 0, length, position = null) {
  const entry = __pi_vfs.getFdEntry(fd);
  if (!entry.readable) {
    throw new Error(`EBADF: bad file descriptor, fd ${String(fd)}`);
  }
  const out = __pi_vfs.toWritableView(buffer);
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const maxLen =
    Number.isInteger(length) && length >= 0
      ? length
      : Math.max(0, out.byteLength - start);
  let cursor =
    typeof position === "number" && Number.isFinite(position) && position >= 0
      ? Math.floor(position)
      : entry.position;
  const source = __pi_vfs.files.get(entry.path) || new Uint8Array();
  if (cursor >= source.byteLength || maxLen <= 0 || start >= out.byteLength) {
    return 0;
  }
  const readLen = Math.min(maxLen, out.byteLength - start, source.byteLength - cursor);
  out.set(source.subarray(cursor, cursor + readLen), start);
  if (position === null || position === undefined) {
    entry.position = cursor + readLen;
  }
  return readLen;
}
export function writeSync(fd, buffer, offset, length, position) {
  const entry = __pi_vfs.getFdEntry(fd);
  if (!entry.writable) {
    throw new Error(`EBADF: bad file descriptor, fd ${String(fd)}`);
  }

  let chunk;
  let explicitPosition = false;
  let cursor = null;

  if (typeof buffer === "string") {
    const encoding =
      typeof length === "string"
        ? length
        : typeof offset === "string"
          ? offset
          : undefined;
    chunk = __pi_vfs.toBytes(buffer, encoding);
    if (
      arguments.length >= 3 &&
      typeof offset === "number" &&
      Number.isFinite(offset) &&
      offset >= 0
    ) {
      explicitPosition = true;
      cursor = Math.floor(offset);
    }
  } else {
    const input = __pi_vfs.toWritableView(buffer);
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const maxLen =
      Number.isInteger(length) && length >= 0
        ? length
        : Math.max(0, input.byteLength - start);
    chunk = input.subarray(start, Math.min(input.byteLength, start + maxLen));
    if (typeof position === "number" && Number.isFinite(position) && position >= 0) {
      explicitPosition = true;
      cursor = Math.floor(position);
    }
  }

  if (!explicitPosition) {
    cursor = entry.append
      ? (__pi_vfs.files.get(entry.path)?.byteLength || 0)
      : entry.position;
  }

  const current = __pi_vfs.files.get(entry.path) || new Uint8Array();
  const required = cursor + chunk.byteLength;
  const next = new Uint8Array(Math.max(current.byteLength, required));
  next.set(current, 0);
  next.set(chunk, cursor);
  __pi_vfs.files.set(entry.path, next);

  if (!explicitPosition) {
    entry.position = cursor + chunk.byteLength;
  }
  return chunk.byteLength;
}
export function fstatSync(fd) {
  const entry = __pi_vfs.getFdEntry(fd);
  return __pi_vfs.makeStat(entry.path, true);
}
export function ftruncateSync(fd, len = 0) {
  const entry = __pi_vfs.getFdEntry(fd);
  if (!entry.writable) {
    throw new Error(`EBADF: bad file descriptor, fd ${String(fd)}`);
  }
  const targetLen =
    Number.isInteger(len) && len >= 0 ? len : 0;
  const current = __pi_vfs.files.get(entry.path) || new Uint8Array();
  const next = new Uint8Array(targetLen);
  next.set(current.subarray(0, Math.min(current.byteLength, targetLen)));
  __pi_vfs.files.set(entry.path, next);
  if (entry.position > targetLen) {
    entry.position = targetLen;
  }
}
export function futimesSync(_fd, _atime, _mtime) { return; }
function __fakeWatcher() {
  const w = { close() {}, unref() { return w; }, ref() { return w; }, on() { return w; }, once() { return w; }, removeListener() { return w; }, removeAllListeners() { return w; } };
  return w;
}
export function watch(path, _optsOrListener, _listener) {
  accessSync(path);
  return __fakeWatcher();
}
export function watchFile(path, _optsOrListener, _listener) {
  accessSync(path);
  return __fakeWatcher();
}
export function unwatchFile(_path, _listener) { return; }
function __queueMicrotaskPolyfill(fn) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
    return;
  }
  Promise.resolve().then(fn);
}
export function createReadStream(path, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const encoding = typeof options.encoding === "string" ? options.encoding : null;
  const highWaterMark =
    Number.isInteger(options.highWaterMark) && options.highWaterMark > 0
      ? options.highWaterMark
      : 64 * 1024;

  const stream = new Readable({ encoding: encoding || undefined, autoDestroy: false });
  stream.path = __pi_vfs.normalizePath(path);

  __queueMicrotaskPolyfill(() => {
    try {
      const bytes = readFileSync(path, "buffer");
      const source =
        bytes instanceof Uint8Array
          ? bytes
          : (typeof Buffer !== "undefined" && Buffer.from
              ? Buffer.from(bytes)
              : __pi_vfs.toBytes(bytes));

      if (source.byteLength === 0) {
        stream.push(null);
        return;
      }

      let offset = 0;
      while (offset < source.byteLength) {
        const nextOffset = Math.min(source.byteLength, offset + highWaterMark);
        const slice = source.subarray(offset, nextOffset);
        if (encoding && typeof Buffer !== "undefined" && Buffer.from) {
          stream.push(Buffer.from(slice).toString(encoding));
        } else {
          stream.push(slice);
        }
        offset = nextOffset;
      }
      stream.push(null);
    } catch (err) {
      stream.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  });

  return stream;
}
export function createWriteStream(path, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const encoding = typeof options.encoding === "string" ? options.encoding : "utf8";
  const flags = typeof options.flags === "string" ? options.flags : "w";
  const appendMode = flags.startsWith("a");
  const bufferedChunks = [];

  const stream = new Writable({
    autoDestroy: false,
    write(chunk, chunkEncoding, callback) {
      try {
        const normalizedEncoding =
          typeof chunkEncoding === "string" && chunkEncoding
            ? chunkEncoding
            : encoding;
        const bytes = __pi_vfs.toBytes(chunk, normalizedEncoding);
        bufferedChunks.push(bytes);
        this.bytesWritten += bytes.byteLength;
        callback(null);
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    },
    final(callback) {
      try {
        if (appendMode) {
          const resolved = __pi_vfs.resolvePath(path, true);
          __pi_vfs.checkWriteAccess(resolved);
          const current = __pi_vfs.files.get(resolved) || new Uint8Array();
          const totalSize = current.byteLength + bufferedChunks.reduce((sum, bytes) => sum + bytes.byteLength, 0);
          const merged = new Uint8Array(totalSize);
          merged.set(current, 0);
          let offset = current.byteLength;
          for (const bytes of bufferedChunks) {
            merged.set(bytes, offset);
            offset += bytes.byteLength;
          }
          __pi_vfs.ensureDir(__pi_vfs.dirname(resolved));
          __pi_vfs.files.set(resolved, merged);
        } else {
          const totalSize = bufferedChunks.reduce((sum, bytes) => sum + bytes.byteLength, 0);
          const merged = new Uint8Array(totalSize);
          let offset = 0;
          for (const bytes of bufferedChunks) {
            merged.set(bytes, offset);
            offset += bytes.byteLength;
          }
          writeFileSync(path, merged);
        }
        callback(null);
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
  stream.path = __pi_vfs.normalizePath(path);
  stream.bytesWritten = 0;
  stream.cork = () => stream;
  stream.uncork = () => stream;
  return stream;
}
export function readFile(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const encoding = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { callback(null, readFileSync(path, encoding)); }
    catch (err) { callback(err); }
  }
}
export function writeFile(path, data, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { writeFileSync(path, data, opts); callback(null); }
    catch (err) { callback(err); }
  }
}
export function stat(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  if (typeof callback === 'function') {
    try { callback(null, statSync(path)); }
    catch (err) { callback(err); }
  }
}
export function readdir(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { callback(null, readdirSync(path, opts)); }
    catch (err) { callback(err); }
  }
}
export function mkdir(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { callback(null, mkdirSync(path, opts)); }
    catch (err) { callback(err); }
  }
}
export function unlink(path, cb) {
  if (typeof cb === 'function') {
    try { unlinkSync(path); cb(null); }
    catch (err) { cb(err); }
  }
}
export function readlink(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { callback(null, readlinkSync(path, opts)); }
    catch (err) { callback(err); }
  }
}
export function symlink(target, path, typeOrCb, cb) {
  const callback = typeof typeOrCb === 'function' ? typeOrCb : cb;
  const type = typeof typeOrCb === 'function' ? undefined : typeOrCb;
  if (typeof callback === 'function') {
    try { symlinkSync(target, path, type); callback(null); }
    catch (err) { callback(err); }
  }
}
export function lstat(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  if (typeof callback === 'function') {
    try { callback(null, lstatSync(path)); }
    catch (err) { callback(err); }
  }
}
export function rmdir(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { rmdirSync(path, opts); callback(null); }
    catch (err) { callback(err); }
  }
}
export function rm(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { rmSync(path, opts); callback(null); }
    catch (err) { callback(err); }
  }
}
export function rename(oldPath, newPath, cb) {
  if (typeof cb === 'function') {
    try { renameSync(oldPath, newPath); cb(null); }
    catch (err) { cb(err); }
  }
}
export function copyFile(src, dest, flagsOrCb, cb) {
  const callback = typeof flagsOrCb === 'function' ? flagsOrCb : cb;
  if (typeof callback === 'function') {
    try { copyFileSync(src, dest); callback(null); }
    catch (err) { callback(err); }
  }
}
export function appendFile(path, data, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { appendFileSync(path, data, opts); callback(null); }
    catch (err) { callback(err); }
  }
}
export function chmod(path, mode, cb) {
  if (typeof cb === 'function') {
    try { chmodSync(path, mode); cb(null); }
    catch (err) { cb(err); }
  }
}
export function chown(path, uid, gid, cb) {
  if (typeof cb === 'function') {
    try { chownSync(path, uid, gid); cb(null); }
    catch (err) { cb(err); }
  }
}
export function realpath(path, optOrCb, cb) {
  const callback = typeof optOrCb === 'function' ? optOrCb : cb;
  const opts = typeof optOrCb === 'function' ? undefined : optOrCb;
  if (typeof callback === 'function') {
    try { callback(null, realpathSync(path, opts)); }
    catch (err) { callback(err); }
  }
}
export function access(_path, modeOrCb, cb) {
  const callback = typeof modeOrCb === 'function' ? modeOrCb : cb;
  if (typeof callback === 'function') {
    try {
      accessSync(_path);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}
export const promises = {
  access: async (path, _mode) => accessSync(path),
  mkdir: async (path, opts) => mkdirSync(path, opts),
  mkdtemp: async (prefix, _opts) => {
    return mkdtempSync(prefix, _opts);
  },
  readFile: async (path, opts) => readFileSync(path, opts),
  writeFile: async (path, data, opts) => writeFileSync(path, data, opts),
  unlink: async (path) => unlinkSync(path),
  readlink: async (path, opts) => readlinkSync(path, opts),
  symlink: async (target, path, type) => symlinkSync(target, path, type),
  rmdir: async (path, opts) => rmdirSync(path, opts),
  stat: async (path) => statSync(path),
  lstat: async (path) => lstatSync(path),
  realpath: async (path, _opts) => realpathSync(path, _opts),
  readdir: async (path, opts) => readdirSync(path, opts),
  rm: async (path, opts) => rmSync(path, opts),
  rename: async (oldPath, newPath) => renameSync(oldPath, newPath),
  copyFile: async (src, dest, mode) => copyFileSync(src, dest, mode),
  cp: async (src, dest, opts) => {
    if (opts && opts.recursive) {
      throw new Error("node:fs.promises.cp recursive copy is not supported in PiJS");
    }
    return copyFileSync(src, dest);
  },
  appendFile: async (path, data, opts) => appendFileSync(path, data, opts),
  chmod: async (path, mode) => chmodSync(path, mode),
  chown: async (path, uid, gid) => chownSync(path, uid, gid),
  utimes: async (path, _atime, _mtime) => accessSync(path),
};
export default { constants, existsSync, readFileSync, appendFileSync, writeFileSync, readdirSync, statSync, lstatSync, mkdtempSync, realpathSync, unlinkSync, rmdirSync, rmSync, copyFileSync, renameSync, mkdirSync, accessSync, chmodSync, chownSync, readlinkSync, symlinkSync, openSync, closeSync, readSync, writeSync, fstatSync, ftruncateSync, futimesSync, watch, watchFile, unwatchFile, createReadStream, createWriteStream, readFile, writeFile, stat, lstat, readdir, mkdir, unlink, readlink, symlink, rmdir, rm, rename, copyFile, appendFile, chmod, chown, realpath, access, promises };