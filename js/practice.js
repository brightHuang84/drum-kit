// Practice patterns schedule clicks on the AudioContext clock (look-ahead),
// then a display frame only paints the playhead. Live drum hits are judged
// after they have already started, and this module never schedules them.

import { PATTERNS } from "./patterns.js";

const COUNT_IN = 16;
const LOOKAHEAD = 0.25;

const LANES = ["crash", "ride", "hhOpen", "hhClosed", "tomHigh", "tomMid", "snare", "tomFloor", "kick"];

function storedNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function beatLabel(step) {
  const slot = step % 4;
  if (slot === 0) return String((Math.floor(step / 4) % 4) + 1);
  return ["", "e", "&", "a"][slot];
}

export function createPractice(deps) {
  const ui = {
    panel: document.getElementById("practice"),
    open: document.getElementById("practice-open"),
    close: document.getElementById("practice-close"),
    lesson: document.getElementById("practice-lesson"),
    start: document.getElementById("practice-start"),
    listen: document.getElementById("practice-listen"),
    bpm: document.getElementById("practice-bpm"),
    bpmOut: document.getElementById("practice-bpm-out"),
    window: document.getElementById("practice-window"),
    windowOut: document.getElementById("practice-window-out"),
    offset: document.getElementById("practice-offset"),
    offsetOut: document.getElementById("practice-offset-out"),
    score: document.getElementById("practice-score"),
    extra: document.getElementById("practice-extra"),
    tip: document.getElementById("practice-tip"),
    board: document.getElementById("practice-board"),
  };

  const drums = Object.fromEntries(deps.drums.map((drum) => [drum.id, drum]));
  const state = {
    mode: "off",
    lesson: 0,
    origin: 0,
    nextTime: 0,
    step: 0,
    patternStart: Infinity,
    notes: [],
    marks: [],
    voices: [],
    gen: 0,
    timer: 0,
    raf: 0,
    col: -2,
    playLoop: -1,
    extras: 0,
    markStamp: "",
    lastScore: null,
    gaps: {},
  };

  ui.bpm.value = String(clamp(storedNumber("drumkit-practice-bpm", 60), 40, 160));
  ui.window.value = String(clamp(storedNumber("drumkit-practice-window", 100), 40, 160));
  ui.offset.value = String(clamp(storedNumber("drumkit-practice-offset", 0), -80, 80));

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pattern() {
    return PATTERNS[state.lesson] || PATTERNS[0];
  }

  function stepDur() {
    return (60 / Number(ui.bpm.value || 60)) / 4;
  }

  function latencyShift() {
    const ctx = deps.getCtx();
    const output = ctx && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
    return output + Number(ui.offset.value || 0) / 1000;
  }

  function windowFor(id) {
    const requested = Number(ui.window.value || 100) / 1000;
    const gapSteps = state.gaps[id] || pattern().steps.length;
    const cap = Math.max(0.05, gapSteps * stepDur() * 0.45);
    return Math.min(requested, cap);
  }

  function say(text) {
    if (deps.say) deps.say(text);
  }

  function isOpen() {
    return !ui.panel.hidden;
  }

  function paintButtons() {
    const practicing = state.mode === "practice";
    const listening = state.mode === "listen";
    ui.start.setAttribute("aria-pressed", practicing ? "true" : "false");
    ui.listen.setAttribute("aria-pressed", listening ? "true" : "false");
    ui.start.textContent = practicing ? "练习中" : "练习";
    ui.listen.textContent = listening ? "停止" : "试听";
    ui.open.setAttribute("aria-pressed", isOpen() ? "true" : "false");
    ui.open.setAttribute("aria-expanded", isOpen() ? "true" : "false");
    ui.bpmOut.textContent = ui.bpm.value;
    ui.windowOut.textContent = `±${ui.window.value}`;
    const trim = Number(ui.offset.value);
    ui.offsetOut.textContent = `${trim > 0 ? "+" : ""}${trim}`;
    const ctx = deps.getCtx();
    const auto = ctx && Number.isFinite(ctx.outputLatency) ? Math.round(ctx.outputLatency * 1000) : 0;
    ui.offset.title = `已计入输出延迟 ${auto} 毫秒。总是被记成晚，就往右拨。`;
  }

  function keyLabel(id, index) {
    const drum = drums[id];
    if (!drum) return "";
    const key = drum.keys[index % drum.keys.length];
    return key === "空格" ? "空" : key;
  }

  function measureGaps(steps) {
    const last = {};
    const first = {};
    const min = {};
    for (let i = 0; i < steps.length; i += 1) {
      for (const id of steps[i]) {
        if (first[id] == null) first[id] = i;
        if (last[id] != null) {
          const gap = i - last[id];
          min[id] = Math.min(min[id] || gap, gap);
        }
        last[id] = i;
      }
    }
    for (const id of Object.keys(last)) {
      const wrap = first[id] + steps.length - last[id];
      min[id] = Math.min(min[id] || wrap, wrap);
    }
    return min;
  }

  function renderScore() {
    const steps = pattern().steps;
    state.gaps = measureGaps(steps);
    const used = LANES.filter((id) => steps.some((step) => step.includes(id)));
    const counts = {};
    const board = document.createElement("div");
    board.className = "score";

    const ruler = document.createElement("div");
    ruler.className = "lane";
    const rulerName = document.createElement("span");
    rulerName.className = "lane-name";
    rulerName.textContent = "拍";
    const rulerCells = document.createElement("span");
    rulerCells.className = "cells";
    steps.forEach((_, index) => {
      const cell = document.createElement("i");
      cell.className = "tick";
      if (index % 16 === 0) cell.classList.add("is-bar");
      else if (index % 4 === 0) cell.classList.add("is-downbeat");
      cell.dataset.step = String(index);
      cell.textContent = beatLabel(index);
      rulerCells.appendChild(cell);
    });
    ruler.append(rulerName, rulerCells);
    board.appendChild(ruler);

    for (const id of used) {
      const lane = document.createElement("div");
      lane.className = "lane";
      const name = document.createElement("span");
      name.className = "lane-name";
      name.textContent = drums[id] ? drums[id].short : id;
      const cells = document.createElement("span");
      cells.className = "cells";
      steps.forEach((step, index) => {
        const cell = document.createElement("i");
        cell.className = "cell";
        if (index % 16 === 0) cell.classList.add("is-bar");
        else if (index % 4 === 0) cell.classList.add("is-downbeat");
        cell.dataset.step = String(index);
        cell.dataset.drum = id;
        if (step.includes(id)) {
          const n = counts[id] || 0;
          counts[id] = n + 1;
          cell.classList.add("has-note");
          cell.dataset.on = "1";
          cell.textContent = keyLabel(id, n);
          const full = drums[id] && drums[id].keys[n % drums[id].keys.length];
          if (full) cell.title = full;
        }
        cells.appendChild(cell);
      });
      lane.append(name, cells);
      board.appendChild(lane);
    }

    ui.board.replaceChildren(board);
    ui.tip.textContent = pattern().tip;
    state.col = -2;
    paintButtons();
  }

  function fillLessons() {
    ui.lesson.replaceChildren();
    PATTERNS.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${index + 1}. ${item.title}`;
      ui.lesson.appendChild(option);
    });
    ui.lesson.value = String(state.lesson);
  }

  function stopVoices() {
    for (const osc of state.voices) {
      osc.onended = null;
      try { osc.stop(); } catch { /* already finished */ }
    }
    state.voices = [];
  }

  function clickAt(time, accent, strong) {
    const ctx = deps.getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1760 : 1080;
    const peak = strong ? (accent ? 0.16 : 0.08) : (accent ? 0.09 : 0.045);
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.connect(gain);
    gain.connect(deps.master());
    osc.start(time);
    osc.stop(time + 0.05);
    osc.onended = () => {
      const index = state.voices.indexOf(osc);
      if (index >= 0) state.voices.splice(index, 1);
    };
    state.voices.push(osc);
  }

  function scheduleAhead() {
    if (state.mode === "off") return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const dur = stepDur();
    if (state.nextTime < ctx.currentTime - 0.05) {
      const missed = Math.ceil((ctx.currentTime + 0.05 - state.nextTime) / dur);
      state.step += missed;
      state.nextTime += missed * dur;
    }
    const steps = pattern().steps;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (state.nextTime < horizon) {
      const step = state.step;
      const time = state.nextTime;
      const inCount = step < COUNT_IN;
      const column = inCount ? step : (step - COUNT_IN) % steps.length;
      const loop = inCount ? -1 : Math.floor((step - COUNT_IN) / steps.length);
      if (column % 4 === 0) clickAt(time, column % 16 === 0, inCount);
      state.marks.push({ time, column, loop, phase: inCount ? "count" : "play" });
      if (!inCount) {
        if (state.patternStart === Infinity) state.patternStart = time;
        for (const id of steps[column]) {
          if (state.mode === "listen") {
            deps.play(id, time, { record: false, visual: false, practice: true });
          } else {
            state.notes.push({ drum: id, step: column, loop, time, status: "wait", delta: null });
          }
        }
      }
      state.step += 1;
      state.nextTime += dur;
    }
    while (state.marks.length && state.marks[0].time < ctx.currentTime - 1) state.marks.shift();
  }

  function armTimer() {
    window.clearTimeout(state.timer);
    if (state.mode === "off") return;
    scheduleAhead();
    state.timer = window.setTimeout(armTimer, 40);
  }

  function playhead(now) {
    let hit = null;
    for (let i = state.marks.length - 1; i >= 0; i -= 1) {
      if (state.marks[i].time <= now) {
        hit = state.marks[i];
        break;
      }
    }
    if (!hit) return { phase: "count", column: 0, loop: -1 };
    return hit;
  }

  function paintPlayhead(pos) {
    const column = pos.phase === "play" ? pos.column : (pos.column - (pos.column % 4));
    if (column === state.col && pos.loop === state.playLoop) return;
    const board = ui.board;
    for (const el of board.querySelectorAll(".is-now, .is-soon")) {
      el.classList.remove("is-now", "is-soon");
    }
    if (pos.phase === "count") {
      const beatCol = pos.column - (pos.column % 4);
      const tick = board.querySelector(`.tick[data-step="${beatCol}"]`);
      if (tick) tick.classList.add("is-now");
      for (const el of board.querySelectorAll('.cell[data-step="0"][data-on="1"]')) el.classList.add("is-soon");
      ui.score.textContent = `预备 ${Math.floor(pos.column / 4) + 1}`;
    } else {
      for (const el of board.querySelectorAll(`[data-step="${column}"]`)) el.classList.add("is-now");
      const next = (column + 1) % pattern().steps.length;
      for (const el of board.querySelectorAll(`.cell[data-step="${next}"][data-on="1"]`)) el.classList.add("is-soon");
      if (pos.loop !== state.playLoop) {
        state.extras = 0;
        ui.extra.textContent = "";
      }
      if (state.lastScore) ui.score.textContent = `这一圈 ${state.lastScore.pct}% · ${state.lastScore.word}`;
      else if (state.mode === "listen") ui.score.textContent = "试听中";
      else ui.score.textContent = "看着亮着的格子";
    }
    state.col = column;
    state.playLoop = pos.loop;
  }

  function paintMarks() {
    const stamp = `${state.playLoop}:${state.extras}:${state.notes.map((note) => note.status).join("")}`;
    if (stamp === state.markStamp) return;
    state.markStamp = stamp;
    const board = ui.board;
    for (const el of board.querySelectorAll(".is-good, .is-early, .is-late, .is-miss")) {
      el.classList.remove("is-good", "is-early", "is-late", "is-miss");
    }
    for (const note of state.notes) {
      if (note.loop !== state.playLoop || note.status === "wait") continue;
      const cell = board.querySelector(`.cell[data-drum="${note.drum}"][data-step="${note.step}"]`);
      if (cell) cell.classList.add(`is-${note.status}`);
    }
    ui.extra.textContent = state.extras > 0 ? `多敲 ${state.extras}` : "";
  }

  function phrase(pct) {
    if (pct >= 90) return "很稳";
    if (pct >= 70) return "不错";
    if (pct >= 45) return "跟上了";
    return "慢慢来";
  }

  function publish(loop) {
    const mine = state.notes.filter((note) => note.loop === loop);
    if (!mine.length) return;
    const points = mine.reduce((sum, note) => {
      if (note.status === "good") return sum + 1;
      if (note.status === "early" || note.status === "late") return sum + 0.7;
      return sum;
    }, 0);
    const pct = Math.round((100 * points) / mine.length);
    const word = phrase(pct);
    state.lastScore = { pct, word, loop };
    ui.score.textContent = `这一圈 ${pct}% · ${word}`;
    say(`${word}，这一圈 ${pct}%`);
    state.notes = state.notes.filter((note) => note.loop !== loop);
  }

  function resolve(now) {
    if (state.mode !== "practice") return;
    const shift = latencyShift();
    for (const note of state.notes) {
      if (note.status !== "wait") continue;
      if (now > note.time + shift + windowFor(note.drum)) note.status = "miss";
    }
    const loops = new Set(state.notes.map((note) => note.loop));
    for (const loop of loops) {
      if (loop >= state.playLoop) continue;
      const mine = state.notes.filter((note) => note.loop === loop);
      if (mine.some((note) => note.status === "wait")) continue;
      publish(loop);
    }
  }

  function frame() {
    state.raf = 0;
    if (state.mode === "off") return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pos = playhead(now);
    if (state.mode === "listen" && pos.phase === "play" && pos.column !== state.col) {
      for (const id of pattern().steps[pos.column] || []) deps.flash(id);
    }
    paintPlayhead(pos);
    resolve(now);
    paintMarks();
    state.raf = requestAnimationFrame(frame);
  }

  function ensureFrame() {
    if (!state.raf) state.raf = requestAnimationFrame(frame);
  }

  function halt() {
    state.mode = "off";
    window.clearTimeout(state.timer);
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    stopVoices();
    state.notes = [];
    state.marks = [];
    state.step = 0;
    state.patternStart = Infinity;
    state.col = -2;
    state.playLoop = -1;
    state.extras = 0;
    state.markStamp = "";
    ui.extra.textContent = "";
    paintButtons();
    for (const el of ui.board.querySelectorAll(".is-now, .is-soon, .is-good, .is-early, .is-late, .is-miss")) {
      el.classList.remove("is-now", "is-soon", "is-good", "is-early", "is-late", "is-miss");
    }
  }

  function stopTransport() {
    state.gen += 1;
    halt();
  }

  async function start(mode) {
    deps.unlock();
    if (deps.stopMetronome) deps.stopMetronome();
    const token = ++state.gen;
    const ctx = deps.getCtx();
    if (ctx && ctx.state !== "running") {
      try { await ctx.resume(); } catch { /* the click still counts as a gesture */ }
    }
    if (token !== state.gen) return;
    halt();
    state.mode = mode;
    state.lastScore = null;
    state.extras = 0;
    state.notes = [];
    state.step = 0;
    state.patternStart = Infinity;
    state.col = -2;
    state.playLoop = -1;
    const now = deps.getCtx().currentTime;
    state.origin = now + 0.08;
    state.nextTime = state.origin;
    ui.score.textContent = "预备 1";
    paintButtons();
    say(mode === "listen" ? "试听，先听四拍" : "练习开始，先听四拍");
    armTimer();
    ensureFrame();
  }

  function toggle(mode) {
    if (state.mode === mode) {
      stopTransport();
      ui.score.textContent = state.lastScore
        ? `这一圈 ${state.lastScore.pct}% · ${state.lastScore.word}`
        : "准备好了";
      say(mode === "listen" ? "试听已停" : "练习已停");
      return;
    }
    start(mode);
  }

  function openPanel() {
    ui.panel.hidden = false;
    paintButtons();
    renderScore();
  }

  function closePanel() {
    stopTransport();
    ui.panel.hidden = true;
    ui.score.textContent = "准备好了";
    paintButtons();
  }

  function onHit(id) {
    if (state.mode !== "practice") return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const shift = latencyShift();
    let best = null;
    let bestAbs = Infinity;
    let bestDelta = 0;
    for (const note of state.notes) {
      if (note.drum !== id || note.status !== "wait") continue;
      const delta = now - (note.time + shift);
      const abs = Math.abs(delta);
      if (abs <= windowFor(id) && abs < bestAbs) {
        best = note;
        bestAbs = abs;
        bestDelta = delta;
      }
    }
    if (!best) {
      if (!(now + 0.02 >= state.patternStart)) return;
      state.extras += 1;
      return;
    }
    const win = windowFor(id);
    if (Math.abs(bestDelta) <= win * 0.4) best.status = "good";
    else if (bestDelta < 0) best.status = "early";
    else best.status = "late";
    best.delta = bestDelta;
  }

  function onKeydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select")) return false;
    const code = event.code;
    if (code !== "KeyC" && code !== "KeyV" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if ((code === "KeyC" || code === "KeyV") && event.repeat) return true;
    if (code === "ArrowUp" || code === "ArrowDown") {
      if (!isOpen()) return false;
      const dir = code === "ArrowDown" ? 1 : -1;
      state.lesson = (state.lesson + dir + PATTERNS.length) % PATTERNS.length;
      ui.lesson.value = String(state.lesson);
      renderScore();
      if (state.mode !== "off") start(state.mode);
      return true;
    }
    if (!isOpen()) openPanel();
    if (code === "KeyC") toggle("practice");
    else toggle("listen");
    if (target instanceof Element) {
      const button = target.closest("button");
      if (button) button.blur();
    }
    return true;
  }

  function bind() {
    fillLessons();
    renderScore();
    paintButtons();
    ui.score.textContent = "准备好了";

    ui.open.addEventListener("click", () => {
      deps.unlock();
      if (isOpen()) closePanel();
      else openPanel();
    });
    ui.close.addEventListener("click", () => closePanel());
    ui.lesson.addEventListener("change", () => {
      state.lesson = Number(ui.lesson.value) || 0;
      renderScore();
      if (state.mode !== "off") start(state.mode);
    });
    ui.start.addEventListener("click", () => {
      if (!isOpen()) openPanel();
      toggle("practice");
    });
    ui.listen.addEventListener("click", () => {
      if (!isOpen()) openPanel();
      toggle("listen");
    });
    ui.bpm.addEventListener("input", () => {
      localStorage.setItem("drumkit-practice-bpm", ui.bpm.value);
      paintButtons();
    });
    ui.window.addEventListener("input", () => {
      localStorage.setItem("drumkit-practice-window", ui.window.value);
      paintButtons();
    });
    ui.offset.addEventListener("input", () => {
      localStorage.setItem("drumkit-practice-offset", ui.offset.value);
      paintButtons();
    });
  }

  function suspend() {
    if (state.mode === "off") return;
    stopTransport();
    ui.score.textContent = "准备好了";
  }

  function debug() {
    const ctx = deps.getCtx();
    return {
      mode: state.mode,
      open: isOpen(),
      lesson: pattern().id,
      title: pattern().title,
      bpm: Number(ui.bpm.value),
      playLoop: state.playLoop,
      patternStart: state.patternStart,
      extras: state.extras,
      score: ui.score.textContent,
      lastScore: state.lastScore,
      outputLatency: ctx && ctx.outputLatency,
      offset: Number(ui.offset.value),
      notes: state.notes.map((note) => ({
        drum: note.drum,
        step: note.step,
        loop: note.loop,
        status: note.status,
        time: note.time,
        delta: note.delta,
      })),
    };
  }

  bind();

  return {
    onHit,
    onKeydown,
    suspend,
    stopTransport,
    debug,
    open: openPanel,
  };
}
