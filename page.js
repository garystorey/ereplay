/* ========== Config ==========
 * Tunable gameplay constants and lane/key mappings.
 * ============================= */
const LANES = 12;
const KEYS_CODES = [
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "ArrowUp",
  "KeyQ",
  "KeyA",
  "KeyW",
  "KeyS",
  "KeyE",
  "KeyD",
  "KeyR",
  "KeyF",
];
const KEYS_LABELS = [
  "L",
  "D",
  "R",
  "U",
  "P1",
  "K1",
  "P2",
  "K2",
  "P3",
  "K3",
  "P4",
  "K4",
];
const PERFECT_WIN = 5; // ms
const GREAT_WIN = 10; // ms
const GOOD_WIN = 20; // ms
const OK_WIN = 30; // ms
const LATE_MISS = 50; // ms after scheduled time
let DROP_MS = 2000; // ms from spawn to hit line
const GLOBAL_OFFSET = 0; // fixed: no manual calibration (ms)
let PRE_ROLL_MS = 3000; // ms of pre-roll (adjustable)

const RESULT_COLORS = {
  perfect: "#00ff80",
  great: "#2ecc71",
  good: "#f6d860",
  okay: "#ff8c42",
  miss: "#ff4d4f",
};

const AUTOPLAY_MISS_RATE = 0.12;
const AUTOPLAY_HIT_WINDOW = 18; // ms window around the planned hit time
const AUTOPLAY_MODES = {
  REALISTIC: "realistic",
  PERFECT: "perfect",
};

/* ========== DOM references ==========
 * Cached references to frequently accessed DOM elements.
 * ===================================== */
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("scoreEl");
const comboEl = document.getElementById("comboEl");
const timeEl = document.getElementById("timeEl");
const pPerf = document.getElementById("pPerf");
const pGreat = document.getElementById("pGreat");
const pGood = document.getElementById("pGood");
const pOk = document.getElementById("pOk");
const pMiss = document.getElementById("pMiss");
const inputData = document.getElementById("inputData");
const metaLine = document.getElementById("metaLine");
const loadBtn = document.getElementById("loadBtn");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const restartBtn = document.getElementById("restartBtn");
const dropMs = document.getElementById("dropMs");
const dropMsLbl = document.getElementById("dropMsLbl");
const autoplayChk = document.getElementById("autoplay");
const autoplayMode = document.getElementById("autoplayMode");
const loopChk = document.getElementById("loopChk");
const preRollMs = document.getElementById("preRollMs");
const preRollLbl = document.getElementById("preRollLbl");
const legend = document.getElementById("legend");
const pads = document.getElementById("pads");
const resultsOverlay = document.getElementById("resultsOverlay");
const chartGrid = document.getElementById("chartGrid");
const chartBackdrop = document.getElementById("chartBackdrop");

if (autoplayMode) {
  autoplayMode.disabled = !autoplayChk.checked;
  autoplayChk.addEventListener("change", () => {
    autoplayMode.disabled = !autoplayChk.checked;
  });
}

/* ========== Game state ==========
 * Mutable state used throughout the gameplay loop.
 * ================================= */
const scoreHistory = new Map(); // Map<string, {best, worst, total, runs}>
let notes = []; // {time, lane, judged:false, hit:false}
let originalNotes = []; // preserved copy of parsed notes so we can seek/reset
let floatTexts = []; // {x,y,text,color,ttl}
let judgedCount = 0;
let score = 0;
let combo = 0;
let longestCombo = 0;
let startTime = null;
let playing = false;
let pausedAt = 0; // time when paused (ms)
let prerolling = false;
let prerollEnd = 0;
let currentDataHash = "";
const laneKeyMap = new Map(KEYS_CODES.map((code, lane) => [code, lane]));
let topMargin = 24;
let hitY = 0;

/* ========== Utility helpers ==========
 * Generic helpers used by multiple systems.
 * ====================================== */
const LANE_BASE_COLORS = [
  "#ff6b6b", // L
  "#ff5252", // D
  "#ff3b30", // R
  "#ff1744", // U
  "#66bb6a", // P1
  "#64b5f6", // K1
  "#43a047", // P2
  "#1e88e5", // K2
  "#2e7d32", // P3
  "#1565c0", // K3
  "#1b5e20", // P4
  "#0d47a1", // K4
];

function laneColor(lane) {
  return LANE_BASE_COLORS[lane] ?? "#ffffff";
}

function resizeCanvasToDisplaySize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const needResize =
    canvas.width !== Math.round(cssW * dpr) ||
    canvas.height !== Math.round(cssH * dpr);
  if (needResize) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
}
window.addEventListener("resize", resizeCanvasToDisplaySize);

function recalcLayout() {
  resizeCanvasToDisplaySize();
  hitY = canvas.clientHeight - 140;
}
recalcLayout();

function nowMs() {
  return performance.now();
}

function currentTimeMs() {
  if (!playing || startTime === null) return 0;
  return Math.max(0, nowMs() - startTime) + GLOBAL_OFFSET;
}

function laneToX(lane) {
  const w = canvas.clientWidth / LANES;
  return (lane + 0.5) * w;
}

function addFloatText(x, y, text, color) {
  floatTexts.push({ x, y, text, color, ttl: 750 });
}

function resetStats() {
  judgedCount = 0;
  score = 0;
  combo = 0;
  longestCombo = 0;
  pPerf.textContent =
    pGreat.textContent =
    pGood.textContent =
    pOk.textContent =
    pMiss.textContent =
      "0";
  scoreEl.textContent = "0";
  comboEl.textContent = "0";
}

function resetNoteRuntimeFields(note) {
  note.judged = false;
  note.hit = false;
  note._y = undefined;
  delete note._autoPlanned;
  delete note._autoWillMiss;
  delete note._autoTargetTime;
  delete note._autoPlannedMode;
}

function hashData(data) {
  return data
    .split("")
    .reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0)
    .toString(36);
}

/* ========== Results overlay & chart helpers ==========
 * Handles the overlay that appears at the end of a run.
 * ===================================================== */
function closeResultsOverlay() {
  resultsOverlay.classList.remove("visible");
  chartBackdrop.classList.remove("visible");
}

document
  .getElementById("closeOverlay")
  .addEventListener("click", closeResultsOverlay);
chartBackdrop.addEventListener("click", closeResultsOverlay);
resultsOverlay.addEventListener("click", (e) => {
  if (e.target === resultsOverlay) {
    closeResultsOverlay();
  }
});

function createChartContainer(title) {
  const container = document.createElement("div");
  container.className = "chart-container";

  const titleEl = document.createElement("h3");
  titleEl.className = "chart-title";
  titleEl.textContent = title;
  container.appendChild(titleEl);

  const chartCanvas = document.createElement("canvas");
  container.appendChild(chartCanvas);

  return { container, canvas: chartCanvas };
}

function createPieChart(canvasEl, stats) {
  const chartCtx = canvasEl.getContext("2d");
  if (canvasEl.chart) {
    canvasEl.chart.destroy();
  }
  canvasEl.width = 260;
  canvasEl.height = 260;
  canvasEl.chart = new Chart(chartCtx, {
    type: "pie",
    data: {
      labels: ["Perfect", "Great", "Good", "Okay", "Miss"],
      datasets: [
        {
          data: [
            stats.perfect ?? 0,
            stats.great ?? 0,
            stats.good ?? 0,
            stats.okay ?? 0,
            stats.miss ?? 0,
          ],
          backgroundColor: [
            RESULT_COLORS.perfect,
            RESULT_COLORS.great,
            RESULT_COLORS.good,
            RESULT_COLORS.okay,
            RESULT_COLORS.miss,
          ],
          borderColor: "#1a2244",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      layout: { padding: { bottom: 10 } },
      plugins: {
        legend: {
          position: "bottom",
          align: "center",
          labels: {
            color: "#e7e9f5",
            padding: 8,
            font: { size: 11, weight: "bold" },
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 6,
          },
        },
      },
    },
  });
}

function createSummaryItem(label, value) {
  const item = document.createElement("div");
  item.className = "summary-item";

  const labelEl = document.createElement("span");
  labelEl.className = "summary-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "summary-value";
  valueEl.textContent = value;

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return item;
}

function updateHighScore() {
  const currentStats = {
    perfect: +pPerf.textContent,
    great: +pGreat.textContent,
    good: +pGood.textContent,
    okay: +pOk.textContent,
    miss: +pMiss.textContent,
    score,
    longestStreak: longestCombo,
  };

  if (!scoreHistory.has(currentDataHash)) {
    scoreHistory.set(currentDataHash, {
      best: { ...currentStats },
      worst: { ...currentStats },
      total: { ...currentStats },
      runs: 1,
      longestStreak: currentStats.longestStreak,
    });
    return;
  }

  const record = scoreHistory.get(currentDataHash);
  record.runs += 1;
  const ensureStatFields = (obj) => {
    obj.perfect ??= 0;
    obj.great ??= 0;
    obj.good ??= 0;
    obj.okay ??= 0;
    obj.miss ??= 0;
  };
  ensureStatFields(record.best);
  ensureStatFields(record.worst);
  ensureStatFields(record.total);
  record.total.perfect += currentStats.perfect;
  record.total.great += currentStats.great;
  record.total.good += currentStats.good;
  record.total.okay += currentStats.okay;
  record.total.miss += currentStats.miss;
  record.total.score += currentStats.score;
  record.total.longestStreak = Math.max(
    record.total.longestStreak ?? 0,
    currentStats.longestStreak
  );

  if (currentStats.score > record.best.score) {
    record.best = { ...currentStats };
  }
  if (currentStats.score < record.worst.score) {
    record.worst = { ...currentStats };
  }
  record.longestStreak = Math.max(
    record.longestStreak ?? 0,
    currentStats.longestStreak
  );
}

function showResults() {
  chartGrid.innerHTML = "";
  const currentStats = {
    perfect: +pPerf.textContent,
    great: +pGreat.textContent,
    good: +pGood.textContent,
    okay: +pOk.textContent,
    miss: +pMiss.textContent,
    score,
    longestStreak: longestCombo,
  };

  const record = scoreHistory.get(currentDataHash);
  const runs = record ? record.runs : 1;
  const highScore = record ? record.best.score : currentStats.score;
  const longestStreak = record
    ? Math.max(record.longestStreak ?? 0, currentStats.longestStreak)
    : currentStats.longestStreak;

  const summary = document.createElement("div");
  summary.className = "chart-summary";
  summary.appendChild(createSummaryItem("Runs", runs));
  summary.appendChild(createSummaryItem("High Score", highScore));
  summary.appendChild(createSummaryItem("Longest Streak", longestStreak));
  chartGrid.appendChild(summary);

  if (record && record.runs > 1) {
    const ensureStatFields = (obj) => {
      obj.perfect ??= 0;
      obj.great ??= 0;
      obj.good ??= 0;
      obj.okay ??= 0;
      obj.miss ??= 0;
    };
    ensureStatFields(record.best);
    ensureStatFields(record.worst);
    ensureStatFields(record.total);
    const { best, worst, total } = record;

    const cumulativeRow = document.createElement("div");
    cumulativeRow.className = "charts-row";
    const cumulativeCol = document.createElement("div");
    cumulativeCol.className = "chart-column";
    const { container: cumulativeContainer, canvas: cumulativeCanvas } =
      createChartContainer("Total Stats Across All Runs");
    cumulativeCol.appendChild(cumulativeContainer);
    cumulativeRow.appendChild(cumulativeCol);
    chartGrid.appendChild(cumulativeRow);

    createPieChart(cumulativeCanvas, total);

    const chartsRow = document.createElement("div");
    chartsRow.className = "charts-row";

    const bestColumn = document.createElement("div");
    bestColumn.className = "chart-column";
    const { container: bestContainer, canvas: bestCanvas } =
      createChartContainer("Best Run");
    bestColumn.appendChild(bestContainer);

    const worstColumn = document.createElement("div");
    worstColumn.className = "chart-column";
    const { container: worstContainer, canvas: worstCanvas } =
      createChartContainer("Worst Run");
    worstColumn.appendChild(worstContainer);

    chartsRow.appendChild(bestColumn);
    chartsRow.appendChild(worstColumn);
    chartGrid.appendChild(chartsRow);

    createPieChart(bestCanvas, best);
    createPieChart(worstCanvas, worst);
  } else {
    const singleRow = document.createElement("div");
    singleRow.className = "charts-row";
    const column = document.createElement("div");
    column.className = "chart-column";
    const { container, canvas: chartCanvas } = createChartContainer("Results");
    column.appendChild(container);
    singleRow.appendChild(column);
    chartGrid.appendChild(singleRow);
    createPieChart(chartCanvas, currentStats);
  }

  resultsOverlay.classList.add("visible");
  chartBackdrop.classList.add("visible");
}

/* ========== Parsing & data preparation ==========
 * Handles reading JSON from the textarea and transforming to note objects.
 * ================================================= */
function parseData(jsonStr) {
  let raw;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    alert("Invalid JSON: " + e.message);
    return { meta: {}, notes: [] };
  }

  let meta = {};
  let frames = [];
  currentDataHash = hashData(jsonStr);

  if (Array.isArray(raw)) {
    frames = raw;
  } else if (raw && Array.isArray(raw.frames)) {
    frames = raw.frames;
    meta = raw.meta || {};
  } else if (raw && raw.data && Array.isArray(raw.data)) {
    frames = raw.data;
    meta = raw.meta || {};
  }

  const out = [];
  for (const entry of frames) {
    let t;
    let bits;
    if (Array.isArray(entry)) {
      t = +entry[0];
      bits = String(entry[1] ?? "").trim();
    } else {
      t = +entry.t;
      bits = String(entry.bits ?? "").trim();
    }

    if (!Number.isFinite(t) || bits.length !== 16) continue;
    for (let i = 2; i < 16; i++) {
      if (bits[i] === "1")
        out.push({ time: t, lane: i - 2, judged: false, hit: false });
    }
  }

  out.sort((a, b) => a.time - b.time);
  const t0 = out.length ? out[0].time : 0;
  for (const n of out) n.time -= t0;

  return { meta, notes: out };
}

function makeBitStringFromLanes(lanes) {
  const arr = new Array(16).fill("0");
  for (const lane of lanes) {
    if (lane >= 0 && lane < LANES) arr[lane + 2] = "1";
  }
  return arr.join("");
}

function generateSample() {
  const frames = [];
  const start = 500; // ms before first hit
  const step = 300;
  const total = 42;
  for (let i = 0; i < total; i++) {
    const t = start + i * step;
    const lane = i % LANES;
    const chord = i % 4 === 0 ? [(lane + 7) % LANES] : [];
    const lanes = [lane, ...chord];
    frames.push([t, makeBitStringFromLanes(lanes)]);
  }
  return {
    meta: {
      start_time: new Date().toISOString(),
      game: "Demo",
      character: "Sampler",
    },
    frames,
  };
}

function generateRandomData() {
  const frames = [];
  const start = 500;
  const duration = 30000; // 30 seconds
  const minGap = 200;
  const maxGap = 800;

  let currentTime = start;
  while (currentTime < duration) {
    const numNotes = Math.floor(Math.random() * 3) + 1;
    const usedLanes = new Set();
    const lanes = [];

    while (lanes.length < numNotes) {
      const lane = Math.floor(Math.random() * LANES);
      if (!usedLanes.has(lane)) {
        lanes.push(lane);
        usedLanes.add(lane);
      }
    }

    frames.push([currentTime, makeBitStringFromLanes(lanes)]);
    currentTime += minGap + Math.random() * (maxGap - minGap);
  }

  return {
    meta: {
      start_time: new Date().toISOString(),
      game: "Random Pattern",
      character: "Auto-Generated",
    },
    frames,
  };
}

/* ========== UI wiring ==========
 * Sets up sliders, buttons, legends, and pads.
 * =========================================== */
function setMetaLine(meta) {
  const parts = [];
  if (meta.game) parts.push(`Game: ${meta.game}`);
  if (meta.character) parts.push(`Character: ${meta.character}`);
  if (meta.start_time) parts.push(`Start: ${meta.start_time}`);
  metaLine.textContent = parts.join(" • ");
}

function fillLegendAndPads() {
  legend.innerHTML = "";
  pads.innerHTML = "";
  for (let l = 0; l < LANES; l++) {
    const pad = document.createElement("div");
    pad.className = "pad";
    pad.textContent = KEYS_LABELS[l];
    pad.style.borderColor = "#2b3569";
    pad.style.color = laneColor(l);
    pad.addEventListener("pointerdown", () => tryHitLane(l));
    pads.appendChild(pad);
  }
}

fillLegendAndPads();

dropMs.addEventListener("input", () => {
  DROP_MS = +dropMs.value;
  dropMsLbl.textContent = DROP_MS;
});

preRollMs.addEventListener("input", () => {
  PRE_ROLL_MS = +preRollMs.value;
  preRollLbl.textContent = (PRE_ROLL_MS / 1000).toString();
});

loadBtn.addEventListener("click", () => {
  const { meta, notes: parsed } = parseData(inputData.value);
  originalNotes = parsed.map((n) => {
    const clone = { ...n };
    resetNoteRuntimeFields(clone);
    return clone;
  });
  notes = originalNotes.map((n) => {
    const clone = { ...n };
    resetNoteRuntimeFields(clone);
    return clone;
  });
  setMetaLine(meta);
  resetStats();
  pauseGame();
  seekToStart();
  if (!notes.length)
    alert(
      'No notes parsed. Ensure your frames are like: [timeMs, "16-bit-string"].'
    );
});

playBtn.addEventListener("click", () => {
  if (!originalNotes || originalNotes.length === 0) {
    const randomData = generateRandomData();
    inputData.value = JSON.stringify(randomData, null, 2);
    const { meta, notes: parsed } = parseData(inputData.value);
    originalNotes = parsed.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
    setMetaLine(meta);
  }
  startPreRoll();
});

pauseBtn.addEventListener("click", pauseGame);
restartBtn.addEventListener("click", () => {
  startPreRoll(true);
});

/* ========== Gameplay control ==========
 * Core state transitions for starting, pausing, and resetting the song.
 * ===================================================================== */
function seekToStart() {
  pausedAt = 0;
  startTime = null;
  playing = false;
  if (originalNotes && originalNotes.length) {
    notes = originalNotes.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
  } else {
    notes = notes.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
  }
  resetStats();
}

function startPreRoll(isRestart = false) {
  if ((!originalNotes || !originalNotes.length) && inputData.value) {
    const parsed = parseData(inputData.value);
    originalNotes = parsed.notes.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
  }

  if (originalNotes && originalNotes.length) {
    notes = originalNotes.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
  } else {
    notes = notes.map((n) => {
      const clone = { ...n };
      resetNoteRuntimeFields(clone);
      return clone;
    });
  }

  resetStats();
  pausedAt = 0;
  playing = false;
  startTime = null;
  prerolling = true;
  prerollEnd = nowMs() + PRE_ROLL_MS;
}

function playGame() {
  if (playing) return;
  if (startTime === null) {
    startTime = nowMs() - PRE_ROLL_MS - pausedAt;
  } else {
    startTime = nowMs() - pausedAt;
  }
  playing = true;
}

function pauseGame() {
  if (!playing) return;
  pausedAt = currentTimeMs();
  playing = false;
}

/* ========== Input handling ==========
 * Keyboard bindings for manual play.
 * ==================================== */
window.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const typing =
    active &&
    (active.tagName === "TEXTAREA" ||
      (active.tagName === "INPUT" && active.type === "text"));
  if (e.code === "Space" && !typing) {
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  const lane = laneKeyMap.get(e.code);
  if (lane !== undefined) {
    tryHitLane(lane);
    e.preventDefault();
  }
});

/* ========== Judging ==========
 * Determines hit quality and applies scoring.
 * ============================================ */
function judgeDelta(delta) {
  const ad = Math.abs(delta);
  if (ad <= PERFECT_WIN)
    return { label: "Perfect", score: 300, color: RESULT_COLORS.perfect };
  if (ad <= GREAT_WIN)
    return { label: "Great", score: 200, color: RESULT_COLORS.great };
  if (ad <= GOOD_WIN)
    return { label: "Good", score: 120, color: RESULT_COLORS.good };
  if (ad <= OK_WIN)
    return { label: "Okay", score: 50, color: RESULT_COLORS.okay };
  return null;
}

function tryHitLane(lane, options = {}) {
  if (prerolling) return;
  const t =
    options && typeof options.forcedTime === "number"
      ? options.forcedTime
      : currentTimeMs();
  let target = null;
  let bestAd = Infinity;
  for (const n of notes) {
    if (n.lane !== lane || n.judged) continue;
    const dt = t - n.time;
    const ad = Math.abs(dt);
    if (ad <= OK_WIN && ad < bestAd) {
      bestAd = ad;
      target = n;
    }
  }

  if (!target) return;

  const delta = t - target.time;
  const judgement = judgeDelta(delta);
  if (!judgement) return;

  target.judged = true;
  target.hit = true;
  score += judgement.score;
  combo += 1;
  if (combo > longestCombo) {
    longestCombo = combo;
    comboEl.textContent = longestCombo;
  }
  judgedCount += 1;

  if (judgement.label === "Perfect") pPerf.textContent = +pPerf.textContent + 1;
  else if (judgement.label === "Great")
    pGreat.textContent = +pGreat.textContent + 1;
  else if (judgement.label === "Good")
    pGood.textContent = +pGood.textContent + 1;
  else pOk.textContent = +pOk.textContent + 1;

  scoreEl.textContent = score;

  const x = laneToX(lane);
  const msText = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  addFloatText(
    x,
    hitY - 10,
    `${judgement.label} (${msText}ms)`,
    judgement.color
  );
}

/* ========== Autoplay ==========
 * Optional automatic player for testing.
 * ====================================== */
function autoPlayStep(t) {
  if (prerolling) return;
  if (!autoplayChk.checked) return;

  const mode =
    autoplayMode && autoplayMode.value
      ? autoplayMode.value
      : AUTOPLAY_MODES.REALISTIC;

  for (const n of notes) {
    if (n.judged) continue;
    if (mode === AUTOPLAY_MODES.PERFECT) {
      if (t < n.time) continue;
      tryHitLane(n.lane, { forcedTime: n.time });
      continue;
    }

    if (n._autoPlanned && n._autoPlannedMode !== mode) {
      n._autoPlanned = false;
      delete n._autoWillMiss;
      delete n._autoTargetTime;
      delete n._autoPlannedMode;
    }

    const dt = t - n.time;
    if (dt < -200) continue;

    if (!n._autoPlanned) {
      n._autoPlanned = true;
      n._autoPlannedMode = mode;
      if (Math.random() < AUTOPLAY_MISS_RATE) {
        n._autoWillMiss = true;
      } else {
        let offset;
        const accuracy = Math.random();
        if (accuracy < 0.1) {
          offset = (Math.random() * 2 - 1) * (PERFECT_WIN * 0.8);
        } else if (accuracy < 0.3) {
          const direction = Math.random() > 0.5 ? 1 : -1;
          offset =
            direction *
            (PERFECT_WIN + Math.random() * (GREAT_WIN - PERFECT_WIN));
        } else if (accuracy < 0.65) {
          const direction = Math.random() > 0.5 ? 1 : -1;
          const spread = GOOD_WIN - GREAT_WIN;
          const bias = 0.25 + Math.random() * 0.75;
          offset = direction * (GREAT_WIN + bias * spread);
        } else {
          const direction = Math.random() > 0.5 ? 1 : -1;
          const spread = OK_WIN - GOOD_WIN;
          const bias = 0.5 + Math.random() * 0.5;
          offset = direction * (GOOD_WIN + bias * spread);
        }
        n._autoTargetTime = n.time + offset;
        n._autoWillMiss = false;
      }
    }

    if (n._autoWillMiss) continue;

    const targetTime = n._autoTargetTime ?? n.time;
    if (t + AUTOPLAY_HIT_WINDOW < targetTime) continue;
    if (t - targetTime > OK_WIN) {
      n._autoWillMiss = true;
      continue;
    }

    tryHitLane(n.lane);
  }
}

/* ========== Rendering ==========
 * Renders notes, UI elements, and handles miss logic per frame.
 * ================================================================= */
function draw() {
  recalcLayout();
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i <= LANES; i++) {
    const x = i * (w / LANES);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.strokeStyle = "#1a2345";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(0, hitY);
  ctx.lineTo(w, hitY);
  ctx.strokeStyle = "#3c4c93";
  ctx.lineWidth = 4;
  ctx.stroke();

  let t = currentTimeMs();
  if (prerolling) {
    const remaining = prerollEnd - nowMs();
    t = Math.min(0, nowMs() - prerollEnd);
    timeEl.textContent = (Math.max(0, remaining) / 1000).toFixed(3) + "s";
    ctx.save();
    ctx.fillStyle = "rgba(15, 18, 32, 0.85)";
    ctx.fillRect(0, 0, w, h);

    const countdown = Math.ceil(Math.max(0, remaining) / 1000);
    ctx.font =
      "700 120px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(122, 167, 255, 0.5)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "white";
    ctx.fillText(countdown.toString(), w / 2, h / 2);

    ctx.shadowBlur = 0;
    ctx.font =
      "600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("Ready!", w / 2, h / 2 + 80);
    ctx.restore();
    if (remaining <= 0) {
      prerolling = false;
      startTime = nowMs();
      playing = true;
      t = 0;
    }
  } else {
    const displayTime = playing ? t : pausedAt;
    timeEl.textContent = (displayTime / 1000).toFixed(3) + "s";
  }

  for (const n of notes) {
    if (!n.judged && t - n.time > LATE_MISS) {
      n.judged = true;
      n.hit = false;
      judgedCount += 1;
      combo = 0;
      pMiss.textContent = +pMiss.textContent + 1;
      const x = laneToX(n.lane);
      addFloatText(x, hitY + 14, "Miss", RESULT_COLORS.miss);
    }
  }

  autoPlayStep(t);

  const travel = hitY - topMargin;
  const laneWidth = canvas.clientWidth / LANES;
  const radius = Math.max(5, Math.min(Math.floor((laneWidth * 0.6) / 2), 14));

  for (let l = 0; l < LANES; l++) {
    const x = laneToX(l);
    const label = KEYS_LABELS[l] ?? "";
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = laneColor(l);
    ctx.globalAlpha = 0.65;
    ctx.arc(x, hitY, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (label) {
      ctx.save();
      ctx.font =
        "700 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(label, x, hitY + radius + 10);
      ctx.restore();
    }
  }

  for (const n of notes) {
    if (n.judged && t - n.time > 600) continue;
    const timeToHit = n.time - t;
    if (timeToHit > DROP_MS) continue;

    const progress = 1 - timeToHit / DROP_MS;
    const y = topMargin + Math.max(0, Math.min(1, progress)) * travel;
    n._y = y;

    if (y < topMargin - 50 || y > canvas.clientHeight + 50) continue;

    const noteX = laneToX(n.lane);
    const label = KEYS_LABELS[n.lane] ?? "";

    ctx.beginPath();
    ctx.arc(noteX, y, radius, 0, Math.PI * 2);
    const baseColor = laneColor(n.lane);
    ctx.fillStyle = baseColor;
    ctx.globalAlpha = n.judged ? 0.25 : 0.95;
    ctx.fill();

    if (!n.judged) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = baseColor;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (label) {
      ctx.save();
      ctx.font =
        "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillText(label, noteX, y);
      ctx.restore();
    }
  }

  for (const f of floatTexts) {
    const life = Math.max(0, f.ttl) / 750;
    ctx.globalAlpha = life;
    ctx.font =
      "700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - (1 - life) * 30);
    ctx.globalAlpha = 1;
    f.ttl -= 16;
  }
  floatTexts = floatTexts.filter((f) => f.ttl > 0);

  for (const n of notes) {
    if (n.judged) continue;
    const dt = t - n.time;
    if (Math.abs(dt) <= PERFECT_WIN * 2) {
      const x = laneToX(n.lane);
      const alpha = 1 - Math.abs(dt) / (PERFECT_WIN * 2);
      ctx.save();
      ctx.globalAlpha = 0.6 * alpha;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(6, 245, 78, 0.9)";
      ctx.lineWidth = 3;
      ctx.arc(x, hitY, radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  const allJudged = notes.length > 0 && notes.every((n) => n.judged);
  if (allJudged && playing) {
    updateHighScore();
    if (loopChk && loopChk.checked) {
      seekToStart();
      startPreRoll(true);
    } else {
      pauseGame();
      const last = Math.max(...notes.map((n) => n.time));
      pausedAt = last + 50;
      showResults();
    }
  }

  requestAnimationFrame(draw);
}

/* ========== Initialization ==========
 * Prepare default UI state and start render loop.
 * ================================================ */
(function init() {
  inputData.value = "";
  originalNotes = [];
  notes = [];
  setMetaLine({});
  dropMsLbl.textContent = DROP_MS;
  preRollLbl.textContent = (PRE_ROLL_MS / 1000).toString();
  requestAnimationFrame(draw);
})();
