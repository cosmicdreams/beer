// WebGL2 renderer for BEER. Every pixel of the glass is computed each frame:
// light from the room behind passes through a curved glass and is absorbed
// by the drink (thinner at the walls, so they glow), the room is refracted by
// the moving surface, caustics play through the liquid, and the head, cream
// and steam are generated from moving noise, so nothing on screen is static.
// app.js owns the simulation and hands this module its state every frame.
'use strict';

const GLR = (() => {
  let gl = null, prog = null, bubbleProg = null, quad = null, bubbleBuf = null;
  const loc = {}, bloc = {}, loc3 = {};
  let prog3d = null, waveTex = null, emptyBubbles = null;
  let flatPosition, glassPosition, bubbleCorner, bubblePosition;
  const tex = {};
  const WAVES = 128;

  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uDpr;
uniform mat3 uInv;          // screen css px -> portrait px
uniform vec2 uP;            // portrait width, height
uniform float uT;
uniform float uAngle;       // liquid frame rotation (gravity)
uniform float uLevel;
uniform float uFill;
uniform float uWaves[${WAVES}];
uniform vec2 uWet;          // where the surface meets the walls, liquid frame x
uniform float uShift;
uniform float uGrav;

uniform sampler2D uRoom;
uniform sampler2D uCond;
uniform float uCondAmt;
uniform vec3 uCondMap;      // flipX, flipY, alignX

uniform float uClear;
uniform vec3 uSigma;
uniform vec3 uBack;
uniform vec3 uScatter;
uniform sampler2D uBody;
uniform float uBodyMix;
uniform vec3 uBodyGain;
uniform float uFlow;
uniform vec3 uCaustic;
uniform float uCream;
uniform vec3 uCreamCol;
uniform float uCreamTop;
uniform vec3 uMenLip;
uniform vec3 uMenDark;
uniform vec3 uMenGlint;
uniform vec3 uSurfGlow;
uniform float uSurfGlowDepth;

uniform int uHead;          // 0 none, 1 foam, 2 cream, 3 crema
uniform sampler2D uHeadTex;
uniform float uHeadScale;
uniform float uFoamH;
uniform vec3 uHeadTop;
uniform vec3 uHeadBot;
uniform float uHeadLift;
uniform float uFoamShift;
uniform float uTendrils;
uniform int uSteam;
uniform sampler2D uFloat;   // floaters (ice, lemon, ice cream), drawn by app.js
uniform float uHasFloat;
uniform float uSeamFizz;    // fine bright bubbles packed under a beer head
uniform float uCondAbove;   // condensation strength on the dry glass above the drink
uniform vec2 uCreamAt;      // liquid-frame x and width where cream melts from (float)
uniform vec2 uCreamFrom;
uniform float uCreamMix;    // 0 = clouds, 1 = fully stirred in
uniform float uCreamT;      // cream's own clock: runs faster while the glass is shaken    // creamer: liquid-frame x it went in at, seconds since
uniform float uRipple;
uniform float uCremaGloss;
uniform sampler2D uBubbles;  // bubbles, drawn first into their own layer
uniform vec3 uWallGlow;
uniform float uShear;       // angular velocity of the slosh, to drag cream and tendrils
uniform vec3 uScoop;        // ice cream scoop: liquid-frame x, centre y, radius (0 if none)
uniform float uNoPops;
uniform vec4 uWineBowl;     // centre y, horizontal radius, vertical radius, rim y

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// Moving caustic light, after the well-known tileable water caustic.
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0, inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}

float waveAt(float x) {
  float span = max(1.0, uWet.y - uWet.x);
  float f = clamp((x - uWet.x) / span, 0.0, 1.0) * float(${WAVES - 1});
  int i = int(floor(f));
  int j = min(i + 1, ${WAVES - 1});
  float a = 0.0, b = 0.0;
  for (int k = 0; k < ${WAVES}; k++) { if (k == i) a = uWaves[k]; if (k == j) b = uWaves[k]; }
  return mix(a, b, fract(f)) + uRipple * (sin(x * 0.11 + uT * 3.1) + 0.7 * sin(x * 0.23 - uT * 4.3));
}
float surfaceAt(float x) {
  float curl = uHead == 0 ? 6.0 * (exp(-max(0.0, x - uWet.x) / 14.0) + exp(-max(0.0, uWet.y - x) / 14.0)) : 0.0;
  return uLevel + waveAt(x) - curl;
}

vec3 room(vec2 p) { return texture(uRoom, clamp(p / uP, 0.001, 0.999)).rgb; }

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = (uInv * vec3(css, 1.0)).xy;
  vec2 c = uP * 0.5;
  float ca = cos(uAngle), sa = sin(uAngle);
  vec2 d = p - c;
  vec2 w = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
  float halfWidth = c.x;
  if (uWineBowl.y > 0.0) {
    float height = (p.y - uWineBowl.x) / uWineBowl.z;
    halfWidth = uWineBowl.y * sqrt(max(0.0, 1.0 - height * height));
    if (p.y < uWineBowl.w || abs(p.x - c.x) >= halfWidth) {
      outColor = vec4(room(p), 1.0);
      return;
    }
  }
  float u = (p.x - c.x) / max(1.0, halfWidth);
  float thick = sqrt(max(0.02, 1.0 - u * u));
  float t = uT;

  vec3 col = room(p);

  float surf = surfaceAt(w.x);
  float depth = w.y - surf;
  bool wet = uFill > 0.5;

  if (wet && depth > -2.0) {
    // Light from the room behind, bent by the surface and the moving liquid.
    float slope = surfaceAt(w.x + 3.0) - surfaceAt(w.x - 3.0);
    vec2 wob = vec2(fbm(p * 0.008 + vec2(t * 0.05, 0.0)) - 0.5, fbm(p * 0.008 + vec2(3.1, -t * 0.04)) - 0.5);
    // A cylinder of liquid is a lens: the room behind is flipped left to
    // right, magnified, and squeezed toward the walls.
    float lensX = c.x - c.x * 0.8 * sin(u * 1.3) / sin(1.3);
    vec2 refr = vec2(lensX + uShift * 0.6, p.y - 12.0) + vec2(slope * 7.0, 0.0) + wob * 10.0;
    float blurR = 4.0 + 22.0 * smoothstep(0.25, 1.0, abs(u));
    vec3 bg = (room(refr) * 2.0 + room(refr + vec2(blurR, 0.0)) + room(refr - vec2(blurR, 0.0))
      + room(refr + vec2(0.0, blurR * 0.6)) + room(refr - vec2(0.0, blurR * 0.6))) / 6.0;
    float window = smoothstep(0.9, 0.0, length((p / uP - vec2(0.72, 0.1)) * vec2(1.0, 0.8)));
    vec3 back = bg * 0.9 + uBack * (0.55 + 0.45 * window);
    vec3 liq = back * exp(-uSigma * thick);
    // Light scattered inside cloudy drinks.
    liq += uScatter * (1.0 - exp(-thick * 1.6));

    if (uBodyMix > 0.0) {
      vec2 buv = vec2(w.x / uP.x + 0.5, w.y / uP.y + 0.5);
      vec2 flow = vec2(fbm(buv * 3.0 + vec2(0.0, t * 0.04)), fbm(buv * 3.0 + vec2(5.2, -t * 0.035))) - 0.5;
      buv += uFlow * flow + vec2(uShift / uP.x, t * 0.004);
      vec3 ph = texture(uBody, buv).rgb * uBodyGain;
      vec3 phLit = ph * (0.62 + 0.38 * thick) + (1.0 - thick) * 0.25 * uBack * exp(-uSigma * 0.3);
      liq = mix(liq, phLit, uBodyMix);
    }

    // Cream: clouds that billow, curl and slowly blend in.
    if (uCream > 0.0) {
      vec2 q = uCreamTop > 0.5 ? vec2(w.x * 0.011, w.y * 0.0035) : w * 0.0032;
      float ct = uCreamT;
      q.y -= ct * 0.05;
      q.x += uShear * max(0.0, depth) * 0.0015;
      vec2 warp = vec2(fbm(q * 1.6 + ct * 0.025), fbm(q * 1.6 - ct * 0.02 + 3.7));
      float dens = fbm(q + 1.6 * warp);
      float lo = 0.6 - 0.3 * uCream;
      dens = smoothstep(lo, lo + 0.45, dens) * uCream;
      // Thin curling filaments: ridges of warped noise.
      // Softer secondary curls on top of the main billows.
      dens += smoothstep(0.5, 0.8, fbm(q * 2.6 + 2.0 * warp + 5.0)) * 0.25 * uCream * exp(-max(0.0, depth) / 400.0);
      dens *= mix(1.0, exp(-max(0.0, depth) / 320.0), 0.6);
      if (uCreamTop > 0.5) dens *= exp(-max(0.0, depth) / 170.0) * exp(-pow((w.x - uCreamAt.x) / uCreamAt.y, 2.0));
      else {
        // Creamer plunges in where it is poured, then billows out and spreads.
        float age = uCreamFrom.y;
        float plunge = min(uP.y, 60.0 + age * 140.0);
        float spread = 25.0 + age * 55.0;
        float dx = (w.x - uCreamFrom.x) / spread;
        float dy = max(0.0, depth - plunge) / (spread * 1.4);
        float reach = exp(-dx * dx - dy * dy) * smoothstep(-20.0, 10.0, plunge - depth + 40.0);
        dens *= mix(reach * 1.6, 1.0, smoothstep(5.0, 16.0, age));
      }
      // Stirring: the clouds lose their contrast and the whole drink turns
      // an even milky brown.
      dens *= 1.0 - uCreamMix;
      vec3 cream = uCreamCol * (0.75 + 0.25 * thick);
      liq = mix(liq, cream, clamp(dens, 0.0, 0.85));
      float blend = uCreamTop > 0.5 ? 0.18 * exp(-max(0.0, depth) / 200.0) : 0.18 + 0.42 * uCreamMix;
      liq = mix(liq, uCreamCol * (0.62 + 0.18 * thick), uCream * blend);
    }

    // Caustics, brightest just under the surface.
    float cs = caustic(w * 0.007 + vec2(uShift * 0.003, 0.0), t * 0.5);
    liq += uCaustic * 0.6 * cs * smoothstep(0.0, 30.0, depth) * exp(-max(0.0, depth) / 260.0) * (0.35 + 0.65 * thick);

    // Glow under the surface for dark drinks, and gentle loss of light with depth.
    liq += uSurfGlow * exp(-max(0.0, depth) / max(1.0, uSurfGlowDepth));
    liq *= 1.0 - 0.22 * smoothstep(0.0, uP.y, depth);
    liq += uWallGlow * smoothstep(0.62, 1.0, abs(u)) * (0.6 + 0.4 * noise(p * 0.01 + t * 0.05));

    // A band of fine bright bubbles packed under a beer head.
    if (uSeamFizz > 0.0 && uHead == 1) {
      float fz = 0.0;
      for (int k = 0; k < 2; k++) {
        float sc = k == 0 ? 3.5 : 6.0;
        vec2 gp = vec2(w.x + uFoamShift * 0.3 + float(k) * 17.0, depth + float(k) * 5.0) / sc;
        vec2 cell = floor(gp);
        vec2 jit = vec2(hash(cell + 1.3), hash(cell + 7.7)) - 0.5;
        vec2 f = fract(gp) - 0.5 - jit * 0.6;
        float r = 0.1 + 0.18 * hash(cell);
        float present = step(0.45 + 0.35 * noise(cell * 0.35), hash(cell + 9.0));
        float fade = exp(-max(0.0, depth) / (12.0 + 30.0 * hash(cell + 4.0)));
        fz += (1.0 - smoothstep(r - 0.08, r, length(f))) * present * fade;
      }
      liq = mix(liq, vec3(1.0, 0.97, 0.88), clamp(fz, 0.0, 1.0) * uSeamFizz * 0.9);
    }

    // Cream tendrils sinking from a creamy head.
    if (uTendrils > 0.0 && uHead > 0) {
      vec2 tq = vec2(w.x * 0.025 + uFoamShift * 0.004 + uShear * depth * 0.002, depth * 0.014 - t * 0.09);
      tq += 1.5 * vec2(fbm(tq * 1.7 + t * 0.03), fbm(tq * 1.7 - t * 0.02 + 4.0));
      float m = smoothstep(0.52, 0.76, fbm(tq)) * exp(-max(0.0, depth) / 80.0) * uTendrils;
      liq = mix(liq, uHeadBot, m);
    }

    // Meniscus where nothing covers the surface: a lit lip, a dark band from
    // total internal reflection, a moving glint.
    if (uHead == 0) {
      // Seen from below, the surface mirrors the liquid: a silvery band.
      float band = smoothstep(1.0, 3.0, depth) * (1.0 - smoothstep(6.0, 13.0, depth));
      vec3 mirror = room(vec2(lensX, p.y + 40.0 + depth * 3.0)) * 1.15 + 0.06;
      liq = mix(liq, mirror * mix(vec3(1.0), uMenLip, 0.5), band * (uClear > 0.5 ? 0.5 : 0.3));
      liq = mix(liq, uMenDark, smoothstep(10.0, 13.0, depth) * (1.0 - smoothstep(13.0, 20.0, depth)) * 0.2);
      float hl = (1.0 - smoothstep(0.0, 1.0, abs(depth - 0.4))) * smoothstep(0.35, 0.75, noise(vec2(w.x * 0.03 + t * 0.3, 1.0)));
      liq += uMenGlint * hl * 0.35;
      liq += uMenGlint * smoothstep(0.4, 1.4, abs(slope)) * (1.0 - smoothstep(0.0, 8.0, depth)) * 0.25;
    }

    vec4 bub = texture(uBubbles, gl_FragCoord.xy / uRes);
    liq = liq * (1.0 - bub.a) + bub.rgb;
    float edge = smoothstep(-2.0, 0.8, depth);
    col = mix(col, liq, edge);
  }

  // Floaters: dry above the surface; below it, seen through the liquid -
  // shifted, tinted by absorption and dimmed.
  if (uHasFloat > 0.5) {
    vec2 fuv = p / uP;
    vec4 fl;
    if (wet && depth > 0.0) {
      vec2 off = vec2(-u * 4.0, -3.0) + 3.0 * vec2(noise(p * 0.05 + t), noise(p * 0.05 - t)) - 1.5;
      fl = texture(uFloat, (p + off) / uP);
      fl.rgb *= exp(-uSigma * 0.35) * 0.82;
      fl.rgb = mix(fl.rgb, fl.rgb * 0.9 + 0.1 * uBack, 0.3);
    } else {
      fl = texture(uFloat, fuv);
    }
    // Contact: a thin bright line where a floater crosses the surface.
    if (wet && abs(depth) < 1.2) fl.rgb += 0.15 * fl.a;
    col = mix(col, fl.rgb, fl.a);
  }

  // The head: foam, cream or crema, sampled from its photo through moving
  // noise, with lit top, soft base that melts into the drink, and popping cells.
  if (wet && uHead > 0) {
    float lumpAmp = uHead == 1 ? 0.35 : (uHead == 2 ? 0.45 : 0.25);
    float lump = (fbm(vec2(w.x * 0.018 + uFoamShift * 0.004, t * 0.04)) - 0.5) * uFoamH * lumpAmp;
    float top = surf - uFoamH + lump;
    if (uScoop.z > 0.0) top -= 10.0 * exp(-pow((w.x - uScoop.x) / (uScoop.z * 0.9), 2.0));
    float reach = uHead == 3 ? 8.0 : 16.0;
    if (w.y > top - 2.0 && w.y < surf + reach) {
      float hv = clamp((w.y - top) / max(1.0, surf - top), 0.0, 1.0);
      vec2 huv = vec2(w.x + uFoamShift + t * 1.2, w.y - top + 60.0) * uHeadScale / 1024.0;
      huv += 0.004 * vec2(fbm(huv * 40.0 + t * 0.2), fbm(huv * 40.0 - t * 0.2)) ;
      vec3 h = texture(uHeadTex, huv).rgb;
      vec3 tint = mix(uHeadTop, uHeadBot, hv);
      h = mix(h * tint * 1.25, tint, uHeadLift * (1.0 - hv));
      h *= 0.82 + 0.18 * (1.0 - hv);
      h *= 0.86 + 0.14 * thick;
      // Bubbles in the head pop: cells blink out and back.
      vec2 hp = vec2(w.x + uFoamShift, w.y - top) / 4.0;
      vec2 cell = floor(hp);
      float life = fract(hash(cell) * 7.0 + t * (0.15 + hash(cell + 3.0) * 0.4));
      float round1 = 1.0 - smoothstep(0.15, 0.4, length(fract(hp) - 0.5));
      h += vec3(0.07) * smoothstep(0.94, 1.0, life) * round1 * (1.0 - hv) * (1.0 - uNoPops);
      if (uScoop.z > 0.0) {
        // The scoop shades the foam just below and beside it.
        float dsc = length(vec2(w.x - uScoop.x, (w.y - uScoop.y - uScoop.z * 0.6) * 1.6));
        h *= 1.0 - 0.3 * exp(-pow(dsc / (uScoop.z * 0.9), 2.0));
      }
      if (uHead == 3) {
        // Crema: a thin glossy film; tiny tan bubbles crowd against the glass.
        float wallD = min(w.x - uWet.x, uWet.y - w.x);
        vec2 bp = vec2(w.x, w.y - top) / 2.5;
        vec2 bc = floor(bp);
        float bb = (1.0 - smoothstep(0.2, 0.42, length(fract(bp) - 0.5 - (vec2(hash(bc), hash(bc + 2.0)) - 0.5) * 0.4)))
          * step(0.5, hash(bc + 5.0)) * (1.0 - smoothstep(0.0, 26.0, wallD));
        h = mix(h, vec3(0.82, 0.62, 0.4), bb * 0.8);
        h += vec3(0.12, 0.1, 0.08) * (1.0 - smoothstep(0.0, 3.0, w.y - top)) * noise(vec2(w.x * 0.05 + t * 0.3, 2.0));
      }
      if (uCremaGloss > 0.0) h += vec3(1.0, 0.92, 0.8) * uCremaGloss * (1.0 - smoothstep(0.0, 1.6, w.y - top));
      float pore = noise(vec2(w.x * 0.35, t * 0.2 + w.y * 0.1));
      float rag = (fbm(vec2(w.x * 0.06 + uFoamShift * 0.01, t * 0.05)) - 0.5) * 10.0;
      h = mix(h, h * 0.86, smoothstep(surf - 6.0 + rag, surf + reach + rag, w.y));
      float a = smoothstep(top - 1.5, top + 1.5 + 2.5 * pore, w.y) * (1.0 - smoothstep(surf - 4.0 + rag, surf + reach + rag, w.y));
      col = mix(col, h, a);
    }
  }

  // Steam rising off hot coffee.
  if (wet && uSteam == 1) {
    float top = surf - uFoamH;
    float above = top - w.y;
    if (above > 0.0) {
      vec2 q = vec2(w.x * 0.01, w.y * 0.008 + t * 0.12);
      vec2 warp = vec2(fbm(q * 1.5 + t * 0.05), fbm(q * 1.5 - t * 0.04 + 2.0));
      float s = fbm(q + 1.4 * warp);
      float dens = smoothstep(0.42, 0.92, s) * exp(-above / 170.0) * smoothstep(0.0, 25.0, above);
      col = mix(col, vec3(0.95, 0.94, 0.92), dens * 0.32);
    }
  }

  // The glass: refraction darkens the very edges, a fresnel reflection of the
  // room grows toward them, and highlights drift as the phone turns.
  col *= 1.0 - 0.38 * smoothstep(0.92, 1.0, abs(u));
  float au = abs(u);
  col += vec3(0.9, 0.92, 0.95) * (exp(-pow((au - 0.958) / 0.003, 2.0)) * 0.1 + exp(-pow((au - 0.988) / 0.002, 2.0)) * 0.16);
  col *= 1.0 - exp(-pow((au - 0.972) / 0.004, 2.0)) * 0.18;
  vec3 refl = room(vec2(uP.x - p.x, p.y));
  col = mix(col, refl, 0.1 * pow(abs(u), 3.0));
  float xn = p.x / uP.x;
  float vfade = smoothstep(0.0, 0.2, p.y / uP.y) * smoothstep(1.0, 0.75, p.y / uP.y);
  float h1 = exp(-pow((xn - (0.045 + 0.012 * sin(uGrav))) / 0.014, 2.0)) * 0.07;
  float h2 = exp(-pow((xn - (0.86 + 0.03 * sin(uGrav))) / 0.045, 2.0)) * 0.07;
  col += vec3(h1 + h2) * (0.4 + 0.6 * vfade);

  // Condensation on cold glass.
  if (uCondAmt > 0.0) {
    vec2 cuv = p / uP;
    if (uCondMap.x < 0.0) cuv.x = 1.0 - cuv.x;
    float aspect = (uP.x / uP.y) / (768.0 / 1152.0);
    cuv.x = (cuv.x - 0.5) * aspect + 0.5 + (uCondMap.z - 0.5) * (1.0 - aspect);
    vec3 m = texture(uCond, cuv).rgb;
    float above1 = texture(uCond, cuv - vec2(0.0, 0.004)).r;
    float where = wet ? mix(uCondAbove, 1.0, smoothstep(-14.0, 14.0, depth)) : uCondAbove;
    // Each bead refracts: its lower rim goes dark, its highlight stays bright.
    col *= 1.0 - clamp(above1 - m.r, 0.0, 1.0) * 0.7 * uCondAmt * where;
    col = 1.0 - (1.0 - col) * (1.0 - m * 0.8 * uCondAmt * where);
  }

  float vig = smoothstep(1.25, 0.35, length((p / uP - 0.5) * vec2(1.0, 0.8)));
  col *= 0.8 + 0.2 * vig;
  outColor = vec4(col, 1.0);
}`;

  // Bubbles: instanced point sprites, shaded like a macro photo of a bubble.
  const BVERT = `#version 300 es
in vec2 aCorner;
in vec3 aBubble;            // portrait x, y, radius
uniform vec2 uRes;
uniform float uDpr;
uniform mat3 uFwd;          // portrait px -> screen css px
out vec2 vLocal;
void main() {
  vLocal = aCorner;
  vec2 p = aBubble.xy + aCorner * aBubble.z * 1.15;
  vec2 css = (uFwd * vec3(p, 1.0)).xy;
  vec2 clip = css * uDpr / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;
  const BFRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec3 uTint;
out vec4 outColor;
void main() {
  float r = length(vLocal) / 1.15;
  if (r > 1.0) discard;
  float rim = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float dark = smoothstep(0.45, 0.75, r) * (1.0 - smoothstep(0.82, 0.95, r));
  float spec = 1.0 - smoothstep(0.0, 0.22, length(vLocal - vec2(-0.35, -0.38)));
  float crescent = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.78, 0.9, r)) * smoothstep(0.0, 0.6, vLocal.y);
  // A visible sphere: dark refracting ring, a bright rim catching light on
  // the upper left, a hot specular point, a faint caustic crescent below.
  float lit = smoothstep(0.2, -0.8, dot(normalize(vLocal + 1e-4), vec2(0.7, 0.7)));
  vec3 c = uTint * (0.3 + 0.9 * rim * lit) + vec3(1.0) * spec + uTint * crescent * 0.5;
  float a = clamp(0.12 + rim * (0.35 + 0.5 * lit) + spec * 0.95 + dark * 0.35, 0.0, 1.0);
  c = mix(c, vec3(0.05, 0.025, 0.0), dark * 0.55);
  outColor = vec4(c * a, a);
}`;


  // ---- 3D glass: every pixel's line of sight is traced through a real
  // cylinder of glass and water. Light reflects off the glass, bends into the
  // water, mirrors off the underside of the surface, passes through ice, and
  // bends out the back wall before it reaches the room behind.
  const FRAG3D = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uDpr;
uniform mat3 uInv;
uniform vec2 uP;
uniform float uT;
uniform vec3 uG;            // gravity in the glass frame: x right, y down, z into the screen
uniform float uLevel;       // the surface is where dot(q, uG) = uLevel (plus waves)
uniform float uFill;
uniform sampler2D uWaveTex; // 128 x 2: waves across the glass, and front to back
uniform vec4 uRings[4];     // ripples: x, z, age, amplitude
uniform sampler2D uRoom;
uniform sampler2D uCond;
uniform sampler2D uFloat;
uniform sampler2D uBubbles;
uniform float uHasFloat;
uniform float uCondAmt;
uniform vec3 uCondMap;
uniform vec3 uSigma;
uniform int uIceN;
uniform vec3 uIcePos[5];
uniform mat3 uIceRot[5];
uniform float uIceSize;

float R, Ri, eyeY, camC, zRoom;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fresnel(float c, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }

float waveRow(float f, int row) {
  f = clamp(f, 0.0, 1.0) * 127.0;
  int i = int(floor(f));
  int j = min(i + 1, 127);
  return mix(texelFetch(uWaveTex, ivec2(i, row), 0).r, texelFetch(uWaveTex, ivec2(j, row), 0).r, fract(f));
}
// How far the surface sits below its resting plane at (x, z). Negative = raised.
float surf(vec2 xz) {
  float h = waveRow(xz.x / (2.0 * Ri) + 0.5, 0) + waveRow(xz.y / (2.0 * Ri) + 0.5, 1);
  for (int i = 0; i < 4; i++) {
    vec4 r = uRings[i];
    if (r.w > 0.0) {
      float ph = length(xz - r.xy) - r.z * 230.0;
      h -= r.w * exp(-r.z * 1.5) * sin(ph * 0.11) * exp(-ph * ph / 5000.0);
    }
  }
  h += 0.4 * sin(xz.x * 0.09 + uT * 3.1) + 0.14 * sin(xz.y * 0.05 - uT * 2.7) + 0.1 * sin((xz.x + xz.y * 0.3) * 0.2 + uT * 4.3);
  // The meniscus climbs the glass.
  h -= 5.0 * exp(-max(0.0, Ri - length(xz)) / 7.0);
  return h;
}
float depthAt(vec3 q) { return dot(q, uG) - uLevel - surf(q.xz); }

// The room behind the glass, as a far wall.
vec3 roomAt(vec3 P, vec3 d, float lod) {
  float dz = max(d.z, 0.12);
  vec2 hit = P.xy + d.xy / dz * (zRoom - P.z);
  float m = (zRoom + R) / camC;
  vec2 uv = vec2(hit.x / uP.x + 0.5, (hit.y + eyeY * m) / (1.0 + m) / uP.y + 0.5);
  return textureLod(uRoom, uv, lod).rgb;
}
// The room in front of the glass (behind you), for reflections.
vec3 envRefl(vec3 d, float lod) {
  vec2 uv = vec2(0.5 - d.x * 0.55, 0.42 + d.y * 0.55);
  return textureLod(uRoom, uv, lod).rgb * 0.6;
}
// An ice cube: a box with well-melted corners and a slightly lumpy skin.
float sdIce(vec3 pl, float h) {
  float r = h * 0.3;
  vec3 q = abs(pl) - (h - r);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
vec3 roundNormal(vec3 pl, float h) {
  float r = h * 0.3;
  vec3 q = abs(pl) - (h - r);
  float m = max(q.x, max(q.y, q.z));
  vec3 n = m > 0.0 ? normalize(max(q, 0.0)) : step(vec3(m), q);
  vec3 u = pl / h * 2.2;   // lumps scale with the cube
  n = sign(pl) * n + 0.1 * (vec3(noise(u.yz), noise(u.zx + 3.0), noise(u.xy + 7.0)) - 0.5);
  return normalize(n);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = (uInv * vec3(css, 1.0)).xy;
  float x = p.x - uP.x * 0.5, ys = p.y - uP.y * 0.5;
  R = uP.x * 0.5 * 0.992;
  Ri = R - 4.5;
  eyeY = uP.y * 0.1;
  camC = uP.y * 2.4;
  zRoom = R * 3.6;

  vec3 d = normalize(vec3(0.0, (ys - eyeY) / camC, 1.0));
  vec3 o = vec3(x, ys, -R);
  vec3 col;
  bool wetFront = false;

  if (abs(x) >= R) {
    col = roomAt(o, d, 0.5);
  } else {
    // Front of the glass: a reflection of the room, stronger toward the edges.
    float zf = -sqrt(R * R - x * x);
    vec3 P = o + d * ((zf - o.z) / d.z);
    vec3 n1 = vec3(P.x, 0.0, P.z) / R;
    float F1 = fresnel(dot(-d, n1), 0.04);
    col = envRefl(reflect(d, n1), 3.0) * F1;
    vec3 thr = vec3(1.0 - F1);

    if (abs(x) >= Ri) {
      // Looking along the glass wall itself: dark, with a bright inner line.
      col += thr * roomAt(P, d, 2.0) * 0.35;
    } else {
      float zi = -sqrt(Ri * Ri - x * x);
      P = o + d * ((zi - o.z) / d.z);
      vec3 n = vec3(P.x, 0.0, P.z) / Ri;
      bool inW = uFill > 0.5 && depthAt(P) > 0.0;
      wetFront = inW;
      if (inW) d = refract(d, n, 1.0 / 1.33);
      o = P + d * 0.5;
      float lod = 0.6;
      bool done = false;
      float half1 = uIceSize * 0.5;

      for (int step = 0; step < 9; step++) {
        // Where this ray leaves through the glass wall.
        float A = dot(d.xz, d.xz), B = dot(o.xz, d.xz), Cc = dot(o.xz, o.xz) - Ri * Ri;
        float tC = A > 1e-6 ? (-B + sqrt(max(0.0, B * B - A * Cc))) / A : 1e5;
        // Where it meets the water surface.
        float tS = 1e6;
        if (uFill > 0.5) {
          float a0 = dot(o, uG) - uLevel, b0 = dot(d, uG);
          if (abs(b0) > 1e-4) {
            float t = -a0 / b0;
            for (int k = 0; k < 2; k++) { vec3 q = o + d * t; t = -(a0 - surf(q.xz)) / b0; }
            if (t > 0.6 && t < tC) tS = t;
          }
        }
        // The nearest ice cube.
        float tI = 1e6; int ik = -1;
        for (int k = 0; k < 5; k++) {
          if (k >= uIceN) break;
          vec3 ol = (o - uIcePos[k]) * uIceRot[k], dl = d * uIceRot[k];
          vec3 m = 1.0 / dl, nn = m * ol, kk = abs(m) * half1;
          vec3 t1 = -nn - kk, t2 = -nn + kk;
          float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
          if (tN < tF && tF > 0.6 && tN < tI) {
            // Walk up to the rounded shape inside its box.
            float t = max(tN, 0.6);
            bool hit = false;
            for (int j = 0; j < 14; j++) {
              float dist = sdIce(ol + dl * t, half1);
              if (dist < 0.35) { hit = true; break; }
              t += dist;
              if (t > tF) break;
            }
            if (hit && t > 0.6 && t < tI) { tI = t; ik = k; }
          }
        }
        float tMin = min(tC, min(tS, tI));
        if (inW) thr *= exp(-uSigma * tMin / R);

        if (ik >= 0 && tI <= tMin) {
          // Ice: nearly invisible under water, glassy above it. Its edges
          // catch light, its core is cloudy, and it bends what's behind it.
          vec3 q = o + d * tI;
          vec3 cpos = uIcePos[ik]; mat3 Rm = uIceRot[ik];
          vec3 pl = (q - cpos) * Rm;
          vec3 nI = Rm * roundNormal(pl, half1);
          bool wq = uFill > 0.5 && depthAt(q) > 0.0;
          float Fi = fresnel(dot(-d, nI), wq ? 0.002 : 0.03) * (wq ? 0.4 : 1.0);
          col += thr * Fi * envRefl(reflect(d, nI), 2.0) * 1.5;
          thr *= 1.0 - Fi;
          vec3 a = abs(pl) / half1;
          float mid = a.x + a.y + a.z - max(a.x, max(a.y, a.z)) - min(a.x, min(a.y, a.z));
          float edge = smoothstep(0.7, 1.0, mid);
          col += thr * edge * vec3(0.8, 0.88, 0.95) * (wq ? 0.07 : 0.2);
          col += thr * vec3(0.8, 0.9, 1.0) * 0.035;
          vec3 di = refract(d, nI, (wq ? 1.33 : 1.0) / 1.31);
          if (dot(di, di) < 1e-6) di = d;
          vec3 dl = di * Rm;
          vec3 tt = (sign(dl) * half1 - pl) / dl;
          float tx = max(0.5, min(tt.x, min(tt.y, tt.z)));
          vec3 qe = q + di * tx;
          vec3 ple = (qe - cpos) * Rm;
          vec3 nE = Rm * roundNormal(ple, half1);
          // Trapped air and cracks: a cloudy heart.
          float tc = clamp(dot(cpos - q, di), 0.0, tx);
          vec3 mp = (q + di * tc - cpos) * Rm;
          float dc = length(mp) / half1;
          // Frozen-in air: a white heart with feathery streaks radiating from it.
          float ang = atan(mp.y, mp.x) * 3.0 + mp.z * 0.08;
          float streak = 0.6 + 0.8 * noise(vec2(ang, length(mp) * 0.09)) * noise(mp.xy * 0.3 + 7.0);
          float core = exp(-dc * dc * 3.2) * streak;
          core = clamp(core * (wq ? 0.75 : 0.9), 0.0, 0.85);
          col += thr * core * vec3(0.86, 0.92, 0.98) * 0.75;
          thr *= 1.0 - core * 0.6;
          bool we = uFill > 0.5 && depthAt(qe) > 0.0;
          vec3 dout = refract(di, -nE, 1.31 / (we ? 1.33 : 1.0));
          if (dot(dout, dout) < 1e-6) dout = reflect(di, -nE);
          d = dout; o = qe + d * 0.7; inW = we;
          lod = max(lod, wq ? 1.2 : 2.0);
          continue;
        }
        if (tS <= tMin) {
          vec3 q = o + d * tS;
          float e = 2.0;
          float s0 = surf(q.xz);
          vec3 grad = uG - vec3(surf(q.xz + vec2(e, 0.0)) - s0, 0.0, surf(q.xz + vec2(0.0, e)) - s0) / e;
          vec3 Ns = -normalize(grad);   // points up, into the air
          if (inW) {
            vec3 r = refract(d, -Ns, 1.33);
            if (dot(r, r) < 1e-6) { d = reflect(d, Ns); thr *= 0.97; }   // the underside mirrors
            else { d = r; inW = false; }
          } else {
            float Fs = fresnel(dot(-d, Ns), 0.02);
            col += thr * Fs * envRefl(reflect(d, Ns), 2.0) * 1.6;
            thr *= 1.0 - Fs;
            d = refract(d, Ns, 1.0 / 1.33);
            inW = true;
          }
          o = q + d * 0.7;
          continue;
        }
        // Out through the back wall.
        vec3 q = o + d * tC;
        vec3 n2 = vec3(q.x, 0.0, q.z) / Ri;
        if (inW) {
          vec3 r = refract(d, -n2, 1.33);
          if (dot(r, r) < 1e-6) { d = reflect(d, n2); o = q + d * 0.7; thr *= 0.9; continue; }
          d = r;
        }
        o = q; done = true;
        break;
      }
      col += thr * roomAt(o, d, lod);
      // Bubbles in sparkling water.
      if (wetFront) { vec4 bub = texture(uBubbles, gl_FragCoord.xy / uRes); col = col * (1.0 - bub.a) + bub.rgb; }
    }
  }

  // A slice of lemon or other floaters, drawn by app.js.
  if (uHasFloat > 0.5) {
    vec4 fl = texture(uFloat, p / uP);
    if (wetFront) fl.rgb *= vec3(0.86, 0.92, 0.9);
    col = mix(col, fl.rgb, fl.a);
  }

  // The glass wall seen edge-on: a dark band and bright lines.
  float au = abs(x) / R;
  col *= 1.0 - 0.28 * smoothstep(0.955, 0.985, au) * (1.0 - smoothstep(0.985, 1.0, au));
  col += vec3(0.9, 0.93, 0.96) * (exp(-pow((au - 0.972) / 0.004, 2.0)) * 0.12 + exp(-pow((au - 0.995) / 0.003, 2.0)) * 0.2);

  // Condensation: heavy where cold water is behind the glass.
  if (uCondAmt > 0.0) {
    vec2 cuv = p / uP;
    if (uCondMap.x < 0.0) cuv.x = 1.0 - cuv.x;
    float aspect = (uP.x / uP.y) / (768.0 / 1152.0);
    cuv.x = (cuv.x - 0.5) * aspect + 0.5 + (uCondMap.z - 0.5) * (1.0 - aspect);
    vec3 m = texture(uCond, cuv).rgb;
    float above1 = texture(uCond, cuv - vec2(0.0, 0.004)).r;
    float where = wetFront ? 1.0 : 0.06;
    col *= 1.0 - clamp(above1 - m.r, 0.0, 1.0) * 0.7 * uCondAmt * where;
    col = 1.0 - (1.0 - col) * (1.0 - m * 0.8 * uCondAmt * where);
  }

  float vig = smoothstep(1.25, 0.35, length((p / uP - 0.5) * vec2(1.0, 0.8)));
  col *= 0.82 + 0.18 * vig;
  outColor = vec4(col, 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function locateUniforms(program, source, locations) {
    for (const match of source.matchAll(/uniform\s+\w+\s+(\w+)/g)) {
      locations[match[1]] = gl.getUniformLocation(program, match[1]);
    }
  }

  function prepare(mode3d) {
    if (!gl) return false;
    try {
      if (mode3d && !prog3d) {
        prog3d = link(VERT, FRAG3D);
        glassPosition = gl.getAttribLocation(prog3d, 'aPos');
        locateUniforms(prog3d, FRAG3D, loc3);
        waveTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, waveTex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, WAVES, 2);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else if (!mode3d && !prog) {
        prog = link(VERT, FRAG);
        flatPosition = gl.getAttribLocation(prog, 'aPos');
        locateUniforms(prog, FRAG, loc);
      }
    } catch (e) {
      gl = null;
      console.warn('WebGL unavailable, using the 2D renderer:', e.message);
      return false;
    }
    return true;
  }

  function init(canvas, mode3d) {
    try {
      gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false });
      if (!gl || !prepare(mode3d)) return false;
      bubbleProg = link(BVERT, BFRAG);
    } catch (e) {
      gl = null;
      console.warn('WebGL unavailable, using the 2D renderer:', e.message);
      return false;
    }
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    bubbleBuf = gl.createBuffer();
    locateUniforms(bubbleProg, BVERT + BFRAG, bloc);
    bubbleCorner = gl.getAttribLocation(bubbleProg, 'aCorner');
    bubblePosition = gl.getAttribLocation(bubbleProg, 'aBubble');
    // Placeholders until the real textures arrive.
    for (const k of ['room', 'cond', 'body', 'head', 'float']) setTexture(k, null);
    emptyBubbles = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, emptyBubbles);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return true;
  }

  function setTexture(key, source) {
    if (!gl) return;
    if (!tex[key]) tex[key] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex[key]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = key === 'room' ? gl.MIRRORED_REPEAT : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  // Per-frame upload for the floater layer: no mipmaps.
  function updateLayer(key, source) {
    if (!gl) return;
    if (!tex[key]) tex[key] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex[key]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize(width, height) {
    if (!gl) return;
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(v => Number(v) / 255);

  function render(s) {
    const bubbles = drawBubbles(s);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(flatPosition);
    gl.vertexAttribPointer(flatPosition, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);

    const f1 = (n, v) => loc[n] && gl.uniform1f(loc[n], v);
    const i1 = (n, v) => loc[n] && gl.uniform1i(loc[n], v);
    const v2 = (n, a, b) => loc[n] && gl.uniform2f(loc[n], a, b);
    const v3 = (n, v) => loc[n] && gl.uniform3fv(loc[n], v);
    v2('uRes', gl.canvas.width, gl.canvas.height);
    f1('uDpr', s.dpr);
    gl.uniformMatrix3fv(loc.uInv, false, s.inv);
    v2('uP', s.PW, s.PH);
    f1('uT', s.time);
    f1('uAngle', s.angle);
    f1('uLevel', s.level);
    f1('uFill', s.fill);
    gl.uniform1fv(loc.uWaves, s.waves);
    v2('uWet', s.wetL, s.wetR);
    f1('uShift', s.shift);
    f1('uGrav', s.grav);
    f1('uCondAmt', s.condAmt);
    v3('uCondMap', s.condMap);
    const L = s.look;
    f1('uClear', L.clear ? 1 : 0);
    v3('uSigma', L.sigma);
    v3('uBack', L.back);
    v3('uScatter', L.scatter);
    f1('uBodyMix', s.hasBody ? L.bodyMix : 0);
    v3('uBodyGain', L.bodyGain);
    f1('uFlow', L.flow);
    v3('uCaustic', L.caustic);
    f1('uCream', s.cream);
    v3('uCreamCol', L.creamCol);
    f1('uCreamTop', L.creamTop ? 1 : 0);
    v3('uMenLip', L.menLip);
    v3('uMenDark', L.menDark);
    v3('uMenGlint', L.menGlint);
    v3('uSurfGlow', L.surfGlow);
    f1('uSurfGlowDepth', L.surfGlowDepth);
    i1('uHead', s.hasHead ? L.head : 0);
    f1('uHeadScale', L.headScale);
    f1('uFoamH', s.foamH);
    v3('uHeadTop', L.headTop);
    v3('uHeadBot', L.headBot);
    f1('uHeadLift', L.headLift);
    f1('uFoamShift', s.foamShift);
    f1('uTendrils', L.tendrils);
    i1('uSteam', L.steam ? 1 : 0);
    f1('uHasFloat', s.hasFloat ? 1 : 0);
    f1('uSeamFizz', L.seamFizz || 0);
    f1('uCondAbove', s.condAbove);
    v2('uCreamAt', s.creamAt[0], s.creamAt[1]);
    v2('uCreamFrom', s.creamFrom[0], s.creamFrom[1]);
    f1('uCreamMix', s.creamMix);
    f1('uCreamT', s.creamT);
    f1('uRipple', L.ripple);
    f1('uCremaGloss', L.cremaGloss || 0);
    v3('uWallGlow', L.wallGlow || [0, 0, 0]);
    f1('uShear', s.shear);
    v3('uScoop', s.scoop);
    f1('uNoPops', L.noPops ? 1 : 0);
    const bowl = s.wineBowl;
    if (bowl) gl.uniform4f(loc.uWineBowl, bowl.cy, bowl.rx, bowl.ry, bowl.rim);
    else gl.uniform4f(loc.uWineBowl, 0, 0, 0, 0);

    const bind = (unit, key, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex[key]);
      i1(name, unit);
    };
    bind(0, 'room', 'uRoom');
    bind(1, 'cond', 'uCond');
    bind(2, 'body', 'uBody');
    bind(3, 'head', 'uHeadTex');
    bind(4, 'float', 'uFloat');
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, bubbles);
    i1('uBubbles', 5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Bubbles go into their own layer first, so the main pass can put them
  // inside the liquid, under the glass and condensation.
  let bubbleFbo = null, bubbleTex = null, fboW = 0, fboH = 0;
  function drawBubbles(s) {
    const n = s.bubbles.length / 3;
    if (n === 0) return emptyBubbles;
    const W = gl.canvas.width, H = gl.canvas.height;
    if (!bubbleFbo || fboW !== W || fboH !== H) {
      bubbleTex = bubbleTex || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, bubbleTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      bubbleFbo = bubbleFbo || gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, bubbleFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bubbleTex, 0);
      fboW = W; fboH = H;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, bubbleFbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(bubbleProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(bloc.uRes, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(bloc.uDpr, s.dpr);
    gl.uniformMatrix3fv(bloc.uFwd, false, s.fwd);
    gl.uniform3fv(bloc.uTint, s.bubbleTint);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(bubbleCorner);
    gl.vertexAttribPointer(bubbleCorner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(bubbleCorner, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, s.bubbles, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(bubblePosition);
    gl.vertexAttribPointer(bubblePosition, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(bubblePosition, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.vertexAttribDivisor(bubblePosition, 0);
    gl.disableVertexAttribArray(bubblePosition);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    return bubbleTex;
  }

  // The 3D glass. `s.waves` is 256 floats: 128 across, then 128 front to back.
  function render3d(s) {
    const bubbles = drawBubbles(s);
    gl.useProgram(prog3d);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(glassPosition);
    gl.vertexAttribPointer(glassPosition, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    const L = loc3;
    gl.uniform2f(L.uRes, gl.canvas.width, gl.canvas.height);
    gl.uniform1f(L.uDpr, s.dpr);
    gl.uniformMatrix3fv(L.uInv, false, s.inv);
    gl.uniform2f(L.uP, s.PW, s.PH);
    gl.uniform1f(L.uT, s.time);
    gl.uniform3fv(L.uG, s.g);
    gl.uniform1f(L.uLevel, s.level);
    gl.uniform1f(L.uFill, s.fill);
    gl.uniform4fv(L.uRings, s.rings);
    gl.uniform1f(L.uHasFloat, s.hasFloat ? 1 : 0);
    gl.uniform1f(L.uCondAmt, s.condAmt);
    gl.uniform3fv(L.uCondMap, s.condMap);
    gl.uniform3fv(L.uSigma, s.sigma);
    gl.uniform1i(L.uIceN, s.iceN);
    gl.uniform3fv(L.uIcePos, s.icePos);
    gl.uniformMatrix3fv(L.uIceRot, false, s.iceRot);
    gl.uniform1f(L.uIceSize, s.iceSize);
    const bind = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(L[name], unit); };
    bind(0, tex.room, 'uRoom');
    bind(1, tex.cond, 'uCond');
    bind(2, tex.float, 'uFloat');
    bind(3, bubbles, 'uBubbles');
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RED, gl.FLOAT, s.waves);
    gl.uniform1i(L.uWaveTex, 4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { init, prepare, setTexture, updateLayer, resize, render, render3d, rgb, WAVES, get ok() { return !!gl; } };
})();
