// Keys follow the kit from the player's seat, left to right. Drums that take
// two sticks get two adjacent keys. QWERTY, top row then home row:
//   Q W crash | E R hi tom | T Y mid tom | U I ride
//   A S closed | D open | F G snare | space kick | J K floor
const PIECES = [
  { id: "crash", kind: "cymbal", cls: "crash", codes: ["KeyQ", "KeyW"], keys: ["Q", "W"], short: "吊镲", name: "吊镲", en: "Crash", aria: "吊镲 Crash，按 Q 或 W", gain: 0.7, files: ["samples/crash-1.wav", "samples/crash-2.wav"] },
  { id: "hhOpen", kind: "hat", cls: "hh-open", codes: ["KeyD"], keys: ["D"], short: "开镲", name: "开镲", en: "Open", aria: "开镲 Open hi-hat，按 D", gain: 0.66, files: ["samples/hh-open-1.wav", "samples/hh-open-2.wav"] },
  { id: "hhClosed", kind: "hat", cls: "hh-closed", codes: ["KeyA", "KeyS"], keys: ["A", "S"], short: "闭镲", name: "闭镲", en: "Closed", aria: "闭镲 Closed hi-hat，按 A 或 S", gain: 0.58, files: ["samples/hh-closed-1.wav", "samples/hh-closed-2.wav"] },
  { id: "tomHigh", kind: "drum", cls: "tom-high drum", codes: ["KeyE", "KeyR"], keys: ["E", "R"], short: "高嗵", name: "高音嗵鼓", en: "Hi Tom", aria: "高音嗵鼓 Hi tom，按 E 或 R", gain: 0.86, files: ["samples/tom-high-1.wav", "samples/tom-high-2.wav"] },
  { id: "tomMid", kind: "drum", cls: "tom-mid drum", codes: ["KeyT", "KeyY"], keys: ["T", "Y"], short: "中嗵", name: "中音嗵鼓", en: "Mid Tom", aria: "中音嗵鼓 Mid tom，按 T 或 Y", gain: 0.8, files: ["samples/tom-mid-1.wav", "samples/tom-mid-2.wav"] },
  { id: "ride", kind: "cymbal", cls: "ride", codes: ["KeyU", "KeyI"], keys: ["U", "I"], short: "叮叮", name: "叮叮镲", en: "Ride", aria: "叮叮镲 Ride，按 U 或 I", gain: 0.98, files: ["samples/ride-1.wav", "samples/ride-2.wav"] },
  { id: "snare", kind: "snare", cls: "snare", codes: ["KeyF", "KeyG"], keys: ["F", "G"], short: "军鼓", name: "军鼓", en: "Snare", aria: "军鼓 Snare，按 F 或 G", gain: 0.92, files: ["samples/snare-1.wav", "samples/snare-2.wav"] },
  { id: "kick", kind: "kick", cls: "kick", codes: ["Space"], keys: ["空格"], short: "底鼓", name: "底鼓", en: "Kick", aria: "底鼓 Kick，空格键", gain: 0.8, files: ["samples/kick-1.wav", "samples/kick-2.wav"] },
  { id: "tomFloor", kind: "floor", cls: "floor", codes: ["KeyJ", "KeyK"], keys: ["J", "K"], short: "落地", name: "落地嗵鼓", en: "Floor", aria: "落地嗵鼓 Floor tom，按 J 或 K", gain: 0.74, files: ["samples/tom-floor-1.wav", "samples/tom-floor-2.wav"] },
];

const BY_CODE = {};
for (const drum of PIECES) {
  for (const code of drum.codes) {
    if (BY_CODE[code]) throw new Error(`duplicate drum key ${code}`);
    BY_CODE[code] = drum.id;
  }
}
const BY_ID = Object.fromEntries(PIECES.map((d) => [d.id, d]));

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const IS_ANDROID = /Android/i.test(navigator.userAgent);

function tryAudioContext(options) {
  try {
    return new AudioCtx(options);
  } catch (err) {
    return null;
  }
}

// Desktop Chrome honors latencyHint 0 (~8ms output here, vs ~32ms for
// "interactive"). On Android, 0 asks for a buffer smaller than the HAL burst.
// Samsung Chrome often rejects that and opens a deep output stream instead,
// so every hit is late. "interactive" uses the device's own low-latency size.
// sampleRate is left at the output device rate. Forcing 44100 would turn on
// Android Chrome's destination resampler and add another buffer.
const DEFAULT_HINT = IS_ANDROID ? "interactive" : "0";

const CLIP_CURVE = (() => {
  const n = 1025;
  const curve = new Float32Array(n);
  const drive = 2;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
})();

let ctx = null;
let master = null;
let audioHint = DEFAULT_HINT;
let lockedRate = 0;
let keepAlive = null;
let userGesture = false;
let resumeInFlight = false;
let resumeCalls = 0;
let currentVolume = 0.82;
let samplesReady = false;
let diagEl = null;
const stateLog = [];
const pendingClose = [];
const lastHit = {
  type: "—",
  jsMs: null,
  resumed: false,
  resumeMs: null,
  state: "—",
};

function latencyOptions(hint) {
  const options = { latencyHint: hint === "0" ? 0 : hint };
  if (lockedRate) options.sampleRate = lockedRate;
  return options;
}

function installContext(hint) {
  const next = tryAudioContext(latencyOptions(hint))
    || tryAudioContext(lockedRate ? { sampleRate: lockedRate } : undefined)
    || new AudioCtx();
  if (!lockedRate) lockedRate = next.sampleRate;
  const previous = ctx;
  if (keepAlive) {
    try { keepAlive.onended = null; keepAlive.stop(); } catch (err) { /* already stopped */ }
    keepAlive = null;
  }
  if (previous && previous !== next) {
    previous.onstatechange = null;
    activeSources.clear();
    if (samplesReady) previous.close();
    else pendingClose.push(previous);
  }
  ctx = next;
  audioHint = hint;
  master = ctx.createGain();
  master.gain.value = currentVolume;
  const clip = ctx.createWaveShaper();
  clip.curve = CLIP_CURVE;
  clip.oversample = "none";
  master.connect(clip);
  clip.connect(ctx.destination);
  ctx.onstatechange = () => handleStateChange();
  stateLog.unshift(`${hint}:${ctx.state}`);
  if (stateLog.length > 6) stateLog.pop();
}

function wakeDevice() {
  if (keepAlive || !ctx) return;
  // Exact zeros let Samsung's AudioTrack go to standby between hits. Opening
  // it again on the next hit can take about a second, while state still
  // reads "running". This noise is about -67 dBFS.
  const length = 4096;
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 123456789;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296 * 2 - 1) * 0.00045;
  }
  const loop = ctx.createBufferSource();
  loop.buffer = noise;
  loop.loop = true;
  loop.connect(ctx.destination);
  loop.start(0);
  keepAlive = loop;
  loop.onended = () => {
    if (keepAlive === loop) keepAlive = null;
  };
}

function armContext() {
  if (!ctx || ctx.state === "running") return false;
  if (resumeInFlight) return true;
  resumeInFlight = true;
  resumeCalls += 1;
  lastHit.resumeMs = null;
  const started = performance.now();
  const pending = ctx.resume();
  const finish = () => {
    resumeInFlight = false;
    lastHit.resumeMs = performance.now() - started;
    if (diagEl && !diagEl.hidden) paintDiag();
  };
  if (pending && typeof pending.then === "function") pending.then(finish, finish);
  else finish();
  return true;
}

let lastAutoResume = 0;

function handleStateChange() {
  if (!ctx) return;
  stateLog.unshift(ctx.state);
  if (stateLog.length > 6) stateLog.pop();
  if (ctx.state === "running") {
    resumeInFlight = false;
    if (userGesture) wakeDevice();
  } else if (userGesture && (ctx.state === "suspended" || ctx.state === "interrupted")) {
    const now = performance.now();
    if (now - lastAutoResume > 500) {
      lastAutoResume = now;
      armContext();
    }
  }
  if (diagEl && !diagEl.hidden) paintDiag();
}

function storedNumber(key) {
  const raw = localStorage.getItem(key);
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const savedVolume = storedNumber("drumkit-volume");
const savedBpm = storedNumber("drumkit-bpm");
if (savedVolume != null) currentVolume = savedVolume / 100;

const kit = document.getElementById("kit");
const veil = document.getElementById("veil");
const live = document.getElementById("live");
const recordBtn = document.getElementById("record");
const playBtn = document.getElementById("play");
const clearBtn = document.getElementById("clear");
const metroBtn = document.getElementById("metro");
const beatsEl = document.getElementById("beats");
const bpmInput = document.getElementById("bpm");
const bpmOut = document.getElementById("bpm-out");
const volumeInput = document.getElementById("volume");
const fsBtn = document.getElementById("fullscreen");
const about = document.getElementById("about");
const rotateNote = document.getElementById("rotate-note");
diagEl = document.getElementById("diag");

if (savedVolume != null) volumeInput.value = String(savedVolume);
if (savedBpm != null && savedBpm >= 40 && savedBpm <= 220) {
  bpmInput.value = String(savedBpm);
  bpmOut.textContent = String(savedBpm);
}

let events = [];
let recording = false;
let recStart = 0;
let recFrame = 0;
let playing = false;
let playbackGen = 0;
const activeSources = new Set();
const pointers = new Set();
const slideAt = new Map();
installContext(DEFAULT_HINT);

function lugs(count) {
  let html = '<span class="lugs">';
  for (let i = 0; i < count; i += 1) html += `<i style="--a:${(360 / count) * i}deg"></i>`;
  return `${html}</span>`;
}

function badge(d) {
  const keys = d.keys.map((key) => `<kbd>${key}</kbd>`).join("");
  return `<span class="badge"><span class="keys">${keys}</span><span class="names"><b>${d.short}</b><small>${d.en}</small></span></span>`;
}

function render(d) {
  const attrs = `class="piece ${d.kind} ${d.cls}" data-drum="${d.id}" role="button" tabindex="-1" aria-label="${d.aria}"`;
  if (d.kind === "kick") {
    return `<div ${attrs}><span class="shadow"></span>${lugs(8)}<span class="head"><span class="shine"></span><span class="port"></span></span><span class="spur left"></span><span class="spur right"></span><span class="pedal"></span>${badge(d)}</div>`;
  }
  if (d.kind === "cymbal") {
    return `<div ${attrs}><span class="cymbal-gfx"><span class="bell"></span></span>${badge(d)}</div>`;
  }
  if (d.kind === "hat") {
    const foot = d.id === "hhClosed" ? '<span class="foot"></span>' : "";
    return `<div ${attrs}><span class="plates"><span class="cymbal-gfx bottom"><span class="bell"></span></span><span class="cymbal-gfx top"><span class="bell"></span></span></span>${foot}${badge(d)}</div>`;
  }
  const legs = d.kind === "floor"
    ? '<span class="leg a"></span><span class="leg b"></span><span class="leg c"></span>'
    : d.kind === "snare"
      ? '<span class="stand"></span>'
      : "";
  const n = d.kind === "snare" ? 8 : 6;
  return `<div ${attrs}><span class="shadow"></span>${legs}<span class="shell"></span>${lugs(n)}<span class="head"><span class="shine"></span></span>${badge(d)}</div>`;
}

kit.innerHTML = `<div class="hardware" aria-hidden="true"><span class="pole left"></span><span class="pole right"></span><span class="rack"></span></div>${PIECES.map(render).join("")}`;

function say(text) {
  live.textContent = text;
}

const pieceEls = new Map();
kit.querySelectorAll(".piece").forEach((el) => pieceEls.set(el.dataset.drum, el));

function flash(id) {
  const el = pieceEls.get(id);
  if (!el) return;
  el.classList.remove("is-hit");
  // Restart the hit animation on the next frame. Reading layout here
  // (offsetWidth) would block the rest of this input turn.
  if (el._flashQueued) return;
  el._flashQueued = true;
  requestAnimationFrame(() => {
    el._flashQueued = false;
    el.classList.add("is-hit");
    clearTimeout(el._hitTimer);
    el._hitTimer = setTimeout(() => el.classList.remove("is-hit"), 170);
  });
}

function unlock() {
  userGesture = true;
  armContext();
  wakeDevice();
}

function noteHit(opts, scheduledAt, resumed, stateAtHit, started) {
  if (!opts.eventType) return;
  lastHit.type = opts.eventType;
  lastHit.resumed = resumed;
  lastHit.state = stateAtHit;
  if (!resumed) lastHit.resumeMs = null;
  if (started && typeof opts.timeStamp === "number") {
    const delta = scheduledAt - opts.timeStamp;
    lastHit.jsMs = delta >= -1 && delta < 5000 ? delta : null;
  } else {
    lastHit.jsMs = null;
  }
  if (diagEl && !diagEl.hidden) paintDiag();
}

function play(id, when = null, opts = {}) {
  const drum = BY_ID[id];
  if (!drum) return;
  const buffers = drum.buffers;
  const live = when == null;
  if (live) userGesture = true;
  const stateAtHit = ctx.state;
  if (!buffers || !buffers.length) {
    if (live) {
      const resumed = armContext();
      wakeDevice();
      noteHit(opts, performance.now(), resumed, stateAtHit, false);
    }
    return;
  }
  // Either key of a pair advances the same round-robin, so F-G-F-G
  // (or any sticking) swaps the two samples and the hits overlap.
  const buffer = buffers[drum.cursor % buffers.length];
  drum.cursor = (drum.cursor || 0) + 1;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  gain.gain.value = drum.gain;
  src.connect(gain);
  gain.connect(master);
  // Schedule the sample before resume() or any DOM work. resume() is not
  // awaited; on Android it can take hundreds of milliseconds, and it is
  // skipped entirely once the context is already running.
  const scheduledAt = performance.now();
  if (live) src.start(0);
  else src.start(Math.max(when, ctx.currentTime));
  const resumed = live ? armContext() : false;
  if (live) wakeDevice();
  noteHit(opts, scheduledAt, resumed, stateAtHit, true);
  src._fromPlayback = Boolean(opts.fromPlayback);
  activeSources.add(src);
  src.onended = () => {
    activeSources.delete(src);
    src.disconnect();
    gain.disconnect();
  };
  if (opts.visual !== false) flash(id);
  if (opts.record !== false && recording) {
    events.push({ id, t: ctx.currentTime - recStart });
  }
}

function pieceFromTouch(touch, event, index) {
  if (index === 0 && event.target instanceof Element) {
    const direct = event.target.closest(".piece");
    if (direct) return direct;
  }
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  return el instanceof Element ? el.closest(".piece") : null;
}

const fingers = new Map();

function slideHit(id, finger, eventType, timeStamp) {
  const stamp = `${id}:${finger}`;
  const now = performance.now();
  if (now - (slideAt.get(stamp) || 0) < 70) return;
  slideAt.set(stamp, now);
  play(id, null, { eventType, timeStamp });
}

// touchstart is earlier than pointerdown on Android Chrome and iOS, and it
// is the user-gesture those browsers require to resume audio. pointerdown
// for touch is ignored so the same finger never plays twice.
kit.addEventListener("touchstart", (e) => {
  const touches = e.changedTouches;
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches[i];
    const piece = pieceFromTouch(touch, e, i);
    if (!piece) continue;
    const id = piece.dataset.drum;
    fingers.set(touch.identifier, id);
    play(id, null, { eventType: "touchstart", timeStamp: e.timeStamp });
    e.preventDefault();
  }
}, { capture: true, passive: false });

kit.addEventListener("touchmove", (e) => {
  const touches = e.changedTouches;
  let onPad = false;
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches[i];
    if (!fingers.has(touch.identifier)) continue;
    onPad = true;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const piece = el instanceof Element ? el.closest(".piece") : null;
    const id = piece && piece.dataset.drum;
    if (!id || fingers.get(touch.identifier) === id) continue;
    fingers.set(touch.identifier, id);
    slideHit(id, touch.identifier, "touchmove", e.timeStamp);
  }
  if (onPad) e.preventDefault();
}, { capture: true, passive: false });

function releaseTouches(e) {
  for (let i = 0; i < e.changedTouches.length; i += 1) {
    fingers.delete(e.changedTouches[i].identifier);
  }
}
kit.addEventListener("touchend", releaseTouches, { passive: true });
kit.addEventListener("touchcancel", releaseTouches, { passive: true });

kit.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const piece = e.target instanceof Element ? e.target.closest(".piece") : null;
  if (!piece) return;
  play(piece.dataset.drum, null, { eventType: "pointerdown", timeStamp: e.timeStamp });
  pointers.add(e.pointerId);
  e.preventDefault();
});

kit.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch" || !pointers.has(e.pointerId)) return;
  const piece = e.target instanceof Element ? e.target.closest(".piece") : null;
  if (!piece) return;
  const id = piece.dataset.drum;
  slideHit(id, e.pointerId, "pointermove", e.timeStamp);
});

window.addEventListener("pointerup", (e) => pointers.delete(e.pointerId));
window.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));

window.addEventListener("keydown", (e) => {
  const id = BY_CODE[e.code];
  if (!id) return;
  const target = e.target;
  if (target instanceof Element) {
    const field = target.closest("input, textarea, select");
    if (field && field.getAttribute("type") !== "range") return;
  }
  play(id, null, { eventType: "keydown", timeStamp: e.timeStamp });
  e.preventDefault();
  if (target instanceof Element) {
    const button = target.closest("button");
    if (button) button.blur();
  }
}, true);

document.addEventListener("selectstart", (e) => {
  if (!(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault();
});

document.addEventListener("contextmenu", (e) => {
  if (e.target instanceof Element && e.target.closest(".stage, .piece, .portrait-gate")) e.preventDefault();
});

function formatTime(sec) {
  const whole = Math.max(0, Math.floor(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function updateTransport() {
  const hasTake = events.length > 0;
  playBtn.disabled = recording || (!hasTake && !playing);
  clearBtn.disabled = !hasTake && !recording;
  playBtn.textContent = playing ? "停止" : "播放";
  playBtn.setAttribute("aria-label", hasTake ? `播放录音，共 ${events.length} 下` : "播放录音");
  recordBtn.setAttribute("aria-pressed", recording ? "true" : "false");
}

function tickRecord() {
  if (!recording) return;
  recordBtn.textContent = `● ${formatTime(ctx.currentTime - recStart)}`;
  recFrame = requestAnimationFrame(tickRecord);
}

async function startRecord() {
  stopPlayback();
  await ctx.resume();
  events = [];
  recording = true;
  recStart = ctx.currentTime;
  recordBtn.textContent = "● 0:00";
  updateTransport();
  say("开始录音");
  tickRecord();
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  cancelAnimationFrame(recFrame);
  recordBtn.textContent = "录音";
  updateTransport();
  if (!events.length) {
    say("这段是空的，还没有敲到鼓");
  } else {
    const end = events[events.length - 1].t;
    say(`录好了，共 ${events.length} 下，大约 ${formatTime(end)}`);
  }
}

recordBtn.addEventListener("click", () => {
  unlock();
  if (recording) stopRecording();
  else startRecord();
});

function stopPlayback() {
  playbackGen += 1;
  playing = false;
  for (const src of activeSources) {
    if (!src._fromPlayback) continue;
    try { src.stop(); } catch { /* already stopped */ }
  }
  updateTransport();
}

function playBack() {
  if (!events.length) {
    say("还没有录音");
    return;
  }
  if (playing) {
    stopPlayback();
    say("已停止播放");
    return;
  }
  if (recording) stopRecording();
  unlock();
  playing = true;
  const gen = playbackGen;
  const start = ctx.currentTime + 0.06;
  const plan = events.map((ev) => ({ id: ev.id, when: start + ev.t, shown: false }));
  for (const ev of plan) play(ev.id, ev.when, { record: false, visual: false, fromPlayback: true });
  const endAt = plan[plan.length - 1].when + 0.2;
  updateTransport();
  say("正在播放录音");

  const loop = () => {
    if (!playing || gen !== playbackGen) return;
    const now = ctx.currentTime;
    for (const ev of plan) {
      if (!ev.shown && now >= ev.when - 0.03) {
        ev.shown = true;
        flash(ev.id);
      }
    }
    if (now >= endAt) {
      playing = false;
      updateTransport();
      say("播放结束");
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

playBtn.addEventListener("click", () => {
  unlock();
  playBack();
});

clearBtn.addEventListener("click", () => {
  stopPlayback();
  if (recording) stopRecording();
  events = [];
  updateTransport();
  say("已清空录音");
});

const metro = { on: false, next: 0, beat: 0, timer: 0 };

function scheduleClick(time, accent) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 1760 : 1080;
  gain.gain.setValueAtTime(accent ? 0.18 : 0.09, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  osc.connect(gain);
  gain.connect(master);
  osc.start(time);
  osc.stop(time + 0.05);
}

function flashBeat(index) {
  const dots = beatsEl.querySelectorAll("i");
  dots.forEach((dot, i) => {
    dot.classList.toggle("on", i === index);
    dot.classList.toggle("accent", i === index && index === 0);
  });
}

function metroLoop() {
  if (!metro.on) return;
  const spacing = 60 / Number(bpmInput.value || 100);
  while (metro.next < ctx.currentTime + 0.25) {
    const beat = metro.beat % 4;
    scheduleClick(metro.next, beat === 0);
    const delay = Math.max(0, (metro.next - ctx.currentTime) * 1000);
    window.setTimeout(() => { if (metro.on) flashBeat(beat); }, delay);
    metro.beat += 1;
    metro.next += spacing;
  }
  metro.timer = window.setTimeout(metroLoop, 60);
}

async function setMetronome(on) {
  metro.on = on;
  metroBtn.setAttribute("aria-pressed", on ? "true" : "false");
  metroBtn.textContent = on ? "节拍开" : "节拍";
  beatsEl.hidden = !on;
  if (!on) {
    window.clearTimeout(metro.timer);
    beatsEl.querySelectorAll("i").forEach((dot) => dot.classList.remove("on", "accent"));
    say("节拍器已关闭");
    return;
  }
  await ctx.resume();
  metro.next = ctx.currentTime + 0.05;
  metro.beat = 0;
  say(`节拍器已打开，${bpmInput.value} BPM`);
  metroLoop();
}

metroBtn.addEventListener("click", () => {
  const next = !metro.on;
  if (next) unlock();
  setMetronome(next);
});

bpmInput.addEventListener("input", () => {
  bpmOut.textContent = bpmInput.value;
  localStorage.setItem("drumkit-bpm", bpmInput.value);
});

volumeInput.addEventListener("input", () => {
  currentVolume = Number(volumeInput.value) / 100;
  master.gain.setTargetAtTime(currentVolume, ctx.currentTime, 0.015);
  localStorage.setItem("drumkit-volume", volumeInput.value);
});

async function enterLandscape() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  try {
    if (!document.fullscreenElement && request) await request.call(root);
  } catch {
    rotateNote.textContent = "未能进入全屏，请手动把手机转成横向。";
  }
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    } else {
      rotateNote.textContent = "这个浏览器不能自动横屏，请手动旋转手机。";
    }
  } catch {
    rotateNote.textContent = "请手动把手机转成横向。若有方向锁，请先关掉。";
  }
}

fsBtn.addEventListener("click", async () => {
  unlock();
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  await enterLandscape();
});

document.getElementById("go-landscape").addEventListener("click", async () => {
  unlock();
  await enterLandscape();
});

document.addEventListener("fullscreenchange", () => {
  const on = Boolean(document.fullscreenElement);
  fsBtn.textContent = on ? "退出" : "全屏";
  fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
});

document.getElementById("about-open").addEventListener("click", () => {
  if (typeof about.showModal === "function") about.showModal();
});

function fmtSec(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  return `${(sec * 1000).toFixed(1)} ms`;
}

function sampleProgress() {
  let ready = 0;
  let total = 0;
  for (const drum of PIECES) {
    total += drum.files.length;
    ready += drum.buffers ? drum.buffers.length : 0;
  }
  return { ready, total };
}

function paintDiag() {
  if (!diagEl) return;
  const { ready, total } = sampleProgress();
  const js = lastHit.jsMs == null ? "—" : `${lastHit.jsMs.toFixed(1)} ms`;
  const resumeCost = lastHit.resumeMs == null ? "—" : `${lastHit.resumeMs.toFixed(0)} ms`;
  diagEl.querySelector("[data-diag='readout']").textContent = [
    `敲下时状态 ${lastHit.state} · 现在 ${ctx.state}`,
    `采样 ${ready}/${total}${samplesReady ? "（已全部解码）" : "（解码中）"} · ${ctx.sampleRate} Hz`,
    `模式 ${audioHint} · baseLatency ${fmtSec(ctx.baseLatency)} · outputLatency ${fmtSec(ctx.outputLatency)}`,
    `上次 ${lastHit.type} · 事件到 start() ${js}`,
    `这次 resume：${lastHit.resumed ? "是" : "否"} · resume 耗时 ${resumeCost} · 累计 ${resumeCalls} 次`,
    stateLog.length ? `状态记录 ${stateLog.join(" ← ")}` : "",
  ].filter(Boolean).join("\n");
  diagEl.querySelectorAll("[data-hint]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.hint === audioHint ? "true" : "false");
  });
}

let diagTimer = 0;
function setDiag(on) {
  if (!diagEl) return;
  diagEl.hidden = !on;
  const toggle = document.getElementById("diag-toggle");
  if (toggle) toggle.textContent = on ? "关闭延迟诊断" : "延迟诊断";
  window.clearInterval(diagTimer);
  if (on) {
    paintDiag();
    diagTimer = window.setInterval(paintDiag, 400);
  }
}

const diagToggle = document.getElementById("diag-toggle");
const diagHide = document.getElementById("diag-hide");
if (diagToggle) {
  diagToggle.addEventListener("click", () => {
    setDiag(true);
    if (typeof about.close === "function") about.close();
  });
}
if (diagHide) diagHide.addEventListener("click", () => setDiag(false));
if (diagEl) {
  diagEl.querySelectorAll("[data-hint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      userGesture = true;
      const metroWasOn = metro.on;
      installContext(btn.dataset.hint);
      armContext();
      wakeDevice();
      if (metroWasOn) {
        metro.next = ctx.currentTime + 0.05;
        metro.beat = 0;
      }
      paintDiag();
    });
  });
}

async function loadSamples() {
  const decodeCtx = ctx;
  try {
    await Promise.all(PIECES.map(async (drum) => {
      drum.buffers = await Promise.all(drum.files.map(async (url) => {
        // Match the <link rel="preload" crossorigin> cache entry. A second
        // mode would download every wav again.
        const response = await fetch(url, { mode: "cors", credentials: "same-origin", cache: "force-cache" });
        if (!response.ok) throw new Error(url);
        return decodeCtx.decodeAudioData(await response.arrayBuffer());
      }));
      drum.cursor = 0;
    }));
    samplesReady = true;
    while (pendingClose.length) {
      const old = pendingClose.pop();
      try { old.close(); } catch (err) { /* already closed */ }
    }
    veil.hidden = true;
    say("音色已加载，可以演奏");
    if (diagEl && !diagEl.hidden) paintDiag();
  } catch (error) {
    veil.textContent = "音色加载失败。请用本地服务器或 GitHub Pages 打开，不要直接双击文件。";
    say(veil.textContent);
    console.error(error);
  }
}

updateTransport();
loadSamples();

window.drumkit = {
  play: (id) => play(id),
  ids: () => PIECES.map((d) => d.id),
  events: () => events.map((ev) => ({ ...ev })),
  isRecording: () => recording,
  isPlaying: () => playing,
  loaded: () => samplesReady,
  context: () => ctx,
  hint: () => audioHint,
  setHint: (hint) => {
    userGesture = true;
    installContext(hint);
    armContext();
    wakeDevice();
    paintDiag();
  },
  lastHit: () => ({ ...lastHit, resumeCalls, state: ctx.state, log: stateLog.slice() }),
  startRecord,
  stopRecord: stopRecording,
  playBack,
  clearRecording: () => clearBtn.click(),
};
