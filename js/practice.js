// Practice follows the player. Hits advance the score; the clock does not.
// Tempo is estimated from the gaps between those hits, compared with the
// target BPM. Listen mode still plays the chart on the audio clock.

import { PATTERNS } from "./patterns.js";

const COUNT_IN = 16;
const LOOKAHEAD = 0.25;
const LANE_ORDER = ["crash", "ride", "hhOpen", "hhClosed", "tomHigh", "tomMid", "snare", "tomFloor", "kick"];

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// samples: { quarters, ioi } where ioi is seconds between hits and quarters
// is the chart distance in quarter notes. Needs two gaps before it will speak.
export function summarizeTempo(samples, targetBpm) {
  if (!samples || samples.length < 2) return null;
  const quarters = samples.map((sample) => sample.ioi / sample.quarters);
  const med = median(quarters);
  if (!med || med <= 0) return null;
  const bpm = 60 / med;
  const residuals = samples.map((sample) => Math.abs(sample.ioi - med * sample.quarters) * 1000);
  // Average, not the median: one rushed note should show up as unsteady
  // even when the tempo median itself ignores it.
  const mad = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const target = Number(targetBpm) || 60;
  const diff = Math.round(bpm - target);
  const band = Math.max(2, Math.round(target * 0.03));
  let word = "正好";
  if (diff > band) word = "偏快";
  else if (diff < -band) word = "偏慢";
  const steady = mad <= 35 ? "很稳" : mad <= 70 ? "还稳" : "不稳";
  return { bpm, diff, word, mad, steady, target };
}

// priorSamples are the gaps before this one. A shorter gap than the player's
// own running tempo is early; a longer gap is late. The target BPM is not used.
export function classifyInterval(ioi, quarters, priorSamples) {
  if (!priorSamples.length) return "hit";
  const predicted = median(priorSamples.map((sample) => sample.ioi / sample.quarters)) * quarters;
  const tol = Math.max(0.045, predicted * 0.12);
  const delta = ioi - predicted;
  if (Math.abs(delta) <= tol) return "good";
  return delta < 0 ? "early" : "late";
}

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

const TOGGLE_ORDER = ["kick", "snare", "hhClosed", "hhOpen", "ride", "crash", "tomHigh", "tomMid", "tomFloor"];

function presentDrums(steps) {
  return TOGGLE_ORDER.filter((id) => steps.some((step) => step.includes(id)));
}

function readActiveMap() {
  try {
    const raw = JSON.parse(localStorage.getItem("drumkit-practice-active") || "");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

// Active drums are the ones the player is practicing. Steps that become
// empty are omitted here; stepDistance still counts them in the gap.
function chartEvents(steps, active) {
  const events = [];
  steps.forEach((drums, step) => {
    const kept = [];
    for (const id of drums) {
      if (active && !active.has(id)) continue;
      if (!kept.includes(id)) kept.push(id);
    }
    if (kept.length) events.push({ step, drums: kept });
  });
  return events;
}

function stepDistance(fromStep, toStep, length) {
  let distance = toStep - fromStep;
  if (distance <= 0) distance += length;
  return distance;
}

export function createPractice(deps) {
  const ui = {
    panel: document.getElementById("practice"),
    open: document.getElementById("practice-open"),
    close: document.getElementById("practice-close"),
    lesson: document.getElementById("practice-lesson"),
    start: document.getElementById("practice-start"),
    listen: document.getElementById("practice-listen"),
    click: document.getElementById("practice-click"),
    bpm: document.getElementById("practice-bpm"),
    bpmOut: document.getElementById("practice-bpm-out"),
    score: document.getElementById("practice-score"),
    extra: document.getElementById("practice-extra"),
    tip: document.getElementById("practice-tip"),
    board: document.getElementById("practice-board"),
    drums: document.getElementById("practice-drums"),
    toggles: document.getElementById("practice-drum-toggles"),
    accompany: document.getElementById("practice-accompany"),
  };

  const drums = Object.fromEntries(deps.drums.map((drum) => [drum.id, drum]));
  const state = {
    mode: "off",
    lesson: 0,
    events: chartEvents(PATTERNS[0].steps),
    origin: 0,
    nextTime: 0,
    step: 0,
    marks: [],
    voices: [],
    gen: 0,
    timer: 0,
    clickTimer: 0,
    raf: 0,
    col: -2,
    playLoop: -1,
    cursor: 0,
    loop: 0,
    filled: new Set(),
    onset: 0,
    lastEvent: null,
    samples: [],
    loopSamples: [],
    judged: {},
    wrong: 0,
    clickOn: false,
    pulseOrigin: null,
    clickNext: 0,
    clickBeat: 0,
    loopSummary: null,
    banner: "",
    activeMap: readActiveMap(),
    active: new Set(),
    accompany: localStorage.getItem("drumkit-practice-accompany") === "1",
    backed: 0,
  };

  ui.bpm.value = String(clamp(storedNumber("drumkit-practice-bpm", 60), 40, 160));

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pattern() {
    return PATTERNS[state.lesson] || PATTERNS[0];
  }

  function targetBpm() {
    return Number(ui.bpm.value || 60);
  }

  function stepDur() {
    return (60 / targetBpm()) / 4;
  }

  function say(text) {
    if (deps.say) deps.say(text);
  }

  function isOpen() {
    return !ui.panel.hidden;
  }

  function chosenIds(item) {
    const present = presentDrums(item.steps);
    const stored = state.activeMap[item.id];
    if (!Array.isArray(stored)) return present.slice();
    const keep = new Set(stored.filter((id) => present.includes(id)));
    return present.filter((id) => keep.has(id));
  }

  function paintAccompany() {
    ui.accompany.setAttribute("aria-pressed", state.accompany ? "true" : "false");
    ui.accompany.textContent = state.accompany ? "跟奏开" : "跟奏";
  }

  function paintToggles() {
    const present = presentDrums(pattern().steps);
    ui.toggles.replaceChildren();
    for (const id of present) {
      const drum = drums[id];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.drum = id;
      const keys = (drum ? drum.keys : []).map((key) => (key === "空格" ? "空" : key)).join(" ");
      button.textContent = drum ? `${drum.short} ${keys}` : id;
      button.setAttribute("aria-pressed", state.active.has(id) ? "true" : "false");
      ui.toggles.appendChild(button);
    }
    const selected = present.filter((id) => state.active.has(id));
    const backbeat = ["kick", "snare"].filter((id) => present.includes(id));
    const match = {
      all: present.length > 0 && selected.length === present.length,
      kick: present.includes("kick") && selected.length === 1 && selected[0] === "kick",
      backbeat: backbeat.length > 0 && backbeat.length === selected.length && backbeat.every((id) => state.active.has(id)),
    };
    for (const button of ui.drums.querySelectorAll("[data-preset]")) {
      const name = button.dataset.preset;
      button.setAttribute("aria-pressed", match[name] ? "true" : "false");
      if (name === "kick") button.disabled = !present.includes("kick");
      if (name === "backbeat") button.disabled = backbeat.length === 0;
    }
    paintAccompany();
  }

  function paintDim() {
    const dim = state.mode !== "listen";
    for (const lane of ui.board.querySelectorAll(".lane[data-lane]")) {
      lane.classList.toggle("is-off", dim && !state.active.has(lane.dataset.lane));
    }
    for (const cell of ui.board.querySelectorAll(".cell.has-note")) {
      cell.classList.toggle("is-off", dim && !state.active.has(cell.dataset.drum));
    }
  }

  function commitActive(ids) {
    const present = presentDrums(pattern().steps);
    const next = present.filter((id) => ids.includes(id));
    const same = next.length === state.active.size && next.every((id) => state.active.has(id));
    state.active = new Set(next);
    state.activeMap[pattern().id] = next.slice();
    localStorage.setItem("drumkit-practice-active", JSON.stringify(state.activeMap));
    state.events = chartEvents(pattern().steps, state.active);
    paintToggles();
    paintDim();
    if (same || state.mode !== "practice") return;
    start("practice");
  }

  function applyPreset(name) {
    const present = presentDrums(pattern().steps);
    if (name === "all") commitActive(present);
    else if (name === "kick") commitActive(present.includes("kick") ? ["kick"] : []);
    else if (name === "backbeat") commitActive(["kick", "snare"].filter((id) => present.includes(id)));
  }

  function toggleDrum(id) {
    const present = presentDrums(pattern().steps);
    if (!present.includes(id)) return;
    const next = present.filter((drum) => (drum === id ? !state.active.has(drum) : state.active.has(drum)));
    commitActive(next);
  }

  function trendOf(word) {
    if (word === "偏快") return "fast";
    if (word === "偏慢") return "slow";
    if (word === "正好") return "ok";
    return "";
  }

  function formatTempo(sum) {
    const bpm = Math.round(sum.bpm);
    const sign = sum.diff > 0 ? "+" : "";
    const gap = sum.diff === 0 ? "" : ` ${sign}${sum.diff}`;
    return `${bpm} BPM ${sum.word}${gap}`;
  }

  function formatSteady(sum) {
    return `${sum.steady} ±${Math.round(sum.mad)}毫秒`;
  }

  function paintButtons() {
    const practicing = state.mode === "practice";
    const listening = state.mode === "listen";
    ui.start.setAttribute("aria-pressed", practicing ? "true" : "false");
    ui.listen.setAttribute("aria-pressed", listening ? "true" : "false");
    ui.start.textContent = practicing ? "练习中" : "练习";
    ui.listen.textContent = listening ? "停止" : "试听";
    ui.click.setAttribute("aria-pressed", state.clickOn ? "true" : "false");
    ui.click.textContent = state.clickOn ? "嘀声开" : "嘀声";
    ui.open.setAttribute("aria-pressed", isOpen() ? "true" : "false");
    ui.open.setAttribute("aria-expanded", isOpen() ? "true" : "false");
    ui.bpmOut.textContent = ui.bpm.value;
  }

  function laneLabel(id) {
    const drum = drums[id];
    if (!drum) return id;
    const keys = drum.keys.map((key) => (key === "空格" ? "空格" : key)).join("/");
    return `${drum.short} ${keys}`;
  }

  function renderScore() {
    const steps = pattern().steps;
    state.active = new Set(chosenIds(pattern()));
    state.events = chartEvents(steps, state.active);
    const used = LANE_ORDER.filter((id) => steps.some((step) => step.includes(id)));
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
      lane.dataset.lane = id;
      const name = document.createElement("span");
      name.className = "lane-name";
      name.textContent = laneLabel(id);
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
          cell.classList.add("has-note");
          cell.dataset.on = "1";
          if (drums[id]) cell.title = drums[id].name;
        }
        cells.appendChild(cell);
      });
      lane.append(name, cells);
      board.appendChild(lane);
    }

    ui.board.replaceChildren(board);
    ui.tip.textContent = pattern().tip;
    state.col = -2;
    paintDim();
    paintToggles();
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
    if (state.mode !== "listen") return;
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
        for (const id of steps[column]) {
          deps.play(id, time, { record: false, visual: false, practice: true });
        }
      }
      state.step += 1;
      state.nextTime += dur;
    }
    while (state.marks.length && state.marks[0].time < ctx.currentTime - 1) state.marks.shift();
  }

  function armTimer() {
    window.clearTimeout(state.timer);
    if (state.mode !== "listen") return;
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

  function clearBoardMarks() {
    for (const el of ui.board.querySelectorAll(".is-now, .is-soon, .is-good, .is-early, .is-late, .is-miss, .is-hit, .is-wrong")) {
      el.classList.remove("is-now", "is-soon", "is-good", "is-early", "is-late", "is-miss", "is-hit", "is-wrong");
    }
  }

  function paintPlayhead(pos) {
    const column = pos.phase === "play" ? pos.column : (pos.column - (pos.column % 4));
    if (column === state.col && pos.loop === state.playLoop) return;
    clearBoardMarks();
    if (pos.phase === "count") {
      const beatCol = pos.column - (pos.column % 4);
      const tick = ui.board.querySelector(`.tick[data-step="${beatCol}"]`);
      if (tick) tick.classList.add("is-now");
      for (const el of ui.board.querySelectorAll('.cell[data-step="0"][data-on="1"]')) el.classList.add("is-soon");
      ui.score.textContent = `预备 ${Math.floor(pos.column / 4) + 1}`;
      ui.score.dataset.trend = "";
    } else {
      for (const el of ui.board.querySelectorAll(`[data-step="${column}"]`)) el.classList.add("is-now");
      const next = (column + 1) % pattern().steps.length;
      for (const el of ui.board.querySelectorAll(`.cell[data-step="${next}"][data-on="1"]`)) el.classList.add("is-soon");
      ui.score.textContent = "试听中";
      ui.score.dataset.trend = "";
    }
    state.col = column;
    state.playLoop = pos.loop;
  }

  function frame() {
    state.raf = 0;
    if (state.mode !== "listen") return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pos = playhead(now);
    if (pos.phase === "play" && pos.column !== state.col) {
      for (const id of pattern().steps[pos.column] || []) deps.flash(id);
    }
    paintPlayhead(pos);
    state.raf = requestAnimationFrame(frame);
  }

  function ensureFrame() {
    if (!state.raf) state.raf = requestAnimationFrame(frame);
  }

  function resetFollow() {
    state.cursor = 0;
    state.loop = 0;
    state.filled = new Set();
    state.onset = 0;
    state.lastEvent = null;
    state.samples = [];
    state.loopSamples = [];
    state.judged = {};
    state.wrong = 0;
    state.pulseOrigin = null;
    state.clickNext = 0;
    state.clickBeat = 0;
    state.loopSummary = null;
    state.loopKept = null;
    state.banner = "";
    state.backed = 0;
    ui.extra.textContent = "";
    ui.score.dataset.trend = "";
  }

  function paintReadout() {
    if (!state.events.length) {
      ui.score.textContent = "先选一面鼓";
      ui.score.dataset.trend = "";
      ui.extra.textContent = "";
      return;
    }
    if (state.banner === "loop" && state.loopKept && state.loopKept.length >= 2) {
      const sum = summarizeTempo(state.loopKept, targetBpm());
      ui.score.textContent = `这一圈 ${formatTempo(sum)}`;
      ui.score.dataset.trend = trendOf(sum.word);
      const wrong = state.wrong ? ` 错音 ${state.wrong}` : "";
      ui.extra.textContent = `${formatSteady(sum)}${wrong}`;
      return;
    }
    const source = state.loopSamples.length >= 2 ? state.loopSamples : state.samples.slice(-8);
    const sum = summarizeTempo(source, targetBpm());
    if (!sum) {
      ui.score.textContent = state.lastEvent ? "再敲几下" : "你来起拍";
      ui.score.dataset.trend = "";
      ui.extra.textContent = state.wrong ? `错音 ${state.wrong}` : "";
      return;
    }
    ui.score.textContent = `当前 ${formatTempo(sum)}`;
    ui.score.dataset.trend = trendOf(sum.word);
    const wrong = state.wrong ? ` 错音 ${state.wrong}` : "";
    ui.extra.textContent = `${formatSteady(sum)}${wrong}`;
  }

  function paintFollow() {
    clearBoardMarks();
    const events = state.events;
    if (!events.length) return;
    const ev = events[state.cursor];
    const next = events[(state.cursor + 1) % events.length];
    const tick = ui.board.querySelector(`.tick[data-step="${ev.step}"]`);
    if (tick) tick.classList.add("is-now");
    for (const id of ev.drums) {
      const cell = ui.board.querySelector(`.cell[data-drum="${id}"][data-step="${ev.step}"]`);
      if (!cell) continue;
      cell.classList.add(state.filled.has(id) ? "is-hit" : "is-now");
    }
    for (const id of next.drums) {
      const cell = ui.board.querySelector(`.cell[data-drum="${id}"][data-step="${next.step}"]`);
      if (cell && !cell.classList.contains("is-now") && !cell.classList.contains("is-hit")) {
        cell.classList.add("is-soon");
      }
    }
    for (const event of events) {
      const status = state.judged[`${state.loop}:${event.step}`];
      if (!status || event.step === ev.step) continue;
      for (const id of event.drums) {
        const cell = ui.board.querySelector(`.cell[data-drum="${id}"][data-step="${event.step}"]`);
        if (!cell) continue;
        cell.classList.remove("is-soon");
        cell.classList.add(status === "hit" ? "is-hit" : `is-${status}`);
      }
    }
  }

  function flagWrong(id) {
    state.wrong += 1;
    const ev = state.events[state.cursor];
    const cell = ev && ui.board.querySelector(`.cell[data-drum="${id}"][data-step="${ev.step}"]`);
    if (cell) {
      cell.classList.add("is-wrong");
      window.setTimeout(() => cell.classList.remove("is-wrong"), 320);
    }
    paintReadout();
  }

  function clickLoop() {
    window.clearTimeout(state.clickTimer);
    if (state.mode !== "practice" || !state.clickOn || state.pulseOrigin == null) return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const quarter = 60 / targetBpm();
    if (state.clickNext < ctx.currentTime - 0.03) {
      const missed = Math.floor((ctx.currentTime - state.clickNext) / quarter) + 1;
      state.clickNext += missed * quarter;
      state.clickBeat += missed;
    }
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (state.clickNext < horizon) {
      const when = Math.max(state.clickNext, ctx.currentTime);
      clickAt(when, state.clickBeat % 4 === 0, false);
      state.clickBeat += 1;
      state.clickNext += quarter;
    }
    state.clickTimer = window.setTimeout(clickLoop, 50);
  }

  function playerQuarter() {
    const rows = state.loopSamples.length
      ? state.loopSamples
      : (state.loopKept && state.loopKept.length ? state.loopKept : state.samples.slice(-8));
    if (!rows.length) return null;
    const med = median(rows.map((sample) => sample.ioi / sample.quarters));
    if (!med || med <= 0) return null;
    return med;
  }

  // Inactive drums in the stretch ahead of the cursor, timed from the
  // player's own quarter. Nothing is scheduled until a gap has been measured.
  function scheduleAccompaniment(fromStep, onset) {
    if (!state.accompany || state.mode !== "practice") return;
    const quarter = playerQuarter();
    if (quarter == null) return;
    const steps = pattern().steps;
    const length = steps.length;
    const events = state.events;
    if (!events.length || !length) return;
    const next = events[state.cursor];
    const span = stepDistance(fromStep, next.step, length);
    const ctx = deps.getCtx();
    if (!ctx) return;
    const token = state.gen;
    for (let dist = 0; dist < span; dist += 1) {
      const step = (fromStep + dist) % length;
      const when = onset + (dist / 4) * quarter;
      for (const id of steps[step]) {
        if (state.active.has(id)) continue;
        deps.play(id, when, { record: false, visual: false, practice: true });
        state.backed += 1;
        const delay = Math.max(0, (when - ctx.currentTime) * 1000);
        window.setTimeout(() => {
          if (token !== state.gen) return;
          if (state.mode !== "practice" || !state.accompany) return;
          deps.flash(id);
        }, delay);
      }
    }
  }

  function finishEvent(time) {
    const events = state.events;
    const ev = events[state.cursor];
    const length = pattern().steps.length;
    let status = "hit";
    if (state.lastEvent) {
      const dist = stepDistance(state.lastEvent.step, ev.step, length);
      const quarters = dist / 4;
      const ioi = Math.max(0.02, time - state.lastEvent.time);
      const sample = { quarters, ioi };
      status = classifyInterval(ioi, quarters, state.samples);
      state.samples.push(sample);
      if (state.samples.length > 24) state.samples.shift();
      state.loopSamples.push(sample);
    }
    const wrapped = Boolean(state.lastEvent && ev.step <= state.lastEvent.step);
    if (state.pulseOrigin == null) {
      const quarter = 60 / targetBpm();
      state.pulseOrigin = time - (ev.step / 4) * quarter;
      state.clickNext = state.pulseOrigin;
      state.clickBeat = Math.round((time - state.pulseOrigin) / quarter);
      if (state.clickOn) clickLoop();
    }
    if (wrapped) {
      state.loopKept = state.loopSamples.slice();
      state.loopSummary = summarizeTempo(state.loopKept, targetBpm());
      if (state.loopSummary) state.loopSummary.wrong = state.wrong;
      state.banner = "loop";
      state.loop += 1;
      state.loopSamples = [];
      state.wrong = 0;
      state.judged = {};
      if (state.loopSummary) {
        const sum = state.loopSummary;
        const sign = sum.diff > 0 ? "+" : "";
        const gap = sum.diff === 0 ? "" : `${sign}${sum.diff}`;
        say(`这一圈${sum.word}${gap}，${sum.steady}`);
      }
    } else {
      state.banner = "live";
    }
    state.judged[`${state.loop}:${ev.step}`] = status;
    state.lastEvent = { time, step: ev.step, loop: state.loop };
    state.filled = new Set();
    const fromStep = ev.step;
    state.cursor = (state.cursor + 1) % events.length;
    scheduleAccompaniment(fromStep, time);
    paintFollow();
    paintReadout();
  }

  function halt() {
    state.mode = "off";
    window.clearTimeout(state.timer);
    window.clearTimeout(state.clickTimer);
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    stopVoices();
    state.marks = [];
    state.step = 0;
    state.col = -2;
    state.playLoop = -1;
    resetFollow();
    paintButtons();
    clearBoardMarks();
    paintDim();
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
    if (mode === "listen") {
      const now = deps.getCtx().currentTime;
      state.origin = now + 0.08;
      state.nextTime = state.origin;
      ui.score.textContent = "预备 1";
      ui.score.dataset.trend = "";
      ui.extra.textContent = "";
      paintButtons();
      paintDim();
      say("试听，先听四拍");
      armTimer();
      ensureFrame();
      return;
    }
    resetFollow();
    paintDim();
    if (!state.events.length) {
      ui.score.textContent = "先选一面鼓";
      ui.extra.textContent = "";
      paintButtons();
      say("先选一面鼓");
      return;
    }
    ui.score.textContent = "你来起拍";
    ui.extra.textContent = "";
    paintButtons();
    paintFollow();
    say("练习开始，你来起拍");
  }

  function toggle(mode) {
    if (state.mode === mode) {
      const score = ui.score.textContent;
      const extra = ui.extra.textContent;
      const trend = ui.score.dataset.trend || "";
      stopTransport();
      const keep = score && !score.startsWith("预备") && score !== "你来起拍" && score !== "再敲几下" && score !== "试听中" && score !== "先选一面鼓";
      ui.score.textContent = keep ? score : "准备好了";
      ui.extra.textContent = keep ? extra : "";
      ui.score.dataset.trend = keep ? trend : "";
      say(mode === "listen" ? "试听已停" : "练习已停");
      return;
    }
    start(mode);
  }

  function openPanel() {
    ui.panel.hidden = false;
    paintButtons();
    renderScore();
    if (state.mode === "practice") paintFollow();
  }

  function closePanel() {
    stopTransport();
    ui.panel.hidden = true;
    ui.score.textContent = "准备好了";
    ui.score.dataset.trend = "";
    paintButtons();
  }

  function onHit(id) {
    if (state.mode !== "practice") return;
    if (!state.active.has(id)) return;
    const ctx = deps.getCtx();
    if (!ctx) return;
    const events = state.events;
    if (!events.length) return;
    const ev = events[state.cursor];
    // Either key, or the pad, arrives as this drum id. A second hit on a
    // drum the current step already has is the same note, not a mistake.
    if (ev.drums.includes(id)) {
      if (state.filled.has(id)) return;
      if (state.filled.size === 0) state.onset = ctx.currentTime;
      state.filled.add(id);
      if (state.filled.size === ev.drums.length) finishEvent(state.onset);
      else paintFollow();
      return;
    }
    flagWrong(id);
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
    ui.click.addEventListener("click", () => {
      state.clickOn = !state.clickOn;
      paintButtons();
      if (!state.clickOn) {
        window.clearTimeout(state.clickTimer);
        if (state.mode !== "listen") stopVoices();
        return;
      }
      if (state.mode === "practice" && state.pulseOrigin != null) clickLoop();
    });
    ui.bpm.addEventListener("input", () => {
      localStorage.setItem("drumkit-practice-bpm", ui.bpm.value);
      paintButtons();
      if (state.mode === "practice" && state.banner !== "loop") paintReadout();
    });
    ui.drums.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || !ui.drums.contains(button)) return;
      if (button.dataset.preset) {
        applyPreset(button.dataset.preset);
        return;
      }
      if (button.dataset.drum) {
        toggleDrum(button.dataset.drum);
        return;
      }
      if (button === ui.accompany) {
        state.accompany = !state.accompany;
        localStorage.setItem("drumkit-practice-accompany", state.accompany ? "1" : "0");
        paintAccompany();
      }
    });
  }

  function suspend() {
    if (state.mode === "off") return;
    stopTransport();
    ui.score.textContent = "准备好了";
    ui.score.dataset.trend = "";
  }

  function debug() {
    const live = summarizeTempo(
      state.loopSamples.length >= 2 ? state.loopSamples : state.samples.slice(-8),
      targetBpm(),
    );
    return {
      mode: state.mode,
      open: isOpen(),
      lesson: pattern().id,
      title: pattern().title,
      target: targetBpm(),
      cursor: state.cursor,
      loop: state.loop,
      wrong: state.wrong,
      clickOn: state.clickOn,
      filled: [...state.filled],
      score: ui.score.textContent,
      extra: ui.extra.textContent,
      trend: ui.score.dataset.trend || "",
      banner: state.banner,
      live,
      loopSummary: state.loopSummary,
      judged: { ...state.judged },
      samples: state.samples.map((sample) => ({ ...sample })),
      active: [...state.active],
      accompany: state.accompany,
      backed: state.backed,
      events: state.events.map((event) => ({ step: event.step, drums: [...event.drums] })),
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
