// BEER: tip the phone like a pint and the beer pours into a cartoon mouth.
//
// The device's tilt away from upright (DeviceOrientation beta, either
// direction) rotates a side-view glass about its rim lip. The beer surface
// stays level; whatever no longer fits below the lip pours into the mouth.
'use strict';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const messageEl = document.getElementById('message');
const countEl = document.getElementById('count');
const simEl = document.getElementById('sim');
const simTilt = document.getElementById('sim-tilt');
const startEl = document.getElementById('start');

const MAX_TILT = 150;          // degrees of on-screen rotation
const FULL = 0.82;             // share of the glass filled at the start
const DRINK_RATE = 0.3;        // share of the glass swallowed per second, max
const REFILL_RATE = 0.5;       // share of the glass refilled per second
const UPRIGHT = 15;            // degrees: below this counts as upright

const params = new URLSearchParams(location.search);
let targetTilt = 0;
let tilt = 0;
let beer = FULL;               // share of glass area
let pourFlow = 0;              // smoothed share-per-second leaving the glass
let state = 'full';            // full | drinking | empty | refilling
let uprightFor = 0;
let beersDrunk = loadCount();
let bubbles = [];
let audio = null;
let lastGlug = 0;
let W = 0, H = 0;

// ---------- geometry ----------

function layout() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function sceneGeometry() {
  // Sized so the base stays on screen through the whole swing.
  const w = Math.min(W * 0.26, H * 0.16);
  const h = w * 1.7;
  const pivot = { x: W * 0.44, y: H * 0.42 };
  const mouth = { x: pivot.x - w * 0.32, y: pivot.y + w * 0.12 };
  // Pint glass in local coordinates; (0, 0) is the rim lip nearest the mouth.
  const local = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w * 0.92, y: h },
    { x: w * 0.08, y: h },
  ];
  return { w, h, pivot, mouth, local };
}

// Rotate a local point about the pivot so the base swings up and away.
function toWorld(p, pivot, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: pivot.x + p.x * c + p.y * s, y: pivot.y - p.x * s + p.y * c };
}

function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

// Part of the polygon at or below screen height `level` (larger y is lower).
function clipBelow(poly, level) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const pIn = p.y >= level, qIn = q.y >= level;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = (level - p.y) / (q.y - p.y);
      out.push({ x: p.x + (q.x - p.x) * t, y: level });
    }
  }
  return out;
}

// Height of a level surface that leaves `area` of the glass below it.
function surfaceFor(glass, area) {
  let top = Math.min(...glass.map(p => p.y));
  let bottom = Math.max(...glass.map(p => p.y));
  for (let i = 0; i < 32; i++) {
    const mid = (top + bottom) / 2;
    if (polygonArea(clipBelow(glass, mid)) > area) top = mid; else bottom = mid;
  }
  return (top + bottom) / 2;
}

// ---------- simulation ----------

function update(dt) {
  tilt += (targetTilt - tilt) * Math.min(1, dt * 8);
  const g = sceneGeometry();
  const a = tilt * Math.PI / 180;
  const glass = g.local.map(p => toWorld(p, g.pivot, a));
  const total = polygonArea(glass);
  // The lip at the pivot is the lowest rim point for any forward tip.
  const fits = polygonArea(clipBelow(glass, g.pivot.y)) / total;

  let flow = 0;
  if (state === 'refilling') {
    beer = Math.min(FULL, beer + REFILL_RATE * dt);
    if (beer >= FULL) state = 'full';
  } else if (beer > 0) {
    flow = Math.max(0, Math.min(beer - fits, DRINK_RATE * dt)) / dt;
    beer = Math.max(0, beer - flow * dt);
    state = flow > 0 ? 'drinking' : 'full';
    if (beer < 0.005) {
      beer = 0;
      state = 'empty';
      beersDrunk += 1;
      saveCount();
      burp();
    }
  }
  pourFlow += (flow - pourFlow) * Math.min(1, dt * 10);
  if (flow > 0) glug();

  if (state === 'empty') {
    uprightFor = tilt < UPRIGHT ? uprightFor + dt : 0;
    if (uprightFor > 1) {
      state = 'refilling';
      uprightFor = 0;
    }
  }

  updateBubbles(dt, glass);
  return { g, glass, total };
}

function updateBubbles(dt, glass) {
  if (beer > 0.02 && bubbles.length < 40 && Math.random() < dt * 30) {
    const xs = glass.map(p => p.x);
    const ys = glass.map(p => p.y);
    bubbles.push({
      x: Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs)),
      y: Math.max(...ys),
      r: 1 + Math.random() * 2.5,
      v: 30 + Math.random() * 50,
    });
  }
  const top = Math.min(...glass.map(p => p.y));
  bubbles = bubbles.filter(b => (b.y -= b.v * dt) > top);
}

// ---------- drawing ----------

function draw({ g, glass, total }) {
  ctx.fillStyle = '#1b120a';
  ctx.fillRect(0, 0, W, H);

  drawHead(g);

  if (beer > 0) {
    const level = surfaceFor(glass, beer * total);
    const foam = Math.max(4, g.h * 0.06 * Math.min(1, beer / 0.3));
    fillPoly(clipBelow(glass, level - foam), '#fff4d6');
    const liquid = clipBelow(glass, level);
    const grad = ctx.createLinearGradient(0, level, 0, level + g.h);
    grad.addColorStop(0, '#f6b915');
    grad.addColorStop(1, '#c9780a');
    fillPoly(liquid, grad);

    ctx.save();
    pathPoly(liquid);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 245, 210, 0.55)';
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (pourFlow > 0.01) drawStream(g);

  pathPoly(glass);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.stroke();

  drawHud();
}

function drawHead(g) {
  const r = g.w * 1.1;
  const cx = g.mouth.x - r * 0.75;
  const cy = g.mouth.y - r * 0.35;
  ctx.fillStyle = '#e8b48a';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // nose
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.9, cy - r * 0.45);
  ctx.lineTo(cx + r * 1.12, cy - r * 0.15);
  ctx.lineTo(cx + r * 0.95, cy - r * 0.08);
  ctx.fill();

  // eye, squeezed shut while drinking
  ctx.strokeStyle = '#3a2414';
  ctx.fillStyle = '#3a2414';
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (pourFlow > 0.01) {
    ctx.arc(cx + r * 0.55, cy - r * 0.45, r * 0.1, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else {
    ctx.arc(cx + r * 0.55, cy - r * 0.45, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  // mouth opens with the flow
  const open = Math.min(1, pourFlow / DRINK_RATE);
  ctx.fillStyle = '#5a1a12';
  ctx.beginPath();
  ctx.ellipse(g.mouth.x, g.mouth.y, r * 0.16, r * (0.03 + 0.14 * open), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawStream(g) {
  const width = 3 + 10 * Math.min(1, pourFlow / DRINK_RATE);
  const t = performance.now() / 1000;
  ctx.strokeStyle = '#f2a900';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(g.pivot.x, g.pivot.y);
  ctx.quadraticCurveTo(
    g.pivot.x - g.w * 0.08 + Math.sin(t * 20) * 2,
    g.pivot.y + g.w * 0.02,
    g.mouth.x + g.w * 0.04,
    g.mouth.y,
  );
  ctx.stroke();
}

function pathPoly(poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function fillPoly(poly, style) {
  if (poly.length < 3) return;
  pathPoly(poly);
  ctx.fillStyle = style;
  ctx.fill();
}

function drawHud() {
  const text = {
    full: beer < FULL - 0.01 ? 'Keep tipping!' : 'Tip your phone to drink',
    drinking: 'Glug glug glug…',
    empty: 'Cheers! Hold upright for a refill',
    refilling: 'Pouring another…',
  }[state];
  if (messageEl.textContent !== text) messageEl.textContent = text;
  const count = beersDrunk === 1 ? '1 beer' : `${beersDrunk} beers`;
  if (countEl.textContent !== count) countEl.textContent = count;
}

// ---------- sound and haptics ----------

function initAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audio = new Ctx();
  audio.resume();
}

function glug() {
  const now = performance.now();
  if (now - lastGlug < 230) return;
  lastGlug = now;
  if (navigator.vibrate) navigator.vibrate(25);
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.setValueAtTime(170 + Math.random() * 40, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}

function burp() {
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const wobble = audio.createOscillator();
  const wobbleGain = audio.createGain();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.linearRampToValueAtTime(70, t + 0.6);
  wobble.frequency.value = 28;
  wobbleGain.gain.value = 18;
  wobble.connect(wobbleGain).connect(osc.frequency);
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  osc.connect(filter).connect(gain).connect(audio.destination);
  osc.start(t);
  wobble.start(t);
  osc.stop(t + 0.7);
  wobble.stop(t + 0.7);
}

// ---------- input ----------

function onOrientation(e) {
  if (e.beta == null) return;
  // Degrees away from upright portrait (beta 90), whichever way it tips.
  let d = e.beta - 90;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  targetTilt = Math.min(MAX_TILT, Math.abs(d));
  gotSensor = true;
}

let gotSensor = false;

function showSimulator() {
  simEl.hidden = false;
  simTilt.addEventListener('input', () => { targetTilt = Number(simTilt.value); });
}

async function start() {
  startEl.hidden = true;
  initAudio();
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      if (await DOE.requestPermission() !== 'granted') return showSimulator();
    } catch {
      return showSimulator();
    }
  }
  window.addEventListener('deviceorientation', onOrientation);
  // Desktop browsers have no tilt sensor; offer a slider instead.
  setTimeout(() => { if (!gotSensor) showSimulator(); }, 1000);
}

function loadCount() {
  try { return Number(localStorage.getItem('beer.count')) || 0; } catch { return 0; }
}

function saveCount() {
  try { localStorage.setItem('beer.count', String(beersDrunk)); } catch { /* ignore */ }
}

// ---------- boot ----------

document.getElementById('start-btn').addEventListener('click', start);
window.addEventListener('resize', layout);
layout();

// ?tilt=60 skips the start screen at a fixed angle; ?sim shows the slider.
if (params.has('tilt') || params.has('sim')) {
  startEl.hidden = true;
  targetTilt = tilt = Number(params.get('tilt')) || 0;
  simTilt.value = String(targetTilt);
  showSimulator();
}

let last = performance.now();
function frame(now) {
  // Clamp: a zero-length first frame would divide by zero in update().
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  draw(update(dt));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
