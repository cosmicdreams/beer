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
const glCanvas = document.getElementById('gl');
let ctx = canvas.getContext('2d'); // swapped briefly to draw the head offscreen
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
    gl: { seamFizz: 1, ripple: 0.12, sigma: [0.16, 0.66, 2.2], back: [0.78, 0.64, 0.38], scatter: [0.02, 0.01, 0.0], bodyMix: 0.5, bodyGain: [0.98, 0.92, 0.82], flow: 0.012, caustic: [0.1, 0.08, 0.025], surfGlow: [0.12, 0.08, 0.0], surfGlowDepth: 40, tendrils: 0 },
    title: 'BEER', unit: ['beer', 'beers'], head: 'foam',
    body: ['#f9c53a', '#eea31c', '#cc760c', '#7a3a05'],
    glow: 'rgba(255, 224, 102, 0.42)', glowAt: 'center', band: '255, 215, 90', bandAlpha: 0.35,
    walls: 'dark', edge: '158, 68, 4', milk: 0,
    foam: 0.075, foamShade: ['#fffaf0', '#f6e9cc', '#e2c48a'], speck: '255, 255, 255', grain: '190, 150, 90',
    headScale: 0.3, headLift: 0.22, rise: [0, 0], photoHaze: 'rgba(255, 210, 80, 0.2)', seam: '232, 184, 74', fresh: 0.11, fizz: 1, drops: 1, burp: true, pour: ['#c06a0e', '#f4b52a', '#ffe08a'],
  },
  butterbeer: {
    gl: { ripple: 0.12, condAmt: 0.45, headTop: [0.97, 0.93, 0.84], headBot: [0.91, 0.83, 0.66], sigma: [0.72, 1.55, 3.2], back: [0.9, 0.74, 0.46], scatter: [0.12, 0.07, 0.02], bodyMix: 0.3, bodyGain: [1.05, 1.0, 0.95], flow: 0.035, caustic: [0.08, 0.06, 0.02], surfGlow: [0.15, 0.1, 0.03], surfGlowDepth: 50, tendrils: 0.75 },
    title: 'BUTTERBEER', unit: ['butterbeer', 'butterbeers'], head: 'cream',
    body: ['#c8862e', '#b07228', '#8a4e16', '#4a2608'],
    glow: 'rgba(255, 214, 120, 0.34)', glowAt: 'center', band: '255, 236, 200', bandAlpha: 0,
    walls: 'dark', edge: '80, 40, 8', milk: 0.06, photoHaze: 'rgba(232, 200, 144, 0.08)', cloudy: true,
    foam: 0.07, foamShade: ['#fffdf8', '#f6ead0', '#e6cb92'], speck: '255, 252, 242', grain: '214, 176, 116',
    headScale: 0.48, headWash: 'rgba(246, 229, 192, 0.45)', rise: [4, 0], swirl: true, seam: '243, 213, 155', fresh: 0.04, fizz: 0.45, drops: 1, burp: true, pour: ['#a8681e', '#e9b45c', '#fbe0a8'],
  },
  rootbeer: {
    gl: { seamFizz: 0.5, ripple: 0.12, condAmt: 0.3, wallGlow: [0.09, 0.028, 0.008], headTop: [0.9, 0.8, 0.64], headBot: [0.72, 0.55, 0.36], sigma: [2.2, 4.2, 6.0], back: [1.0, 0.72, 0.46], scatter: [0.02, 0.005, 0.0], bodyMix: 0.3, bodyGain: [1.0, 0.9, 0.85], flow: 0.03, caustic: [0.06, 0.025, 0.008], surfGlow: [0.24, 0.11, 0.03], surfGlowDepth: 55, tendrils: 0 },
    title: 'ROOT BEER', unit: ['root beer', 'root beers'], head: 'foam',
    body: ['#3a1206', '#1e0802', '#0f0401', '#070100'],
    glow: 'rgba(150, 60, 24, 0.55)', glowAt: 'surface', glowDepth: 60, band: '200, 120, 70', bandAlpha: 0,
    walls: 'lit', edge: '122, 40, 10', milk: 0, bubbleTint: '232, 168, 104',
    foam: 0.07, foamShade: ['#eed8b0', '#d8b886', '#b88e5a'], speck: '250, 238, 214', grain: '150, 100, 50',
    headScale: 0.3, rise: [0, 0], darkMask: true, seam: '184, 124, 66', fresh: 0.07, fizz: 0.9, drops: 1, burp: true, pour: ['#1a0602', '#4a1a08', '#9a4a24'],
  },
  wine: {
    gl: { ripple: 0.06, wallGlow: [0.1, 0.008, 0.025], sigma: [1.9, 5.8, 4.8], back: [1.0, 0.9, 0.86], scatter: [0.01, 0.0, 0.003], bodyMix: 0, bodyGain: [1, 1, 1], flow: 0, caustic: [0.05, 0.005, 0.015], surfGlow: [0.2, 0.025, 0.05], surfGlowDepth: 40, tendrils: 0, menLip: [0.56, 0.1, 0.17], menDark: [0.08, 0.0, 0.02], menGlint: [1.0, 0.85, 0.9] },
    title: 'WINE', unit: ['glass of wine', 'glasses of wine'], head: 'none',
    body: ['#8e1430', '#3c0612', '#2a0510', '#140105'],
    glow: 'rgba(196, 25, 63, 0.45)', glowAt: 'surface', glowDepth: 90, ruby: true, band: '140, 30, 60', bandAlpha: 0,
    walls: 'lit', edge: '176, 23, 63', wallWidth: 0.2, milk: 0, legs: true, grainAmount: 0.3, photoAlpha: 0, caustic: '184, 25, 62', causticAlpha: 0.28,
    foam: 0, fresh: 0, fizz: 0, drops: 0, burp: false, pour: ['#3a0410', '#7a0e2a', '#d04a68'],
  },
  water: {
    gl: { ripple: 0.1, condAmt: 0.3, sigma: [0.06, 0.025, 0.015], back: [0.34, 0.38, 0.4], scatter: [0.0, 0.0, 0.0], bodyMix: 0, bodyGain: [1, 1, 1], flow: 0, caustic: [0.16, 0.18, 0.2], surfGlow: [0.03, 0.05, 0.06], surfGlowDepth: 40, tendrils: 0, menLip: [0.92, 0.97, 1.0], menDark: [0.2, 0.26, 0.3], menGlint: [1, 1, 1] },
    title: 'WATER', unit: ['glass of water', 'glasses of water'], head: 'none', clear: true,
    body: ['#a9c4cc', '#93b3bd', '#7c9ea9', '#5f8592'],
    glow: 'rgba(220, 240, 255, 0.12)', glowAt: 'surface', glowDepth: 60, band: '230, 245, 255', bandAlpha: 0,
    walls: 'lit', edge: '210, 235, 245', wallWidth: 0.08, milk: 0, photoAlpha: 0,
    caustic: '255, 255, 255', causticAlpha: 0.1,
    meniscus: { lip: '235, 248, 255', dark: '40, 60, 70', glint: '255, 255, 255' },
    clearTint: 'rgba(170, 210, 222, 0.12)', clearGlow: 'rgba(50, 75, 85, 0.35)',
    foam: 0, fresh: 0, fizz: 0, drops: 1, burp: false, pour: ['#8fb4c2', '#d8eef5', '#ffffff'],
  },
  coffee: {
    gl: { ripple: 0.08, cremaGloss: 0.12, wallGlow: [0.14, 0.06, 0.02], headTop: [0.66, 0.42, 0.2], headBot: [0.2, 0.09, 0.03], sigma: [3.4, 5.4, 7.0], back: [1.0, 0.78, 0.55], scatter: [0.0, 0.0, 0.0], bodyMix: 0.25, bodyGain: [1.0, 0.95, 0.9], flow: 0.03, caustic: [0.04, 0.02, 0.005], surfGlow: [0.2, 0.09, 0.03], surfGlowDepth: 60, tendrils: 0, creamCol: [0.9, 0.8, 0.66] },
    title: 'COFFEE', unit: ['coffee', 'coffees'], head: 'crema',
    body: ['#24120a', '#160a04', '#0d0602', '#060200'],
    glow: 'rgba(110, 44, 11, 0.55)', glowAt: 'surface', glowDepth: 70, band: '150, 95, 55', bandAlpha: 0,
    walls: 'lit', edge: '138, 60, 18', milk: 0, wallWidth: 0.1,
    foam: 0.011, grainAmount: 0.25, foamShade: ['#c48a52', '#a8703e', '#8a552a'], speck: '217, 166, 106', grain: '90, 50, 20',
    headScale: 0.2, headTint: 'rgba(120, 61, 20, 0.3)', bodyTint: 'rgba(16, 7, 2, 0.4)', caustic: '143, 69, 24', causticAlpha: 0.08, fresh: 0.003, fizz: 0, drops: 0, steam: true, burp: false, pour: ['#0d0602', '#2b1608', '#6a3e1e'],
  },
};
let drinkName = DRINKS[params.get('drink')] ? params.get('drink') : (loadDrink() || 'beer');

// Modifiers: optional extras per drink, chosen on the start screen. Each one
// returns overrides for the drink's settings.
const MODS = {
  coffee: {
    creamer: { label: 'Creamer', apply: () => ({
      body: ['#6b4024', '#56331b', '#3e2412', '#23140a'], bodyTint: 'rgba(40, 22, 10, 0.15)',
      creamClouds: 'rgba(236, 214, 182, 1)', glow: 'rgba(170, 110, 60, 0.45)',
      gl: { cream: true, creamCol: [0.9, 0.8, 0.66], sigma: [1.8, 2.7, 3.6], scatter: [0.16, 0.1, 0.05], wallGlow: [0.07, 0.03, 0.01], headTop: [0.78, 0.6, 0.43], headBot: [0.55, 0.38, 0.24] },
    }) },
    coldfoam: { label: 'Cold foam', apply: () => ({
      head: 'cream', foam: 0.09, headTex: 'butterbeer-head', headScale: 0.5, headLift: 0.28,
      headTint: null, foamShade: ['#fffdf8', '#f8f1e4', '#e9dcc3'], speck: '255, 255, 255', grain: '200, 180, 150',
      seam: '214, 190, 160', fresh: 0.02, steam: false,
      gl: { tendrils: 0.6, headTop: [0.98, 0.96, 0.92], headBot: [0.88, 0.83, 0.75], cremaGloss: 0, condAmt: 0.35 },
      drops: 0.65, headLift: 0.45,
    }) },
  },
  water: {
    ice: { label: 'Ice', apply: () => ({ ice: true }) },
    lemon: { label: 'Lemon', apply: () => ({ lemon: true }) },
    sparkling: { label: 'Sparkling', apply: () => ({ fizz: 1.2, bubbleTint: '255, 255, 255', title: 'SPARKLING' }) },
  },
  rootbeer: {
    float: { label: 'Ice cream float', apply: () => ({
      float: true, foam: 0.1, fresh: 0.05, foamShade: ['#fbf3e2', '#efdcb8', '#d6b585'], headLift: 0.2,
      creamClouds: 'rgba(240, 222, 190, 1)', creamTop: true,
      gl: { cream: true, creamMax: 0.8, creamTop: true, creamCol: [0.95, 0.9, 0.8], tendrils: 0.4 },
    }) },
  },
  wine: {
    red: { label: 'Red', group: 'wine', apply: () => ({}) },
    white: { label: 'White', group: 'wine', apply: () => ({
      title: 'WHITE WINE',
      body: ['#f2e2a0', '#e6cf7c', '#d6b65a', '#a8822e'], glow: 'rgba(255, 244, 190, 0.45)',
      edge: '240, 214, 140', caustic: '255, 248, 210', causticAlpha: 0.16, ruby: false, drops: 0.6,
      meniscus: { lip: '255, 246, 214', dark: '90, 70, 20', glint: '255, 255, 240' }, legTint: '220, 190, 110',
      gl: { condAmt: 0.15, sigma: [0.02, 0.04, 0.28], back: [0.58, 0.56, 0.4], caustic: [0.1, 0.09, 0.05], surfGlow: [0.06, 0.05, 0.01], menLip: [1.0, 0.96, 0.8], menDark: [0.3, 0.25, 0.1], menGlint: [1, 1, 0.94] },
      pour: ['#a8822e', '#e6cf7c', '#fff4c8'], clear: true, clearTint: 'rgba(240, 205, 90, 0.4)', clearGlow: 'rgba(150, 120, 30, 0.55)', menLipHex: null,
    }) },
    rose: { label: 'Rosé', group: 'wine', apply: () => ({
      title: 'ROSÉ',
      body: ['#f4a3a8', '#e5848f', '#cc6377', '#8e3a4e'], glow: 'rgba(255, 190, 200, 0.45)',
      edge: '245, 160, 170', caustic: '255, 214, 220', causticAlpha: 0.16, ruby: false, drops: 0.6,
      meniscus: { lip: '255, 220, 226', dark: '110, 40, 55', glint: '255, 250, 252' }, legTint: '230, 130, 150',
      gl: { condAmt: 0.12, sigma: [0.02, 0.34, 0.28], back: [0.62, 0.4, 0.44], caustic: [0.1, 0.06, 0.06], surfGlow: [0.08, 0.02, 0.03], menLip: [1.0, 0.82, 0.86], menDark: [0.35, 0.12, 0.18], menGlint: [1, 0.96, 0.97] },
      pour: ['#8e3a4e', '#e5848f', '#ffd6dc'], clear: true, clearTint: 'rgba(236, 110, 132, 0.42)', clearGlow: 'rgba(160, 60, 80, 0.5)',
    }) },
  },
};
let activeMods = readMods();
let drink = composeDrink(drinkName, activeMods);

// A drink with its modifiers applied. The `gl` look is merged key by key.
function composeDrink(name, mods) {
  const base = DRINKS[name] || DRINKS.beer;
  const out = Object.assign({}, base);
  out.gl = Object.assign({}, base.gl);
  for (const id of mods) {
    const o = MODS[name][id].apply();
    const gl = o.gl;
    delete o.gl;
    Object.assign(out, o);
    if (gl) Object.assign(out.gl, gl);
  }
  return out;
}
let FOAM = drink.foam;      // settled head height, as a share of screen height

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
let headLayer = null;   // offscreen canvas for the head, so its lower edge can fade out
let headPattern = null; // the head photo, made seamless so it tiles
let bodyTile = null;    // the body photo, made seamless vertically, for scrolling
let bodyPattern = null;
let cloudTile = null;   // creamer / melting ice cream clouds, tinted
let foamShift = 0;      // how far the head has slid sideways with the slosh
let liquidShift = 0;    // the same for the liquid photo
let pops = [];
let creamAmt = 0;       // how much creamer has poured in, 0 to 1
// Extras arriving: floaters fall in and bob, creamer and cold foam pour.
const floatState = {};  // per floater id: { fy, fv, landed }
let drops = [];         // splash droplets, liquid frame
let addPour = null;     // { kind: 'cream' | 'foam', t, x }
let creamAge = 99;      // seconds since creamer started pouring
let creamOrigin = 0;    // liquid-frame x where it went in
let foamGrow = 1;       // cold foam builds up as it is poured
let pendingExtras = [];
let lastLevel = 0; // extras to add once a fresh pour finishes
let legs = [];
let legTimer = 0;
let lastTopY = null;     // screen y of the wine's highest wet point, to spot it falling
let slides = [];
let slideTimer = 2;
let seamDots = [];
let edgeBeads = [];

// ---------- layout and textures ----------

let useGL = false;

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
  if (useGL) {
    const gdpr = Math.min(2, dpr);
    GLR.resize(Math.round(W * gdpr), Math.round(H * gdpr));
    GLR.setTexture('room', sprites.room);
  }
  sites = Array.from({ length: 11 }, (_, i) => ({
    x: PW * (0.1 + 0.8 * ((i * 0.618 + 0.13) % 1)),
    y: PH * (0.45 + 0.5 * ((i * 0.381 + 0.27) % 1)),
    wait: Math.random() * 0.1, moveAt: 2 + Math.random() * 6,
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
  // A carbonation bubble as a macro photo shows it: a dark refracting ring,
  // a lit rim, a bright pin of reflection, and a soft caustic crescent below.
  const [bubble, b] = makeCanvas(32, 32);
  const tint = drink.bubbleTint || '255, 246, 214';
  const ring = b.createRadialGradient(16, 16, 0, 16, 16, 15);
  ring.addColorStop(0, `rgba(${tint}, 0.45)`);
  ring.addColorStop(0.55, `rgba(${tint}, 0.3)`);
  ring.addColorStop(0.78, 'rgba(60, 28, 0, 0.35)');
  ring.addColorStop(0.9, `rgba(${tint}, 0.85)`);
  ring.addColorStop(1, `rgba(${tint}, 0)`);
  b.fillStyle = ring;
  b.beginPath(); b.arc(16, 16, 15, 0, Math.PI * 2); b.fill();
  b.fillStyle = 'rgba(255, 255, 255, 0.95)';
  b.beginPath(); b.ellipse(11, 10, 3.2, 2.4, -0.6, 0, Math.PI * 2); b.fill();
  b.strokeStyle = `rgba(${tint}, 0.6)`;
  b.lineWidth = 2;
  b.beginPath(); b.arc(16, 16, 9, 0.35 * Math.PI, 0.75 * Math.PI); b.stroke();

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
    glass: buildGlass(), room: buildRoom(), grain: drink.grainAmount ? buildGrain() : null,
  };
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
// Fine luminance grain, so painted liquids don't look like flat vector fills.
function buildGrain() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 40;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

function buildRoom() {
  const [room, g] = makeCanvas(PW, PH);
  if (TEX.roomPhoto) {
    // A real out-of-focus room, slightly dimmed.
    const img = TEX.roomPhoto, k = Math.max(PW / img.width, PH / img.height);
    g.drawImage(img, (PW - img.width * k) / 2, (PH - img.height * k) / 2, img.width * k, img.height * k);
    g.fillStyle = 'rgba(10, 8, 6, 0.25)';
    g.fillRect(0, 0, PW, PH);
    return room;
  }
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
    void bar;
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
  streak(PW * 0.035, 3, 0.16);   // rim glint on the left
  streak(PW * 0.07, 10, 0.05);
  streak(PW * 0.9, 30, 0.08);    // a broad soft reflection on the right
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
  return PH * (FOAM * Math.min(1, beer / 0.1) * (drink.head === 'cream' && drinkName === 'coffee' ? foamGrow : 1) + foamExtra);
}

// Surface ripple, in the liquid frame.
// The surface is a small wave simulation across the glass: tilting, stopping,
// shaking or tapping sends waves that run to the walls, bounce and settle, and
// a faint tremor keeps it from ever going perfectly still.
const WN = 128;
const waveH = new Float32Array(WN);
const waveV = new Float32Array(WN);
let prevAngleV = 0;
let shake = 0;

function stepWaves(dt) {
  const acc = (angleV - prevAngleV) / dt;
  prevAngleV = angleV;
  const steps = 8, h = dt / steps;
  for (let n = 0; n < steps; n++) {
    for (let i = 0; i < WN; i++) {
      const im = i > 0 ? i - 1 : 1, ip = i < WN - 1 ? i + 1 : WN - 2;
      const x = i / (WN - 1) - 0.5;
      const lapH = waveH[im] + waveH[ip] - 2 * waveH[i];
      const lapV = waveV[im] + waveV[ip] - 2 * waveV[i];
      // Stiffness, damping, and viscosity that kills short ripples fastest.
      waveV[i] += (lapH * 3600 - waveV[i] * 0.4 + lapV * 3 - Math.max(-80, Math.min(80, acc)) * x * 5) * h;
    }
    for (let i = 0; i < WN; i++) waveH[i] += waveV[i] * h;
  }
  const amb = 3 + shake * 120;
  for (let k = 0; k < 2; k++) waveV[(Math.random() * WN) | 0] += (Math.random() - 0.5) * amb;
  let m = 0;
  for (let i = 0; i < WN; i++) m += waveH[i];
  m /= WN;
  for (let i = 0; i < WN; i++) waveH[i] = Math.max(-40, Math.min(40, waveH[i] - m));
}

// A ripple pushed in at liquid-frame x.
function poke(x, strength) {
  const span = Math.max(1, surfR - surfL);
  const c = (x - surfL) / span * (WN - 1);
  for (let i = 0; i < WN; i++) waveV[i] -= strength * Math.exp(-((i - c) ** 2) / 2.5) * Math.cos((i - c) * 1.2);
}

function wave(x) {
  const span = Math.max(1, Math.min(D, surfR) - Math.max(-D, surfL));
  const f = Math.max(0, Math.min(1, (x - Math.max(-D, surfL)) / span)) * (WN - 1);
  const i = Math.floor(f), j = Math.min(WN - 1, i + 1);
  return waveH[i] + (waveH[j] - waveH[i]) * (f - i)
    + ((drink.gl && drink.gl.ripple) ?? 0.12) * (Math.sin(x * 0.11 + clock * 3.1) + 0.7 * Math.sin(x * 0.23 - clock * 4.3));
}

function foamTop(x) {
  const h = foamHeight();
  const k = FOAM ? Math.min(1, h / (PH * FOAM)) : 0;
  if (drink.head === 'crema') {
    return wave(x) - h;
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
  const curl = FOAM ? 0 : 7 * (Math.exp(-Math.max(0, x - surfL) / 15) + Math.exp(-Math.max(0, surfR - x) / 15));
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
  stepWaves(dt);
  shake *= Math.exp(-dt * 3);
  // Shaking a fizzy drink foams it up.
  if (shake > 0.15 && drink.fizz > 0 && FOAM > 0.03 && beer > 0.05) foamExtra = Math.min(0.2, foamExtra + shake * dt * 0.25);
  const creamMax = drink.gl && drink.gl.cream ? (drink.gl.creamMax || 1) : 0;
  if (!creamMax) creamAmt = Math.max(0, creamAmt - dt * 2);
  else if (drink.float) creamAmt = Math.min(creamMax, creamAmt + dt * 0.04);   // ice cream melts slowly
  else if (addPour && addPour.kind === 'cream') creamAmt = Math.min(creamMax, creamAmt + dt * 0.45);
  creamAge += dt;
  updateExtras(dt);

  const poly = [[0, 0], [PW, 0], [PW, PH], [0, PH]].map(([x, y]) => toWorld(x, y));
  const total = PW * PH;
  // The top edge of the phone is the rim; beer above its lower corner spills.
  const rim = Math.max(poly[0].y, poly[1].y);
  const fits = polygonArea(clipBelow(poly, rim)) / total;

  let sip = 0;
  if (fizz && fizz.drips && audio && Math.random() < dt * 9) blip(800 + Math.random() * 900, 1400 + Math.random() * 900, 0.05, 0.04);
  if (state === 'refilling') {
    beer = Math.min(FULL, beer + REFILL_RATE * dt);
    foamExtra = Math.min(drink.fresh, foamExtra + 0.22 * dt);
    if (beer >= FULL) {
      state = 'full';
      stopFizz();
      for (const id of pendingExtras) addExtra(id);
      pendingExtras = [];
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
  lastLevel = level;
  updateBubbles(dt, level);
  updateLace(dt, level, sip > 0);
  updateAlive(dt, level);
  return level;
}

// ---------- extras arriving ----------

// Called when an extra is added to the glass (or after a fresh pour).
function addExtra(id) {
  if (id === 'ice') {
    [0, 1, 2].forEach(i => { floatState[`ice${i}`] = { fy: -PH * (0.7 + 0.12 * i), fv: 0, landed: false, delay: i * 0.22 }; });
  } else if (id === 'lemon') {
    floatState.lemon = { fy: -PH * 0.55, fv: 0, landed: false, delay: 0.1 };
  } else if (id === 'float') {
    floatState.scoop = { fy: -PH * 0.6, fv: 0, landed: false, delay: 0 };
  } else if (id === 'creamer') {
    addPour = { kind: 'cream', t: 0, x: PW * (0.3 + Math.random() * 0.15) };
    creamAge = 0;
    creamOrigin = toWorld(addPour.x, 0).x;
    creamAmt = 0;
    startPourSound('cream');
  } else if (id === 'coldfoam') {
    addPour = { kind: 'foam', t: 0, x: PW * 0.5 };
    foamGrow = 0;
    startPourSound('foam');
  }
}

// Floaters fall under gravity, hit the surface (a wave, a splash, a sound),
// overshoot under, and bob back up on a buoyancy spring.
const FLOATER = {
  ice: { splash: 900, drops: 26, dropSpeed: 300, buoy: 55, damp: 5, keep: 0.35, sound: 'ice' },
  lemon: { splash: 160, drops: 5, dropSpeed: 110, buoy: 40, damp: 7, keep: 0.15, sound: 'lemon' },
  scoop: { splash: 420, drops: 10, dropSpeed: 140, buoy: 30, damp: 8, keep: 0.2, sound: 'scoop' },
};
function floaterX(id) {
  if (id === 'lemon') return -PW * 0.3 + liquidShift * 0.6;
  if (id === 'scoop') return PW * 0.08 + liquidShift * 0.5;
  const i = Number(id.slice(3));
  return PW * (0.02 + 0.2 * i) + liquidShift * (0.7 + i * 0.15);
}

function updateExtras(dt) {
  for (const [id, f] of Object.entries(floatState)) {
    if (f.delay > 0) { f.delay -= dt; continue; }
    const kind = id.startsWith('ice') ? 'ice' : id;
    const P = FLOATER[kind];
    if (!f.landed) {
      f.fv += 1900 * dt;
      f.fy += f.fv * dt;
      if (f.fy >= -6) {
        f.landed = true;
        splash(floaterX(id), P, f.fv);
        f.fv *= P.keep;
      }
    } else {
      f.fv += (-P.buoy * f.fy - P.damp * f.fv) * dt;
      f.fy += f.fv * dt;
      if (Math.abs(f.fy) < 0.05 && Math.abs(f.fv) < 0.05) delete floatState[id];
    }
  }
  drops = drops.filter(d => {
    d.vy += 1300 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.age += dt;
    return d.y < d.surf + 4 || d.age < 0.05;
  });
  if (addPour) {
    addPour.t += dt;
    if (addPour.kind === 'foam') foamGrow = Math.min(1, foamGrow + dt * 0.5);
    if (addPour.t > (addPour.kind === 'cream' ? 2.4 : 2.2)) { addPour = null; stopFizz(); }
  }
}

function splash(x, P, speed) {
  const level = lastLevel;
  poke(x, P.splash * Math.min(1.5, speed / 900));
  for (let i = 0; i < P.drops; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const v = P.dropSpeed * (0.4 + Math.random() * 0.8);
    drops.push({ x: x + (Math.random() - 0.5) * 30, y: level - 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1 + Math.random() * 2, age: 0, surf: level });
  }
  // Air dragged under: a burst of bubbles below the entry point.
  for (let i = 0; i < P.drops; i++) {
    const p = toScreen(x + (Math.random() - 0.5) * 50, level + 10 + Math.random() * 60);
    const b = newBubble(p.x, p.y, 0.8 + Math.random() * 1.6);
    b.v = 10 + Math.random() * 40;
    bubbles.push(b);
  }
  playExtraSound(P.sound, speed);
}

function drawDrops() {
  ctx.fillStyle = drink.pour[2];
  for (const d of drops) {
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath(); ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = drink.pour[2];
  }
  ctx.globalAlpha = 1;
}

// A thin stream of creamer or cold foam pouring in from the top.
function drawAddPour(level) {
  if (!addPour) return;
  const surface = Math.max(0, toScreen(toWorld(addPour.x, 0).x, level).y - foamHeight());
  const fade = Math.min(1, addPour.t * 4) * Math.min(1, (2.3 - addPour.t) * 3);
  if (fade <= 0) return;
  const x = addPour.x + Math.sin(clock * 9) * 1.2;
  const w = addPour.kind === 'cream' ? 3.2 : 6;
  const col = addPour.kind === 'cream' ? '240, 226, 200' : '250, 247, 240';
  const grad = ctx.createLinearGradient(x - w, 0, x + w, 0);
  grad.addColorStop(0, `rgba(${col}, 0)`);
  grad.addColorStop(0.5, `rgba(${col}, ${0.95 * fade})`);
  grad.addColorStop(1, `rgba(${col}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(x - w, 0, w * 2, surface + 3);
}

function refill() {
  state = 'refilling';
  uprightFor = 0;
  startFizz();
  // Extras go in after the pour.
  pendingExtras = activeMods.filter(id => ['ice', 'lemon', 'float', 'creamer', 'coldfoam'].includes(id));
  for (const k of Object.keys(floatState)) delete floatState[k];
  for (const id of pendingExtras) {
    if (id === 'ice') [0, 1, 2].forEach(i => { floatState[`ice${i}`] = { fy: -PH * 2, fv: 0, landed: false, delay: 1e9 }; });
    if (id === 'lemon') floatState.lemon = { fy: -PH * 2, fv: 0, landed: false, delay: 1e9 };
    if (id === 'float') floatState.scoop = { fy: -PH * 2, fv: 0, landed: false, delay: 1e9 };
  }
  if (pendingExtras.includes('coldfoam')) foamGrow = 0;
  if (pendingExtras.includes('creamer')) creamAmt = 0;
}

function inLiquid(x, y, level, margin) {
  return toWorld(x, y).y > level + margin;
}

function updateBubbles(dt, level) {
  if (beer > 0.01 && drink.fizz > 0) {
    // Free-floating bubbles start deep and rise.
    const spawn = (state === 'refilling' ? 120 : 22) * drink.fizz * dt;
    for (let n = spawn + Math.random(); n >= 1 && bubbles.length < 260; n--) {
      let x, y;
      if (state === 'refilling') {
        const p = toScreen((Math.random() - 0.5) * PW * 0.35, level + 20 + Math.random() * PH * 0.35);
        x = p.x; y = p.y;
      } else {
        x = Math.random() * PW;
        y = PH * (0.5 + Math.random() * 0.55);
      }
      if (inLiquid(x, y, level, 12)) {
        // A few bubbles cling to the glass and grow before letting go.
        const b = newBubble(x, y, 0.5 + Math.random() * 1.2);
        if (Math.random() < 0.08) { b.stuck = 2 + Math.random() * 6; b.v = 0; }
        bubbles.push(b);
      }
    }
    // Nucleation sites on the glass send up steady chains of tiny bubbles.
    for (const s of sites) {
      // A nucleation site runs for a few seconds, then another takes over.
      s.moveAt -= dt;
      if (s.moveAt <= 0) {
        s.moveAt = 3 + Math.random() * 7;
        s.x = PW * (0.06 + Math.random() * 0.88);
        s.y = PH * (0.4 + Math.random() * 0.58);
      }
      s.wait -= dt;
      if (s.wait <= 0) {
        // Irregular spacing, with the odd pause, so chains don't look dotted.
        s.wait = (0.04 + Math.random() * 0.12 + (Math.random() < 0.12 ? 0.35 : 0)) / drink.fizz;
        const x = s.x + (Math.random() - 0.5) * 3;
        if (bubbles.length < 420 && inLiquid(x, s.y, level, 12)) {
          bubbles.push(newBubble(x, s.y, 0.7 + Math.random() * 0.5, true));
        }
      }
    }
  }
  const ux = -Math.sin(angle), uy = -Math.cos(angle); // "up" on screen
  bubbles = bubbles.filter(b => {
    b.age += dt;
    // Bubbles speed up and swell as they rise, as the pressure drops.
    if (b.stuck > 0) {
      b.stuck -= dt;
      b.age += 0;
      b.r = Math.min(2.4, b.r * (1 + dt * 0.08));
      return inLiquid(b.x, b.y, level, b.r + 2);
    }
    b.v = Math.min(b.chain ? 150 : 120, b.v + dt * 45);
    b.r = Math.min(b.chain ? 2.6 : 3, b.r * (1 + dt * (b.chain ? 0.35 : 0.12)));
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
  if (drink.legs) updateLegs(dt, level);
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

// Wine legs: where wine has just run back down the glass (the level fell or a
// slosh receded), a few tears form at the wet line and creep slowly down.
function updateLegs(dt, level) {
  const crest = toScreen(0, level).y;
  legTimer -= dt;
  const receding = lastTopY !== null && crest > lastTopY + 0.3;
  if ((receding || slosh > 0.15) && legTimer <= 0 && beer > 0.02) {
    legTimer = 0.5;
    const wx = (Math.random() - 0.5) * D;
    const p = toScreen(wx, level - 4 - Math.random() * 30);
    if (p.x > 8 && p.x < PW - 8 && p.y > 0 && legs.length < 18) {
      legs.push({ x: p.x, y0: p.y - 10, len: 0, max: 40 + Math.random() * 80, w: 1.5 + Math.random() * 1.5, bend: (Math.random() - 0.5) * 3, life: 1 });
    }
  }
  lastTopY = crest;
  for (const l of legs) {
    l.len = Math.min(l.max, l.len + dt * (4 + Math.random() * 3));
    l.life -= dt / 25;
  }
  legs = legs.filter(l => l.life > 0);
}

function drawLegs() {
  for (const l of legs) {
    const a = Math.min(1, l.life * 2);
    const end = l.y0 + l.len;
    // A wet film band where the wine was, a thin rivulet running down from it
    // with a lit left edge, and a heavier drop at its foot.
    const film = ctx.createLinearGradient(0, l.y0, 0, end);
    const lt = drink.legTint || '150, 25, 50';
    film.addColorStop(0, `rgba(${lt}, ${0.06 * a})`);
    film.addColorStop(1, `rgba(${lt}, ${0.22 * a})`);
    ctx.strokeStyle = film;
    ctx.lineWidth = l.w;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(l.x, l.y0); ctx.quadraticCurveTo(l.x + l.bend, (l.y0 + end) / 2, l.x, end); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * a})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(l.x - l.w / 2, l.y0); ctx.quadraticCurveTo(l.x - l.w / 2 + l.bend, (l.y0 + end) / 2, l.x - l.w / 2, end); ctx.stroke();
    ctx.fillStyle = `rgba(${drink.legTint || '170, 30, 60'}, ${0.4 * a})`;
    ctx.beginPath(); ctx.ellipse(l.x, end + 1.5, l.w * 0.9, l.w * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 240, 244, ${0.55 * a})`;
    ctx.beginPath(); ctx.arc(l.x - l.w * 0.3, end + 0.6, 0.7, 0, Math.PI * 2); ctx.fill();
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
    track.addColorStop(1, `rgba(255, 255, 255, ${0.04 * a})`);
    ctx.strokeStyle = track;
    ctx.lineWidth = d.r * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(d.x, d.y0);
    for (let y = d.y0; y <= d.y; y += 4) ctx.lineTo(d.x + Math.sin(y * 0.05 + d.x) * 1.8 + Math.sin(y * 0.13) * 0.6, y);
    ctx.stroke();
    ctx.globalAlpha = a;
    drawBead(ctx, d.x + Math.sin(d.y * 0.05 + d.x) * 1.8 + Math.sin(d.y * 0.13) * 0.6, d.y, d.r);
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
  if (useGL) { drawGL(level); return; }
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
    drawFloaters(level);
    if (drink.steam) drawSteam(level);
    drawPops(level);
    ctx.restore();
  }

  ctx.setTransform(base);
  if (TEX.condensation) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.8;
    // Flip it per drink so each glass has its own drops.
    const flip = { beer: [1, 1, 0.5], butterbeer: [-1, 1, 0.5], rootbeer: [1, 1, 0] }[drinkName] || [1, 1, 0.5];
    ctx.save();
    ctx.translate(flip[0] < 0 ? PW : 0, flip[1] < 0 ? PH : 0);
    ctx.scale(flip[0], flip[1]);
    drawCover(TEX.condensation, flip[2]);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  drawSlides();
  ctx.drawImage(sprites.glass, 0, 0, PW, PH);
  drawHud();
}

// WebGL path: the GPU draws the glass, drink, head, bubbles and condensation;
// the 2D canvas on top adds the small things: lacing, legs, the pour,
// floaters, popping foam, running drops and the HUD.
const CONDMAP = { beer: [1, 1, 0.5], butterbeer: [-1, 1, 0.5], rootbeer: [1, 1, 0], water: [-1, 1, 0.2] };
const hexRgb = h => h.match(/\w\w/g).map(v => parseInt(v, 16) / 255);

function drawGL(level) {
  const m = new DOMMatrix().translate(W / 2, H / 2).rotate(-screenAngle).translate(-PW / 2, -PH / 2);
  const inv = m.inverse();
  const g = drink.gl;
  const foamH = drink.head === 'none' ? 0 : foamHeight();
  const bub = new Float32Array(bubbles.length * 3);
  bubbles.forEach((b, i) => { bub[i * 3] = b.x; bub[i * 3 + 1] = b.y; bub[i * 3 + 2] = b.r * Math.min(1, b.age * 5); });
  const shade = drink.foamShade || ['#ffffff', '#ffffff', '#ffffff'];
  const men = drink.meniscus;
  const c3 = s => s.split(',').map(v => Number(v) / 255);
  const hasFloat = !!(TEX.lemon || TEX.ice || TEX.scoop) && drawFloatLayer(level);
  if (hasFloat) GLR.updateLayer('float', floatLayer);
  GLR.render({
    hasFloat, condAbove: 0.08, creamFrom: [creamOrigin, creamAge], shear: Math.max(-3, Math.min(3, angleV)),
    scoop: TEX.scoop ? [PW * 0.08 + liquidShift * 0.5, level - foamH + PW * 0.05, PW * 0.18] : [0, 0, 0], creamAt: [PW * 0.08 + liquidShift * 0.5, 90],
    dpr: Math.min(2, dpr), PW, PH, time: clock, angle, level, fill: beer > 0.002 ? 1 : 0,
    inv: [inv.a, inv.b, 0, inv.c, inv.d, 0, inv.e, inv.f, 1],
    fwd: [m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1],
    waves: waveH, wetL: Math.max(-D, surfL), wetR: Math.min(D, surfR), shift: liquidShift, grav: targetAngle,
    condAmt: TEX.condensation ? (g.condAmt ?? 0.85) * Math.min(1, drink.drops) : 0, condMap: CONDMAP[drinkName] || [1, 1, 0.5],
    hasBody: !!TEX.body && drink.photoAlpha !== 0, hasHead: !!TEX.head && foamH > 1, foamH,
    foamShift, cream: creamAmt,
    bubbles: bub, bubbleTint: c3(drink.bubbleTint || '255, 240, 200'),
    look: {
      clear: !!drink.clear, sigma: g.sigma, back: g.back, scatter: g.scatter, bodyMix: g.bodyMix,
      bodyGain: g.bodyGain, flow: g.flow, caustic: g.caustic, creamCol: g.creamCol || [0.95, 0.9, 0.8],
      creamTop: !!g.creamTop, surfGlow: g.surfGlow, surfGlowDepth: g.surfGlowDepth,
      menLip: g.menLip || (men ? c3(men.lip) : [0.8, 0.2, 0.3]),
      menDark: g.menDark || (men ? c3(men.dark) : [0.1, 0, 0]),
      menGlint: g.menGlint || (men ? c3(men.glint) : [1, 0.9, 0.9]),
      head: { foam: 1, cream: 2, crema: 3 }[drink.head] || 0, headScale: 1 / (drink.headScale || 0.3),
      headTop: g.headTop || hexRgb(shade[0]), headBot: g.headBot || hexRgb(shade[2]), headLift: drink.headLift || 0.15,
      tendrils: g.tendrils || 0, steam: !!drink.steam,
      seamFizz: g.seamFizz || 0, ripple: g.ripple ?? 0.12, cremaGloss: g.cremaGloss || 0, wallGlow: g.wallGlow,
      noPops: drink.head === 'cream',
    },
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-screenAngle * RAD);
  ctx.translate(-PW / 2, -PH / 2);
  baseMatrix = ctx.getTransform();
  if (drink.legs) drawLegs();
  for (const l of lace) {
    ctx.globalAlpha = Math.min(1, l.life * 1.6) * 0.85;
    ctx.drawImage(sprites.blob, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.globalAlpha = 1;
  if (state === 'refilling') drawPour(level);
  drawAddPour(level);
  if (beer > 0) {
    ctx.save();
    ctx.translate(PW / 2, PH / 2);
    ctx.rotate(-angle);
    drawDrops();
    ctx.restore();
  }
  drawSlides();
  drawHud();
}

function drawEmptyGlass() {
  ctx.drawImage(sprites.room, 0, 0, PW, PH);
  if (drink.legs) drawLegs();
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
  const photo = !!TEX.body && drink.photoAlpha !== 0;
  if (drink.clear) drawClearWater(level);
  if (photo) {
    ctx.globalAlpha = drink.photoAlpha ?? 1;
    drawLiveBody(level);
    ctx.globalAlpha = 1;
    if (drink.photoHaze) {
      ctx.fillStyle = drink.photoHaze;
      ctx.fillRect(-D, level - 20, D * 2, D * 2);
    }
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
  if (!photo && drink.caustic) {
    const m = ctx.getTransform();
    ctx.setTransform(baseMatrix);
    for (let i = 0; i < 3; i++) {
      const x = PW * (0.5 + 0.42 * Math.sin(clock * (0.35 + i * 0.12) + i * 2.1) + liquidShift / PW);
      const y = PH * (0.4 + 0.32 * Math.sin(clock * (0.27 + i * 0.09) + i * 1.3));
      const r = PW * (0.3 + 0.1 * i) * (1 + slosh * 0.4);
      const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, i === 2 ? `rgba(82, 7, 24, ${drink.causticAlpha || 0.14})` : `rgba(${drink.caustic}, ${drink.causticAlpha || 0.14})`);
      cg.addColorStop(1, `rgba(${drink.caustic}, 0)`);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, PW, PH);
    }
    ctx.setTransform(m);
  }
  if (sprites.grain) {
    ctx.globalAlpha = drink.grainAmount;
    ctx.fillStyle = sprites.grain;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
    ctx.globalAlpha = 1;
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
  if (cloudTile) drawCreamClouds(level);
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
    ctx.globalAlpha = 0.55;
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
      const ca = drink.causticAlpha || 0.18;
      cg.addColorStop(0, `rgba(${drink.caustic}, ${i ? ca * 0.7 : ca})`);
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
    h.addColorStop(0.22, 'rgba(122, 40, 10, 0)');
    h.addColorStop(0.78, 'rgba(122, 40, 10, 0)');
    h.addColorStop(1, 'rgba(122, 40, 10, 0.5)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, PW, PH);
  }
  ctx.setTransform(m);
}

// Water: the room behind, seen through the water, magnified and shifted a
// little by refraction, with a faint cool tint and moving caustic light.
function drawClearWater(level) {
  const m = ctx.getTransform();
  ctx.setTransform(baseMatrix);
  ctx.drawImage(sprites.room, -PW * 0.04 + liquidShift * 0.4, -PH * 0.02, PW * 1.08, PH * 1.04);
  ctx.fillStyle = drink.clearTint || 'rgba(170, 205, 215, 0.14)';
  ctx.fillRect(0, 0, PW, PH);
  if (drink.clearGlow) {
    // Light through the drink: lift it toward its own colour.
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = drink.clearGlow;
    ctx.fillRect(0, 0, PW, PH);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i++) {
    const y = PH * (0.35 + 0.15 * i) + Math.sin(clock * (0.6 + i * 0.2) + i) * 30;
    const g = ctx.createLinearGradient(0, y - 18, 0, y + 18);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.5, `rgba(255, 255, 255, ${0.035 + 0.02 * Math.sin(clock * 1.3 + i)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 18, PW, 36);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(m);
}

// Creamer (or melting ice cream): clouds that drift, curl and slowly blend.
function drawCreamClouds(level) {
  const c = cloudTile;
  const k = Math.max(D / c.width, D / c.height) * 0.8;
  const settle = Math.min(1, clock / 20);   // the clouds spread and fade over ~20 s
  for (const [phase, dir, a] of [[0, 1, 0.32], [2.1, -1, 0.2]]) {
    ctx.save();
    ctx.globalAlpha = a * (1 - settle * 0.5) * (drink.creamTop ? 0.7 : 1);
    ctx.translate(Math.sin(clock * 0.07 * dir + phase) * 40 + liquidShift, level + (drink.creamTop ? -c.height * k * 0.35 : -40));
    ctx.rotate(Math.sin(clock * 0.05 + phase) * 0.15 * dir);
    ctx.scale(k * (1 + settle * 0.3) * dir, k * (1 + settle * 0.3) * (drink.creamTop ? 0.55 : 1));
    ctx.drawImage(c, -c.width / 2, 0);
    ctx.restore();
  }
  if (!drink.creamTop) {
    // Blended-in cream lightens the whole drink a little.
    ctx.fillStyle = `rgba(200, 160, 120, ${0.1 + settle * 0.12})`;
    ctx.fillRect(-D, level - 20, D * 2, D * 2);
  }
}

// Ice cubes, a lemon wheel and an ice cream scoop float at the surface and
// bob with the slosh.
// The ice photo holds three cubes side by side; cut them apart so each can
// float on its own.
let iceCubes = [];
function splitIce(src) {
  return [[0.0, 0.36], [0.34, 0.66], [0.63, 1.0]].map(([a, b]) => {
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * (b - a));
    c.height = Math.round(src.height * 0.7);
    const g = c.getContext('2d');
    g.drawImage(src, -src.width * a, -src.height * 0.18);
    // Feather the cut edges.
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.42, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.62);
    m.addColorStop(0, 'rgba(0, 0, 0, 1)');
    m.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = m;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  });
}

// Floaters for the WebGL layer: each rides its own spot on the surface,
// bobbing and tilting with the local wave, mostly under water.
let floatLayer = null;
function drawFloatLayer(level) {
  const k = Math.min(2, dpr);
  if (!floatLayer || floatLayer.width !== Math.round(PW * k)) {
    floatLayer = document.createElement('canvas');
    floatLayer.width = Math.round(PW * k);
    floatLayer.height = Math.round(PH * k);
  }
  const g = floatLayer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, floatLayer.width, floatLayer.height);
  if (beer < 0.05) return false;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.translate(PW / 2, PH / 2);
  g.rotate(-angle);
  const surf = x => level + wave(x);
  const slope = x => (wave(x + 8) - wave(x - 8)) / 16;
  const fyOf = id => (floatState[id] ? floatState[id].fy : 0);
  const place = (img, x, sink, size, phase, spin, id) => {
    const w = size, h = w * img.height / img.width;
    const fy = fyOf(id);
    g.save();
    g.translate(x, surf(x) + h * sink + fy + Math.sin(clock * 1.1 + phase) * 1.5);
    g.rotate(Math.atan(slope(x)) * 0.8 + Math.sin(clock * 0.6 + phase) * spin);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
  };
  iceCubes.forEach((c, i) => {
    const x = PW * (0.02 + 0.2 * i) + liquidShift * (0.7 + i * 0.15) + Math.sin(clock * (0.17 + i * 0.05) + i * 2) * 10;
    place(c, x, 0.36 + 0.04 * i, PW * (0.24 + 0.03 * (i % 2)), i * 1.7, 0.06 + 0.03 * i, `ice${i}`);
  });
  if (TEX.lemon) {
    const x = -PW * 0.3 + liquidShift * 0.6 + Math.sin(clock * 0.13) * 8;
    const w = PW * 0.38, h = w * 0.42;
    g.save();
    g.translate(x, surf(x) + h * 0.05 + fyOf('lemon') + Math.sin(clock * 1.1 + 3) * 1.5);
    g.rotate(Math.atan(slope(x)) * 0.8 - 0.12);
    g.drawImage(TEX.lemon, -w / 2, -h / 2, w, h);
    g.restore();
  }
  if (TEX.scoop) {
    const x = PW * 0.08 + liquidShift * 0.5;
    const s = PW * 0.5;
    g.save();
    g.translate(x, level - foamHeight() + s * 0.1 + fyOf('scoop') + Math.sin(clock * 0.9) * 1.2);
    g.rotate(Math.atan(slope(x)) * 0.5);
    g.drawImage(TEX.scoop, -s / 2, -s / 2, s, s);
    // Its underside is in shadow where it sits in the foam.
    const sh = g.createLinearGradient(0, 0, 0, s / 2);
    sh.addColorStop(0, 'rgba(90, 50, 20, 0)');
    sh.addColorStop(1, 'rgba(90, 50, 20, 0.35)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = sh;
    g.fillRect(-s / 2, 0, s, s / 2);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(243, 230, 205)';
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(120, 80, 30, 0.12)';
    g.fillRect(-s / 2, -s / 2, s, s);
    g.restore();
  }
  return true;
}

function drawFloaters(level) {
  if (beer < 0.05) return;
  const bob = i => Math.sin(clock * 1.3 + i * 2) * 3 + angleV * 6 * (i % 2 ? 1 : -1);
  if (TEX.lemon) {
    const s = PW * 0.42;
    ctx.save();
    ctx.translate(-PW * 0.12 + liquidShift * 0.6, level + s * 0.05 + bob(3));
    ctx.rotate(-0.25 + angleV * 0.1);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(TEX.lemon, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  if (TEX.ice) {
    const img = TEX.ice, w = PW * 0.9, h = w * img.height / img.width;
    ctx.save();
    ctx.translate(liquidShift * 0.8, level + bob(1));
    ctx.rotate(angleV * 0.05);
    ctx.drawImage(img, -w / 2, -h * 0.45, w, h);
    ctx.restore();
  }
  if (TEX.scoop) {
    const s = PW * 0.55;
    ctx.save();
    ctx.translate(PW * 0.08 + liquidShift * 0.5, level - foamHeight() + s * 0.12 + bob(2));
    ctx.rotate(angleV * 0.06);
    ctx.drawImage(TEX.scoop, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

// Curved glass: pale drinks darken toward the side walls; dark drinks show
// their colour where the liquid is thin, so their edges glow.
function drawWallsInLiquid() {
  const side = ctx.createLinearGradient(0, 0, PW, 0);
  const a = drink.walls === 'lit' ? 0.5 : 0.45;
  const w = drink.wallWidth || (drink.walls === 'lit' ? 0.17 : 0.12);
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
      tg.addColorStop(0, 'rgba(245, 220, 168, 0.48)');
      tg.addColorStop(1, 'rgba(243, 213, 155, 0)');
      ctx.fillStyle = tg;
      ctx.fillRect(-len, 0, len * 2, len);
      ctx.restore();
    }
  }

  // Draw the head offscreen, reaching down into the liquid, then fade its
  // lower edge out with a mask so it melts into the drink.
  const main = ctx;
  if (!headLayer || headLayer.width !== canvas.width || headLayer.height !== canvas.height) {
    headLayer = document.createElement('canvas');
    headLayer.width = canvas.width;
    headLayer.height = canvas.height;
  }
  const hl = headLayer.getContext('2d');
  hl.setTransform(1, 0, 0, 1, 0, 0);
  hl.clearRect(0, 0, headLayer.width, headLayer.height);
  hl.setTransform(main.getTransform());
  ctx = hl;
  const reach = crema ? 10 : 16;

  if (crema) {
    // Crema: flat on top; its thickness varies along the fading underside.
    ctx.beginPath();
    ctx.moveTo(-D, level + foamTop(-D));
    for (let x = -D; x <= D; x += 4) ctx.lineTo(x, level + foamTop(x));
    for (let x = D; x >= -D; x -= 4) ctx.lineTo(x, level + wave(x) + reach + 4 * Math.sin(x * 0.017 + 0.4) + 3 * Math.sin(x * 0.047 + 1.7));
    ctx.closePath();
  } else {
    headPath(level, reach);
  }
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
  if (headPattern && drink.head === 'cream') {
    // Fine pores over the cream so it reads as aerated foam, not satin.
    ctx.globalAlpha = 1;
    ctx.fillStyle = sprites.foam;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
    ctx.globalAlpha = 1;
  }
  if (headPattern && drink.headWash) {
    ctx.fillStyle = drink.headWash;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  }
  if (headPattern && crema) {
    // Light catches the top of the crema.
    const lit = ctx.createLinearGradient(0, level - h, 0, level);
    lit.addColorStop(0, 'rgba(217, 163, 90, 0.6)');
    lit.addColorStop(1, 'rgba(139, 74, 28, 0)');
    ctx.fillStyle = lit;
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
    lift.addColorStop(0, `rgba(248, 240, 220, ${drink.headLift * 1.8})`);
    lift.addColorStop(1, `rgba(241, 230, 204, ${drink.headLift * 1.2})`);
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
    depth.addColorStop(0.7, 'rgba(120, 80, 30, 0.04)');
    depth.addColorStop(1, 'rgba(110, 70, 20, 0.08)');
    ctx.fillStyle = depth;
    ctx.fillRect(-D, level - h - 30, D * 2, h + 40);
  }
  ctx.restore();

  // Small soft puffs along the top break up the cut-out edge.
  if (!crema) {
    for (let x = -D; x <= D; x += 6 + 9 * Math.abs(Math.sin(x * 1.37))) {
      const r = 1.5 + 3 * Math.abs(Math.sin(x * 0.71 + 0.3));
      const y = level + foamTop(x) + r * 0.6;
      const pg = ctx.createRadialGradient(x, y, 0, x, y, r);
      pg.addColorStop(0, drink.head === 'cream' ? 'rgba(255, 253, 246, 0.8)' : 'rgba(250, 244, 228, 0.7)');
      pg.addColorStop(1, 'rgba(250, 244, 228, 0)');
      ctx.fillStyle = pg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // Fade the bottom: opaque down to the surface, gone `reach` px into the liquid.
  ctx.globalCompositeOperation = 'destination-in';
  const top = level - h - 80, bottom = level + reach;
  const fade = ctx.createLinearGradient(0, top, 0, bottom);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(Math.max(0, (level - 4 - top) / (bottom - top)), 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(-D, top, D * 2, bottom - top);
  ctx.globalCompositeOperation = 'source-over';
  ctx = main;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(headLayer, 0, 0);
  ctx.restore();
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
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
  const men = drink.meniscus || { lip: '200, 29, 66', dark: '18, 1, 5', glint: '255, 220, 228' };
  ribbon.addColorStop(0, `rgba(${men.lip}, 0.85)`);
  ribbon.addColorStop(0.3, `rgba(${men.dark}, ${drink.clear ? 0.25 : 0.7})`);
  ribbon.addColorStop(0.55, `rgba(${men.lip}, 0.25)`);
  ribbon.addColorStop(1, 'rgba(74, 8, 25, 0)');
  ctx.fillStyle = ribbon;
  ctx.fill();

  // One continuous highlight whose strength drifts smoothly along its length.
  ctx.lineWidth = 1.5;
  for (let x = -D; x < D; x += 8) {
    const a = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(x * 0.013 + 1.1) * Math.sin(x * 0.031 + clock * 0.4));
    ctx.strokeStyle = `rgba(${(drink.meniscus || {}).glint || '255, 220, 228'}, ${a})`;
    ctx.beginPath();
    ctx.moveTo(x, surfaceAt(level, x) + 0.5);
    ctx.lineTo(x + 8, surfaceAt(level, x + 8) + 0.5);
    ctx.stroke();
  }

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
  // A faint mist hanging just over the hot surface.
  const mist = ctx.createLinearGradient(0, top, 0, top - 80);
  mist.addColorStop(0, 'rgba(237, 232, 226, 0.12)');
  mist.addColorStop(1, 'rgba(237, 232, 226, 0)');
  ctx.fillStyle = mist;
  ctx.fillRect(-D, top - 80, D * 2, 80);
  for (let i = 0; i < 3; i++) {
    const life = (clock / 5 + i * 0.33) % 1;
    const fade = Math.sin(life * Math.PI);
    const x0 = (i - 1) * PW * 0.28 + Math.sin(i * 7.1) * 25;
    const height = 140 + 90 * life;
    for (let k = 4; k <= height; k += 7) {
      const t = k / height;
      const x = x0 + Math.sin(k * 0.03 - clock * 1.1 + i * 2) * (3 + k * 0.14);
      const y = top - 4 - k;
      const r = 10 + t * 36;
      const a = 0.14 * fade * (1 - t) * Math.min(1, t * 4);
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
  const showExtras = startEl.hidden;
  if (extrasBtn.hidden === showExtras) extrasBtn.hidden = !showExtras;
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

// Each pour sounds like its drink: a band of rushing liquid, plus fizz
// crackle for carbonated drinks, a gurgle for still ones, and bright drips
// for water.
const POUR_SOUND = {
  beer: { f: 2000, q: 0.8, g: 0.11, crackle: 0.55, gurgle: 0 },
  butterbeer: { f: 1500, q: 0.8, g: 0.1, crackle: 0.25, gurgle: 0.2 },
  rootbeer: { f: 2400, q: 0.7, g: 0.11, crackle: 0.95, gurgle: 0 },
  wine: { f: 650, q: 1.5, g: 0.1, crackle: 0, gurgle: 0.8 },
  coffee: { f: 480, q: 1.2, g: 0.09, crackle: 0, gurgle: 0.6 },
  water: { f: 1250, q: 1.0, g: 0.1, crackle: 0, gurgle: 0.3, drips: true },
  cream: { f: 900, q: 1.6, g: 0.05, crackle: 0, gurgle: 0.4 },
  foam: { f: 3200, q: 0.6, g: 0.04, crackle: 0.3, gurgle: 0 },
};
let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = audio.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

function startFizz() {
  const prof = { ...POUR_SOUND[drinkName] || POUR_SOUND.beer };
  if (drink.fizz > 1) prof.crackle = 1;
  startPourSound(prof);
}

function startPourSound(kind) {
  if (!audio) return;
  stopFizz();
  const P = typeof kind === 'string' ? POUR_SOUND[kind] : kind;
  const t = audio.currentTime;
  const out = audio.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(1, t + 0.25);
  out.connect(audio.destination);
  const nodes = [];
  // The rush of liquid.
  const src = noise();
  const band = audio.createBiquadFilter();
  band.type = 'bandpass'; band.frequency.value = P.f; band.Q.value = P.q;
  const g = audio.createGain(); g.gain.value = P.g;
  src.connect(band).connect(g).connect(out);
  src.start(); nodes.push(src);
  // A gurgle: the rush swells and dips a few times a second.
  if (P.gurgle) {
    const lfo = audio.createOscillator(); lfo.frequency.value = 5 + Math.random() * 3;
    const depth = audio.createGain(); depth.gain.value = P.g * P.gurgle * 0.8;
    lfo.connect(depth).connect(g.gain);
    lfo.start(); nodes.push(lfo);
  }
  // Fizz: sparse clicks, high-passed.
  if (P.crackle) {
    const len = audio.sampleRate;
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.004 * P.crackle ? (Math.random() * 2 - 1) : 0;
    const c = audio.createBufferSource(); c.buffer = buf; c.loop = true;
    const hp = audio.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const cg = audio.createGain(); cg.gain.value = 0.25 * P.crackle;
    c.connect(hp).connect(cg).connect(out);
    c.start(); nodes.push(c);
  }
  fizz = { out, nodes, drips: !!P.drips };
}

function stopFizz() {
  if (!fizz || !audio) { fizz = null; return; }
  const t = audio.currentTime;
  fizz.out.gain.setTargetAtTime(0.0001, t, 0.35);
  for (const n of fizz.nodes) n.stop(t + 2);
  fizz = null;
}

// Short sounds for extras landing in the glass.
function blip(f0, f1, dur, gain, type = 'sine', when = 0) {
  const t = audio.currentTime + when;
  const o = audio.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function splashNoise(f, dur, gain) {
  const t = audio.currentTime;
  const s = noise();
  const b = audio.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 0.9;
  const g = audio.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(b).connect(g).connect(audio.destination);
  s.start(t); s.stop(t + dur + 0.05);
}
function playExtraSound(kind, speed) {
  if (navigator.vibrate) navigator.vibrate(kind === 'ice' ? 30 : 10);
  if (!audio) return;
  const k = Math.min(1.3, speed / 900);
  if (kind === 'ice') {
    // A hard plunge, a splash, and ice clinking against ice and glass.
    blip(220, 70, 0.18, 0.35 * k);
    splashNoise(1600, 0.35, 0.22 * k);
    for (let i = 0; i < 3; i++) blip(2600 + Math.random() * 1600, 2400 + Math.random() * 1200, 0.12, 0.06, 'sine', 0.08 + i * 0.09 + Math.random() * 0.05);
  } else if (kind === 'lemon') {
    blip(420, 260, 0.09, 0.08 * k);
    splashNoise(2200, 0.12, 0.04 * k);
  } else if (kind === 'scoop') {
    blip(160, 60, 0.22, 0.3 * k);
    splashNoise(900, 0.25, 0.1 * k);
  }
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
  const want = { body: drink.bodyTex || `${drinkName}-body` };
  if (drink.photoAlpha === 0) delete want.body;
  if (drink.head !== 'none') want.head = drink.headTex || `${drinkName}-head`;
  if (drink.drops) want.condensation = 'condensation';
  if (drinkName === 'coffee' && drink.drops) want.condensation = 'condensation';
  if (drink.creamClouds) want.clouds = 'cream-clouds';
  if (drink.ice) want.ice = 'ice';
  if (drink.lemon) want.lemon = 'lemon';
  if (drink.float) want.scoop = 'scoop';
  if (!TEX.roomPhoto) want.roomPhoto = 'room';
  for (const [key, file] of Object.entries(want)) {
    const img = new Image();
    img.onload = () => {
      TEX[key] = img;
      if (key === 'head') {
        headPattern = buildHeadPattern2(img);
        if (useGL) GLR.setTexture('head', seamless(img, 'x'));
      }
      if (key === 'body') {
        bodyTile = seamless(seamless(img, 'x'), 'y');
        bodyPattern = ctx.createPattern(bodyTile, 'repeat');
        if (useGL) GLR.setTexture('body', bodyTile);
      }
      if (key === 'condensation' && useGL) GLR.setTexture('cond', img);
      if (key === 'clouds') cloudTile = tintClouds(img, drink.creamClouds);
      if (key === 'ice') { TEX.ice = lumaAlpha(img); iceCubes = splitIce(TEX.ice); }
      if (key === 'roomPhoto') {
        sprites.room = buildRoom();
        if (useGL) GLR.setTexture('room', sprites.room);
      }
    };
    img.src = `textures/${file}.${['lemon', 'scoop'].includes(key) ? 'png' : 'jpg'}`;
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

// Turn the white-on-black cream photo into a tinted layer whose alpha is its
// brightness, so it can be laid over the drink.
function tintClouds(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const [r, gg, b] = color.match(/\d+/g).map(Number);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
    data.data[i] = r; data.data[i + 1] = gg; data.data[i + 2] = b;
    data.data[i + 3] = Math.min(255, v * 1.3);
  }
  g.putImageData(data, 0, 0);
  // Feather the edges so the photo's border never shows.
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, c.height);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(0.25, 'rgba(0, 0, 0, 1)');
  v.addColorStop(0.75, 'rgba(0, 0, 0, 1)');
  v.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = v;
  g.fillRect(0, 0, c.width, c.height);
  const h = g.createLinearGradient(0, 0, c.width, 0);
  h.addColorStop(0, 'rgba(0, 0, 0, 0)');
  h.addColorStop(0.15, 'rgba(0, 0, 0, 1)');
  h.addColorStop(0.85, 'rgba(0, 0, 0, 1)');
  h.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = h;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Photos shot on black (ice): brightness becomes opacity, so they can be laid
// over anything without a black box.
function lumaAlpha(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]);
    d.data[i + 3] = Math.min(220, v * 1.15);
    const k = v ? 255 / v : 0;
    d.data[i] = Math.min(255, d.data[i] * k * 0.95);
    d.data[i + 1] = Math.min(255, d.data[i + 1] * k * 0.97);
    d.data[i + 2] = Math.min(255, d.data[i + 2] * k);
  }
  g.putImageData(d, 0, 0);
  return c;
}

// Draw an image to cover the portrait screen, in screen coordinates.
function drawCover(img, alignX = 0.5) {
  const k = Math.max(PW / img.width, PH / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (PW - w) * alignX, (PH - h) / 2, w, h);
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

// Active modifiers: from ?mods=a,b, else what was last picked for this drink.
function readMods() {
  const all = MODS[drinkName] || {};
  let ids = params.has('mods') ? params.get('mods').split(',') : null;
  if (!ids) {
    try { ids = JSON.parse(localStorage.getItem(`beer.mods.${drinkName}`) || 'null'); } catch { ids = null; }
  }
  ids = (ids || []).filter(id => all[id]);
  // Grouped choices (wine colour) keep only the last one picked.
  const seen = new Set();
  return ids.reverse().filter(id => {
    const g = all[id].group;
    if (!g) return true;
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  }).reverse();
}

function loadDrink() {
  try { return localStorage.getItem('beer.drink'); } catch { return null; }
}

// Drink and extras chips, on the start screen and in the in-glass sheet.
// Picking one switches live: no reload, and extras keep what's in the glass.
const DRINK_LABELS = { beer: 'Beer', butterbeer: 'Butterbeer', rootbeer: 'Root beer', wine: 'Wine', coffee: 'Coffee', water: 'Water' };

function renderChips(drinksEl, modsEl) {
  drinksEl.textContent = '';
  for (const [name, label] of Object.entries(DRINK_LABELS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(name === drinkName));
    b.addEventListener('click', () => { if (name !== drinkName) switchDrink(name, savedMods(name)); });
    drinksEl.appendChild(b);
  }
  modsEl.textContent = '';
  const all = MODS[drinkName] || {};
  modsEl.hidden = !Object.keys(all).length;
  for (const [id, mod] of Object.entries(all)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = mod.label;
    const on = activeMods.includes(id) || (mod.group && id === 'red' && !activeMods.some(m => all[m].group === mod.group));
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const next = activeMods.filter(m => m !== id && !(mod.group && all[m].group === mod.group));
      if (!on || mod.group) next.push(id);
      switchDrink(drinkName, next);
    });
    modsEl.appendChild(b);
  }
}

function savedMods(name) {
  try { return JSON.parse(localStorage.getItem(`beer.mods.${name}`) || '[]').filter(id => (MODS[name] || {})[id]); } catch { return []; }
}

function setupPicker() {
  renderChips(document.getElementById('picker'), document.getElementById('mods'));
  renderChips(document.getElementById('sheet-drinks'), document.getElementById('sheet-mods'));
  document.getElementById('title').textContent = drink.title;
  document.title = drink.title;
}

// Change drink or extras in place. A new drink is poured fresh; a change of
// extras keeps the glass as it is (creamer pours in, ice drops in).
function switchDrink(name, mods) {
  const fresh = name !== drinkName;
  const added = fresh ? [] : mods.filter(id => !activeMods.includes(id));
  const removed = fresh ? [] : activeMods.filter(id => !mods.includes(id));
  drinkName = name;
  activeMods = mods;
  drink = composeDrink(name, mods);
  FOAM = drink.foam;
  try {
    localStorage.setItem('beer.drink', name);
    localStorage.setItem(`beer.mods.${name}`, JSON.stringify(mods));
  } catch { /* ignore */ }
  const q = new URLSearchParams(location.search);
  q.set('drink', name);
  q.set('mods', mods.join(','));
  history.replaceState(null, '', `?${q}`);
  for (const k of Object.keys(TEX)) if (k !== 'roomPhoto') delete TEX[k];
  headPattern = bodyPattern = bodyTile = cloudTile = null;
  if (useGL) for (const k of ['body', 'head', 'cond']) GLR.setTexture(k, null);
  sprites = buildSprites();
  if (useGL) GLR.setTexture('room', sprites.room);
  loadTextures();
  beersDrunk = loadCount();
  legs = [];
  if (fresh) {
    bubbles = [];
    lace = [];
    creamAmt = 0;
    beer = 0;
    foamExtra = 0;
    if (!startEl.hidden) beer = FULL; else refill();
  } else if (drink.fizz <= 0) {
    bubbles = [];
  }
  if (!fresh) {
    for (const id of removed) {
      if (id === 'ice') [0, 1, 2].forEach(i => delete floatState[`ice${i}`]);
      if (id === 'lemon') delete floatState.lemon;
      if (id === 'float') delete floatState.scoop;
    }
    if (beer > 0.05 && state !== 'refilling') for (const id of added) addExtra(id);
    else pendingExtras.push(...added);
  }
  setupPicker();
}

// ---------- boot ----------

document.getElementById('start-btn').addEventListener('click', start);
const sheetEl = document.getElementById('sheet');
const extrasBtn = document.getElementById('extras-btn');
extrasBtn.addEventListener('click', e => { e.stopPropagation(); sheetEl.hidden = false; });
document.getElementById('sheet-done').addEventListener('click', e => { e.stopPropagation(); sheetEl.hidden = true; });
sheetEl.addEventListener('pointerdown', e => e.stopPropagation());
setupPicker();
loadTextures();
useGL = !params.has('gl') || params.get('gl') !== '0' ? GLR.init(glCanvas) : false;
if (!useGL) glCanvas.hidden = true;
canvas.addEventListener('pointerdown', e => {
  if (state === 'empty') { refill(); return; }
  // Tapping the glass sends a ripple and knocks loose a few bubbles.
  const r = canvas.getBoundingClientRect();
  const m = new DOMMatrix().translate(W / 2, H / 2).rotate(-screenAngle).translate(-PW / 2, -PH / 2).inverse();
  const pt = m.transformPoint(new DOMPoint(e.clientX - r.left, e.clientY - r.top));
  poke(toWorld(pt.x, pt.y).x, 280);
  if (drink.fizz > 0) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.6) * 90;
      const b = newBubble(pt.x + Math.cos(a) * d * 0.7, pt.y + Math.sin(a) * d, 0.5 + Math.random() * 1.3);
      b.v = 20 + Math.random() * 90;
      bubbles.push(b);
    }
  }
});
let lastAcc = null;
window.addEventListener('devicemotion', e => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  if (lastAcc) {
    const jerk = Math.hypot(a.x - lastAcc.x, a.y - lastAcc.y, a.z - lastAcc.z);
    shake = Math.max(shake, Math.min(1, (jerk - 1.5) / 20));
  }
  lastAcc = { x: a.x, y: a.y, z: a.z };
});
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
