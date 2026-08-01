import.meta.url = "pi://node:os";
const _platform = "darwin";
const _arch = "arm64";
const _type = "Darwin";
const _tmpdir = "/var/folders/3j/6ws_m0051bl8dj7qx00jp_xr0000gn/T/";
const _homedir = "/Users/kentaylor";
const _hostname = "localhost";
const _eol = "\n";
const _devNull = "/dev/null";
const _uid = 1000;
const _gid = 1000;
const _username = "kentaylor";
const _shell = "/bin/zsh";
const _numCpus = 8;
const _cpus = [];
for (let i = 0; i < _numCpus; i++) _cpus.push({ model: "cpu", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } });

export function homedir() {
  const env_home =
    globalThis.pi && globalThis.pi.env && typeof globalThis.pi.env.get === "function"
      ? globalThis.pi.env.get("HOME")
      : undefined;
  return env_home || _homedir;
}
export function tmpdir() {
  const env_tmp =
    globalThis.pi && globalThis.pi.env && typeof globalThis.pi.env.get === "function"
      ? globalThis.pi.env.get("TMPDIR")
      : undefined;
  const process_tmp =
    globalThis.process && globalThis.process.env
      ? globalThis.process.env.TMPDIR || globalThis.process.env.TEMP || globalThis.process.env.TMP
      : undefined;
  return env_tmp || process_tmp || _tmpdir;
}
export function hostname() { return _hostname; }
export function platform() { return _platform; }
export function arch() { return _arch; }
export function type() { return _type; }
export function release() { return "6.0.0"; }
export function cpus() { return _cpus; }
export function totalmem() { return 8 * 1024 * 1024 * 1024; }
export function freemem() { return 4 * 1024 * 1024 * 1024; }
export function uptime() { return Math.floor(Date.now() / 1000); }
export function loadavg() { return [0.0, 0.0, 0.0]; }
export function networkInterfaces() { return {}; }
export function userInfo(_options) {
  return {
    uid: _uid,
    gid: _gid,
    username: _username,
    homedir: homedir(),
    shell: _shell,
  };
}
export function endianness() { return "LE"; }
export const EOL = _eol;
export const devNull = _devNull;
export const constants = {
  signals: {},
  errno: {},
  priority: { PRIORITY_LOW: 19, PRIORITY_BELOW_NORMAL: 10, PRIORITY_NORMAL: 0, PRIORITY_ABOVE_NORMAL: -7, PRIORITY_HIGH: -14, PRIORITY_HIGHEST: -20 },
};
export default { homedir, tmpdir, hostname, platform, arch, type, release, cpus, totalmem, freemem, uptime, loadavg, networkInterfaces, userInfo, endianness, EOL, devNull, constants };