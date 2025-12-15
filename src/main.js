/* =========================
   CHOSHIM main.js (FULL)
   - stage 캐싱: lastStage
   - API mutate: /api/mutate
   - 부팅 시 lastClean 누락 자동 복구
   - ✅ 그만 닦기: 도감 저장 + 새 돌 시작
   - ✅ 동반자 멘트: 시간 단계별
   - ✅ 디버그: 0/6/12/18/24h 패널
   ========================= */

function normalizeInput(text) {
  return (text || "")
    .replace(/["'“”‘’]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- DOM ---------- */
let lastStage = null;
let lastTextForStage = "";

const baseCanvas = document.getElementById("baseCanvas");
const grimeCanvas = document.getElementById("grimeCanvas");
const engraveEl = document.getElementById("engrave");
const stoneWrap = document.getElementById("stoneWrap");

const cloth = document.getElementById("cloth");

const overlay = document.getElementById("overlay");
const inputText = document.getElementById("inputText");
const saveBtn = document.getElementById("saveBtn");
const examplesEl = document.getElementById("examples");

const hudLeft = document.getElementById("hudLeft");
const hudRight = document.getElementById("hudRight");
const companionEl = document.getElementById("companion");

const finishBtn = document.getElementById("finishBtn"); // ✅ 존재하면 사용
const debugPanel = document.getElementById("debugPanel"); // ✅ 존재하면 사용

const STONE_SCALE = 0.8;

/* ---------- Storage Keys ---------- */
const KEY_TEXT = "choshim_text_v2";
const KEY_LAST_CLEAN = "choshim_last_clean_v2";
const KEY_CREATED = "choshim_created_v2";
const KEY_STONE = "choshim_stone_variant_v1";
const KEY_MUTATED = "choshim_mutated_by_stage_v3_noquote";

/* ✅ 도감 */
const KEY_BOOK = "choshim_book_v1";

/* ---------- Const ---------- */
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

const EXAMPLES = [
  "매일 물 2리터 마시기",
  "7시간 이상 자기",
  "매일 꾸준히 운동하기",
  "작업을 미루지 않기",
  "남과 비교하지 않기",
  "다이어트 성공하기",
];

/* =========================
   ★ 자주 만지는 값
========================= */
const BRUSH_R = 22;
const CLEAN_AREA_RATIO = 0.72;
const CLEAN_MIN_MS = 5000;
const TICK_MS = 30 * 1000;

/* =========================
   Debug
========================= */
let debugOverrideHours = null;

/* =========================
   Runtime
========================= */
let dpr = Math.max(1, window.devicePixelRatio || 1);
let W = 0;
let H = 0;

let isDown = false;
let lastPoint = null;

let erasedAreaApprox = 0;
let scrubStartTs = 0;
let scrubAccumMs = 0;

/* ---------- Time helpers ---------- */
function now() {
  return Date.now();
}

function todayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysSince(a, b) {
  const da = todayStart(a);
  const db = todayStart(b);
  return Math.floor((db - da) / ONE_DAY) + 1;
}

/* ---------- Storage helpers ---------- */
function safeGet(key) {
  return localStorage.getItem(key);
}

function safeSet(key, val) {
  localStorage.setItem(key, String(val));
}

/* ---------- UI helpers ---------- */
function showOverlay(show) {
  overlay?.setAttribute("aria-hidden", show ? "false" : "true");
}

function setupExamples() {
  if (!examplesEl) return;
  examplesEl.innerHTML = "";
  EXAMPLES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "example-chip";
    b.textContent = t;
    b.addEventListener("click", () => {
      if (!inputText) return;
      inputText.value = t;
      inputText.focus();
    });
    examplesEl.appendChild(b);
  });
}

/* ---------- State ---------- */
function getState() {
  const text = safeGet(KEY_TEXT) || "";
  const lastClean = Number(safeGet(KEY_LAST_CLEAN) || 0);
  const created = Number(safeGet(KEY_CREATED) || 0);
  return { text, lastClean, created };
}

/* ⭐ 부팅/복구 */
function repairStateIfNeeded() {
  const s = getState();
  const hasText = !!(s.text && s.text.trim());
  if (!hasText) return;

  if (!s.created) safeSet(KEY_CREATED, now());

  if (!s.lastClean) {
    const created = Number(safeGet(KEY_CREATED) || 0);
    safeSet(KEY_LAST_CLEAN, created || now());
  }
}

function setNewText(text) {
  const t = text.trim();
  const ts = now();

  safeSet(KEY_TEXT, t);
  safeSet(KEY_LAST_CLEAN, ts);

  if (!safeGet(KEY_CREATED)) safeSet(KEY_CREATED, ts);
}

/* ✅ 새 돌 시작을 위해 현재 돌 상태 싹 지우기 */
function clearStoneState() {
  localStorage.removeItem(KEY_TEXT);
  localStorage.removeItem(KEY_LAST_CLEAN);
  localStorage.removeItem(KEY_CREATED);

  // ✅ 새 돌로 바꾸려면 variant도 지워서 랜덤 재생성
  localStorage.removeItem(KEY_STONE);

  lastStage = null;
  lastTextForStage = "";
}

/* ---------- Elapsed & Stage ---------- */
function elapsedSinceClean() {
  const { lastClean, text } = getState();
  if (!text || !text.trim()) return Infinity;

  if (debugOverrideHours !== null) return debugOverrideHours * ONE_HOUR;

  if (!lastClean) {
    repairStateIfNeeded();
    const fixed = Number(safeGet(KEY_LAST_CLEAN) || 0);
    if (!fixed) return Infinity;
    return now() - fixed;
  }

  return now() - lastClean;
}

function stageIndex(elapsed) {
  if (elapsed >= 24 * ONE_HOUR) return 4;
  if (elapsed >= 18 * ONE_HOUR) return 3;
  if (elapsed >= 12 * ONE_HOUR) return 2;
  if (elapsed >= 6 * ONE_HOUR) return 1;
  return 0;
}

/* =========================
   Pebble variants
========================= */
function getStoneVariant() {
  const stored = safeGet(KEY_STONE);
  if (stored !== null) return Number(stored);

  const v = Math.floor(Math.random() * 3);
  safeSet(KEY_STONE, v);
  return v;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function drawPebblePath(ctx, cx, cy, baseR, variant, seed) {
  const rand = mulberry32(seed);
  const wobble = 0.07;

  const isTall = H > W * 1.05;
  const squashX = isTall ? 0.92 : 1.28;
  const squashY = isTall ? 1.18 : 0.84;
  const rot = isTall ? 0.06 : 0.0;

  const pts = [];
  const steps = 128;

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const n1 = Math.sin(a * 2 + rand() * 0.25) * wobble;
    const n2 = Math.sin(a * 5 + rand() * 0.25) * (wobble * 0.18);
    const rr = baseR * (1 + n1 + n2);

    pts.push({
      x: Math.cos(a) * rr * squashX,
      y: Math.sin(a) * rr * squashY,
    });
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;

    if (i === 0) ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
  }
  ctx.closePath();

  ctx.restore();
}

function isMobile() {
  return window.matchMedia("(max-width: 640px)").matches;
}

/* =========================
   Canvas sizing
========================= */
function ctxOf(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function resizeAll() {
  dpr = Math.max(1, window.devicePixelRatio || 1);

  const rect = stoneWrap.getBoundingClientRect();
  W = Math.floor(rect.width);
  H = Math.floor(rect.height);

  [baseCanvas, grimeCanvas].forEach((c) => {
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = W + "px";
    c.style.height = H + "px";
  });

  drawBase();
  drawGrime(true);
}

/* =========================
   Stone base draw
========================= */
function drawBase() {
  const ctx = ctxOf(baseCanvas);
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;

  const scale = isMobile() ? 1.08 : STONE_SCALE;
  const fill = isMobile() ? 0.48 : 0.40;
  const baseR = Math.min(W, H) * fill * scale;

  const variant = getStoneVariant();
  const seed = 12345 + variant * 999;

  drawPebblePath(ctx, cx, cy, baseR, variant, seed);

  const g = ctx.createRadialGradient(
    cx - baseR * 0.25,
    cy - baseR * 0.25,
    baseR * 0.18,
    cx,
    cy,
    baseR * 1.2
  );
  g.addColorStop(0, "rgba(252,252,252,0.98)");
  g.addColorStop(0.6, "rgba(230,230,230,0.98)");
  g.addColorStop(1, "rgba(198,198,198,0.98)");

  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.clip();

  const rand = mulberry32(7777 + variant * 111);
  const n = 760;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const rr = (rand() ** 0.65) * baseR * 0.98;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const r = rand() * 1.7 + 0.2;
    const o = rand() * 0.06;
    ctx.fillStyle = `rgba(0,0,0,${o})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "screen";
  ctx.beginPath();
  ctx.ellipse(
    cx - baseR * 0.22,
    cy - baseR * 0.30,
    baseR * 0.48,
    baseR * 0.26,
    -0.2,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

/* =========================
   Cracks
========================= */
function drawCracksNatural(ctx, cx, cy, baseR, seed, strength) {
  const rand = mulberry32(seed);
  const crackCount = Math.floor(5 + strength * 10);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < crackCount; i++) {
    let x = cx + (rand() - 0.5) * baseR * 1.2;
    let y = cy + (rand() - 0.5) * baseR * 1.0;
    let ang = rand() * Math.PI * 2;

    const baseAlpha = 0.05 + rand() * (0.05 + strength * 0.08);
    let w = 0.6 + rand() * (0.7 + strength * 0.5);
    const segs = 7 + Math.floor(rand() * (6 + strength * 4));

    for (let s = 0; s < segs; s++) {
      ang += (rand() - 0.5) * 0.85;
      const len = baseR * (0.06 + rand() * (0.07 + strength * 0.05));

      const nx = x + Math.cos(ang) * len + (rand() - 0.5) * 3.2;
      const ny = y + Math.sin(ang) * len + (rand() - 0.5) * 3.2;

      ctx.strokeStyle = `rgba(0,0,0,${baseAlpha})`;
      ctx.lineWidth = w;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      if (rand() < 0.18) w = Math.min(w + 0.35, 2.2);
      else w = Math.max(w - 0.18, 0.55);

      if (rand() < 0.14) {
        const bAng = ang + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.6);
        const bx = nx + Math.cos(bAng) * baseR * (0.05 + rand() * 0.06);
        const by = ny + Math.sin(bAng) * baseR * (0.05 + rand() * 0.06);

        ctx.strokeStyle = `rgba(0,0,0,${baseAlpha * 0.7})`;
        ctx.lineWidth = w * 0.7;

        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      x = nx;
      y = ny;
    }
  }
}

/* =========================
   Grime main draw
========================= */
function drawGrime(resetErasedArea) {
  const ctx = ctxOf(grimeCanvas);
  ctx.clearRect(0, 0, W, H);

  const idx = stageIndex(elapsedSinceClean());

  const cx = W / 2;
  const cy = H / 2;

  const scale = isMobile() ? 0.95 : STONE_SCALE;
  const baseR = Math.min(W, H) * 0.40 * scale;

  const variant = getStoneVariant();
  const seed = 12345 + variant * 999;

  if (idx >= 4) {
    if (engraveEl) engraveEl.textContent = "";

    ctx.save();
    drawPebblePath(ctx, cx, cy, baseR, variant, seed);
    ctx.clip();

    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(0, 0, W, H);

    {
      const rand = mulberry32(9000 + 4 * 100 + variant * 17);
      for (let i = 0; i < 1100; i++) {
        const x = cx + (rand() - 0.5) * baseR * 1.85;
        const y = cy + (rand() - 0.5) * baseR * 1.55;
        const r = 0.4 + rand() * 1.2;
        const o = 0.05 + rand() * 0.14;
        ctx.fillStyle = `rgba(0,0,0,${o})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawCracksNatural(ctx, cx, cy, baseR, 54000 + variant * 31, 1.0);

    ctx.restore();
    ctx.globalCompositeOperation = "source-over";

    if (resetErasedArea) erasedAreaApprox = 0;
    return;
  }

  ctx.save();
  drawPebblePath(ctx, cx, cy, baseR, variant, seed);
  ctx.clip();

  const grimeAlpha = [0.0, 0.10, 0.18, 0.24][idx] ?? 0.0;
  const scratchCount = [0, 26, 54, 76][idx] ?? 0;
  const speckCount = [0, 260, 520, 760][idx] ?? 0;
  const smudgeCount = [0, 10, 16, 22][idx] ?? 0;

  ctx.fillStyle = `rgba(0,0,0,${grimeAlpha})`;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < scratchCount; i++) {
    const x1 = cx + (Math.random() - 0.5) * baseR * 1.8;
    const y1 = cy + (Math.random() - 0.5) * baseR * 1.5;
    const x2 = x1 + (Math.random() - 0.5) * 56;
    const y2 = y1 + (Math.random() - 0.5) * 34;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  {
    const rand = mulberry32(9000 + idx * 100 + variant * 17);
    for (let i = 0; i < speckCount; i++) {
      const x = cx + (rand() - 0.5) * baseR * 1.85;
      const y = cy + (rand() - 0.5) * baseR * 1.55;
      const r = 0.4 + rand() * 1.2;
      const o = 0.05 + rand() * 0.12;
      ctx.fillStyle = `rgba(0,0,0,${o})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  {
    const rand = mulberry32(12000 + idx * 200 + variant * 31);
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (let i = 0; i < smudgeCount; i++) {
      const x = cx + (rand() - 0.5) * baseR * 1.6;
      const y = cy + (rand() - 0.5) * baseR * 1.3;
      const len = 18 + rand() * 42;
      const ang = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * (len * 0.35));
      ctx.stroke();
    }
  }

  if (idx === 3) {
    drawCracksNatural(ctx, cx, cy, baseR, 30000 + variant * 97, 0.55);
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  if (resetErasedArea) erasedAreaApprox = 0;
}

/* =========================
   Cloth follow
========================= */
function pointerPos(e) {
  const rect = grimeCanvas.getBoundingClientRect();
  const src = ("touches" in e && e.touches[0]) ? e.touches[0] : e;
  return {
    x: src.clientX - rect.left,
    y: src.clientY - rect.top,
    cx: src.clientX,
    cy: src.clientY,
  };
}

function hideCloth() {
  if (!cloth) return;
  cloth.style.left = "-9999px";
  cloth.style.top = "-9999px";
  cloth.style.opacity = "0";
}

function setClothAt(clientX, clientY, show) {
  if (!cloth) return;
  if (!show) return hideCloth();

  const size = 54;
  cloth.style.left = (clientX - size / 2) + "px";
  cloth.style.top = (clientY - size / 2) + "px";
  cloth.style.opacity = "1";
}

/* =========================
   API mutate (fetch)
========================= */
async function requestMutate(text, stage) {
  const res = await fetch("/api/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, stage })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "mutate failed");
  return (data.result || "").toString();
}

/* =========================
   Mutation cache
========================= */
async function getMutatedCached(text, stage) {
  if (!text || !text.trim()) return "";
  if (stage === 0) return text;

  const key = `${KEY_MUTATED}:${stage}:${text}`;
  const cached = safeGet(key);
  if (cached) return cached;

  const mutated = await requestMutate(text, stage);
  const out = mutated.trim() || text;

  safeSet(key, out);
  return out;
}

function applyTextToUI(nextText) {
  if (!engraveEl) return;

  const cleaned = (nextText || "")
    .replace(/["'“”‘’]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const style = getComputedStyle(engraveEl);
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  const fs = parseFloat(style.fontSize) || 16;
  let lsPx = 0;
  if (style.letterSpacing && style.letterSpacing !== "normal") {
    if (style.letterSpacing.endsWith("px")) lsPx = parseFloat(style.letterSpacing);
    else if (style.letterSpacing.endsWith("em")) lsPx = parseFloat(style.letterSpacing) * fs;
  }

  const maxWidth = engraveEl.clientWidth * 0.92;
  const wrapped = wrapTextKoreanSmart(cleaned, maxWidth, font, lsPx);
  engraveEl.textContent = wrapped;
}

/* =========================
   Engrave update (stage cache)
========================= */
async function updateEngraveByStage() {
  if (!engraveEl) return;

  const { text } = getState();
  const t = (text || "").trim();

  if (!t) {
    engraveEl.textContent = "";
    lastStage = null;
    lastTextForStage = "";
    return;
  }

  const idx = stageIndex(elapsedSinceClean());

  if (t !== lastTextForStage) {
    lastTextForStage = t;
    lastStage = null;
  }

  if (idx === lastStage) return;
  lastStage = idx;

  if (idx >= 4) {
    engraveEl.textContent = "";
    return;
  }

  try {
    const mutated = await getMutatedCached(t, idx);
    const latestIdx = stageIndex(elapsedSinceClean());
    if (latestIdx !== idx) return;
    applyTextToUI(mutated);
  } catch (e) {
    console.error(e);
    engraveEl.textContent = t;
  }
}

/* =========================
   Cleaning logic
========================= */
function addErasedApprox(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  erasedAreaApprox += dist * (BRUSH_R * 2);
}

function pebbleAreaApprox() {
  const r = Math.min(W, H) * 0.40 * STONE_SCALE;
  return Math.PI * r * r;
}

/* ✅ 도감 snapshot */
function exportStoneSnapshot() {
  const out = document.createElement("canvas");
  out.width = Math.floor(W * dpr);
  out.height = Math.floor(H * dpr);

  const ctx = out.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.drawImage(baseCanvas, 0, 0, W, H);
  ctx.drawImage(grimeCanvas, 0, 0, W, H);

  if (engraveEl && engraveEl.textContent.trim()) {
    const style = getComputedStyle(engraveEl);
    const lines = engraveEl.textContent.split("\n");

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.shadowColor = "rgba(95,95,95,0.5)";
    ctx.shadowBlur = 1;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = -1;

    const fontSize = parseFloat(style.fontSize) || 32;
    const fontFamily = style.fontFamily || "sans-serif";
    const fontWeight = style.fontWeight || "700";
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const lineHeight = fontSize * 1.65;
    const totalH = lineHeight * lines.length;
    const cx = W / 2;
    const cy = H / 2;

    for (let i = 0; i < lines.length; i++) {
      const y = cy - totalH / 2 + lineHeight * (i + 0.5);
      ctx.fillText(lines[i], cx, y);
    }

    ctx.restore();
  }

  return out.toDataURL("image/png");
}

function getBook() {
  try { return JSON.parse(localStorage.getItem(KEY_BOOK) || "[]"); }
  catch { return []; }
}
function setBook(list) {
  localStorage.setItem(KEY_BOOK, JSON.stringify(list));
}

/* ✅ 새 돌로 리셋하고 입력창으로 */
function acceptCleanToResetFlow() {
  clearStoneState();
  showOverlay(true);

  if (inputText) inputText.value = "";
  if (engraveEl) engraveEl.textContent = "";

  debugOverrideHours = null;

  isDown = false;
  lastPoint = null;
  erasedAreaApprox = 0;
  scrubStartTs = 0;
  scrubAccumMs = 0;

  setClothAt(0, 0, false);

  // ✅ 새 돌 variant 다시 생성
  getStoneVariant();

  drawBase();
  drawGrime(true);
  updateHud();
  updateCompanion(true);
  lastStage = null;
  updateEngraveByStage();
  updateFinishBtn();
}

/* ✅ “그만 닦기” 누르면 저장하고 새 돌 */
function finishCurrentStone() {
  const { text, created } = getState();
  if (!text || !text.trim()) return;

  const finished = now();
  const d = daysSince(created || finished, finished);

  const entry = {
    id: "stone_" + finished,
    text,
    created: created || finished,
    finished,
    d,
    snapshot: exportStoneSnapshot(),
  };

  const book = getBook();
  book.unshift(entry);
  setBook(book);

  acceptCleanToResetFlow();
}

function maybeAcceptClean() {
  if (scrubAccumMs < CLEAN_MIN_MS) return false;

  const idx = stageIndex(elapsedSinceClean());

  // ✅ 24h 이후면 닦는 행위로도 새 돌로 넘어가게 유지
  if (idx >= 4) {
    acceptCleanToResetFlow();
    return true;
  }

  const need = pebbleAreaApprox() * CLEAN_AREA_RATIO;
  if (erasedAreaApprox < need) return false;

  const { text } = getState();
  if (!text || !text.trim()) return false;

  safeSet(KEY_LAST_CLEAN, now());
  debugOverrideHours = null;

  lastStage = null;

  isDown = false;
  lastPoint = null;
  setClothAt(0, 0, false);

  scrubStartTs = 0;
  scrubAccumMs = 0;

  drawGrime(true);
  updateHud();
  updateCompanion(false);
  updateEngraveByStage();
  return true;
}

/* =========================
   Pointer events
========================= */
function handleDown(e) {
  e.preventDefault();
  isDown = true;

  scrubStartTs = performance.now();
  scrubAccumMs = 0;

  const p = pointerPos(e);
  lastPoint = p;

  setClothAt(p.cx, p.cy, true);

  const ctx = ctxOf(grimeCanvas);
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,1)";
  ctx.lineWidth = BRUSH_R * 2;

  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function handleMove(e) {
  if (!isDown) return;
  e.preventDefault();

  scrubAccumMs = performance.now() - scrubStartTs;

  const p = pointerPos(e);
  setClothAt(p.cx, p.cy, true);

  const ctx = ctxOf(grimeCanvas);
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,1)";
  ctx.lineWidth = BRUSH_R * 2;

  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  if (lastPoint) addErasedApprox(lastPoint, p);
  lastPoint = p;

  if (maybeAcceptClean()) return;
}

function handleUp(e) {
  if (!isDown) return;
  e.preventDefault();

  isDown = false;
  lastPoint = null;

  setClothAt(0, 0, false);

  scrubStartTs = 0;
  scrubAccumMs = 0;
}

/* =========================
   HUD & Companion
========================= */
function updateHud() {
  const { created, text } = getState();
  const hasText = !!(text && text.trim());

  if (!hasText) {
    if (hudLeft) hudLeft.textContent = "";
    if (hudRight) hudRight.textContent = "";
    return;
  }

  const d = daysSince(created || now(), now());
  if (hudLeft) hudLeft.textContent = `D+${d}`;

  const elapsed = elapsedSinceClean();
  const hrs = Math.floor(elapsed / ONE_HOUR);

  if (hudRight) {
    if (debugOverrideHours !== null) hudRight.textContent = `${Math.floor(debugOverrideHours)}h*`;
    else hudRight.textContent = `${hrs}h`;
  }
}

/* ✅ 시간 단계별 멘트로 업그레이드 */
const COMPANION_BY_STAGE = [
  "안정적",
  "마모 중",
  "이탈 중",
  "마지막 복구 기회",
  "종료",
];


function updateCompanion(force) {
  if (!companionEl) return;

  const { text } = getState();
  if (!text || !text.trim()) {
    companionEl.textContent = "";
    return;
  }

  const idx = stageIndex(elapsedSinceClean());
  companionEl.textContent = COMPANION_BY_STAGE[idx] || "";
}

/* ✅ 그만 닦기 버튼 보이기/숨기기 */
function updateFinishBtn() {
  if (!finishBtn) return;
  const { text } = getState();
  finishBtn.style.display = (text && text.trim()) ? "inline-flex" : "none";
}
/* =========================
   Debug keys (KEYBOARD)
   ========================= */
function setupDebugKeys() {
  window.addEventListener("keydown", (e) => {

    /* ----- 시간 단계 강제 ----- */
    // 0h
    if (e.code === "Digit0") debugOverrideHours = 0;
    // 6h
    if (e.code === "Digit1") debugOverrideHours = 6;
    // 12h
    if (e.code === "Digit2") debugOverrideHours = 12;
    // 18h
    if (e.code === "Digit3") debugOverrideHours = 18;
    // 24h (완전 방치)
    if (e.code === "Digit4") debugOverrideHours = 24;

    // 디버그 해제 (실시간으로 돌아감)
    if (e.code === "Digit9") debugOverrideHours = null;

    /* ----- 화면 갱신 ----- */
    const isTimeKey = [
      "Digit0",
      "Digit1",
      "Digit2",
      "Digit3",
      "Digit4",
      "Digit9",
    ].includes(e.code);

    if (isTimeKey) {
      // 오염 다시 그림
      drawGrime(true);

      // HUD / 멘트 / 각인 전부 갱신
      updateHud();
      updateCompanion(true);

      lastStage = null;
      updateEngraveByStage();
    }
  });
}

/* =========================
   Debug panel (5탭 열기)
========================= */
function setupDebugPanel() {
  if (!hudRight || !debugPanel) return;

  let tapCount = 0;
  let tapTimer = null;

  hudRight.addEventListener("click", () => {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => (tapCount = 0), 600);

    if (tapCount >= 5) {
      tapCount = 0;
      const hidden = debugPanel.getAttribute("aria-hidden") === "true";
      debugPanel.setAttribute("aria-hidden", hidden ? "false" : "true");
    }
  });

  debugPanel.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const v = btn.dataset.h;
    debugOverrideHours = (v === "null") ? null : Number(v);

    drawGrime(true);
    updateHud();
    updateCompanion(true);
    lastStage = null;
    updateEngraveByStage();
  });
}

/* =========================
   Boot
========================= */
function boot() {
  setupExamples();
  setupDebugPanel();

  hideCloth();

  repairStateIfNeeded();

  const s = getState();
  if (!s.text || !s.text.trim()) showOverlay(true);
  else showOverlay(false);

  resizeAll();
  updateHud();
  updateCompanion(true);
  updateEngraveByStage();
  updateFinishBtn();

  // ✅ 버튼 바인딩
  if (finishBtn) {
    finishBtn.addEventListener("click", finishCurrentStone);
  }

  setInterval(() => {
    const { text } = getState();
    if (!text || !text.trim()) return;

    drawGrime(false);
    updateHud();
    updateEngraveByStage();
    updateCompanion(false);
  }, TICK_MS);

  saveBtn?.addEventListener("click", () => {
    const raw = inputText?.value || "";
    const t = normalizeInput(raw);
    if (!t) return;

    setNewText(t);

    lastStage = null;
    lastTextForStage = "";

    debugOverrideHours = null;
    showOverlay(false);

    // ✅ 새 초심이면 새 돌 느낌 주려고 variant 재랜덤
    localStorage.removeItem(KEY_STONE);
    getStoneVariant();

    drawBase();
    drawGrime(true);
    updateHud();
    updateCompanion(true);
    updateEngraveByStage();
    updateFinishBtn();
  });

  grimeCanvas.addEventListener("mousedown", handleDown);
  window.addEventListener("mousemove", handleMove);
  window.addEventListener("mouseup", handleUp);

  grimeCanvas.addEventListener("touchstart", handleDown, { passive: false });
  window.addEventListener("touchmove", handleMove, { passive: false });
  window.addEventListener("touchend", handleUp, { passive: false });

  window.addEventListener("resize", resizeAll);
  setupDebugKeys();

}

document.addEventListener("DOMContentLoaded", boot);

/* =========================
   Text wrap helper
========================= */
function wrapTextKoreanSmart(text, maxWidthPx, font, letterSpacingPx = 0) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;

  const t = (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";

  const measure = (s) => {
    const glyphs = Array.from(s);
    const extra = Math.max(0, glyphs.length - 1) * letterSpacingPx;
    return ctx.measureText(s).width + extra;
  };

  if (t.includes(" ")) {
    const words = t.split(" ");
    const lines = [];
    let line = "";

    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (measure(test) <= maxWidthPx) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.join("\n");
  }

  const chars = Array.from(t);
  const lines = [];
  let line = "";

  for (const ch of chars) {
    const test = line + ch;
    if (measure(test) <= maxWidthPx) line = test;
    else {
      if (line) lines.push(line);
      line = ch;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
