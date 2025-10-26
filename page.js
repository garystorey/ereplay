/* ========== Config ========== */
const LANES = 12;
const KEYS_CODES = ['ArrowLeft', 'ArrowDown', 'ArrownRight', 'ArrowUp', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF'];
const KEYS_LABELS = ['L', 'D', 'R', 'U', 'P1', 'P2', 'P3', 'P4', 'K1', 'k2', 'k3', 'K4'];
const PERFECT_WIN = 10;   // ms
const GOOD_WIN = 40;  // ms
const OK_WIN = 80;  // ms
const LATE_MISS = 120;  // ms after scheduled time

// High score tracking
const scoreHistory = new Map(); // Map<string, {score: number, perfect: number, good: number, okay: number, miss: number}>
let DROP_MS = 2000;       // ms from spawn to hit line
const GLOBAL_OFFSET = 0;    // fixed: no manual calibration (ms)
let PRE_ROLL_MS = 3000; // ms of pre-roll (adjustable)

/* ========== DOM refs ========== */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('scoreEl');
const comboEl = document.getElementById('comboEl');
const timeEl = document.getElementById('timeEl');
const pPerf = document.getElementById('pPerf');
const pGood = document.getElementById('pGood');
const pOk = document.getElementById('pOk');
const pMiss = document.getElementById('pMiss');
const inputData = document.getElementById('inputData');
const metaLine = document.getElementById('metaLine');
const loadBtn = document.getElementById('loadBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const dropMs = document.getElementById('dropMs');
const dropMsLbl = document.getElementById('dropMsLbl');

const autoplayChk = document.getElementById('autoplay');
const loopChk = document.getElementById('loopChk');
const preRollMs = document.getElementById('preRollMs');
const preRollLbl = document.getElementById('preRollLbl');
const legend = document.getElementById('legend');
const pads = document.getElementById('pads');

/* ========== Canvas sizing (retina) ========== */
function resizeCanvasToDisplaySize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const needResize = canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr);
    if (needResize) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
}
window.addEventListener('resize', resizeCanvasToDisplaySize);

/* ========== Colors per lane ========== */
function laneColor(lane) {
    const hue = Math.round(lane * 360 / LANES);
    return `hsl(${hue}deg 90% 60%)`;
}

/* ========== Game state ========== */
let notes = []; // {time, lane, judged:false, hit:false}
let judgedCount = 0;
let score = 0;
let combo = 0;
let startTime = null;
let playing = false;
let pausedAt = 0; // time when paused (ms)
let floatTexts = []; // {x,y,text,color,ttl}
let laneKeyMap = new Map(KEYS_CODES.map((code, lane) => [code, lane]));
let originalNotes = []; // preserved copy of parsed notes so we can seek/reset
let prerolling = false;
let prerollEnd = 0;
let timeShift = 0; // when we shift notes so first spawn happens after preroll
// preRolled no longer needed; pre-roll is handled via startTime offset
let loopCount = 0;
let currentDataHash = ''; // to track when data changes
let bestScore = 0;
let worstScore = Infinity;

/* Results overlay */
const resultsOverlay = document.getElementById('resultsOverlay');
const chartGrid = document.getElementById('chartGrid');
const chartBackdrop = document.getElementById('chartBackdrop');

// Function to close the results overlay
function closeResultsOverlay() {
    resultsOverlay.classList.remove('visible');
    chartBackdrop.classList.remove('visible');
}

// Close button click
document.getElementById('closeOverlay').addEventListener('click', closeResultsOverlay);

// Backdrop click
chartBackdrop.addEventListener('click', closeResultsOverlay);

// Click outside overlay
resultsOverlay.addEventListener('click', (e) => {
    if (e.target === resultsOverlay) {
        closeResultsOverlay();
    }
});

function showResults() {
    chartGrid.innerHTML = '';
    const currentStats = {
        perfect: +pPerf.textContent,
        good: +pGood.textContent,
        okay: +pOk.textContent,
        miss: +pMiss.textContent,
        score: score
    };

    if (loopCount > 1) {
        // Add high score at the top if available
        if (scoreHistory.has(currentDataHash)) {
            const highScoreEl = document.createElement('div');
            highScoreEl.className = 'high-score';
            highScoreEl.textContent = `High Score: ${scoreHistory.get(currentDataHash).best.score}`;
            chartGrid.appendChild(highScoreEl);
        }

        // Create first row for cumulative stats
        const cumulativeRow = document.createElement('div');
        cumulativeRow.className = 'charts-row';
        const cumulativeCol = document.createElement('div');
        cumulativeCol.className = 'chart-column';
        const cumulativeChart = createChartContainer('Total Stats Across All Runs');
        cumulativeCol.appendChild(cumulativeChart.parentElement);
        cumulativeRow.appendChild(cumulativeCol);
        chartGrid.appendChild(cumulativeRow);

        // Calculate cumulative stats
        const cumulativeStats = {
            perfect: 0,
            good: 0,
            okay: 0,
            miss: 0,
            score: 0
        };

        // Add current run
        cumulativeStats.perfect += currentStats.perfect;
        cumulativeStats.good += currentStats.good;
        cumulativeStats.okay += currentStats.okay;
        cumulativeStats.miss += currentStats.miss;
        cumulativeStats.score += currentStats.score;

        // Create cumulative chart
        createPieChart(cumulativeChart, cumulativeStats);

        // Create second row for best/worst
        const chartsRow = document.createElement('div');
        chartsRow.className = 'charts-row';
        chartsRow.style.marginTop = '2rem';

        // Create columns for side-by-side layout
        const bestColumn = document.createElement('div');
        bestColumn.className = 'chart-column';
        const worstColumn = document.createElement('div');
        worstColumn.className = 'chart-column';

        // Create and append charts to their columns
        const bestChart = createChartContainer('Best Run');
        const worstChart = createChartContainer('Worst Run');
        bestColumn.appendChild(bestChart.parentElement);
        worstColumn.appendChild(worstChart.parentElement);

        // Add columns to row and row to grid
        chartsRow.appendChild(bestColumn);
        chartsRow.appendChild(worstColumn);
        chartGrid.appendChild(chartsRow);                // Create charts
        createPieChart(bestChart, scoreHistory.get(currentDataHash).best);
        createPieChart(worstChart, scoreHistory.get(currentDataHash).worst);
    } else {
        // Show single run results centered
        const container = createChartContainer('Results');
        const column = document.createElement('div');
        column.className = 'chart-column';
        column.appendChild(container.parentElement);
        chartGrid.appendChild(column);
        createPieChart(container, currentStats);
    } resultsOverlay.classList.add('visible');
}

function createChartContainer(title) {
    const container = document.createElement('div');
    container.className = 'chart-container';

    const titleEl = document.createElement('h3');
    titleEl.className = 'chart-title';
    titleEl.textContent = title;
    container.appendChild(titleEl);

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    chartGrid.appendChild(container);
    return canvas;
}

function createPieChart(canvas, stats) {
    const ctx = canvas.getContext('2d');
    // Destroy any existing chart
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    canvas.chart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Perfect', 'Good', 'Okay', 'Miss'],
            datasets: [{
                data: [stats.perfect, stats.good, stats.okay, stats.miss],
                backgroundColor: [
                    '#62d26f',
                    '#6fd3ff',
                    '#ffd166',
                    '#ff6b6b'
                ],
                borderColor: '#1a2244',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: {
                padding: {
                    bottom: 10
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    align: 'center',
                    labels: {
                        color: '#e7e9f5',
                        padding: 8,
                        font: {
                            size: 11,
                            weight: 'bold'
                        },
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 6
                    }
                }
            }
        }
    });
}

function updateHighScore() {
    const currentStats = {
        perfect: +pPerf.textContent,
        good: +pGood.textContent,
        okay: +pOk.textContent,
        miss: +pMiss.textContent,
        score: score
    };

    if (!scoreHistory.has(currentDataHash)) {
        scoreHistory.set(currentDataHash, {
            best: currentStats,
            worst: currentStats
        });
    } else {
        const record = scoreHistory.get(currentDataHash);
        if (currentStats.score > record.best.score) {
            record.best = { ...currentStats };
        }
        if (currentStats.score < record.worst.score) {
            record.worst = { ...currentStats };
        }
    }
}

/* Hit line & layout (in CSS pixels) */
let topMargin = 24;
let hitY = 0;
function recalcLayout() {
    resizeCanvasToDisplaySize();
    hitY = canvas.clientHeight - 140;
}
recalcLayout();

/* ========== Helpers ========== */
function nowMs() {
    return performance.now();
}
function currentTimeMs() {
    if (!playing || startTime === null) return 0;
    return Math.max(0, nowMs() - startTime) + GLOBAL_OFFSET;
}
function addFloatText(x, y, text, color) {
    floatTexts.push({ x, y, text, color, ttl: 750 });
}
function resetStats() {
    judgedCount = 0; score = 0; combo = 0;
    pPerf.textContent = pGood.textContent = pOk.textContent = pMiss.textContent = '0';
    scoreEl.textContent = '0'; comboEl.textContent = '0';
}

/* ========== Parsing ========== */
/** Accepts:
 *  { meta: {...}, frames: [[ms, "16-bits"], ...] }
 *  or just [[ms, "16-bits"], ...]
 *  Also supports [{t:ms,bits:"16-bits"}, ...]
 */
function hashData(data) {
    // Simple hash function for data comparison
    return data.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0).toString(36);
}

function parseData(jsonStr) {
    let raw;
    try { raw = JSON.parse(jsonStr); }
    catch (e) {
        alert('Invalid JSON: ' + e.message);
        return { meta: {}, notes: [] };
    }
    let meta = {};
    let frames = [];

    // Update current data hash
    currentDataHash = hashData(jsonStr);
    if (Array.isArray(raw)) frames = raw;
    else if (raw && Array.isArray(raw.frames)) { frames = raw.frames; meta = raw.meta || {}; }
    else if (raw && raw.data && Array.isArray(raw.data)) { frames = raw.data; meta = raw.meta || {}; }
    else frames = [];

    const out = [];
    for (const entry of frames) {
        let t, bits;
        if (Array.isArray(entry)) { t = +entry[0]; bits = String(entry[1] ?? '').trim(); }
        else { t = +entry.t; bits = String(entry.bits ?? '').trim(); }

        if (!Number.isFinite(t) || bits.length !== 16) continue;
        // Bits 2..15 map to lanes 0..13
        for (let i = 2; i < 16; i++) {
            if (bits[i] === '1') out.push({ time: t, lane: i - 2, judged: false, hit: false });
        }
    }
    // Normalize time so first note ~>= 0
    out.sort((a, b) => a.time - b.time);
    const t0 = out.length ? out[0].time : 0;
    for (const n of out) n.time -= t0;

    return { meta, notes: out };
}

/* ========== Demo sample generator ========== */
function makeBitStringFromLanes(lanes) {
    const arr = new Array(16).fill('0');
    // arr[0]=arr[1]='0' (already 0)
    for (const lane of lanes) {
        if (lane >= 0 && lane < LANES) arr[lane + 2] = '1';
    }
    return arr.join('');
}
function generateSample() {
    const frames = [];
    const start = 500; // ms before first hit
    const step = 300;
    const total = 42;
    for (let i = 0; i < total; i++) {
        const t = start + i * step;
        const lane = i % LANES;
        const chord = (i % 4 === 0) ? [(lane + 7) % LANES] : [];
        const lanes = [lane, ...chord];
        frames.push([t, makeBitStringFromLanes(lanes)]);
    }
    return {
        meta: { start_time: new Date().toISOString(), game: "Demo", character: "Sampler" },
        frames
    };
}

/* ========== UI Wiring ========== */
function setMetaLine(meta) {
    const parts = [];
    if (meta.game) parts.push(`Game: ${meta.game}`);
    if (meta.character) parts.push(`Character: ${meta.character}`);
    if (meta.start_time) parts.push(`Start: ${meta.start_time}`);
    metaLine.textContent = parts.join(' • ');
}
function fillLegendAndPads() {
    legend.innerHTML = '';
    pads.innerHTML = '';
    for (let l = 0; l < LANES; l++) {


        const pad = document.createElement('div');
        pad.className = 'pad';
        pad.textContent = KEYS_LABELS[l];
        pad.style.borderColor = '#2b3569';
        pad.style.color = laneColor(l);
        pad.addEventListener('pointerdown', () => tryHitLane(l));
        pads.appendChild(pad);
    }
}
fillLegendAndPads();

/* Sliders */
dropMs.addEventListener('input', () => {
    DROP_MS = +dropMs.value; dropMsLbl.textContent = DROP_MS;
});
preRollMs.addEventListener('input', () => {
    PRE_ROLL_MS = +preRollMs.value;
    preRollLbl.textContent = (PRE_ROLL_MS / 1000).toString();
});

/* Buttons */
loadBtn.addEventListener('click', () => {
    const { meta, notes: parsed } = parseData(inputData.value);
    // preserve original timestamps so we can reset on seek/restart
    originalNotes = parsed.map(n => ({ ...n }));
    notes = originalNotes.map(n => ({ ...n }));
    setMetaLine(meta);
    resetStats();
    pauseGame();
    seekToStart();
    if (!notes.length) alert('No notes parsed. Ensure your frames are like: [timeMs, "16-bit-string"].');
});
playBtn.addEventListener('click', () => {
    // If no data is provided, generate random data
    if (!originalNotes || originalNotes.length === 0) {
        const randomData = generateRandomData();
        inputData.value = JSON.stringify(randomData, null, 2);
        const { meta, notes: parsed } = parseData(inputData.value);
        originalNotes = parsed.map(n => ({ ...n }));
        setMetaLine(meta);
    }
    startPreRoll();
});
pauseBtn.addEventListener('click', pauseGame);
restartBtn.addEventListener('click', () => { startPreRoll(true); });

function startPreRoll(isRestart = false) {
    // If user hasn't loaded or originalNotes is empty, parse the textarea now
    if ((!originalNotes || !originalNotes.length) && inputData.value) {
        const parsed = parseData(inputData.value);
        originalNotes = parsed.notes.map(n => ({ ...n }));
    }

    // Reset loop count if not restarting
    if (!isRestart) {
        loopCount = 0;
    }

    // Reset notes from original
    if (originalNotes && originalNotes.length) {
        notes = originalNotes.map(n => ({ ...n, time: n.time, judged: false, hit: false }));
    } else {
        // fallback: keep notes but reset judgments
        notes = notes.map(n => ({ ...n, judged: false, hit: false }));
    }
    resetStats();
    pausedAt = 0;
    playing = false;
    startTime = null;
    // Enter preroll state; notes are hidden until preroll ends
    prerolling = true;
    prerollEnd = nowMs() + PRE_ROLL_MS;
}

/* Keyboard input */
window.addEventListener('keydown', (e) => {
    // Prevent space from triggering page-level behavior (like form submit or accidental reset)
    // but allow it when typing in a text area/input.
    const active = document.activeElement;
    const typing = active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'));
    if (e.code === 'Space' && !typing) {
        e.preventDefault();
        return;
    }
    if (e.repeat) return; // basic protection; repeated presses can be noisy
    const lane = laneKeyMap.get(e.code);
    if (lane !== undefined) {
        tryHitLane(lane);
        e.preventDefault();
    }
});

/* ========== Gameplay control ========== */
function seekToStart() {
    pausedAt = 0;
    startTime = null;
    playing = false;
    // Reset to original parsed timestamps and clear judgments
    if (originalNotes && originalNotes.length) {
        notes = originalNotes.map(n => ({ ...n }));
    } else {
        for (const n of notes) { n.judged = false; n.hit = false; n._y = undefined; }
    }
    resetStats();
}
function playGame() {
    if (playing) return;
    // Start playback with pre-roll: set startTime so currentTimeMs() is negative during pre-roll
    if (startTime === null) {
        // fresh start: startTime such that now - startTime = -PRE_ROLL_MS
        startTime = nowMs() + PRE_ROLL_MS * -1 - pausedAt;
    } else {
        // resume from pause: subtract pausedAt so time continues from pausedAt
        startTime = nowMs() - pausedAt;
    }
    playing = true;
}
function pauseGame() {
    if (!playing) return;
    pausedAt = currentTimeMs();
    playing = false;
}

/* ========== Judging ========== */
function judgeDelta(delta) {
    const ad = Math.abs(delta);
    if (ad <= PERFECT_WIN) return { label: 'Perfect', score: 300, color: '#00ff00' };
    if (ad <= GOOD_WIN) return { label: 'Good', score: 120, color: '#deff22ff' };
    if (ad <= OK_WIN) return { label: 'Okay', score: 50, color: '#f78e05ff' };
    return null;
}
function tryHitLane(lane) {
    if (prerolling) return; // ignore inputs during preroll
    const t = currentTimeMs();
    // Find nearest unjudged note in this lane within the widest window
    let target = null;
    let bestAd = Infinity;
    for (const n of notes) {
        if (n.lane !== lane || n.judged) continue;
        const dt = t - n.time;
        const ad = Math.abs(dt);
        if (ad <= OK_WIN && ad < bestAd) { bestAd = ad; target = n; }
        // Early-out: once n.time > t + OK_WIN and we’re scanning sorted, we could break; but keep it simple
    }
    if (target) {
        const delta = t - target.time;
        const j = judgeDelta(delta);
        if (j) {
            target.judged = true; target.hit = true;
            score += j.score; combo += 1; judgedCount += 1;
            // Update UI counters
            if (j.label === 'Perfect') pPerf.textContent = (+pPerf.textContent + 1);
            else if (j.label === 'Good') pGood.textContent = (+pGood.textContent + 1);
            else pOk.textContent = (+pOk.textContent + 1);
            scoreEl.textContent = score;
            comboEl.textContent = combo;
            // Float text at lane hit position with ms feedback
            const x = laneToX(lane);
            const msText = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
            addFloatText(x, hitY - 10, `${j.label} (${msText}ms)`, j.color);
        }
    } else {
        // Optional: ghost tap; no penalty. You could add a tiny visual if you like.
    }
}

/* ========== Autoplay (for testing) ========== */
function autoPlayStep(t) {
    if (prerolling) return; // disable autoplay during preroll
    if (!autoplayChk.checked) return;

    for (const n of notes) {
        if (n.judged) continue;
        const dt = t - n.time;

        // Only attempt to hit notes that are close enough
        if (dt < -100 || dt > 100) continue;

        // Define probability ranges for different outcomes
        const rand = Math.random();

        // 15% chance to miss
        if (rand < 0.15) continue;

        // Will hit - determine accuracy
        let offset;
        const accuracy = Math.random();

        if (accuracy < 0.15) {  // 15% perfect
            offset = (Math.random() * 2 - 1) * (PERFECT_WIN * 0.8);
        } else if (accuracy < 0.65) {  // 50% good
            const direction = Math.random() > 0.5 ? 1 : -1;
            // Target middle of good window
            offset = direction * (PERFECT_WIN + (Math.random() * (GOOD_WIN - PERFECT_WIN)));
        } else {  // 35% okay
            const direction = Math.random() > 0.5 ? 1 : -1;
            // Target middle of okay window
            offset = direction * (GOOD_WIN + (Math.random() * (OK_WIN - GOOD_WIN)));
        }

        // Immediately try to hit rather than using setTimeout
        const hitTime = n.time + offset;
        if (Math.abs(t - hitTime) < 5) {
            tryHitLane(n.lane);
        }
    }
}

/* ========== Drawing ========== */
function laneToX(lane) {
    const w = canvas.clientWidth / LANES;
    return (lane + 0.5) * w;
}
function draw() {
    recalcLayout();
    // Clear
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // Background subtle grid
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.globalAlpha = 0.25;
    for (let i = 0; i <= LANES; i++) {
        const x = i * (w / LANES);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.strokeStyle = '#1a2345';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Hit line
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(w, hitY);
    ctx.strokeStyle = '#3c4c93';
    ctx.lineWidth = 4;
    ctx.stroke();

    // compute playback time; during preroll we show countdown and hide notes
    let t = currentTimeMs();
    if (prerolling) {
        const remaining = prerollEnd - nowMs();
        // during preroll, set t to negative time until preroll ends so notes will move
        t = Math.min(0, nowMs() - prerollEnd);
        // show countdown
        timeEl.textContent = (Math.max(0, remaining) / 1000).toFixed(3) + 's';
        ctx.save();
        // Draw background overlay
        ctx.fillStyle = 'rgba(15, 18, 32, 0.85)';
        ctx.fillRect(0, 0, w, h);

        // Draw countdown number
        const countdown = Math.ceil(Math.max(0, remaining) / 1000);
        ctx.font = '700 120px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw glow
        ctx.shadowColor = 'rgba(122, 167, 255, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = 'white';
        ctx.fillText(countdown.toString(), w / 2, h / 2);

        // Draw "Get Ready!" text
        ctx.shadowBlur = 0;
        ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('Ready!', w / 2, h / 2 + 80);
        ctx.restore();
        if (remaining <= 0) {
            // preroll finished: start playback clock so t aligns with notes
            prerolling = false;
            // set startTime such that nowMs() - startTime == 0
            startTime = nowMs();
            playing = true;
            t = 0;
        }
    } else {
        // When not prerolling, display current time
        const displayTime = playing ? t : pausedAt;
        timeEl.textContent = (displayTime / 1000).toFixed(3) + 's';
    }

    // Late-miss pass
    for (const n of notes) {
        if (!n.judged && t - n.time > LATE_MISS) {
            n.judged = true; n.hit = false; judgedCount += 1;
            combo = 0; comboEl.textContent = combo;
            pMiss.textContent = (+pMiss.textContent + 1);
            const x = laneToX(n.lane);
            addFloatText(x, hitY + 14, 'Miss', '#c00707ff');
        }
    }

    // Autoplay (optional)
    autoPlayStep(t);

    // Draw notes
    const travel = hitY - topMargin;
    const laneWidth = canvas.clientWidth / LANES;
    // Make circles smaller but proportional; cap to not exceed 14px for compact look
    const radius = Math.max(5, Math.min(Math.floor((laneWidth * 0.6) / 2), 14));

    // Draw per-lane hit targets (thin ring at hit line)
    for (let l = 0; l < LANES; l++) {
        const x = laneToX(l);
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.arc(x, hitY, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
    }

    for (const n of notes) {
        if (n.judged && (t - n.time) > 600) continue; // hide well after
        const timeToHit = n.time - t;

        // If the note's spawn time is still in the future (needs DROP_MS to fall), skip it
        if (timeToHit > DROP_MS) continue;

        const progress = 1 - (timeToHit / DROP_MS);
        const y = topMargin + Math.max(0, Math.min(1, progress)) * travel;
        // cache last y for hit text placement (optional)
        n._y = y;

        // cull if far outside
        if (y < topMargin - 50 || y > canvas.clientHeight + 50) continue;

        // Circle
        ctx.beginPath();
        ctx.arc(laneToX(n.lane), y, radius, 0, Math.PI * 2);
        ctx.fillStyle = laneColor(n.lane);
        ctx.globalAlpha = n.judged ? 0.25 : 0.95;
        ctx.fill();

        // Outline on approach
        if (!n.judged) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Floating judgement texts
    for (const f of floatTexts) {
        const life = Math.max(0, f.ttl) / 750;
        ctx.globalAlpha = life;
        ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y - (1 - life) * 30);
        ctx.globalAlpha = 1;
        f.ttl -= 16;
    }
    floatTexts = floatTexts.filter(f => f.ttl > 0);

    // Flash a 'perfect' indicator when notes are approaching perfect window
    for (const n of notes) {
        if (n.judged) continue;
        const dt = t - n.time; // ms
        if (Math.abs(dt) <= PERFECT_WIN * 2) {
            const x = laneToX(n.lane);
            const alpha = 1 - Math.abs(dt) / (PERFECT_WIN * 2);
            ctx.save();
            ctx.globalAlpha = 0.6 * alpha;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(6, 245, 78, 0.9)';
            ctx.lineWidth = 3;
            ctx.arc(x, hitY, radius + 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Check for completion: all notes judged
    const allJudged = notes.length > 0 && notes.every(n => n.judged);
    if (allJudged && playing) {
        // Update high score tracking
        updateHighScore();

        // finished this replay
        if (loopChk && loopChk.checked) {
            loopCount++;
            // restart with preroll so the user has time to get ready
            seekToStart();
            startPreRoll(true);
            // prevent immediate re-loop within same frame
        } else {
            // stop playback and keep final time (use last note time + small margin)
            pauseGame();
            const last = Math.max(...notes.map(n => n.time));
            pausedAt = last + 50; // small margin so final floats show
            // Show results overlay
            showResults();
        }
    }

    requestAnimationFrame(draw);
}


requestAnimationFrame(draw);

/* ========== Random data generation ========== */
function generateRandomData() {
    const frames = [];
    const start = 500;
    const duration = 30000; // 30 seconds
    const minGap = 200;    // minimum 200ms between notes
    const maxGap = 800;    // maximum 800ms between notes

    let currentTime = start;
    while (currentTime < duration) {
        // Random number of simultaneous notes (1-3)
        const numNotes = Math.floor(Math.random() * 3) + 1;
        const usedLanes = new Set();
        const lanes = [];

        // Generate unique random lanes
        while (lanes.length < numNotes) {
            const lane = Math.floor(Math.random() * LANES);
            if (!usedLanes.has(lane)) {
                lanes.push(lane);
                usedLanes.add(lane);
            }
        }

        frames.push([currentTime, makeBitStringFromLanes(lanes)]);

        // Random gap to next note
        currentTime += minGap + Math.random() * (maxGap - minGap);
    }

    return {
        meta: {
            start_time: new Date().toISOString(),
            game: "Random Pattern",
            character: "Auto-Generated"
        },
        frames
    };
}

/* ========== Init with empty data ========== */
(function init() {
    inputData.value = '';
    originalNotes = [];
    notes = [];
    setMetaLine({});
    dropMsLbl.textContent = DROP_MS;
    preRollLbl.textContent = (PRE_ROLL_MS / 1000).toString();
})();
