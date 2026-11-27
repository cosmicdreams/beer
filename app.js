// BEER: the whole screen is a glass of beer. Tip the phone and the beer
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
const FULL = 0.76;          // share of the screen filled with beer; foam sits on top
const FOAM = 0.075;         // settled head height, as a share of screen height
const DRINK_RATE = 0.24;    // share of the screen swallowed per second, max
const REFILL_RATE = 0.32;   // share of the screen poured per second
const UPRIGHT = 22 * RAD;   // within this of upright counts as upright

const params = new URLSearchParams(location.search);

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
  sites = Array.from({ length: 7 }, (_, i) => ({
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
  // A carbonation bubble: clear middle, bright rim, a glint.
  const [bubble, b] = makeCanvas(32, 32);
  const bg = b.createRadialGradient(16, 16, 0, 16, 16, 15);
  bg.addColorStop(0, 'rgba(255, 240, 200, 0.05)');
  bg.addColorStop(0.65, 'rgba(255, 236, 180, 0.18)');
  bg.addColorStop(0.92, 'rgba(255, 250, 225, 0.85)');
  bg.addColorStop(1, 'rgba(255, 250, 225, 0)');
  b.fillStyle = bg;
  b.beginPath(); b.arc(16, 16, 15, 0, Math.PI * 2); b.fill();
  b.fillStyle = 'rgba(255, 255, 255, 0.95)';
  b.beginPath(); b.arc(11, 10, 3.2, 0, Math.PI * 2); b.fill();

  // A soft foam blob, for lacing and the froth line.
  const [blob, l] = makeCanvas(32, 32);
  const lg = l.createRadialGradient(16, 16, 0, 16, 16, 16);
  lg.addColorStop(0, 'rgba(255, 252, 240, 0.95)');
  lg.addColorStop(0.55, 'rgba(250, 240, 214, 0.6)');
  lg.addColorStop(1, 'rgba(250, 240, 214, 0)');
  l.fillStyle = lg;
  l.fillRect(0, 0, 32, 32);

  return { bubble, blob, foam: buildFoamPattern(), glass: buildGlass() };
}

// Tileable texture of packed foam cells.
function buildFoamPattern() {
  const S = 180;
  const [tile, t] = makeCanvas(S, S);
  const cells = [];
  for (let i = 0; i < 340; i++) {
    const r = i < 40 ? 6 + Math.random() * 7 : 1.5 + Math.random() * 5;
    cells.push({ x: Math.random() * S, y: Math.random() * S, r });
  }
  for (const c of cells) {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const x = c.x + ox, y = c.y + oy;
        if (x < -c.r || x > S + c.r || y < -c.r || y > S + c.r) continue;
        const g = t.createRadialGradient(x - c.r * 0.3, y - c.r * 0.35, 0, x, y, c.r);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        g.addColorStop(0.7, 'rgba(250, 242, 222, 0.55)');
        g.addColorStop(1, 'rgba(196, 160, 100, 0.55)');
        t.fillStyle = g;
        t.beginPath(); t.arc(x, y, c.r, 0, Math.PI * 2); t.fill();
      }
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern.setTransform && window.DOMMatrix) {
    pattern.setTransform(new DOMMatrix().scale(1 / dpr));
  }
  return pattern;
}

// The cold glass in front of the beer: condensation, glare and a vignette.
function buildGlass() {
  const [glass, g] = makeCanvas(PW, PH);

  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(255, 255, 255, ${0.04 + Math.random() * 0.08})`;
    g.beginPath();
    g.arc(Math.random() * PW, Math.random() * PH, 0.4 + Math.random() * 1.1, 0, Math.PI * 2);
    g.fill();
  }

  for (let i = 0; i < 10; i++) {
    // A drop that has run down, leaving a clear trail.
    const x = Math.random() * PW;
    const y0 = Math.random() * PH * 0.6;
    const len = 40 + Math.random() * PH * 0.3;
    const trail = g.createLinearGradient(0, y0, 0, y0 + len);
    trail.addColorStop(0, 'rgba(255, 255, 255, 0)');
    trail.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
    g.strokeStyle = trail;
    g.lineWidth = 3 + Math.random() * 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y0);
    g.quadraticCurveTo(x + (Math.random() - 0.5) * 12, y0 + len / 2, x, y0 + len);
    g.stroke();
    drawDrop(g, x, y0 + len, 4 + Math.random() * 3);
  }
  const drops = Math.round(PW * PH / 5200);
  for (let i = 0; i < drops; i++) {
    drawDrop(g, Math.random() * PW, Math.random() * PH, 1.5 + Math.pow(Math.random(), 2.5) * 8);
  }

  // Glare from a window, and the glass's edges catching the light.
  const glare = g.createLinearGradient(0, 0, PW, 0);
  glare.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  glare.addColorStop(0.03, 'rgba(255, 255, 255, 0.02)');
  glare.addColorStop(0.1, 'rgba(255, 255, 255, 0)');
  glare.addColorStop(0.14, 'rgba(255, 255, 255, 0.12)');
  glare.addColorStop(0.2, 'rgba(255, 255, 255, 0.03)');
  glare.addColorStop(0.24, 'rgba(255, 255, 255, 0)');
  glare.addColorStop(0.86, 'rgba(255, 255, 255, 0)');
  glare.addColorStop(0.9, 'rgba(255, 255, 255, 0.06)');
  glare.addColorStop(0.97, 'rgba(255, 255, 255, 0.02)');
  glare.addColorStop(1, 'rgba(255, 255, 255, 0.14)');
  g.fillStyle = glare;
  g.fillRect(0, 0, PW, PH);

  const vignette = g.createRadialGradient(PW / 2, PH * 0.45, Math.min(PW, PH) * 0.35, PW / 2, PH / 2, D * 0.62);
  vignette.addColorStop(0, 'rgba(20, 8, 0, 0)');
  vignette.addColorStop(1, 'rgba(20, 8, 0, 0.42)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, PW, PH);
  return glass;
}

function drawDrop(g, x, y, r) {
  const ry = r * 1.12;
  g.fillStyle = 'rgba(40, 18, 0, 0.16)';
  g.beginPath(); g.ellipse(x + r * 0.12, y + r * 0.25, r, ry, 0, 0, Math.PI * 2); g.fill();
  const body = g.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r * 1.1);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
  body.addColorStop(0.7, 'rgba(255, 255, 255, 0.1)');
  body.addColorStop(1, 'rgba(255, 255, 255, 0.38)');
  g.fillStyle = body;
  g.beginPath(); g.ellipse(x, y, r, ry, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.42, r * 0.26, r * 0.2, -0.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.35)';
  g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.55, r * 0.3, r * 0.12, 0.4, 0, Math.PI * 2); g.fill();
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
  const lumpy = Math.min(1, h / (PH * FOAM));
  return wave(x) - h
    + lumpy * (5 * Math.sin(x * 0.041 + clock * 0.5)
      + 3 * Math.sin(x * 0.113 - clock * 0.7)
      + 2 * Math.sin(x * 0.071 + 1.3));
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

  let drink = 0;
  if (state === 'refilling') {
    beer = Math.min(FULL, beer + REFILL_RATE * dt);
    foamExtra = Math.min(0.11, foamExtra + 0.22 * dt);
    if (beer >= FULL) {
      state = 'full';
      stopFizz();
    }
  } else if (beer > 0) {
    drink = Math.max(0, Math.min(beer - fits, DRINK_RATE * dt));
    beer -= drink;
    if (drink > 0) {
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
      burp();
    }
  }
  if (state !== 'refilling') foamExtra = Math.max(0, foamExtra - 0.012 * dt);
  flow += (drink / dt - flow) * Math.min(1, dt * 10);

  if (state === 'empty') {
    const upright = Math.abs(targetAngle) < UPRIGHT && gravityStrength > 0.5;
    uprightFor = upright ? uprightFor + dt : 0;
    if (uprightFor > 0.8) refill();
  }

  const level = beer > 0 ? surfaceFor(poly, beer * total) : Math.max(...poly.map(p => p.y)) + 50;
  updateBubbles(dt, level);
  updateLace(dt, level, drink > 0);
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
  if (beer > 0.01) {
    // Free-floating bubbles start deep and rise.
    const spawn = (state === 'refilling' ? 90 : 26) * dt;
    for (let n = spawn + Math.random(); n >= 1 && bubbles.length < 260; n--) {
      let x, y;
      if (state === 'refilling') {
        const p = toScreen((Math.random() - 0.5) * PW * 0.35, level + 20 + Math.random() * PH * 0.35);
        x = p.x; y = p.y;
      } else {
        x = Math.random() * PW;
        y = PH * (0.5 + Math.random() * 0.55);
      }
      if (inLiquid(x, y, level, 12)) bubbles.push(newBubble(x, y, 0.8 + Math.random() * 2.2));
    }
    // Nucleation sites on the glass send up steady chains of tiny bubbles.
    for (const s of sites) {
      s.wait -= dt;
      if (s.wait <= 0) {
        s.wait = 0.07 + Math.random() * 0.06;
        if (bubbles.length < 320 && inLiquid(s.x, s.y, level, 12)) {
          bubbles.push(newBubble(s.x, s.y, 0.6 + Math.random() * 0.5, true));
        }
      }
    }
  }
  const ux = -Math.sin(angle), uy = -Math.cos(angle); // "up" on screen
  bubbles = bubbles.filter(b => {
    b.age += dt;
    b.v += dt * 25;
    b.r *= 1 + dt * 0.12;
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
  if (draining && laceTimer <= 0 && beer > 0.02) {
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
    drawBeer(level);

    // Bubbles live in screen space; clip them to the liquid.
    ctx.beginPath();
    ctx.rect(-D, level, D * 2, D * 2);
    ctx.setTransform(base);
    ctx.clip();
    for (const b of bubbles) {
      const s = b.r * 2 * Math.min(1, b.age * 5);
      ctx.drawImage(sprites.bubble, b.x - s / 2, b.y - s / 2, s, s);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(PW / 2, PH / 2);
    ctx.rotate(-angle);
    drawFoam(level);
    ctx.restore();
  }

  ctx.setTransform(base);
  ctx.drawImage(sprites.glass, 0, 0, PW, PH);
  drawHud();
}

function drawEmptyGlass() {
  const bg = ctx.createLinearGradient(0, 0, 0, PH);
  bg.addColorStop(0, '#4a3b2c');
  bg.addColorStop(1, '#1e150e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PW, PH);
  for (const l of lace) {
    ctx.globalAlpha = Math.min(1, l.life * 1.6) * 0.75;
    ctx.drawImage(sprites.blob, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.globalAlpha = 1;
}

function drawBeer(level) {
  const body = ctx.createLinearGradient(0, level, 0, level + PH);
  body.addColorStop(0, '#fbc93f');
  body.addColorStop(0.12, '#f1a91e');
  body.addColorStop(0.55, '#d47d0d');
  body.addColorStop(1, '#8e4406');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-D, level + wave(-D));
  for (let x = -D; x <= D; x += 8) ctx.lineTo(x, level + wave(x));
  ctx.lineTo(D, level + D);
  ctx.lineTo(-D, level + D);
  ctx.closePath();
  ctx.fill();

  // Light coming through the glass from behind.
  ctx.save();
  ctx.clip();
  const lit = toWorld(PW * 0.4, PH * 0.35);
  const glow = ctx.createRadialGradient(lit.x, lit.y, 0, lit.x, lit.y, D * 0.5);
  glow.addColorStop(0, 'rgba(255, 228, 140, 0.38)');
  glow.addColorStop(1, 'rgba(255, 228, 140, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-D, level - 20, D * 2, D * 2);
  // Creamy haze where the head meets the beer.
  const haze = ctx.createLinearGradient(0, level, 0, level + 26);
  haze.addColorStop(0, 'rgba(255, 238, 190, 0.7)');
  haze.addColorStop(1, 'rgba(255, 238, 190, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(-D, level - 20, D * 2, 50);
  ctx.restore();
}

function drawFoam(level) {
  if (foamHeight() < 1) return;
  const step = 4;
  ctx.beginPath();
  ctx.moveTo(-D, level + foamTop(-D));
  for (let x = -D; x <= D; x += step) ctx.lineTo(x, level + foamTop(x));
  for (let x = D; x >= -D; x -= step) ctx.lineTo(x, level + wave(x) + 3);
  ctx.closePath();

  const h = foamHeight();
  const shade = ctx.createLinearGradient(0, level - h - 10, 0, level + 4);
  shade.addColorStop(0, '#fffdf7');
  shade.addColorStop(0.55, '#f7ead0');
  shade.addColorStop(1, '#e5c47e');
  ctx.fillStyle = shade;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = sprites.foam;
  ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  ctx.globalAlpha = 1;
  // Shadow under the domed top, so the head has some depth.
  const depth = ctx.createLinearGradient(0, level - h, 0, level + 4);
  depth.addColorStop(0, 'rgba(255, 255, 255, 0)');
  depth.addColorStop(0.6, 'rgba(160, 110, 40, 0.08)');
  depth.addColorStop(1, 'rgba(150, 90, 20, 0.28)');
  ctx.fillStyle = depth;
  ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  ctx.restore();

  // Soft froth line under the head.
  for (let x = -D; x <= D; x += 13) {
    const r = 5 + 4 * Math.sin(x * 1.7);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(sprites.blob, x - r, level + wave(x) + 1 - r * 0.6, r * 2, r * 1.4);
  }
  ctx.globalAlpha = 1;

  // Bright rim along the top of the head.
  ctx.beginPath();
  for (let x = -D; x <= D; x += step) ctx.lineTo(x, level + foamTop(x) + 1.5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// A stream pouring in from the top edge during a refill.
function drawPour(level) {
  const surface = toScreen(0, level).y - foamHeight();
  const x = PW / 2 + Math.sin(clock * 7) * 2;
  const w = Math.max(14, PW * 0.06);
  const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  grad.addColorStop(0, '#b8620a');
  grad.addColorStop(0.3, '#f4b52a');
  grad.addColorStop(0.45, '#ffe08a');
  grad.addColorStop(0.6, '#f2ab20');
  grad.addColorStop(1, '#a85608');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.6, -5);
  ctx.lineTo(x + w * 0.6, -5);
  ctx.lineTo(x + w * 0.45, Math.max(0, surface) + 30);
  ctx.lineTo(x - w * 0.45, Math.max(0, surface) + 30);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < 6; i++) {
    const y = ((clock * 900 + i * 137) % Math.max(1, surface));
    ctx.drawImage(sprites.bubble, x - 3 + Math.sin(i * 3 + clock * 9) * w * 0.2, y, 5, 5);
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

function loadCount() {
  try { return Number(localStorage.getItem('beer.count')) || 0; } catch { return 0; }
}

function saveCount() {
  try { localStorage.setItem('beer.count', String(beersDrunk)); } catch { /* ignore */ }
}

// ---------- boot ----------

document.getElementById('start-btn').addEventListener('click', start);
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
