import.meta.url = "pi://node:fs/promises";
import fs from 'node:fs';

export async function access(path, mode) { return fs.promises.access(path, mode); }
export async function mkdir(path, opts) { return fs.promises.mkdir(path, opts); }
export async function mkdtemp(prefix, opts) { return fs.promises.mkdtemp(prefix, opts); }
export async function readFile(path, opts) { return fs.promises.readFile(path, opts); }
export async function writeFile(path, data, opts) { return fs.promises.writeFile(path, data, opts); }
export async function unlink(path) { return fs.promises.unlink(path); }
export async function readlink(path, opts) { return fs.promises.readlink(path, opts); }
export async function symlink(target, path, type) { return fs.promises.symlink(target, path, type); }
export async function rmdir(path, opts) { return fs.promises.rmdir(path, opts); }
export async function stat(path) { return fs.promises.stat(path); }
export async function realpath(path, opts) { return fs.promises.realpath(path, opts); }
export async function readdir(path, opts) { return fs.promises.readdir(path, opts); }
export async function rm(path, opts) { return fs.promises.rm(path, opts); }
export async function lstat(path) { return fs.promises.lstat(path); }
export async function copyFile(src, dest) { return fs.promises.copyFile(src, dest); }
export async function cp(src, dest, opts = {}) {
  if (typeof fs.promises.cp === 'function') {
    return fs.promises.cp(src, dest, opts);
  }
  if (opts && opts.recursive) {
    throw new Error('node:fs/promises.cp recursive copy is not supported in PiJS');
  }
  return fs.promises.copyFile(src, dest);
}
export async function rename(oldPath, newPath) { return fs.promises.rename(oldPath, newPath); }
export async function chmod(path, mode) { return fs.promises.chmod(path, mode); }
export async function chown(path, uid, gid) { return fs.promises.chown(path, uid, gid); }
export async function utimes(path, atime, mtime) { return fs.promises.utimes(path, atime, mtime); }
export async function appendFile(path, data, opts) { return fs.promises.appendFile(path, data, opts); }
export async function open(path, flags, mode) { return { close: async () => {} }; }
export async function truncate(path, len) { return; }
export default { access, mkdir, mkdtemp, readFile, writeFile, unlink, readlink, symlink, rmdir, stat, lstat, realpath, readdir, rm, copyFile, cp, rename, chmod, chown, utimes, appendFile, open, truncate };