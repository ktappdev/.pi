import.meta.url = "pi://@mariozechner/pi-tui";
export function matchesKey(_data, _key) {
  return false;
}

export function truncateToWidth(text, width) {
  const s = String(text ?? "");
  const w = Number(width ?? 0);
  if (!w || w <= 0) return "";
  return s.length <= w ? s : s.slice(0, w);
}

export class Text {
  constructor(text, x = 0, y = 0) {
    this.text = String(text ?? "");
    this.x = x;
    this.y = y;
  }
}

export class TruncatedText extends Text {
  constructor(text, width = 80, x = 0, y = 0) {
    super(text, x, y);
    this.width = Number(width ?? 80);
  }
}

export class Container {
  constructor(..._args) {}
}

export class Markdown {
  constructor(..._args) {}
}

export class Spacer {
  constructor(..._args) {}
}

export function visibleWidth(str) {
  return String(str ?? "").length;
}

export function wrapTextWithAnsi(text, _width) {
  return String(text ?? "");
}

export class Editor {
  constructor(_opts = {}) {
    this.value = "";
  }
}

export const CURSOR_MARKER = "▌";

export function isKeyRelease(_data) {
  return false;
}

export function parseKey(key) {
  return { key: String(key ?? "") };
}

export class Box {
  constructor(_padX = 0, _padY = 0, _styleFn = null) {
    this.children = [];
  }

  addChild(child) {
    this.children.push(child);
  }
}

export class SelectList {
  constructor(items = [], _opts = {}) {
    this.items = Array.isArray(items) ? items : [];
    this.selected = 0;
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
  }

  select(index) {
    const i = Number(index ?? 0);
    this.selected = Number.isFinite(i) ? i : 0;
  }
}

export class Input {
  constructor(_opts = {}) {
    this.value = "";
  }
}

export class ProcessTerminal {
  constructor(_proc, _opts = {}) {
    this.proc = _proc;
  }
  on(_event, _handler) { return this; }
  write(_data) {}
  resize(_cols, _rows) {}
  destroy() {}
}

export const Key = {
  // Special keys
  escape: "escape",
  esc: "esc",
  enter: "enter",
  tab: "tab",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  home: "home",
  end: "end",
  pageUp: "pageUp",
  pageDown: "pageDown",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  // Single modifiers
  ctrl: (key) => `ctrl+${key}`,
  shift: (key) => `shift+${key}`,
  alt: (key) => `alt+${key}`,
  // Combined modifiers
  ctrlShift: (key) => `ctrl+shift+${key}`,
  shiftCtrl: (key) => `shift+ctrl+${key}`,
  ctrlAlt: (key) => `ctrl+alt+${key}`,
  altCtrl: (key) => `alt+ctrl+${key}`,
  shiftAlt: (key) => `shift+alt+${key}`,
  altShift: (key) => `alt+shift+${key}`,
  ctrlAltShift: (key) => `ctrl+alt+shift+${key}`,
};

export class DynamicBorder {
  constructor(_styleFn = null) {
    this.styleFn = _styleFn;
  }
}

export class SettingsList {
  constructor(_opts = {}) {
    this.items = [];
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
  }
}

// Fuzzy string matching for filtering lists
export function fuzzyMatch(query, text, _opts = {}) {
  const q = String(query ?? '').toLowerCase();
  const t = String(text ?? '').toLowerCase();
  if (!q) return { match: true, score: 0, positions: [] };
  if (!t) return { match: false, score: 0, positions: [] };

  const positions = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti);
      qi++;
    }
  }

  const match = qi === q.length;
  const score = match ? (q.length / t.length) * 100 : 0;
  return { match, score, positions };
}

// Get editor keybindings configuration
export function getEditorKeybindings() {
  return {
    save: 'ctrl+s',
    quit: 'ctrl+q',
    copy: 'ctrl+c',
    paste: 'ctrl+v',
    undo: 'ctrl+z',
    redo: 'ctrl+y',
    find: 'ctrl+f',
    replace: 'ctrl+h',
  };
}

// Filter an array of items using fuzzy matching
export function fuzzyFilter(query, items, _opts = {}) {
  const q = String(query ?? '').toLowerCase();
  if (!q) return items;
  if (!Array.isArray(items)) return [];
  return items.filter(item => {
    const text = typeof item === 'string' ? item : String(item?.label ?? item?.name ?? item);
    return fuzzyMatch(q, text).match;
  });
}

// Cancellable loader widget - shows loading state with optional cancel
export class CancellableLoader {
  constructor(message = 'Loading...', opts = {}) {
    this.message = String(message ?? 'Loading...');
    this.cancelled = false;
    this.onCancel = opts.onCancel ?? null;
  }

  cancel() {
    this.cancelled = true;
    if (typeof this.onCancel === 'function') {
      this.onCancel();
    }
  }

  render() {
    return this.cancelled ? [] : [this.message];
  }
}

export class Image {
  constructor(src, _opts = {}) {
    this.src = String(src ?? "");
    this.width = 0;
    this.height = 0;
  }
}

export default { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, Text, TruncatedText, Container, Markdown, Spacer, Editor, Box, SelectList, Input, ProcessTerminal, Image, CURSOR_MARKER, isKeyRelease, parseKey, Key, DynamicBorder, SettingsList, fuzzyMatch, getEditorKeybindings, fuzzyFilter, CancellableLoader };