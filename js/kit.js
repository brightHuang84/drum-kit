const PIECES = [
  { id: "crash", kind: "cymbal", cls: "crash", code: "KeyQ", key: "Q", short: "吊镲", name: "吊镲", en: "Crash", aria: "吊镲 Crash，按 Q", gain: 0.7, files: ["samples/crash-1.wav", "samples/crash-2.wav"] },
  { id: "hhOpen", kind: "hat", cls: "hh-open", code: "KeyD", key: "D", short: "开镲", name: "开镲", en: "Open", aria: "开镲 Open hi-hat，按 D", gain: 0.66, files: ["samples/hh-open-1.wav", "samples/hh-open-2.wav"] },
  { id: "hhClosed", kind: "hat", cls: "hh-closed", code: "KeyA", key: "A", short: "闭镲", name: "闭镲", en: "Closed", aria: "闭镲 Closed hi-hat，按 A", gain: 0.58, files: ["samples/hh-closed-1.wav", "samples/hh-closed-2.wav"] },
  { id: "tomHigh", kind: "drum", cls: "tom-high drum", code: "KeyJ", key: "J", short: "高嗵", name: "高音嗵鼓", en: "Hi Tom", aria: "高音嗵鼓 Hi tom，按 J", gain: 0.86, files: ["samples/tom-high-1.wav", "samples/tom-high-2.wav"] },
  { id: "tomMid", kind: "drum", cls: "tom-mid drum", code: "KeyK", key: "K", short: "中嗵", name: "中音嗵鼓", en: "Mid Tom", aria: "中音嗵鼓 Mid tom，按 K", gain: 0.8, files: ["samples/tom-mid-1.wav", "samples/tom-mid-2.wav"] },
  { id: "ride", kind: "cymbal", cls: "ride", code: "KeyO", key: "O", short: "叮叮", name: "叮叮镲", en: "Ride", aria: "叮叮镲 Ride，按 O", gain: 0.98, files: ["samples/ride-1.wav", "samples/ride-2.wav"] },
  { id: "snare", kind: "snare", cls: "snare", code: "KeyS", key: "S", short: "军鼓", name: "军鼓", en: "Snare", aria: "军鼓 Snare，按 S", gain: 0.92, files: ["samples/snare-1.wav", "samples/snare-2.wav"] },
  { id: "kick", kind: "kick", cls: "kick", code: "Space", key: "空格", short: "底鼓", name: "底鼓", en: "Kick", aria: "底鼓 Kick，空格键", gain: 0.8, files: ["samples/kick-1.wav", "samples/kick-2.wav"] },
  { id: "tomFloor", kind: "floor", cls: "floor", code: "KeyL", key: "L", short: "落地", name: "落地嗵鼓", en: "Floor", aria: "落地嗵鼓 Floor tom，按 L", gain: 0.74, files: ["samples/tom-floor-1.wav", "samples/tom-floor-2.wav"] },
];

const BY_CODE = Object.fromEntries(PIECES.map((d) => [d.code, d.id]));
const BY_ID = Object.fromEntries(PIECES.map((d) => [d.id, d]));

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx({ latencyHint: "interactive" });
const master = ctx.createGain();
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -8;
limiter.knee.value = 2;
limiter.ratio.value = 12;
limiter.attack.value = 0.002;
limiter.release.value = 0.12;
master.connect(limiter);
limiter.connect(ctx.destination);

function storedNumber(key) {
  const raw = localStorage.getItem(key);
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const savedVolume = storedNumber("drumkit-volume");
const savedBpm = storedNumber("drumkit-bpm");
master.gain.value = savedVolume == null ? 0.82 : savedVolume / 100;

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

function lugs(count) {
  let html = '<span class="lugs">';
  for (let i = 0; i < count; i += 1) html += `<i style="--a:${(360 / count) * i}deg"></i>`;
  return `${html}</span>`;
}

function badge(d) {
  return `<span class="badge"><kbd>${d.key}</kbd><span class="names"><b>${d.short}</b><small>${d.en}</small></span></span>`;
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

function flash(id) {
  const el = kit.querySelector(`[data-drum="${id}"]`);
  if (!el) return;
  el.classList.remove("is-hit");
  void el.offsetWidth;
  el.classList.add("is-hit");
  clearTimeout(el._hitTimer);
  el._hitTimer = setTimeout(() => el.classList.remove("is-hit"), 170);
}

function unlock() {
  if (ctx.state !== "running") ctx.resume();
}

function play(id, when = null, opts = {}) {
  const drum = BY_ID[id];
  if (!drum) return;
  unlock();
  if (opts.visual !== false) flash(id);
  const buffers = drum.buffers;
  if (!buffers || !buffers.length) return;
  const buffer = buffers[drum.cursor % buffers.length];
  drum.cursor = (drum.cursor || 0) + 1;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  gain.gain.value = drum.gain;
  src.connect(gain);
  gain.connect(master);
  const startAt = when == null ? ctx.currentTime : Math.max(when, ctx.currentTime);
  src.start(startAt);
  src._fromPlayback = Boolean(opts.fromPlayback);
  activeSources.add(src);
  src.onended = () => {
    activeSources.delete(src);
    src.disconnect();
    gain.disconnect();
  };
  if (opts.record !== false && recording) {
    events.push({ id, t: ctx.currentTime - recStart });
  }
}

function bindPad(el) {
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.add(e.pointerId);
    e.preventDefault();
    play(el.dataset.drum);
  }, { passive: false });

  el.addEventListener("pointerenter", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const stamp = `${el.dataset.drum}:${e.pointerId}`;
    const now = performance.now();
    if (now - (slideAt.get(stamp) || 0) < 70) return;
    slideAt.set(stamp, now);
    play(el.dataset.drum);
  });
}

kit.querySelectorAll(".piece").forEach(bindPad);

window.addEventListener("pointerup", (e) => pointers.delete(e.pointerId));
window.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));

window.addEventListener("keydown", (e) => {
  const id = BY_CODE[e.code];
  if (!id) return;
  const target = e.target;
  if (target instanceof Element) {
    const field = target.closest("input, textarea, select");
    if (field && field.getAttribute("type") !== "range") return;
    const button = target.closest("button");
    if (button) button.blur();
  }
  e.preventDefault();
  play(id);
});

document.addEventListener("touchmove", (e) => {
  if (e.target instanceof Element && e.target.closest('input[type="range"]')) return;
  e.preventDefault();
}, { passive: false });

document.addEventListener("touchstart", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let lastTap = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTap < 320 && !(e.target instanceof Element && e.target.closest('input[type="range"], button'))) {
    e.preventDefault();
  }
  lastTap = now;
}, { passive: false });

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

metroBtn.addEventListener("click", () => setMetronome(!metro.on));

bpmInput.addEventListener("input", () => {
  bpmOut.textContent = bpmInput.value;
  localStorage.setItem("drumkit-bpm", bpmInput.value);
});

volumeInput.addEventListener("input", () => {
  const value = Number(volumeInput.value) / 100;
  master.gain.setTargetAtTime(value, ctx.currentTime, 0.015);
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

async function loadSamples() {
  try {
    await Promise.all(PIECES.map(async (drum) => {
      drum.buffers = await Promise.all(drum.files.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(url);
        return ctx.decodeAudioData(await response.arrayBuffer());
      }));
      drum.cursor = 0;
    }));
    veil.hidden = true;
    say("音色已加载，可以演奏");
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
  loaded: () => PIECES.every((d) => d.buffers && d.buffers.length === d.files.length),
  context: () => ctx,
  startRecord,
  stopRecord: stopRecording,
  playBack,
  clearRecording: () => clearBtn.click(),
};
