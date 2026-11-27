// BEER: the whole screen is a glass of beer (or wine, butterbeer, root beer
// or coffee). Tip the phone and the beer
// stays level with the ground, sloshes, and drains out over the top edge
// into your mouth.
//
// Everything is drawn in "portrait" coordinates (the phone held upright),
// so the beer stays put even if the browser rotates the page. Gravity comes
// from DeviceOrientation and is projected onto the screen. The liquid is
// drawn in a frame rotated so that gravity points straight down.
'use strict';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const messageEl = document.getElementById('message');
const countEl = document.getElementById('count');
const simEl = document.getElementById('sim');
const simTilt = document.getElementById('sim-tilt');
const startEl = document.getElementById('start');

const RAD = Math.PI / 180;
const FULL = 0.76;          // share of the screen filled; foam sits on top
const DRINK_RATE = 0.24;    // share of the screen swallowed per second, max
const REFILL_RATE = 0.32;   // share of the screen poured per second
const UPRIGHT = 22 * RAD;   // within this of upright counts as upright

const params = new URLSearchParams(location.search);

// Each drink: liquid colours (surface to depth), the glow of light through
// it, its head (height as a share of screen height, colours top to bottom,
// foam cell tint), fizz, condensation, steam, and whether it earns a burp.
const DRINKS = {
  beer: {
    title: 'BEER', unit: ['beer', 'beers'], head: 'foam',
    body: ['#f9c53a', '#eea31c', '#cc760c', '#7a3a05'],
    glow: 'rgba(255, 222, 120, 0.36)', glowAt: 'center', band: '255, 215, 90', bandAlpha: 0.4,
    edge: '70, 26, 0', milk: 0,
    foam: 0.075, foamShade: ['#fffaf0', '#f6e9cc', '#dcbc7c'], speck: '255, 255, 255', grain: '190, 150, 90',
    fresh: 0.11, fizz: 1, drops: 1, burp: true, pour: ['#b8620a', '#f4b52a', '#ffe08a'],
  },
  butterbeer: {
    title: 'BUTTERBEER', unit: ['butterbeer', 'butterbeers'], head: 'cream',
    body: ['#e8b866', '#d39a48', '#a8682a', '#6e3d14'],
    glow: 'rgba(255, 214, 140, 0.3)', glowAt: 'center', band: '255, 236, 200', bandAlpha: 0.45,
    edge: '80, 40, 8', milk: 0.14,
    foam: 0.07, foamShade: ['#fffbf2', '#f7e6c4', '#e6c48a'], speck: '255, 252, 242', grain: '214, 176, 116',
    fresh: 0.04, fizz: 0.45, drops: 1, burp: true, pour: ['#a8681e', '#e9b45c', '#fbe0a8'],
  },
  rootbeer: {
    title: 'ROOT BEER', unit: ['root beer', 'root beers'], head: 'foam',
    body: ['#4a1a08', '#2a0c03', '#160502', '#0a0201'],
    glow: 'rgba(170, 70, 28, 0.5)', glowAt: 'surface', band: '200, 120, 70', bandAlpha: 0.3,
    edge: '10, 2, 0', milk: 0,
    foam: 0.035, foamShade: ['#ecd6ae', '#d9b788', '#a87a48'], speck: '250, 238, 214', grain: '150, 100, 50',
    fresh: 0.07, fizz: 0.9, drops: 1, burp: true, pour: ['#1a0602', '#4a1a08', '#9a4a24'],
  },
  wine: {
    title: 'WINE', unit: ['glass of wine', 'glasses of wine'], head: 'none',
    body: ['#5e0f26', '#460a1c', '#2a0411', '#140108'],
    glow: 'rgba(160, 26, 56, 0.4)', glowAt: 'surface', band: '140, 30, 60', bandAlpha: 0.25,
    edge: '9, 0, 2', milk: 0,
    foam: 0, fresh: 0, fizz: 0, drops: 0, burp: false, pour: ['#2a020a', '#6a0c24', '#c0304e'],
  },
  coffee: {
    title: 'COFFEE', unit: ['coffee', 'coffees'], head: 'crema',
    body: ['#2b1608', '#1a0c04', '#0d0602', '#060200'],
    glow: 'rgba(117, 70, 41, 0.28)', glowAt: 'surface', band: '150, 95, 55', bandAlpha: 0.25,
    edge: '4, 1, 0', milk: 0,
    foam: 0.02, foamShade: ['#d9a66a', '#b77c45', '#8a552a'], speck: '217, 166, 106', grain: '90, 50, 20',
    fresh: 0.006, fizz: 0, drops: 0, steam: true, burp: false, pour: ['#0d0602', '#2b1608', '#6a3e1e'],
  },
};
const drinkName = DRINKS[params.get('drink')] ? params.get('drink') : (loadDrink() || 'beer');
const drink = DRINKS[drinkName] || DRINKS.beer;
const FOAM = drink.foam;    // settled head height, as a share of screen height

let dpr = 1, W = 0, H = 0, PW = 0, PH = 0, screenAngle = 0, D = 0;
let targetAngle = 0;        // gravity direction on screen, 0 = straight down
let gravityStrength = 1;    // how much of gravity lies in the screen plane
let angle = 0, angleV = 0;  // the liquid's lagging surface angle (slosh)
let slosh = 0;
let beer = FULL;
let foamExtra = 0;          // extra head from a fresh pour
let flow = 0;               // smoothed drink rate
let state = 'full';         // full | drinking | empty | refilling
let uprightFor = 0;
let drankOnce = false;
let beersDrunk = loadCount();
let gotSensor = false;
let clock = 0;
let bubbles = [];
let lace = [];
let laceTimer = 0;
let audio = null, fizz = null, lastGlug = 0;
let sprites = null;
let sites = [];
let surfL = -1e4, surfR = 1e4; // where the surface meets the glass walls
let foamCells = [];

// ---------- layout and textures ----------

function layout() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  screenAngle = readScreenAngle();
  const turned = screenAngle % 180 !== 0;
  PW = turned ? H : W;
  PH = turned ? W : H;
  D = Math.hypot(PW, PH);
  sprites = buildSprites();
  sites = Array.from({ length: 10 }, (_, i) => ({
    x: PW * (0.1 + 0.8 * ((i * 0.618 + 0.13) % 1)),
    y: PH * (0.45 + 0.5 * ((i * 0.381 + 0.27) % 1)),
    wait: Math.random() * 0.1,
  }));
}

function readScreenAngle() {
  const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  return ((Number(a) % 360) + 360) % 360;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  return [c, g];
}

function buildSprites() {
  // A carbonation bubble: a thin bright rim around a clear middle.
  const [bubble, b] = makeCanvas(32, 32);
  const bg = b.createRadialGradient(16, 16, 0, 16, 16, 15);
  bg.addColorStop(0, 'rgba(255, 240, 200, 0.02)');
  bg.addColorStop(0.7, 'rgba(255, 236, 180, 0.12)');
  bg.addColorStop(0.9, 'rgba(255, 248, 220, 0.6)');
  bg.addColorStop(1, 'rgba(255, 248, 220, 0)');
  b.fillStyle = bg;
  b.beginPath(); b.arc(16, 16, 15, 0, Math.PI * 2); b.fill();

  // A soft blob, for lacing and the pour splash.
  const [blob, l] = makeCanvas(32, 32);
  const lg = l.createRadialGradient(16, 16, 0, 16, 16, 16);
  lg.addColorStop(0, 'rgba(255, 252, 240, 0.95)');
  lg.addColorStop(0.55, 'rgba(250, 240, 214, 0.6)');
  lg.addColorStop(1, 'rgba(250, 240, 214, 0)');
  l.fillStyle = lg;
  l.fillRect(0, 0, 32, 32);

  // Bigger cells in the bottom of a beer head, where it meets the liquid.
  foamCells = drink.head === 'foam'
    ? Array.from({ length: 320 }, () => ({ u: Math.random(), dy: Math.pow(Math.random(), 1.6), r: 1.2 + Math.random() * 2.6 }))
    : [];

  return { bubble, blob, foam: drink.head === 'none' ? null : buildHeadPattern(), glass: buildGlass(), room: buildRoom() };
}

// Tileable head texture: fine micro-foam, smooth cream, or mottled crema.
function buildHeadPattern() {
  const S = 160;
  const [tile, t] = makeCanvas(S, S);
  const dot = (x, y, r, style) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = x + ox, py = y + oy;
      if (px < -r || px > S + r || py < -r || py > S + r) continue;
      t.fillStyle = style;
      t.beginPath(); t.arc(px, py, r, 0, Math.PI * 2); t.fill();
    }
  };
  if (drink.head === 'crema') {
    const tones = ['198, 138, 75', '160, 101, 44', '217, 166, 106', '120, 70, 30'];
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 5;
      const tone = tones[i % tones.length];
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const g = t.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${tone}, ${0.25 + Math.random() * 0.25})`);
        g.addColorStop(1, `rgba(${tone}, 0)`);
        t.fillStyle = g;
        t.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 900; i++) dot(Math.random() * S, Math.random() * S, 0.3 + Math.random() * 0.5, `rgba(${drink.grain}, ${0.15 + Math.random() * 0.25})`);
  } else {
    const n = drink.head === 'cream' ? 1400 : 2400;
    const a = drink.head === 'cream' ? 0.35 : 1;
    for (let i = 0; i < n; i++) {
      const light = Math.random() < 0.6;
      dot(Math.random() * S, Math.random() * S, 0.3 + Math.pow(Math.random(), 2) * 1.1,
        light ? `rgba(${drink.speck}, ${(0.25 + Math.random() * 0.4) * a})`
          : `rgba(${drink.grain}, ${(0.1 + Math.random() * 0.18) * a})`);
    }
    if (drink.head === 'foam') {
      // A few slightly larger pockets.
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * S, y = Math.random() * S, r = 1 + Math.random() * 1.5;
        dot(x, y, r, 'rgba(255, 255, 255, 0.18)');
        t.strokeStyle = `rgba(${drink.grain}, 0.22)`;
        t.lineWidth = 0.5;
        t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.stroke();
      }
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern.setTransform && window.DOMMatrix) pattern.setTransform(new DOMMatrix().scale(1 / dpr));
  return pattern;
}

// What you see through the empty part of the glass: a dim, blurred room.
function buildRoom() {
  const [room, g] = makeCanvas(PW, PH);
  const bg = g.createLinearGradient(0, 0, 0, PH);
  bg.addColorStop(0, '#5c5650');
  bg.addColorStop(1, '#2a2622');
  g.fillStyle = bg;
  g.fillRect(0, 0, PW, PH);
  const spots = [[0.2, 0.12, 110, 0.14], [0.78, 0.08, 80, 0.12], [0.62, 0.3, 120, 0.08], [0.12, 0.42, 70, 0.1], [0.9, 0.55, 95, 0.08]];
  for (const [fx, fy, r, a] of spots) {
    const sg = g.createRadialGradient(PW * fx, PH * fy, 0, PW * fx, PH * fy, r);
    sg.addColorStop(0, `rgba(255, 205, 140, ${a})`);
    sg.addColorStop(1, 'rgba(255, 205, 140, 0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, PW, PH);
  }
  return room;
}

// The glass in front of the drink: condensation (cold drinks only), the
// curved walls catching light, and a vignette.
function buildGlass() {
  const [glass, g] = makeCanvas(PW, PH);

  if (drink.drops) {
    // Fine frost, thicker toward the edges and bottom.
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * PW, y = Math.random() * PH;
      const edge = Math.min(1, Math.abs(x - PW / 2) / (PW / 2) + y / PH * 0.4);
      if (Math.random() > 0.3 + edge * 0.7) continue;
      g.fillStyle = `rgba(255, 255, 255, ${0.03 + Math.random() * 0.05})`;
      g.fillRect(x, y, 0.8, 0.8);
    }
    // Clusters of small beads.
    for (let c = 0; c < 14; c++) {
      const cx = Math.random() < 0.6 ? (Math.random() < 0.5 ? 0.08 : 0.92) * PW : Math.random() * PW;
      const cy = PH * (0.15 + Math.random() * 0.85);
      const spread = 40 + Math.random() * 80;
      const n = 60 + Math.random() * 90;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.7) * spread;
        drawBead(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.3, 0.5 + Math.pow(Math.random(), 3) * 1.7);
      }
    }
    // A few bigger drops, each having run a short way and wiped a clear track.
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * PW, y = PH * (0.2 + Math.random() * 0.75);
      const len = 8 + Math.random() * 17;
      g.strokeStyle = 'rgba(0, 0, 0, 0.07)';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y - len); g.lineTo(x, y); g.stroke();
      drawBead(g, x, y, 2.4 + Math.random() * 1.8);
    }
  }

  // Curved walls: dark edges, a bright rim line on each side, and a soft
  // reflection a little in from the left.
  const walls = g.createLinearGradient(0, 0, PW, 0);
  walls.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  walls.addColorStop(0.012, 'rgba(255, 255, 255, 0.04)');
  walls.addColorStop(0.05, 'rgba(255, 255, 255, 0)');
  walls.addColorStop(0.1, 'rgba(255, 255, 255, 0)');
  walls.addColorStop(0.13, 'rgba(255, 255, 255, 0.11)');
  walls.addColorStop(0.16, 'rgba(255, 255, 255, 0.04)');
  walls.addColorStop(0.2, 'rgba(255, 255, 255, 0)');
  walls.addColorStop(0.92, 'rgba(255, 255, 255, 0)');
  walls.addColorStop(0.95, 'rgba(255, 255, 255, 0.05)');
  walls.addColorStop(0.994, 'rgba(255, 255, 255, 0.04)');
  walls.addColorStop(1, 'rgba(255, 255, 255, 0.28)');
  g.fillStyle = walls;
  g.fillRect(0, 0, PW, PH);

  const vignette = g.createRadialGradient(PW / 2, PH * 0.45, Math.min(PW, PH) * 0.4, PW / 2, PH / 2, D * 0.62);
  vignette.addColorStop(0, 'rgba(20, 8, 0, 0)');
  vignette.addColorStop(1, 'rgba(20, 8, 0, 0.35)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, PW, PH);
  return glass;
}

// A water bead on vertical glass: slightly taller than wide, dark rim at the
// top, lit lower half, a pin of highlight.
function drawBead(g, x, y, r) {
  const ry = r * 1.25;
  g.fillStyle = 'rgba(20, 10, 0, 0.09)';
  g.beginPath(); g.ellipse(x, y - r * 0.15, r, ry, 0, 0, Math.PI * 2); g.fill();
  const body = g.createLinearGradient(0, y - ry, 0, y + ry);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
  body.addColorStop(0.55, 'rgba(255, 255, 255, 0.1)');
  body.addColorStop(1, 'rgba(255, 255, 255, 0.34)');
  g.fillStyle = body;
  g.beginPath(); g.ellipse(x, y, r * 0.9, ry * 0.92, 0, 0, Math.PI * 2); g.fill();
  if (r > 1.1) {
    g.fillStyle = 'rgba(255, 255, 255, 0.7)';
    g.beginPath(); g.arc(x - r * 0.35, y - ry * 0.45, Math.max(0.4, r * 0.18), 0, Math.PI * 2); g.fill();
  }
}

// ---------- geometry ----------

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Portrait screen point -> liquid frame (gravity points to +y).
function toWorld(x, y) {
  const dx = x - PW / 2, dy = y - PH / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

// Liquid frame -> portrait screen point.
function toScreen(x, y) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: PW / 2 + x * c + y * s, y: PH / 2 - x * s + y * c };
}

function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

// Part of the polygon at or below height `level` (larger y is lower).
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

// Height of a level surface that leaves `area` of the screen below it.
function surfaceFor(poly, area) {
  let top = Math.min(...poly.map(p => p.y));
  let bottom = Math.max(...poly.map(p => p.y));
  for (let i = 0; i < 30; i++) {
    const mid = (top + bottom) / 2;
    if (polygonArea(clipBelow(poly, mid)) > area) top = mid; else bottom = mid;
  }
  return (top + bottom) / 2;
}

function foamHeight() {
  return PH * (FOAM * Math.min(1, beer / 0.1) + foamExtra);
}

// Surface ripple, in the liquid frame.
function wave(x) {
  return Math.sin(x * 0.018 + clock * 5.5) * slosh * 14
    + Math.sin(x * 0.047 - clock * 2.1) * (1.2 + slosh * 4);
}

function foamTop(x) {
  const h = foamHeight();
  const k = FOAM ? Math.min(1, h / (PH * FOAM)) : 0;
  if (drink.head === 'crema') return wave(x) - h + k * 0.6 * Math.sin(x * 0.09 + 1.7);
  if (drink.head === 'cream') {
    return wave(x) - h + k * (7 * Math.sin(x * 0.011 + clock * 0.15) + 3.5 * Math.sin(x * 0.029 + 2.2) + 1.2 * Math.sin(x * 0.083));
  }
  return wave(x) - h + k * (3.2 * Math.sin(x * 0.023 + clock * 0.3 + 1)
    + 2.2 * Math.sin(x * 0.061 - clock * 0.45)
    + 1.3 * Math.sin(x * 0.137 + 2.1)
    + 0.8 * Math.sin(x * 0.29 + 0.7));
}

// Without a head, the surface curls up a few pixels where it meets the glass.
function surfaceAt(level, x) {
  const curl = FOAM ? 0 : 5 * (Math.exp(-Math.max(0, x - surfL) / 5) + Math.exp(-Math.max(0, surfR - x) / 5));
  return level + wave(x) - curl;
}

// ---------- simulation ----------

function update(dt) {
  clock += dt;

  // The surface follows gravity on a damped spring, so it sloshes.
  const d = wrap(targetAngle - angle);
  angleV += (55 * d - 6 * angleV) * dt;
  angle = wrap(angle + angleV * dt);
  slosh = Math.max(slosh * Math.exp(-dt * 1.2), Math.min(1, Math.abs(angleV) / 2.5));

  const poly = [[0, 0], [PW, 0], [PW, PH], [0, PH]].map(([x, y]) => toWorld(x, y));
  const total = PW * PH;
  // The top edge of the phone is the rim; beer above its lower corner spills.
  const rim = Math.max(poly[0].y, poly[1].y);
  const fits = polygonArea(clipBelow(poly, rim)) / total;

  let sip = 0;
  if (state === 'refilling') {
    beer = Math.min(FULL, beer + REFILL_RATE * dt);
    foamExtra = Math.min(drink.fresh, foamExtra + 0.22 * dt);
    if (beer >= FULL) {
      state = 'full';
      stopFizz();
    }
  } else if (beer > 0) {
    sip = Math.max(0, Math.min(beer - fits, DRINK_RATE * dt));
    beer -= sip;
    if (sip > 0) {
      state = 'drinking';
      drankOnce = true;
      foamExtra = Math.max(0, foamExtra - 0.2 * dt);
      glug();
    } else {
      state = 'full';
    }
    if (beer < 0.003) {
      beer = 0;
      foamExtra = 0;
      state = 'empty';
      beersDrunk += 1;
      saveCount();
      if (drink.burp) burp(); else if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    }
  }
  if (state !== 'refilling') foamExtra = Math.max(0, foamExtra - 0.012 * dt);
  flow += (sip / dt - flow) * Math.min(1, dt * 10);

  if (state === 'empty') {
    const upright = Math.abs(targetAngle) < UPRIGHT && gravityStrength > 0.5;
    uprightFor = upright ? uprightFor + dt : 0;
    if (uprightFor > 0.8) refill();
  }

  const level = beer > 0 ? surfaceFor(poly, beer * total) : Math.max(...poly.map(p => p.y)) + 50;
  const wet = clipBelow(poly, level).filter(p => Math.abs(p.y - level) < 0.5).map(p => p.x);
  surfL = wet.length ? Math.min(...wet) : -1e4;
  surfR = wet.length ? Math.max(...wet) : 1e4;
  updateBubbles(dt, level);
  updateLace(dt, level, sip > 0);
  return level;
}

function refill() {
  state = 'refilling';
  uprightFor = 0;
  startFizz();
}

function inLiquid(x, y, level, margin) {
  return toWorld(x, y).y > level + margin;
}

function updateBubbles(dt, level) {
  if (beer > 0.01 && drink.fizz > 0) {
    // Free-floating bubbles start deep and rise.
    const spawn = (state === 'refilling' ? 90 : 10) * drink.fizz * dt;
    for (let n = spawn + Math.random(); n >= 1 && bubbles.length < 260; n--) {
      let x, y;
      if (state === 'refilling') {
        const p = toScreen((Math.random() - 0.5) * PW * 0.35, level + 20 + Math.random() * PH * 0.35);
        x = p.x; y = p.y;
      } else {
        x = Math.random() * PW;
        y = PH * (0.5 + Math.random() * 0.55);
      }
      if (inLiquid(x, y, level, 12)) bubbles.push(newBubble(x, y, 0.5 + Math.random() * 1));
    }
    // Nucleation sites on the glass send up steady chains of tiny bubbles.
    for (const s of sites) {
      s.wait -= dt;
      if (s.wait <= 0) {
        s.wait = (0.07 + Math.random() * 0.06) / drink.fizz;
        if (bubbles.length < 320 && inLiquid(s.x, s.y, level, 12)) {
          bubbles.push(newBubble(s.x, s.y, 0.45 + Math.random() * 0.35, true));
        }
      }
    }
  }
  const ux = -Math.sin(angle), uy = -Math.cos(angle); // "up" on screen
  bubbles = bubbles.filter(b => {
    b.age += dt;
    b.v += dt * 25;
    b.r *= 1 + dt * 0.08;
    const wob = b.chain ? 0 : Math.sin(b.age * 9 + b.phase) * 10 * dt;
    b.x += ux * b.v * dt - uy * wob;
    b.y += uy * b.v * dt + ux * wob;
    return b.x > -10 && b.x < PW + 10 && b.y > -10 && b.y < PH + 10
      && inLiquid(b.x, b.y, level, b.r + 2);
  });
}

function newBubble(x, y, r, chain = false) {
  return { x, y, r, v: chain ? 55 : 35 + Math.random() * 60, age: 0, phase: Math.random() * 6, chain };
}

// Foam clings to the glass as the level drops.
function updateLace(dt, level, draining) {
  laceTimer -= dt;
  if (draining && laceTimer <= 0 && beer > 0.02 && FOAM > 0.05) {
    laceTimer = 0.09;
    for (let i = 0; i < 6; i++) {
      const wx = (Math.random() - 0.5) * D;
      const p = toScreen(wx, level - foamHeight() * (0.2 + Math.random() * 0.7));
      if (p.x < 0 || p.x > PW || p.y < 0 || p.y > PH) continue;
      lace.push({ x: p.x, y: p.y, r: 3 + Math.random() * 11, life: 1 });
    }
    if (lace.length > 500) lace.splice(0, lace.length - 500);
  }
  if (state === 'refilling') {
    for (const l of lace) l.life -= dt * 0.8;
  }
  lace = lace.filter(l => (l.life -= dt / 30) > 0);
}

// ---------- drawing ----------

function draw(level) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-screenAngle * RAD);
  ctx.translate(-PW / 2, -PH / 2);
  const base = ctx.getTransform();

  drawEmptyGlass();
  if (state === 'refilling') drawPour(level);

  if (beer > 0) {
    ctx.save();
    ctx.translate(PW / 2, PH / 2);
    ctx.rotate(-angle);
    drawLiquid(level);

    // Glass-fixed effects and bubbles live in screen space; clip to the liquid.
    ctx.beginPath();
    ctx.rect(-D, level, D * 2, D * 2);
    ctx.setTransform(base);
    ctx.clip();
    drawWallsInLiquid();
    for (const b of bubbles) {
      const s = b.r * 2 * Math.min(1, b.age * 5);
      ctx.drawImage(sprites.bubble, b.x - s / 2, b.y - s / 2, s, s);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(PW / 2, PH / 2);
    ctx.rotate(-angle);
    if (drink.head === 'none') drawMeniscus(level); else drawHead(level);
    if (drink.steam) drawSteam(level);
    ctx.restore();
  }

  ctx.setTransform(base);
  ctx.drawImage(sprites.glass, 0, 0, PW, PH);
  drawHud();
}

function drawEmptyGlass() {
  ctx.drawImage(sprites.room, 0, 0, PW, PH);
  for (const l of lace) {
    ctx.globalAlpha = Math.min(1, l.life * 1.6) * 0.6;
    ctx.drawImage(sprites.blob, l.x - l.r * 1.3, l.y - l.r * 0.45, l.r * 2.6, l.r * 0.9);
  }
  ctx.globalAlpha = 1;
}

function liquidPath(level) {
  ctx.beginPath();
  ctx.moveTo(-D, surfaceAt(level, -D));
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x));
  ctx.lineTo(D, level + D);
  ctx.lineTo(-D, level + D);
  ctx.closePath();
}

function drawLiquid(level) {
  const body = ctx.createLinearGradient(0, level, 0, level + PH);
  body.addColorStop(0, drink.body[0]);
  body.addColorStop(0.12, drink.body[1]);
  body.addColorStop(0.55, drink.body[2]);
  body.addColorStop(1, drink.body[3]);
  ctx.fillStyle = body;
  liquidPath(level);
  ctx.fill();

  ctx.save();
  ctx.clip();
  // Light coming through from behind: in the body for pale drinks, only
  // near the surface for dark ones.
  if (drink.glowAt === 'center') {
    const lit = toWorld(PW * 0.42, PH * 0.4);
    const glow = ctx.createRadialGradient(lit.x, lit.y, 0, lit.x, lit.y, D * 0.45);
    glow.addColorStop(0, drink.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
  } else {
    const glow = ctx.createLinearGradient(0, level, 0, level + PH * 0.22);
    glow.addColorStop(0, drink.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
  }
  ctx.fillRect(-D, level - 20, D * 2, D * 2);
  if (drink.milk) {
    ctx.fillStyle = `rgba(255, 235, 200, ${drink.milk})`;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
  }
  // A bright band just under the surface, where light comes through the head.
  const band = ctx.createLinearGradient(0, level, 0, level + 30);
  band.addColorStop(0, `rgba(${drink.band}, ${drink.bandAlpha})`);
  band.addColorStop(1, `rgba(${drink.band}, 0)`);
  ctx.fillStyle = band;
  ctx.fillRect(-D, level - 20, D * 2, 60);
  ctx.restore();
}

// Curved glass: the liquid darkens toward the side walls, with a faint
// shaft of light a little left of centre.
function drawWallsInLiquid() {
  const side = ctx.createLinearGradient(0, 0, PW, 0);
  side.addColorStop(0, `rgba(${drink.edge}, 0.5)`);
  side.addColorStop(0.14, `rgba(${drink.edge}, 0)`);
  side.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
  side.addColorStop(0.36, 'rgba(255, 245, 225, 0.07)');
  side.addColorStop(0.44, 'rgba(255, 255, 255, 0)');
  side.addColorStop(0.86, `rgba(${drink.edge}, 0)`);
  side.addColorStop(1, `rgba(${drink.edge}, 0.5)`);
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, PW, PH);
}

function headPath(level, bottom) {
  ctx.beginPath();
  ctx.moveTo(-D, level + foamTop(-D));
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, level + foamTop(x));
  for (let x = D; x >= -D; x -= 4) ctx.lineTo(x, level + wave(x) + bottom);
  ctx.closePath();
}

function drawHead(level) {
  const h = foamHeight();
  if (h < 1) return;
  headPath(level, drink.head === 'crema' ? 1 : 3);
  const shade = ctx.createLinearGradient(0, level - h - 8, 0, level + 3);
  shade.addColorStop(0, drink.foamShade[0]);
  shade.addColorStop(0.6, drink.foamShade[1]);
  shade.addColorStop(1, drink.foamShade[2]);
  ctx.fillStyle = shade;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = sprites.foam;
  ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  // Bigger, translucent cells low in a beer head.
  if (foamCells.length) {
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${drink.grain}, 0.35)`;
    ctx.fillStyle = 'rgba(255, 250, 235, 0.22)';
    for (const c of foamCells) {
      const x = -D + c.u * D * 2;
      const y = level + wave(x) + 1 - c.dy * h * 0.3;
      ctx.beginPath(); ctx.arc(x, y, c.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  // Shade toward the liquid, so the head has volume.
  const depth = ctx.createLinearGradient(0, level - h, 0, level + 3);
  depth.addColorStop(0, 'rgba(255, 255, 255, 0)');
  depth.addColorStop(0.65, 'rgba(120, 80, 30, 0.06)');
  depth.addColorStop(1, 'rgba(110, 70, 20, 0.22)');
  ctx.fillStyle = depth;
  ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  ctx.restore();

  // Feathered underside for cream: it bleeds into the drink.
  if (drink.head === 'cream') {
    const feather = ctx.createLinearGradient(0, level, 0, level + 26);
    feather.addColorStop(0, 'rgba(245, 225, 185, 0.55)');
    feather.addColorStop(1, 'rgba(245, 225, 185, 0)');
    ctx.fillStyle = feather;
    ctx.fillRect(-D, level, D * 2, 26);
  }

  // Soft light along the top.
  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, level + foamTop(x) + 1.2);
  ctx.strokeStyle = drink.head === 'crema' ? 'rgba(239, 210, 171, 0.35)' : 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = drink.head === 'cream' ? 3 : 1.5;
  ctx.stroke();
}

// No head: a thin foreshortened surface ribbon, a broken highlight on it,
// and a dark line under it. surfaceAt() curls it up at the walls.
function drawMeniscus(level) {
  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x));
  for (let x = D; x >= -D; x -= 4) ctx.lineTo(x, surfaceAt(level, x) + 6);
  ctx.closePath();
  const ribbon = ctx.createLinearGradient(0, level - 4, 0, level + 6);
  ribbon.addColorStop(0, 'rgba(181, 28, 60, 0.7)');
  ribbon.addColorStop(1, 'rgba(38, 2, 10, 0.2)');
  ctx.fillStyle = ribbon;
  ctx.fill();

  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x) + 6.5);
  ctx.strokeStyle = 'rgba(26, 2, 8, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x) + 0.6);
  ctx.setLineDash([120, 40, 30, 90, 200, 60]);
  ctx.strokeStyle = 'rgba(255, 219, 226, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}

// Coffee: a few faint tapered wisps rising off the surface.
function drawSteam(level) {
  const top = level - foamHeight();
  for (let i = 0; i < 5; i++) {
    const life = (clock / 4.5 + i * 0.37) % 1;
    const fade = Math.sin(life * Math.PI);
    const x0 = (i - 2) * PW * 0.2 + Math.sin(i * 7.1) * 30;
    const height = 120 + 80 * life;
    const grad = ctx.createLinearGradient(0, top, 0, top - height);
    grad.addColorStop(0, `rgba(245, 239, 230, ${0.05 * fade})`);
    grad.addColorStop(1, 'rgba(245, 239, 230, 0)');
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    for (const w of [22, 12]) {
      ctx.lineWidth = w * (0.6 + life * 0.6);
      ctx.beginPath();
      for (let k = 0; k <= height; k += 6) {
        const x = x0 + Math.sin(k * 0.035 - clock * 1.2 + i) * (4 + k * 0.12);
        if (k === 0) ctx.moveTo(x, top - 4 - k); else ctx.lineTo(x, top - 4 - k);
      }
      ctx.stroke();
    }
  }
}

// A stream pouring in from the top edge during a refill: narrow, tapering,
// with a splash where it lands.
function drawPour(level) {
  const surface = Math.max(0, toScreen(0, level).y - foamHeight());
  const x = PW / 2 + Math.sin(clock * 7) * 1.5;
  const grad = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
  grad.addColorStop(0, drink.pour[0]);
  grad.addColorStop(0.35, drink.pour[1]);
  grad.addColorStop(0.5, drink.pour[2]);
  grad.addColorStop(0.65, drink.pour[1]);
  grad.addColorStop(1, drink.pour[0]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - 5, -5);
  ctx.lineTo(x + 5, -5);
  for (let y = 0; y <= surface + 6; y += 12) ctx.lineTo(x + 3 + Math.sin(y * 0.05 - clock * 30) * 0.8, y);
  for (let y = surface + 6; y >= 0; y -= 12) ctx.lineTo(x - 3 + Math.sin(y * 0.05 - clock * 30 + 1) * 0.8, y);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < (drink.head === 'foam' || drink.head === 'cream' ? 7 : 0); i++) {
    const a = clock * 6 + i * 2.3;
    const r = 4 + 3 * Math.abs(Math.sin(a));
    ctx.globalAlpha = 0.45;
    ctx.drawImage(sprites.blob, x + Math.sin(a * 1.3) * 12 - r, surface - Math.abs(Math.cos(a)) * 8 - r * 0.5, r * 2, r);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  let text = '';
  if (!startEl.hidden) text = '';
  else if (state === 'empty') text = 'Cheers! Hold it upright for another';
  else if (state === 'full' && !drankOnce) text = 'Tip it to your lips';
  if (messageEl.textContent !== text) messageEl.textContent = text;
  messageEl.hidden = !text;
  const count = `${beersDrunk} ${drink.unit[beersDrunk === 1 ? 0 : 1]}`;
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
  if (now - lastGlug < 260) return;
  lastGlug = now;
  if (navigator.vibrate) navigator.vibrate(20);
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

function startFizz() {
  if (!audio || fizz) return;
  const len = audio.sampleRate;
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.2);
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 0.7;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.3);
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start();
  fizz = { src, gain };
}

function stopFizz() {
  if (!fizz) return;
  const t = audio.currentTime;
  fizz.gain.gain.setTargetAtTime(0.0001, t, 0.5);
  fizz.src.stop(t + 2.5);
  fizz = null;
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
  if (e.beta == null || e.gamma == null) return;
  gotSensor = true;
  // Gravity projected onto the screen, in portrait coordinates (y down).
  const b = e.beta * RAD, g = e.gamma * RAD;
  const x = Math.sin(g) * Math.cos(b);
  const y = Math.sin(b);
  gravityStrength = Math.hypot(x, y);
  // Lying flat, the direction is noise; keep the last one.
  if (gravityStrength > 0.25) targetAngle = Math.atan2(x, y);
}

function showSimulator() {
  simEl.hidden = false;
  simTilt.addEventListener('input', () => { targetAngle = Number(simTilt.value) * RAD; });
}

async function start() {
  startEl.hidden = true;
  initAudio();
  // Android: keep the page from rotating while you drink. iOS ignores this;
  // turn on Portrait Orientation Lock there.
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait'))
      .catch(() => {});
  }
  beer = 0;
  foamExtra = 0;
  refill();

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

function countKey() {
  return drinkName === 'beer' ? 'beer.count' : `beer.count.${drinkName}`;
}

function loadCount() {
  try { return Number(localStorage.getItem(countKey())) || 0; } catch { return 0; }
}

function saveCount() {
  try { localStorage.setItem(countKey(), String(beersDrunk)); } catch { /* ignore */ }
}

function loadDrink() {
  try { return localStorage.getItem('beer.drink'); } catch { return null; }
}

// The start screen's drink picker reloads with ?drink=.
function setupPicker() {
  document.getElementById('title').textContent = drink.title;
  document.title = drink.title;
  for (const btn of document.querySelectorAll('[data-drink]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.drink === drinkName));
    btn.addEventListener('click', () => {
      try { localStorage.setItem('beer.drink', btn.dataset.drink); } catch { /* ignore */ }
      const q = new URLSearchParams(location.search);
      q.set('drink', btn.dataset.drink);
      location.search = q.toString();
    });
  }
}

// ---------- boot ----------

document.getElementById('start-btn').addEventListener('click', start);
setupPicker();
canvas.addEventListener('click', () => { if (state === 'empty') refill(); });
window.addEventListener('resize', layout);
if (screen.orientation) screen.orientation.addEventListener('change', layout);
layout();

// ?tilt=60 skips the start screen at a fixed angle; ?sim shows the slider;
// ?beer=0.5 sets how full the glass is; ?pour starts a refill.
if (params.has('tilt') || params.has('sim')) {
  startEl.hidden = true;
  targetAngle = angle = (Number(params.get('tilt')) || 0) * RAD;
  simTilt.value = String(Number(params.get('tilt')) || 0);
  showSimulator();
}
if (params.has('beer')) beer = Math.max(0, Math.min(FULL, Number(params.get('beer'))));
if (params.has('pour')) refill();

let last = performance.now();
function frame(now) {
  // Clamp: a zero-length first frame would divide by zero in update().
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  draw(update(dt));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
