// Drum keys and the non-drum shortcuts share one map so a rebind can
// detect a clash, swap, or clear it. Practice and recording still see
// drum ids; this module only answers "which key is which".

const STORE = "drumkit-keys";

export const DEFAULT_DRUMS = {
  crash: ["KeyQ", "KeyW"],
  hhOpen: ["KeyD"],
  hhClosed: ["KeyA", "KeyS"],
  tomHigh: ["KeyE", "KeyR"],
  tomMid: ["KeyT", "KeyY"],
  ride: ["KeyU", "KeyI"],
  snare: ["KeyF", "KeyG"],
  kick: ["Space"],
  tomFloor: ["KeyJ", "KeyK"],
};

export const SHORTCUTS = [
  { id: "backing-play", code: "KeyB", name: "播放伴奏" },
  { id: "backing-stop", code: "KeyN", name: "停止伴奏" },
  { id: "backing-loop", code: "KeyL", name: "循环" },
  { id: "backing-back", code: "BracketLeft", name: "后退" },
  { id: "backing-forward", code: "BracketRight", name: "前进" },
  { id: "backing-slower", code: "Minus", name: "减速" },
  { id: "backing-faster", code: "Equal", name: "加速" },
  { id: "practice", code: "KeyC", name: "练习" },
  { id: "listen", code: "KeyV", name: "试听" },
  { id: "lesson-prev", code: "ArrowUp", name: "上一首" },
  { id: "lesson-next", code: "ArrowDown", name: "下一首" },
];

const NAMED = {
  Space: "空格",
  ArrowUp: "上",
  ArrowDown: "下",
  ArrowLeft: "左",
  ArrowRight: "右",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
  Enter: "Enter",
  Backspace: "Backspace",
  Tab: "Tab",
  Escape: "Esc",
};

const drums = {};
const shortcuts = {};
const listeners = new Set();

function blank() {
  for (const id of Object.keys(DEFAULT_DRUMS)) drums[id] = DEFAULT_DRUMS[id].slice();
  for (const item of SHORTCUTS) shortcuts[item.id] = item.code;
}

function isCode(value) {
  return typeof value === "string" && value.length > 0 && value.length < 40;
}

function load() {
  blank();
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORE) || "");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return;
  const used = new Set();
  const storedDrums = raw.drums && typeof raw.drums === "object" ? raw.drums : null;
  for (const id of Object.keys(DEFAULT_DRUMS)) {
    const has = storedDrums && Object.prototype.hasOwnProperty.call(storedDrums, id) && Array.isArray(storedDrums[id]);
    const list = has ? storedDrums[id] : DEFAULT_DRUMS[id];
    const kept = [];
    for (const code of list) {
      if (!isCode(code) || used.has(code)) continue;
      used.add(code);
      kept.push(code);
    }
    drums[id] = kept;
  }
  const storedShortcuts = raw.shortcuts && typeof raw.shortcuts === "object" ? raw.shortcuts : null;
  for (const item of SHORTCUTS) {
    const has = storedShortcuts && Object.prototype.hasOwnProperty.call(storedShortcuts, item.id);
    if (!has) {
      if (used.has(item.code)) shortcuts[item.id] = "";
      else used.add(item.code);
      continue;
    }
    const code = storedShortcuts[item.id];
    if (!isCode(code) || used.has(code)) {
      shortcuts[item.id] = "";
      continue;
    }
    used.add(code);
    shortcuts[item.id] = code;
  }
}

function save() {
  const data = {
    drums: Object.fromEntries(Object.keys(DEFAULT_DRUMS).map((id) => [id, drums[id].slice()])),
    shortcuts: { ...shortcuts },
  };
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    /* private mode or a full disk; the live map still works */
  }
}

function emit() {
  save();
  for (const fn of listeners) fn();
}

load();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function labelFor(code) {
  if (!code) return "未设";
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.slice(6);
  return code;
}

export function codesFor(id) {
  return (drums[id] || []).slice();
}

export function shortcutCode(id) {
  return shortcuts[id] || "";
}

export function shortcutFor(code) {
  for (const item of SHORTCUTS) {
    if (shortcuts[item.id] === code) return item.id;
  }
  return "";
}

export function ownerOf(code) {
  for (const id of Object.keys(DEFAULT_DRUMS)) {
    const index = (drums[id] || []).indexOf(code);
    if (index >= 0) return { kind: "drum", id, index };
  }
  for (const item of SHORTCUTS) {
    if (shortcuts[item.id] === code) return { kind: "shortcut", id: item.id, name: item.name };
  }
  return null;
}

export function assign(drumId, index, code, mode) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_DRUMS, drumId)) return "bad";
  if (!isCode(code)) return "bad";
  const list = drums[drumId];
  if (index < 0 || index > list.length) return "bad";
  const owner = ownerOf(code);
  if (owner && owner.kind === "drum" && owner.id === drumId && owner.index === index) return "same";
  if (owner && owner.kind === "drum" && owner.id === drumId) return "duplicate";
  const previous = index < list.length ? list[index] : null;
  if (owner && mode !== "swap" && mode !== "clear") return "conflict";
  if (owner && mode === "swap" && previous == null) return "conflict";
  if (owner && mode === "swap") {
    if (owner.kind === "drum") drums[owner.id][owner.index] = previous;
    else shortcuts[owner.id] = previous;
  } else if (owner && mode === "clear") {
    if (owner.kind === "drum") drums[owner.id].splice(owner.index, 1);
    else shortcuts[owner.id] = "";
  }
  if (index >= drums[drumId].length) drums[drumId].push(code);
  else drums[drumId][index] = code;
  emit();
  return "ok";
}

export function removeKey(drumId, index) {
  const list = drums[drumId];
  if (!list || index < 0 || index >= list.length) return;
  list.splice(index, 1);
  emit();
}

export function resetKeys() {
  blank();
  emit();
}

export function snapshot() {
  return {
    drums: Object.fromEntries(Object.keys(DEFAULT_DRUMS).map((id) => [id, drums[id].slice()])),
    shortcuts: { ...shortcuts },
  };
}
