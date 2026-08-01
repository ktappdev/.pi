import.meta.url = "pi://node:path";
function __pi_is_abs(s) {
  return s.startsWith("/") || (s.length >= 3 && s[1] === ":" && s[2] === "/");
}

export function join(...parts) {
  const cleaned = parts.map((p) => String(p ?? "").replace(/\\/g, "/")).filter((p) => p.length > 0);
  if (cleaned.length === 0) return ".";
  return normalize(cleaned.join("/"));
}

export function dirname(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  const idx = s.lastIndexOf("/");
  if (idx <= 0) return s.startsWith("/") ? "/" : ".";
  const dir = s.slice(0, idx);
  // Keep trailing slash for drive root: D:/ not D:
  if (dir.length === 2 && dir[1] === ":") return dir + "/";
  return dir;
}

export function resolve(...parts) {
  const base =
    globalThis.pi && globalThis.pi.process && typeof globalThis.pi.process.cwd === "string"
      ? globalThis.pi.process.cwd
      : "/";
  const cleaned = parts
    .map((p) => String(p ?? "").replace(/\\/g, "/"))
    .filter((p) => p.length > 0);

  let out = "";
  for (const part of cleaned) {
    if (__pi_is_abs(part)) {
      out = part;
      continue;
    }
    out = out === "" || out.endsWith("/") ? out + part : out + "/" + part;
  }
  if (!__pi_is_abs(out)) {
    out = base.endsWith("/") ? base + out : base + "/" + out;
  }
  return normalize(out);
}

export function basename(p, ext) {
  const s = String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = s.lastIndexOf("/");
  const name = idx === -1 ? s : s.slice(idx + 1);
  if (ext && name.endsWith(ext)) {
    return name.slice(0, -ext.length);
  }
  return name;
}

export function relative(from, to) {
  const fromParts = String(from ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const toParts = String(to ?? "").replace(/\\/g, "/").split("/").filter(Boolean);

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  const up = fromParts.length - common;
  const downs = toParts.slice(common);
  const result = [...Array(up).fill(".."), ...downs];
  return result.join("/") || ".";
}

export function isAbsolute(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  return __pi_is_abs(s);
}

export function extname(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  const b = s.lastIndexOf("/");
  const name = b === -1 ? s : s.slice(b + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot);
}

export function normalize(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  const isAbs = __pi_is_abs(s);
  const parts = s.split("/").filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (part === "..") { if (out.length > 0 && out[out.length - 1] !== "..") out.pop(); else if (!isAbs) out.push(part); }
    else if (part !== ".") out.push(part);
  }
  const result = out.join("/");
  if (out.length > 0 && out[0].length === 2 && out[0][1] === ":") return result;
  return isAbs ? "/" + result : result || ".";
}

export function parse(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  const isAbs = s.startsWith("/");
  const lastSlash = s.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : s.slice(0, lastSlash) || (isAbs ? "/" : "");
  const base = lastSlash === -1 ? s : s.slice(lastSlash + 1);
  const ext = extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  const root = isAbs ? "/" : "";
  return { root, dir, base, ext, name };
}

export function format(pathObj) {
  const dir = pathObj.dir || pathObj.root || "";
  const base = pathObj.base || (pathObj.name || "") + (pathObj.ext || "");
  if (!dir) return base;
  return dir === pathObj.root ? dir + base : dir + "/" + base;
}

export const sep = "/";
export const delimiter = ":";
export const posix = { join, dirname, resolve, basename, relative, isAbsolute, extname, normalize, parse, format, sep, delimiter };

const win32Stub = new Proxy({}, { get(_, prop) { throw new Error("path.win32." + String(prop) + " is not supported (Pi runs on POSIX only)"); } });
export const win32 = win32Stub;

export default { join, dirname, resolve, basename, relative, isAbsolute, extname, normalize, parse, format, sep, delimiter, posix, win32 };