// Backing tracks are decoded into an AudioBuffer and played with their own
// BufferSource into a gain that goes straight to the destination. They do not
// pass through the drum clipper or the drum volume, and they never share a
// source node with a drum hit.
//
// An HTML media element routed through MediaElementAudioSourceNode looked like
// the way to keep pitch while changing speed, but in Chrome that path cannot
// seek a progressively loaded MP3 (the seekable range stays 0) and a blob URL
// stalls near the start. A buffer source seeks by starting at an offset, stays
// on the same context as the drums, and does not open a second output device.
// Speed uses playbackRate, so pitch moves with the tempo.

const BUILTINS = {
  "backing/peaceful3.mp3": "平静 · 钢琴与贝斯",
  "backing/bgmusic1.mp3": "和弦 · 钢琴、钟与贝斯",
};

const DB_NAME = "drumkit-backing";
const DB_STORE = "tracks";

function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const whole = Math.floor(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* private mode or a full disk: the track still plays this session */
  }
}

export function createBacking(deps) {
  const ui = {
    bar: document.getElementById("backing"),
    file: document.getElementById("backing-file"),
    open: document.getElementById("backing-open"),
    pick: document.getElementById("backing-pick"),
    name: document.getElementById("backing-name"),
    toggle: document.getElementById("backing-toggle"),
    stop: document.getElementById("backing-stop"),
    now: document.getElementById("backing-now"),
    dur: document.getElementById("backing-dur"),
    seek: document.getElementById("backing-seek"),
    loop: document.getElementById("backing-loop"),
    volume: document.getElementById("backing-volume"),
    rate: document.getElementById("backing-rate"),
    rateOut: document.getElementById("backing-rate-out"),
  };

  const state = {
    ctx: null,
    bus: null,
    buffer: null,
    raw: null,
    source: null,
    mountGen: 0,
    token: 0,
    name: "",
    builtin: null,
    blob: null,
    blobType: "",
    volume: storedNumber("drumkit-backing-volume", 70) / 100,
    rate: storedNumber("drumkit-backing-rate", 100) / 100,
    loop: localStorage.getItem("drumkit-backing-loop") === "1",
    offset: 0,
    startedAt: 0,
    playing: false,
    seeking: false,
    raf: 0,
    saveTimer: 0,
    takeOwned: false,
    ready: false,
    lastTake: null,
  };

  function storedNumber(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function clampRate(rate) {
    return Math.min(1.25, Math.max(0.5, Math.round(rate * 20) / 20));
  }

  state.rate = clampRate(state.rate);
  state.volume = Math.min(1, Math.max(0, state.volume));

  function say(text) {
    if (deps.say) deps.say(text);
  }

  function hasTrack() {
    return Boolean(state.ready && state.buffer);
  }

  function duration() {
    const d = state.buffer ? state.buffer.duration : 0;
    return Number.isFinite(d) ? d : 0;
  }

  function position() {
    const d = duration();
    if (!state.playing || !state.ctx) return clampOffset(state.offset, d);
    const elapsed = Math.max(0, state.ctx.currentTime - state.startedAt) * state.rate;
    const pos = state.offset + elapsed;
    if (!(d > 0)) return 0;
    if (state.loop) return pos % d;
    return Math.min(pos, d);
  }

  function clampOffset(offset, d) {
    if (!(d > 0)) return 0;
    if (state.loop) return ((offset % d) + d) % d;
    return Math.min(d, Math.max(0, offset));
  }

  function playing() {
    return state.playing;
  }

  function paint() {
    const on = playing();
    ui.toggle.disabled = !hasTrack();
    ui.stop.disabled = !hasTrack();
    ui.seek.disabled = !hasTrack();
    ui.loop.disabled = !hasTrack();
    ui.toggle.textContent = on ? "暂停" : "播放";
    ui.toggle.setAttribute("aria-pressed", on ? "true" : "false");
    ui.toggle.setAttribute("aria-label", on ? "暂停伴奏" : "播放伴奏");
    ui.loop.setAttribute("aria-pressed", state.loop ? "true" : "false");
    ui.now.textContent = formatClock(position());
    ui.dur.textContent = formatClock(duration());
    ui.name.textContent = state.name || "把音频拖到这里，或点「打开」";
    ui.rateOut.textContent = `${state.rate.toFixed(2)}×`;
    if (ui.pick) ui.pick.value = state.builtin || "";
    if (!state.seeking && hasTrack()) {
      const d = duration();
      ui.seek.value = d > 0 ? String(Math.round((position() / d) * 10000)) : "0";
    }
  }

  function tick() {
    state.raf = 0;
    paint();
    if (playing()) state.raf = requestAnimationFrame(tick);
  }

  function ensureTick() {
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }

  function applyVolume() {
    if (!state.bus) return;
    const ctx = state.ctx;
    const now = ctx ? ctx.currentTime : 0;
    state.bus.gain.setTargetAtTime(state.volume, now, 0.02);
  }

  function rememberControls() {
    localStorage.setItem("drumkit-backing-volume", String(Math.round(state.volume * 100)));
    localStorage.setItem("drumkit-backing-rate", String(Math.round(state.rate * 100)));
    localStorage.setItem("drumkit-backing-loop", state.loop ? "1" : "0");
  }

  function scheduleSave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveLast, 250);
  }

  function saveLast() {
    if (!state.ready) return;
    idbSet("last", {
      name: state.name,
      builtin: state.builtin,
      blob: state.builtin ? null : state.blob,
      type: state.blobType,
      position: position(),
    });
  }

  function haltSource() {
    const src = state.source;
    state.source = null;
    if (!src) return;
    src.onended = null;
    try { src.stop(); } catch { /* not started yet */ }
    try { src.disconnect(); } catch { /* already disconnected */ }
  }

  function resetTrack() {
    state.mountGen += 1;
    state.playing = false;
    haltSource();
    state.buffer = null;
    state.raw = null;
    state.ready = false;
    state.offset = 0;
    state.takeOwned = false;
    state.blob = null;
    state.blobType = "";
    state.builtin = null;
  }

  function startAt(offset, when) {
    haltSource();
    const ctx = state.ctx || deps.getCtx();
    const buffer = state.buffer;
    if (!ctx || !buffer) return false;
    const d = buffer.duration || 0;
    let off = clampOffset(offset, d);
    if (!state.loop && d > 0 && off >= d - 0.01) {
      state.playing = false;
      state.offset = d;
      paint();
      return false;
    }
    let startWhen = Number.isFinite(when) ? when : ctx.currentTime;
    if (startWhen < ctx.currentTime) {
      off = clampOffset(off + (ctx.currentTime - startWhen) * state.rate, d);
      startWhen = ctx.currentTime;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = state.loop && d > 0;
    src.playbackRate.value = state.rate;
    src.connect(state.bus);
    try {
      src.start(startWhen, off);
    } catch {
      try { src.disconnect(); } catch { /* ignore */ }
      return false;
    }
    state.source = src;
    state.startedAt = startWhen;
    state.offset = off;
    state.playing = true;
    src.onended = () => {
      if (state.source !== src) return;
      state.source = null;
      state.playing = false;
      state.takeOwned = false;
      state.offset = state.loop ? 0 : d;
      paint();
      scheduleSave();
    };
    ensureTick();
    return true;
  }

  function mount(ctx, carry) {
    const gen = ++state.mountGen;
    state.playing = false;
    haltSource();
    state.ctx = ctx;
    state.buffer = null;
    state.ready = false;
    state.bus = ctx.createGain();
    state.bus.gain.value = state.volume;
    state.bus.connect(ctx.destination);
    if (!carry || !carry.raw) {
      paint();
      return;
    }
    const bytes = carry.raw.slice(0);
    ctx.decodeAudioData(bytes).then((buffer) => {
      if (gen !== state.mountGen || state.ctx !== ctx) return;
      state.buffer = buffer;
      state.raw = carry.raw;
      state.ready = true;
      state.name = carry.name || state.name;
      state.builtin = carry.builtin || null;
      state.blob = carry.blob || null;
      state.blobType = carry.blobType || "";
      state.offset = clampOffset(carry.time || 0, buffer.duration);
      state.rate = clampRate(carry.rate || state.rate);
      state.loop = Boolean(carry.loop);
      ui.rate.value = String(Math.round(state.rate * 100));
      if (!carry.paused) startAt(state.offset, ctx.currentTime);
      paint();
    }).catch(() => {
      if (gen !== state.mountGen) return;
      paint();
    });
  }

  function capture() {
    if (!state.raw) return null;
    return {
      raw: state.raw,
      name: state.name,
      builtin: state.builtin,
      blob: state.blob,
      blobType: state.blobType,
      time: position(),
      paused: !state.playing,
      rate: state.rate,
      loop: state.loop,
    };
  }

  async function decodeInto(bytes, token, meta) {
    const ctx = deps.getCtx();
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(bytes.slice(0));
    } catch {
      if (token === state.token) {
        state.ready = false;
        paint();
        if (!meta.quiet) say("这个文件不能当作伴奏播放");
      }
      return false;
    }
    if (token !== state.token) return false;
    state.raw = bytes;
    state.buffer = buffer;
    state.ready = true;
    state.name = meta.name || "本地音频";
    state.builtin = meta.builtin || null;
    state.blob = meta.blob || null;
    state.blobType = meta.type || "";
    state.offset = clampOffset(meta.position || 0, buffer.duration);
    state.playing = false;
    paint();
    if (!meta.quiet) say(`已载入伴奏 ${state.name}`);
    saveLast();
    return true;
  }

  async function loadFile(file, opts = {}) {
    if (!file) return false;
    deps.unlock();
    const token = ++state.token;
    resetTrack();
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      if (!opts.quiet) say("这个文件不能当作伴奏播放");
      return false;
    }
    return decodeInto(bytes, token, {
      name: file.name || "本地音频",
      builtin: null,
      blob: file,
      type: file.type || "",
      position: opts.position || 0,
      quiet: opts.quiet,
    });
  }

  async function loadUrl(url, title, opts = {}) {
    if (!BUILTINS[url]) return false;
    deps.unlock();
    const token = ++state.token;
    resetTrack();
    state.name = title || BUILTINS[url];
    state.builtin = url;
    paint();
    let bytes;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      bytes = await res.arrayBuffer();
    } catch {
      if (token === state.token && !opts.quiet) say("这个文件不能当作伴奏播放");
      return false;
    }
    return decodeInto(bytes, token, {
      name: title || BUILTINS[url],
      builtin: url,
      blob: null,
      type: "audio/mpeg",
      position: opts.position || 0,
      quiet: opts.quiet,
    });
  }

  function play() {
    if (!hasTrack()) return;
    deps.unlock();
    const d = duration();
    let off = position();
    if (!state.loop && d > 0 && off >= d - 0.05) off = 0;
    startAt(off, deps.getCtx().currentTime);
    paint();
  }

  function pause() {
    if (!state.playing) return;
    state.offset = position();
    state.playing = false;
    haltSource();
    paint();
    scheduleSave();
  }

  function stop() {
    state.takeOwned = false;
    state.playing = false;
    haltSource();
    state.offset = 0;
    paint();
    scheduleSave();
  }

  function toggle() {
    if (!hasTrack()) return;
    if (playing()) pause();
    else play();
  }

  function seekTo(fraction) {
    const d = duration();
    if (!(d > 0)) return;
    const next = Math.min(d, Math.max(0, fraction * d));
    if (state.playing) startAt(next, state.ctx.currentTime);
    else state.offset = next;
    paint();
  }

  function seekBy(delta) {
    const d = duration();
    if (!(d > 0)) return;
    const next = Math.min(d, Math.max(0, position() + delta));
    if (state.playing) startAt(next, state.ctx.currentTime);
    else state.offset = next;
    paint();
    scheduleSave();
  }

  function setLoop(on) {
    const pos = position();
    state.loop = on;
    state.offset = pos;
    rememberControls();
    if (state.playing) startAt(pos, state.ctx.currentTime);
    else paint();
  }

  function setRate(rate) {
    const pos = position();
    state.rate = clampRate(rate);
    ui.rate.value = String(Math.round(state.rate * 100));
    rememberControls();
    if (state.playing) startAt(pos, state.ctx.currentTime);
    paint();
  }

  function setVolume(value) {
    state.volume = Math.min(1, Math.max(0, value));
    applyVolume();
    rememberControls();
  }

  function markForRecord() {
    if (!playing()) return null;
    return {
      token: state.token,
      position: position(),
      rate: state.rate,
      loop: state.loop,
    };
  }

  function playWithTake(mark, when, stillGoing) {
    state.lastTake = {
      markPos: mark ? mark.position : null,
      tokenOk: Boolean(mark) && mark.token === state.token,
      ready: state.ready,
    };
    if (!mark || mark.token !== state.token || !state.buffer || !state.ready) return;
    if (stillGoing && !stillGoing()) return;
    state.takeOwned = true;
    state.rate = clampRate(mark.rate);
    state.loop = Boolean(mark.loop);
    ui.rate.value = String(Math.round(state.rate * 100));
    const ctx = deps.getCtx();
    const started = startAt(mark.position || 0, when || (ctx ? ctx.currentTime : 0));
    state.lastTake = {
      ...state.lastTake,
      atPlay: started ? state.offset : null,
      started,
    };
    paint();
  }

  function stopTake() {
    if (!state.takeOwned) return;
    state.offset = position();
    state.playing = false;
    state.takeOwned = false;
    haltSource();
    paint();
  }

  function onKeydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select")) return false;
    const code = event.code;
    if (code === "KeyB" || code === "KeyN" || code === "KeyL") {
      if (event.repeat) return true;
    }
    if (code === "KeyB") {
      toggle();
      return true;
    }
    if (code === "KeyN") {
      stop();
      return true;
    }
    if (code === "KeyL") {
      if (hasTrack()) setLoop(!state.loop);
      return true;
    }
    if (code === "BracketLeft") {
      seekBy(-5);
      return true;
    }
    if (code === "BracketRight") {
      seekBy(5);
      return true;
    }
    if (code === "Minus") {
      setRate(state.rate - 0.05);
      return true;
    }
    if (code === "Equal") {
      setRate(state.rate + 0.05);
      return true;
    }
    return false;
  }

  function bind() {
    ui.volume.value = String(Math.round(state.volume * 100));
    ui.rate.value = String(Math.round(state.rate * 100));
    ui.loop.setAttribute("aria-pressed", state.loop ? "true" : "false");
    paint();

    ui.open.addEventListener("click", () => {
      deps.unlock();
      ui.file.click();
    });
    ui.file.addEventListener("change", () => {
      const file = ui.file.files && ui.file.files[0];
      ui.file.value = "";
      if (file) loadFile(file);
    });
    ui.pick.addEventListener("change", () => {
      const url = ui.pick.value;
      if (!url) return;
      loadUrl(url, BUILTINS[url]);
    });
    ui.toggle.addEventListener("click", () => {
      deps.unlock();
      toggle();
    });
    ui.stop.addEventListener("click", () => {
      deps.unlock();
      stop();
    });
    ui.loop.addEventListener("click", () => {
      if (hasTrack()) setLoop(!state.loop);
    });
    ui.volume.addEventListener("input", () => {
      setVolume(Number(ui.volume.value) / 100);
    });
    ui.rate.addEventListener("input", () => {
      setRate(Number(ui.rate.value) / 100);
    });
    ui.seek.addEventListener("pointerdown", () => {
      state.seeking = true;
    });
    ui.seek.addEventListener("pointerup", () => {
      state.seeking = false;
      scheduleSave();
    });
    ui.seek.addEventListener("input", () => {
      state.seeking = true;
      seekTo(Number(ui.seek.value) / 10000);
    });
    ui.seek.addEventListener("change", () => {
      state.seeking = false;
      seekTo(Number(ui.seek.value) / 10000);
      scheduleSave();
    });

    const allowDrop = (event) => {
      const types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      return Array.from(types).includes("Files");
    };
    document.addEventListener("dragover", (event) => {
      if (!allowDrop(event)) return;
      event.preventDefault();
      ui.bar.classList.add("is-drop");
    });
    document.addEventListener("dragleave", (event) => {
      if (event.target === document || event.target === document.body) {
        ui.bar.classList.remove("is-drop");
      }
    });
    document.addEventListener("drop", (event) => {
      if (!allowDrop(event)) return;
      event.preventDefault();
      ui.bar.classList.remove("is-drop");
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) loadFile(file);
    });
    document.addEventListener("dragend", () => ui.bar.classList.remove("is-drop"));
    window.addEventListener("pagehide", saveLast);
  }

  async function restore() {
    const seen = state.token;
    const rec = await idbGet("last");
    if (!rec || state.token !== seen) return;
    if (rec.builtin && BUILTINS[rec.builtin]) {
      await loadUrl(rec.builtin, rec.name || BUILTINS[rec.builtin], {
        quiet: true,
        position: rec.position,
      });
      if (state.token !== seen + 1) return;
      say(`已恢复伴奏 ${state.name}`);
      return;
    }
    if (rec.blob) {
      const file = rec.blob instanceof File
        ? rec.blob
        : new File([rec.blob], rec.name || "伴奏", { type: rec.type || rec.blob.type || "" });
      await loadFile(file, { quiet: true, position: rec.position });
      if (state.name) say(`已恢复伴奏 ${state.name}`);
    }
  }

  function debug() {
    return {
      name: state.name,
      builtin: state.builtin,
      ready: state.ready,
      paused: !state.playing,
      time: position(),
      duration: duration(),
      rate: state.rate,
      preservesPitch: false,
      engine: "buffer",
      loop: state.loop,
      volume: state.volume,
      token: state.token,
      takeOwned: state.takeOwned,
      lastTake: state.lastTake,
    };
  }

  bind();

  return {
    mount,
    capture,
    loadFile,
    loadUrl,
    markForRecord,
    playWithTake,
    stopTake,
    onKeydown,
    restore,
    debug,
    play,
    pause,
  };
}
