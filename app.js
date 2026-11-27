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
    glow: 'rgba(255, 224, 102, 0.42)', glowAt: 'center', band: '255, 215, 90', bandAlpha: 0.35,
    walls: 'dark', edge: '158, 68, 4', milk: 0,
    foam: 0.075, foamShade: ['#fffaf0', '#f6e9cc', '#e2c48a'], speck: '255, 255, 255', grain: '190, 150, 90',
    headScale: 0.3, headLift: 0.22, rise: [16, 38], seam: '232, 184, 74', fresh: 0.11, fizz: 1, drops: 1, burp: true, pour: ['#c06a0e', '#f4b52a', '#ffe08a'],
  },
  butterbeer: {
    title: 'BUTTERBEER', unit: ['butterbeer', 'butterbeers'], head: 'cream',
    body: ['#ecb055', '#cf8a30', '#8f4a10', '#4a2005'],
    glow: 'rgba(255, 214, 120, 0.34)', glowAt: 'center', band: '255, 236, 200', bandAlpha: 0,
    walls: 'dark', edge: '80, 40, 8', milk: 0.06, cloudy: true,
    foam: 0.07, foamShade: ['#fffdf8', '#f6ead0', '#e6cb92'], speck: '255, 252, 242', grain: '214, 176, 116',
    headScale: 0.48, headWash: 'rgba(239, 227, 196, 0.45)', rise: [4, 0], swirl: true, seam: '243, 213, 155', fresh: 0.04, fizz: 0.45, drops: 1, burp: true, pour: ['#a8681e', '#e9b45c', '#fbe0a8'],
  },
  rootbeer: {
    title: 'ROOT BEER', unit: ['root beer', 'root beers'], head: 'foam',
    body: ['#3a1206', '#1e0802', '#0f0401', '#070100'],
    glow: 'rgba(150, 60, 24, 0.55)', glowAt: 'surface', glowDepth: 60, band: '200, 120, 70', bandAlpha: 0,
    walls: 'lit', edge: '122, 40, 10', milk: 0, bubbleTint: '232, 168, 104',
    foam: 0.07, foamShade: ['#eed8b0', '#d8b886', '#b88e5a'], speck: '250, 238, 214', grain: '150, 100, 50',
    headScale: 0.3, rise: [14, 30], darkMask: true, seam: '184, 124, 66', fresh: 0.07, fizz: 0.9, drops: 1, burp: true, pour: ['#1a0602', '#4a1a08', '#9a4a24'],
  },
  wine: {
    title: 'WINE', unit: ['glass of wine', 'glasses of wine'], head: 'none',
    body: ['#6e0a1c', '#4a0614', '#3a0410', '#1a0207'],
    glow: 'rgba(158, 18, 52, 0.55)', glowAt: 'surface', glowDepth: 110, ruby: true, band: '140, 30, 60', bandAlpha: 0,
    walls: 'lit', edge: '94, 15, 32', milk: 0, legs: true, photoAlpha: 0.3, photoShade: 'rgba(34, 0, 10, 0.2)', caustic: '200, 40, 70',
    foam: 0, fresh: 0, fizz: 0, drops: 0, burp: false, pour: ['#3a0410', '#7a0e2a', '#d04a68'],
  },
  coffee: {
    title: 'COFFEE', unit: ['coffee', 'coffees'], head: 'crema',
    body: ['#24120a', '#160a04', '#0d0602', '#060200'],
    glow: 'rgba(74, 34, 11, 0.8)', glowAt: 'surface', glowDepth: 60, band: '150, 95, 55', bandAlpha: 0,
    walls: 'lit', edge: '90, 42, 14', milk: 0,
    foam: 0.014, foamShade: ['#c48a52', '#a8703e', '#8a552a'], speck: '217, 166, 106', grain: '90, 50, 20',
    headScale: 0.12, headTint: 'rgba(120, 61, 20, 0.3)', bodyTint: 'rgba(20, 8, 2, 0.3)', caustic: '138, 74, 34', fresh: 0.003, fizz: 0, drops: 0, steam: true, burp: false, pour: ['#0d0602', '#2b1608', '#6a3e1e'],
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
let baseMatrix = null;
const TEX = {};         // photo textures: body, head, condensation
let headPattern = null; // the head photo, made seamless so it tiles
let bodyTile = null;    // the body photo, made seamless vertically, for scrolling
let bodyPattern = null;
let foamShift = 0;      // how far the head has slid sideways with the slosh
let liquidShift = 0;    // the same for the liquid photo
let pops = [];
let slides = [];
let slideTimer = 2;
let seamDots = [];
let edgeBeads = [];

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
  sites = Array.from({ length: 6 }, (_, i) => ({
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
  const tint = drink.bubbleTint || '255, 251, 230';
  bg.addColorStop(0.9, `rgba(${tint}, 0.75)`);
  bg.addColorStop(1, `rgba(${tint}, 0)`);
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

  // Root beer's loose head has coarse, tan-rimmed bubbles at its base.
  foamCells = [];
  if (drinkName === 'rootbeer') {
    for (let c = 0; c < 60; c++) {
      const u = Math.random(), dy = Math.pow(Math.random(), 1.3);
      const n = 4 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n; i++) {
        foamCells.push({ u: u + (Math.random() - 0.5) * 0.012, dy: Math.max(0, dy + (Math.random() - 0.5) * 0.12), r: 1 + Math.random() * 3.5 });
      }
    }
  }
  // Fine bright bubbles packed just under a beer head.
  seamDots = drink.head === 'foam'
    ? Array.from({ length: 420 }, () => ({ u: Math.random(), dy: Math.pow(Math.random(), 2) * 18, r: 0.5 + Math.random() * 1 }))
    : [];
  // Coffee: small bubbles where the surface meets the glass.
  edgeBeads = drink.head === 'crema'
    ? Array.from({ length: 26 }, (_, i) => ({ side: i % 2, d: Math.pow(Math.random(), 1.5) * 30, dy: Math.random() * 4, r: 1 + Math.random() * 1.5 }))
    : [];

  return {
    bubble, blob, foam: drink.head === 'none' ? null : buildHeadPattern(),
    glass: buildGlass(), room: buildRoom(), legs: drink.legs ? buildLegs() : null,
  };
}

// Wine legs: thin tears running down the inside of the glass, each ending
// in a small lit bead.
function buildLegs() {
  const [legs, g] = makeCanvas(PW, PH);
  for (let i = 0; i < 12; i++) {
    const x = PW * (0.06 + 0.88 * ((i * 0.618 + 0.21) % 1));
    const y0 = PH * (0.02 + Math.random() * 0.12);
    const len = 25 + Math.random() * 45;
    const w = 1 + Math.random() * 1.2;
    const tear = g.createLinearGradient(0, y0, 0, y0 + len);
    tear.addColorStop(0, 'rgba(176, 36, 72, 0)');
    tear.addColorStop(1, 'rgba(176, 36, 72, 0.12)');
    g.strokeStyle = tear;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y0);
    g.quadraticCurveTo(x + (Math.random() - 0.5) * 4, y0 + len / 2, x + (Math.random() - 0.5) * 2, y0 + len);
    g.stroke();
    const by = y0 + len + 1;
    g.fillStyle = 'rgba(160, 40, 70, 0.16)';
    g.beginPath(); g.ellipse(x, by, w + 0.4, w + 0.8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 220, 228, 0.35)';
    g.beginPath(); g.arc(x - 0.4, by - 0.6, 0.6, 0, Math.PI * 2); g.fill();
  }
  return legs;
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
    const tones = ['230, 184, 130', '156, 89, 36', '92, 44, 14', '212, 155, 99'];
    for (let i = 0; i < 110; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const rx = 8 + Math.random() * 12, ry = 1 + Math.random();
      const tone = tones[i % tones.length];
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        t.save();
        t.translate(x + ox, y + oy);
        t.scale(1, ry / rx);
        const g = t.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, `rgba(${tone}, 0.45)`);
        g.addColorStop(1, `rgba(${tone}, 0)`);
        t.fillStyle = g;
        t.fillRect(-rx, -rx, rx * 2, rx * 2);
        t.restore();
      }
    }
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

// What you see through the empty part of the glass: a dim, blurred bar,
// with a window and a couple of lights.
function buildRoom() {
  const [room, g] = makeCanvas(PW, PH);
  const bg = g.createLinearGradient(0, 0, 0, PH);
  bg.addColorStop(0, '#625b54');
  bg.addColorStop(0.5, '#3a3530');
  bg.addColorStop(1, '#161311');
  g.fillStyle = bg;
  g.fillRect(0, 0, PW, PH);
  const soft = (cx, cy, rx, ry, rgb, a) => {
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    sg.addColorStop(0, `rgba(${rgb}, ${a})`);
    sg.addColorStop(0.5, `rgba(${rgb}, ${a * 0.6})`);
    sg.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = sg;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  };
  // A window: a bright soft rectangle with faint glazing bars.
  {
    const wx = PW * 0.5, wy = PH * 0.02, ww = PW * 0.44, wh = PH * 0.22;
    for (let i = 18; i >= 0; i--) {
      const grow = i * 2.5 - 12;
      g.fillStyle = 'rgba(207, 216, 224, 0.022)';
      g.beginPath();
      g.roundRect(wx - grow, wy - grow, ww + grow * 2, wh + grow * 2, Math.max(2, 10 + grow));
      g.fill();
    }
    const bar = (x, y, w, h) => {
      const bgx = w < h ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
      bgx.addColorStop(0, 'rgba(40, 38, 36, 0)');
      bgx.addColorStop(0.5, 'rgba(40, 38, 36, 0.12)');
      bgx.addColorStop(1, 'rgba(40, 38, 36, 0)');
      g.fillStyle = bgx;
      g.fillRect(x, y, w, h);
    };
    bar(wx + ww / 2 - 8, wy, 16, wh);
    bar(wx, wy + wh * 0.48 - 7, ww, 14);
  }
  soft(PW * 0.2, PH * 0.07, 70, 55, '255, 200, 130', 0.3);               // bar light
  soft(PW * 0.48, PH * 0.3, 110, 80, '255, 190, 120', 0.12);
  soft(PW * 0.1, PH * 0.4, 60, 60, '255, 210, 150', 0.1);
  soft(PW * 0.88, PH * 0.5, 80, 70, '255, 200, 140', 0.08);
  return room;
}

// The glass in front of the drink: condensation (cold drinks only), the
// curved walls catching light, and a vignette.
function buildGlass() {
  const [glass, g] = makeCanvas(PW, PH);

  if (drink.drops) {
    // Fine frost, thicker toward the edges and bottom.
    for (let i = 0; i < 3600; i++) {
      const x = Math.random() * PW, y = Math.random() * PH;
      const edge = Math.min(1, Math.abs(x - PW / 2) / (PW / 2) + y / PH * 0.4);
      if (Math.random() > 0.3 + edge * 0.7) continue;
      g.fillStyle = `rgba(255, 255, 255, ${0.015 + Math.random() * 0.025})`;
      g.fillRect(x, y, 0.8, 0.8);
    }
    // Beads come from the condensation photo; keep only a few stray ones.
    for (let c = 0; c < 0; c++) {
      const cx = Math.random() < 0.6 ? (Math.random() < 0.5 ? 0.08 : 0.92) * PW : Math.random() * PW;
      const cy = PH * (0.15 + Math.random() * 0.85);
      const spread = 40 + Math.random() * 80;
      const n = 30 + Math.random() * 50;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.7) * spread;
        drawBead(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.3, 0.5 + Math.pow(Math.random(), 3) * 1.7);
      }
    }
    // A few bigger drops that ran a short way, wiping a clear track in the frost.
    for (let i = 0; i < 0; i++) {
      const x = Math.random() * PW, y = PH * (0.3 + Math.random() * 0.68);
      const r = 2.4 + Math.random() * 1.8;
      const len = 10 + Math.random() * 22;
      const track = g.createLinearGradient(0, y - len, 0, y);
      track.addColorStop(0, 'rgba(0, 0, 0, 0)');
      track.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
      g.globalCompositeOperation = 'destination-out';
      g.strokeStyle = track;
      g.lineWidth = r * 1.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + Math.sin(i) * 2, y - len);
      g.quadraticCurveTo(x - 2, y - len / 2, x, y);
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      drawBead(g, x, y, r);
    }
  }

  // Curved walls: refraction darkens the very edges, a crisp highlight runs
  // just inside each one, and a faint streak sits a little in from the left.
  const dark = g.createLinearGradient(0, 0, PW, 0);
  dark.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  dark.addColorStop(0.03, 'rgba(0, 0, 0, 0)');
  dark.addColorStop(0.97, 'rgba(0, 0, 0, 0)');
  dark.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  g.fillStyle = dark;
  g.fillRect(0, 0, PW, PH);
  // Bell-curve highlights, fading toward the top and bottom.
  const streak = (x, w, a) => {
    const v = g.createLinearGradient(0, 0, 0, PH);
    v.addColorStop(0, 'rgba(0, 0, 0, 1)');
    v.addColorStop(0.2, 'rgba(0, 0, 0, 0)');
    v.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 1)');
    const [band, bg2] = makeCanvas(w, PH);
    const hh = bg2.createLinearGradient(0, 0, w, 0);
    hh.addColorStop(0, 'rgba(255, 255, 255, 0)');
    hh.addColorStop(0.5, `rgba(255, 255, 255, ${a})`);
    hh.addColorStop(1, 'rgba(255, 255, 255, 0)');
    bg2.fillStyle = hh;
    bg2.fillRect(0, 0, w, PH);
    bg2.globalCompositeOperation = 'destination-out';
    bg2.fillStyle = v;
    bg2.fillRect(0, 0, w, PH);
    g.drawImage(band, x - w / 2, 0, w, PH);
  };
  streak(PW * 0.035, 3, 0.26);   // crisp rim glint on the left
  streak(PW * 0.07, 10, 0.05);
  streak(PW * 0.9, 26, 0.12);    // a broad soft reflection on the right
  streak(PW * 0.975, 2, 0.12);

  const vignette = g.createRadialGradient(PW / 2, PH * 0.45, Math.min(PW, PH) * 0.4, PW / 2, PH / 2, D * 0.62);
  vignette.addColorStop(0, 'rgba(20, 8, 0, 0)');
  vignette.addColorStop(1, 'rgba(20, 8, 0, 0.3)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, PW, PH);
  return glass;
}

// A water bead on vertical glass: slightly taller than wide, a faint dark rim
// at the top, lit lower half, a pin of highlight.
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
  return Math.sin(x * 0.009 + clock * 4) * slosh * 10
    + Math.sin(x * 0.047 - clock * 2.1) * (0.4 + slosh * 4);
}

function foamTop(x) {
  const h = foamHeight();
  const k = FOAM ? Math.min(1, h / (PH * FOAM)) : 0;
  if (drink.head === 'crema') {
    return wave(x) - h - k * 0.5 * Math.sin(x * 0.03 + 0.4);
  }
  if (drink.head === 'cream') {
    return wave(x) - h + k * (7 * Math.sin(x * 0.011 + clock * 0.15) + 3.5 * Math.sin(x * 0.029 + 2.2) + 1.2 * Math.sin(x * 0.083));
  }
  // A loose root beer head varies a lot in thickness.
  const loose = drinkName === 'rootbeer' ? h * 0.35 * Math.sin(x * 0.0075 + 1.1) + h * 0.15 * Math.sin(x * 0.019 + clock * 0.2) : 0;
  return wave(x) - h + loose + k * (3.2 * Math.sin(x * 0.023 + clock * 0.3 + 1)
    + 2.2 * Math.sin(x * 0.061 - clock * 0.45)
    + 1.3 * Math.sin(x * 0.137 + 2.1)
    + 0.8 * Math.sin(x * 0.29 + 0.7));
}

// Without a head, the surface curls up a few pixels where it meets the glass.
function surfaceAt(level, x) {
  const curl = FOAM ? 0 : 6 * (Math.exp(-Math.max(0, x - surfL) / 7) + Math.exp(-Math.max(0, surfR - x) / 7));
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
  updateAlive(dt, level);
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
        // Irregular spacing, with the odd pause, so chains don't look dotted.
        s.wait = (0.05 + Math.random() * 0.14 + (Math.random() < 0.15 ? 0.4 : 0)) / drink.fizz;
        const x = s.x + (Math.random() - 0.5) * 3;
        if (bubbles.length < 320 && inLiquid(x, s.y, level, 12)) {
          bubbles.push(newBubble(x, s.y, 0.35 + Math.random() * 0.25, true));
        }
      }
    }
  }
  const ux = -Math.sin(angle), uy = -Math.cos(angle); // "up" on screen
  bubbles = bubbles.filter(b => {
    b.age += dt;
    b.v += dt * 25;
    b.r = Math.min(b.chain ? 1.3 : 2, b.r * (1 + dt * (b.chain ? 0.4 : 0.08)));
    const wob = Math.sin(b.age * (b.chain ? 5 : 9) + b.phase) * (b.chain ? 4 : 10) * dt;
    b.x += ux * b.v * dt - uy * wob;
    b.y += uy * b.v * dt + ux * wob;
    return b.x > -10 && b.x < PW + 10 && b.y > -10 && b.y < PH + 10
      && inLiquid(b.x, b.y, level, b.r + 2);
  });
}

function newBubble(x, y, r, chain = false) {
  return { x, y, r, v: chain ? 55 : 35 + Math.random() * 60, age: 0, phase: Math.random() * 6, chain };
}

// Foam clings to the glass as the level drops, in ragged little clusters.
// Small things that keep a still glass alive: the head and liquid slide with
// the slosh, foam bubbles pop, and condensation drops now and then run down.
function updateAlive(dt, level) {
  foamShift += angleV * dt * 70;
  liquidShift += (-angleV * 22 - liquidShift) * Math.min(1, dt * 3);
  if (FOAM > 0.03 && beer > 0.02 && Math.random() < dt * 10) {
    pops.push({ x: (Math.random() - 0.5) * PW * 1.2, t: 0, r: 0.8 + Math.random() * 1.6 });
  }
  pops = pops.filter(p => (p.t += dt) < 0.25);
  if (drink.drops) {
    slideTimer -= dt;
    if (slideTimer <= 0) {
      slideTimer = 3 + Math.random() * 5;
      const x = PW * (0.08 + Math.random() * 0.84), y = PH * (0.1 + Math.random() * 0.5);
      slides.push({ x, y0: y, y, r: 2.5 + Math.random() * 1.5, v: 0, go: 0.4, life: 1 });
    }
    for (const d of slides) {
      // Stop-start, the way a drop runs down glass.
      d.go -= dt;
      if (d.go <= 0) { d.go = 0.2 + Math.random() * 0.8; d.v = Math.random() < 0.35 ? 0 : 40 + Math.random() * 60; }
      d.y += d.v * dt;
      if (d.y > PH + 10 || d.y - d.y0 > PH * 0.35) d.life -= dt;
      d.life -= dt / 40;
    }
    slides = slides.filter(d => d.life > 0);
  }
}

function drawPops(level) {
  for (const p of pops) {
    const y = level + foamTop(p.x) + 1.5;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * (1 - p.t / 0.25)})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(p.x, y, p.r * (1 + p.t * 6), 0, Math.PI * 2); ctx.stroke();
  }
}

function drawSlides() {
  for (const d of slides) {
    const a = Math.min(1, d.life);
    const track = ctx.createLinearGradient(0, d.y0, 0, d.y);
    track.addColorStop(0, 'rgba(255, 255, 255, 0)');
    track.addColorStop(1, `rgba(255, 255, 255, ${0.1 * a})`);
    ctx.strokeStyle = track;
    ctx.lineWidth = d.r * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(d.x, d.y0); ctx.lineTo(d.x + Math.sin(d.y * 0.05) * 1.5, d.y); ctx.stroke();
    ctx.globalAlpha = a;
    drawBead(ctx, d.x + Math.sin(d.y * 0.05) * 1.5, d.y, d.r);
    ctx.globalAlpha = 1;
  }
}

function updateLace(dt, level, draining) {
  laceTimer -= dt;
  if (draining && laceTimer <= 0 && beer > 0.02 && FOAM > 0.03) {
    laceTimer = 0.12;
    for (let c = 0; c < 4; c++) {
      const wx = (Math.random() - 0.5) * D;
      const p = toScreen(wx, level - foamHeight() * (0.3 + Math.random() * 0.6));
      if (p.x < 0 || p.x > PW || p.y < 0 || p.y > PH) continue;
      const n = 5 + Math.floor(Math.random() * 8);
      const span = 8 + Math.random() * 22;
      for (let i = 0; i < n; i++) {
        lace.push({
          x: p.x + (Math.random() - 0.5) * span * 2,
          y: p.y + (Math.random() - 0.5) * 5 - Math.sin(i / n * Math.PI) * 3,
          r: 1.4 + Math.random() * 2, life: 1,
        });
      }
    }
    if (lace.length > 1600) lace.splice(0, lace.length - 1600);
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
  baseMatrix = base;

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
    drawPops(level);
    ctx.restore();
  }

  ctx.setTransform(base);
  if (TEX.condensation) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.8;
    // Flip it per drink so each glass has its own drops.
    const flip = { beer: [1, 1], butterbeer: [-1, 1], rootbeer: [-1, 1] }[drinkName] || [1, 1];
    ctx.save();
    ctx.translate(flip[0] < 0 ? PW : 0, flip[1] < 0 ? PH : 0);
    ctx.scale(flip[0], flip[1]);
    drawCover(TEX.condensation);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  drawSlides();
  ctx.drawImage(sprites.glass, 0, 0, PW, PH);
  drawHud();
}

function drawEmptyGlass() {
  ctx.drawImage(sprites.room, 0, 0, PW, PH);
  if (sprites.legs) ctx.drawImage(sprites.legs, 0, 0, PW, PH);
  for (const l of lace) {
    ctx.globalAlpha = Math.min(1, l.life * 1.6) * 0.85;
    ctx.drawImage(sprites.blob, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
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
  const photo = !!TEX.body;
  if (photo) {
    ctx.globalAlpha = drink.photoAlpha ?? 1;
    drawLiveBody(level);
    ctx.globalAlpha = 1;
    if (drink.photoShade) {
      ctx.fillStyle = drink.photoShade;
      ctx.fillRect(-D, level - 20, D * 2, D * 2);
    }
    // A little darker with depth.
    const deep = ctx.createLinearGradient(0, level, 0, level + PH);
    deep.addColorStop(0, 'rgba(0, 0, 0, 0)');
    deep.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.fillStyle = deep;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
  }
  // Light coming through from behind: in the body for pale drinks, only
  // near the surface for dark ones.
  if (photo && drink.glowAt === 'center') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  } else if (drink.glowAt === 'center') {
    const lit = toWorld(PW * 0.42, PH * 0.4);
    const glow = ctx.createRadialGradient(lit.x, lit.y, 0, lit.x, lit.y, D * 0.45);
    glow.addColorStop(0, drink.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
  } else {
    const glow = ctx.createLinearGradient(0, level, 0, level + drink.glowDepth);
    glow.addColorStop(0, drink.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
  }
  ctx.fillRect(-D, level - 20, D * 2, D * 2);
  if (drink.milk && !photo) {
    ctx.fillStyle = `rgba(255, 235, 200, ${drink.milk})`;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
  }
  // Butterbeer is cloudy: big faint patches drifting in the body.
  if (drink.cloudy && !photo) {
    for (let i = 0; i < 6; i++) {
      const x = Math.sin(i * 2.4 + clock * 0.05) * PW * 0.4;
      const y = level + 80 + ((i * 0.37) % 1) * PH * 0.6;
      const r = 60 + (i * 23) % 40;
      const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = i % 2 ? '229, 189, 127' : '182, 124, 67';
      cg.addColorStop(0, `rgba(${tone}, 0.14)`);
      cg.addColorStop(1, `rgba(${tone}, 0)`);
      ctx.fillStyle = cg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  if (drink.ruby) {
    // Light through the wine, off to one side, and a lighter band under the surface.
    const lit = toWorld(PW * 0.72, PH * 0.42);
    const rg = ctx.createRadialGradient(lit.x, lit.y, 0, lit.x, lit.y, PW * 0.6);
    rg.addColorStop(0, 'rgba(160, 26, 52, 0.3)');
    rg.addColorStop(1, 'rgba(160, 26, 52, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
    const under = ctx.createLinearGradient(0, level + 3, 0, level + 21);
    under.addColorStop(0, 'rgba(20, 1, 6, 0.75)');
    under.addColorStop(0.2, 'rgba(158, 18, 52, 0.5)');
    under.addColorStop(1, 'rgba(158, 18, 52, 0)');
    ctx.fillStyle = under;
    ctx.fillRect(-D, level + 3, D * 2, 18);
  }
  if (drink.bandAlpha) {
    // A bright band just under the surface, where light comes through the head.
    const band = ctx.createLinearGradient(0, level, 0, level + 30);
    band.addColorStop(0, `rgba(${drink.band}, ${drink.bandAlpha})`);
    band.addColorStop(1, `rgba(${drink.band}, 0)`);
    ctx.fillStyle = band;
    ctx.fillRect(-D, level - 20, D * 2, 60);
  }
  ctx.restore();
}

// The body photo, alive: bubbles rise (two layers, for depth), swirls drift,
// light wanders, and the whole liquid slides a little with the slosh.
function drawLiveBody(level) {
  if (!bodyPattern || !bodyPattern.setTransform) { drawCover(TEX.body); return; }
  // In the liquid frame, so bubbles rise against gravity and swirls hang
  // with it however the phone is held.
  const m = ctx.getTransform();
  const img = bodyTile;
  const k = Math.max(PW / img.width, PH / img.height);
  const th = img.height * k;
  const [rise, rise2] = drink.rise || [0, 0];
  const layer = (scale, speed, phase, swayX, swayY) => {
    const y = -((clock * speed + phase) % (th * scale)) + Math.sin(clock * 0.13 + phase) * swayY;
    bodyPattern.setTransform(new DOMMatrix().translate(liquidShift + Math.sin(clock * 0.11 + phase) * swayX, y).scale(k * scale));
    ctx.fillStyle = bodyPattern;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
  };
  ctx.globalAlpha = drink.photoAlpha ?? 1;
  layer(1, rise, 0, drink.swirl ? 22 : 3, drink.swirl ? 16 : 0);
  if (rise2) {
    // A nearer, faster layer of bubbles.
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.14;
    layer(1.45, rise2, th * 0.37, 4, 0);
  } else if (drink.swirl) {
    // A second copy drifting the other way, so the swirls change shape.
    ctx.globalAlpha = 0.45;
    layer(1.15, -6, th * 0.5, -26, 18);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Glass-fixed effects, in screen space.
  ctx.setTransform(baseMatrix);
  if (drink.bodyTint) {
    ctx.fillStyle = drink.bodyTint;
    ctx.fillRect(0, 0, PW, PH);
  }
  if (drink.caustic) {
    // Soft patches of light wandering through still liquid, visibly moving.
    for (let i = 0; i < 3; i++) {
      const x = PW * (0.5 + 0.42 * Math.sin(clock * (0.35 + i * 0.12) + i * 2.1) + liquidShift / PW);
      const y = PH * (0.45 + 0.32 * Math.sin(clock * (0.27 + i * 0.09) + i * 1.3));
      const r = PW * (0.4 + 0.12 * i);
      const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, `rgba(${drink.caustic}, ${i ? 0.14 : 0.22})`);
      cg.addColorStop(1, `rgba(${drink.caustic}, 0)`);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, PW, PH);
    }
  }
  if (drink.darkMask) {
    // Root beer is nearly black: fizz shows near the surface and the walls.
    const v = ctx.createLinearGradient(0, 0, 0, PH);
    v.addColorStop(0, 'rgba(20, 5, 2, 0.2)');
    v.addColorStop(0.35, 'rgba(20, 5, 2, 0.75)');
    v.addColorStop(1, 'rgba(20, 5, 2, 0.85)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, PW, PH);
    const h = ctx.createLinearGradient(0, 0, PW, 0);
    h.addColorStop(0, 'rgba(122, 40, 10, 0.5)');
    h.addColorStop(0.14, 'rgba(122, 40, 10, 0)');
    h.addColorStop(0.86, 'rgba(122, 40, 10, 0)');
    h.addColorStop(1, 'rgba(122, 40, 10, 0.5)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, PW, PH);
  }
  ctx.setTransform(m);
}

// Curved glass: pale drinks darken toward the side walls; dark drinks show
// their colour where the liquid is thin, so their edges glow.
function drawWallsInLiquid() {
  const side = ctx.createLinearGradient(0, 0, PW, 0);
  const a = drink.walls === 'lit' ? 0.5 : 0.45;
  const w = drink.walls === 'lit' ? 0.17 : 0.12;
  side.addColorStop(0, `rgba(${drink.edge}, ${a})`);
  side.addColorStop(w, `rgba(${drink.edge}, 0)`);
  side.addColorStop(1 - w, `rgba(${drink.edge}, 0)`);
  side.addColorStop(1, `rgba(${drink.edge}, ${a})`);
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
  const crema = drink.head === 'crema';

  // Wet transition from liquid into head: an irregular soft band.
  if (!crema) {
    const wet = ctx.createLinearGradient(0, level - 2, 0, level + (drink.head === 'cream' ? 16 : 10));
    wet.addColorStop(0, `rgba(${drink.seam}, 0.55)`);
    wet.addColorStop(1, `rgba(${drink.seam}, 0)`);
    ctx.fillStyle = wet;
    ctx.fillRect(-D, level - 2, D * 2, 20);
  } else {
    const soft = ctx.createLinearGradient(0, level, 0, level + 8);
    soft.addColorStop(0, 'rgba(102, 51, 16, 0.55)');
    soft.addColorStop(1, 'rgba(102, 51, 16, 0)');
    ctx.fillStyle = soft;
    ctx.fillRect(-D, level, D * 2, 8);
  }
  for (const d of seamDots) {
    const x = -D + d.u * D * 2;
    ctx.fillStyle = 'rgba(255, 248, 220, 0.45)';
    ctx.beginPath(); ctx.arc(x, level + wave(x) + 3 + d.dy, d.r, 0, Math.PI * 2); ctx.fill();
  }
  // Cream bleeds down into butterbeer in soft tendrils.
  if (drink.head === 'cream') {
    for (let i = 0; i < 12; i++) {
      const x = -D * 0.6 + i * D * 0.11 + Math.sin(i * 3.7) * 30;
      const len = 35 + (i * 13) % 30;
      const w = 8 + (i % 3) * 5;
      ctx.save();
      ctx.translate(x, level);
      ctx.scale(w / len, 1);
      const tg = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
      tg.addColorStop(0, 'rgba(247, 223, 176, 0.38)');
      tg.addColorStop(1, 'rgba(243, 213, 155, 0)');
      ctx.fillStyle = tg;
      ctx.fillRect(-len, 0, len * 2, len);
      ctx.restore();
    }
  }

  headPath(level, crema ? 6 : 6);
  const shade = ctx.createLinearGradient(0, level - h - 8, 0, level + 3);
  shade.addColorStop(0, drink.foamShade[0]);
  shade.addColorStop(0.6, drink.foamShade[1]);
  shade.addColorStop(1, drink.foamShade[2]);
  ctx.fillStyle = shade;
  ctx.fill();

  ctx.save();
  ctx.clip();
  if (headPattern && headPattern.setTransform) {
    const k = drink.headScale;
    headPattern.setTransform(new DOMMatrix().translate(foamShift + clock * 1.5, level - h - 40 * k * 3).scale(k));
    ctx.fillStyle = headPattern;
  } else {
    ctx.fillStyle = sprites.foam;
  }
  ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  if (headPattern && drink.headWash) {
    ctx.fillStyle = drink.headWash;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  }
  if (headPattern && drink.headTint) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = drink.headTint;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (headPattern && drink.headLift) {
    // Lift the photo's grey cast toward lit white foam, brightest at the top.
    const lift = ctx.createLinearGradient(0, level - h, 0, level);
    lift.addColorStop(0, `rgba(246, 241, 226, ${drink.headLift * 1.6})`);
    lift.addColorStop(1, `rgba(233, 220, 182, ${drink.headLift * 0.8})`);
    ctx.fillStyle = lift;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  }
  if (drink.head === 'cream' && !headPattern) {
    // Overlapping soft lobes: lit tops, shaded undersides.
    for (let x = -D; x <= D; x += 17 + 13 * Math.abs(Math.sin(x * 0.7))) {
      const r = 10 + 8 * Math.abs(Math.sin(x * 0.13));
      const y = level + foamTop(x) + r * 0.9;
      const lit = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r * 1.3);
      lit.addColorStop(0, 'rgba(255, 253, 248, 0.4)');
      lit.addColorStop(1, 'rgba(255, 250, 238, 0)');
      ctx.fillStyle = lit;
      ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    }
  }
  if (!headPattern) for (const c of foamCells) {
    // Root beer: coarse cells with a shadowed lower rim and a lit top.
    const x = -D + c.u * D * 2;
    const y = level + wave(x) + 1 - c.dy * h * 0.4;
    ctx.fillStyle = 'rgba(90, 42, 12, 0.4)';
    ctx.beginPath(); ctx.arc(x, y + c.r * 0.25, c.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(232, 200, 154, 0.5)';
    ctx.beginPath(); ctx.arc(x, y, c.r * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 246, 229, 0.7)';
    ctx.beginPath(); ctx.arc(x - c.r * 0.35, y - c.r * 0.35, Math.max(0.4, c.r * 0.25), 0, Math.PI * 2); ctx.fill();
  }
  if (!crema) {
    // Shade toward the liquid, so the head has volume.
    const depth = ctx.createLinearGradient(0, level - h, 0, level + 3);
    depth.addColorStop(0, 'rgba(255, 255, 255, 0)');
    depth.addColorStop(0.65, 'rgba(120, 80, 30, 0.05)');
    depth.addColorStop(1, 'rgba(110, 70, 20, 0.16)');
    ctx.fillStyle = depth;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  }
  ctx.restore();

  // Feather the head's lower edge so the photo doesn't look cut out.
  if (headPattern) {
    const tone = crema ? '200, 147, 90' : drink.foamShade[1].match(/\w\w/g).map(h => parseInt(h, 16)).join(', ');
    const depth = crema ? 8 : 14;
    const fb = ctx.createLinearGradient(0, level + 4, 0, level + 6 + depth);
    fb.addColorStop(0, `rgba(${tone}, 0.75)`);
    fb.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = fb;
    ctx.fillRect(-D, level + 4, D * 2, depth + 2);
  }
  if (crema) {
    // Wet specular line on top, and tiny bubbles where it meets the glass.
    ctx.beginPath();
    for (let x = -D; x <= D; x += 4) ctx.lineTo(x, level + foamTop(x) + 0.8);
    ctx.strokeStyle = 'rgba(255, 241, 222, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const e of edgeBeads) {
      const x = e.side ? surfR - 3 - e.d : surfL + 3 + e.d;
      ctx.fillStyle = 'rgba(183, 124, 69, 0.6)';
      ctx.beginPath(); ctx.arc(x, level + foamTop(x) + 1 + e.dy, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 235, 210, 0.5)';
      ctx.beginPath(); ctx.arc(x - e.r * 0.3, level + foamTop(x) + 1 + e.dy - e.r * 0.3, e.r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // Soft light along the top.
    ctx.beginPath();
    for (let x = -D; x <= D; x += 4) ctx.lineTo(x, level + foamTop(x) + 1.2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = drink.head === 'cream' ? 1 : 1.5;
    ctx.stroke();
  }
}

// No head (wine): a soft translucent ruby ribbon along the surface, curling
// up at the glass, with a few soft elongated glints where light catches it.
function drawMeniscus(level) {
  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x));
  for (let x = D; x >= -D; x -= 4) ctx.lineTo(x, surfaceAt(level, x) + 9);
  ctx.closePath();
  const ribbon = ctx.createLinearGradient(0, level - 5, 0, level + 9);
  ribbon.addColorStop(0, 'rgba(200, 50, 84, 0.55)');
  ribbon.addColorStop(0.35, 'rgba(158, 26, 58, 0.3)');
  ribbon.addColorStop(1, 'rgba(74, 8, 25, 0)');
  ctx.fillStyle = ribbon;
  ctx.fill();

  ctx.beginPath();
  for (let x = -D; x <= D; x += 4) ctx.lineTo(x, surfaceAt(level, x) + 0.5);
  ctx.strokeStyle = 'rgba(255, 176, 192, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const left = Math.max(-D, surfL), right = Math.min(D, surfR);
  const span = right - left;
  for (const [f, len, a] of [[0.22, 70, 0.5], [0.58, 34, 0.35], [0.8, 90, 0.4]]) {
    const x = left + span * f;
    const y = surfaceAt(level, x) + 1.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 1.5 / len);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len / 2);
    g.addColorStop(0, `rgba(255, 220, 228, ${a})`);
    g.addColorStop(1, 'rgba(255, 220, 228, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-len / 2, -len / 2, len, len);
    ctx.restore();
  }
}

// Coffee: two or three faint plumes rising off the surface, built from soft
// puffs that widen and fade as they go.
function drawSteam(level) {
  const top = level - foamHeight();
  for (let i = 0; i < 3; i++) {
    const life = (clock / 5 + i * 0.33) % 1;
    const fade = Math.sin(life * Math.PI);
    const x0 = (i - 1) * PW * 0.28 + Math.sin(i * 7.1) * 25;
    const height = 140 + 90 * life;
    for (let k = 4; k <= height; k += 7) {
      const t = k / height;
      const x = x0 + Math.sin(k * 0.03 - clock * 1.1 + i * 2) * (3 + k * 0.14);
      const y = top - 4 - k;
      const r = 3 + t * 14;
      const a = 0.09 * fade * (1 - t) * Math.min(1, t * 5);
      const pg = ctx.createRadialGradient(x, y, 0, x, y, r);
      pg.addColorStop(0, `rgba(250, 246, 240, ${a})`);
      pg.addColorStop(1, 'rgba(250, 246, 240, 0)');
      ctx.fillStyle = pg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

// A stream pouring in from the top edge during a refill: tapering, with a
// specular thread, a dimple and droplets where it lands.
function drawPour(level) {
  const surface = Math.max(0, toScreen(0, level).y - foamHeight());
  const x = PW / 2 + Math.sin(clock * 7) * 1.5;
  const edge = (y, sign) => x + sign * (6.5 - 3 * Math.min(1, y / Math.max(1, surface)) + Math.sin(y * 0.04 - clock * 25) * 0.6);
  const grad = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.15, drink.pour[0]);
  grad.addColorStop(0.4, drink.pour[1]);
  grad.addColorStop(0.5, drink.pour[2]);
  grad.addColorStop(0.6, drink.pour[1]);
  grad.addColorStop(0.85, drink.pour[0]);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(edge(-5, -1), -5);
  for (let y = 0; y <= surface + 6; y += 10) ctx.lineTo(edge(y, 1), y);
  for (let y = surface + 6; y >= -5; y -= 10) ctx.lineTo(edge(y, -1), y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - 1, 0); ctx.lineTo(x - 0.5, surface); ctx.stroke();

  // Dimple and droplets.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath(); ctx.ellipse(x, surface + 2, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 8; i++) {
    const ph = (clock * 2.2 + i * 0.137) % 1;
    const dir = (i % 2 ? 1 : -1) * (6 + (i * 5) % 14);
    ctx.fillStyle = drink.pour[2];
    ctx.globalAlpha = 0.7 * (1 - ph);
    ctx.beginPath();
    ctx.arc(x + dir * ph, surface - 16 * ph * (1 - ph) * 4 + 2, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Concentric ripples, and churned foam where it lands in a head.
  for (let i = 0; i < 2; i++) {
    const ph = (clock * 1.5 + i * 0.5) % 1;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 * (1 - ph)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, surface + 2, 8 + ph * 26, 2 + ph * 4, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if (drink.head === 'foam' || drink.head === 'cream') {
    for (let i = 0; i < 12; i++) {
      const a = clock * 5 + i * 1.9;
      const r = 4 + 4 * Math.abs(Math.sin(a));
      ctx.globalAlpha = 0.5;
      ctx.drawImage(sprites.blob, x + Math.sin(a * 1.3) * 20 - r, surface - Math.abs(Math.cos(a)) * 7 - r * 0.5, r * 2, r);
    }
    ctx.globalAlpha = 1;
  }
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

// Photo textures for this drink. Until they load, the drawn gradients show.
function loadTextures() {
  const want = { body: `${drinkName}-body` };
  if (drink.head !== 'none') want.head = `${drinkName}-head`;
  if (drink.drops) want.condensation = 'condensation';
  for (const [key, file] of Object.entries(want)) {
    const img = new Image();
    img.onload = () => {
      TEX[key] = img;
      if (key === 'head') headPattern = buildHeadPattern2(img);
      if (key === 'body') {
        bodyTile = seamless(seamless(img, 'x'), 'y');
        bodyPattern = ctx.createPattern(bodyTile, 'repeat');
      }
    };
    img.src = `textures/${file}.jpg`;
  }
}

function buildHeadPattern2(img) {
  return ctx.createPattern(seamless(img, 'x'), 'repeat');
}

// Make an image tile without a visible seam along one axis: blend in a copy
// shifted by half a tile near the edges, where the plain copy would jump.
function seamless(img, axis) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const s = document.createElement('canvas');
  s.width = w; s.height = h;
  const sg = s.getContext('2d');
  if (axis === 'x') {
    sg.drawImage(img, -w / 2, 0); sg.drawImage(img, w / 2, 0);
  } else {
    sg.drawImage(img, 0, -h / 2); sg.drawImage(img, 0, h / 2);
  }
  const mask = axis === 'x' ? sg.createLinearGradient(0, 0, w, 0) : sg.createLinearGradient(0, 0, 0, h);
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(0.18, 'rgba(0, 0, 0, 0)');
  mask.addColorStop(0.82, 'rgba(0, 0, 0, 0)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 1)');
  sg.globalCompositeOperation = 'destination-in';
  sg.fillStyle = mask;
  sg.fillRect(0, 0, w, h);
  g.drawImage(s, 0, 0);
  return c;
}

// Draw an image to cover the portrait screen, in screen coordinates.
function drawCover(img) {
  const k = Math.max(PW / img.width, PH / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (PW - w) / 2, (PH - h) / 2, w, h);
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
loadTextures();
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
