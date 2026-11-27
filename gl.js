// WebGL2 renderer for BEER. Every pixel of the glass is computed each frame:
// light from the room behind passes through a curved glass and is absorbed
// by the drink (thinner at the walls, so they glow), the room is refracted by
// the moving surface, caustics play through the liquid, and the head, cream
// and steam are generated from moving noise, so nothing on screen is static.
// app.js owns the simulation and hands this module its state every frame.
'use strict';

const GLR = (() => {
  let gl = null, prog = null, bubbleProg = null, quad = null, bubbleBuf = null;
  let loc = {}, bloc = {};
  const tex = {};
  const WAVES = 64;

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
  return mix(a, b, fract(f)) + 0.35 * sin(x * 0.11 + uT * 3.1) + 0.25 * sin(x * 0.23 - uT * 4.3);
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
  float u = (p.x - c.x) / c.x;
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
    vec2 refr = p + vec2(-u * 22.0 * thick + uShift * 0.5, -10.0) + vec2(slope * 6.0, 0.0) + wob * 14.0;
    vec3 bg = room(refr);
    float window = smoothstep(0.9, 0.0, length((p / uP - vec2(0.72, 0.1)) * vec2(1.0, 0.8)));
    vec3 back = bg * 0.9 + uBack * (0.55 + 0.45 * window);
    vec3 liq = back * exp(-uSigma * thick);
    // Light scattered inside cloudy drinks.
    liq += uScatter * (1.0 - exp(-thick * 1.6));

    if (uBodyMix > 0.0) {
      vec2 buv = p / uP;
      vec2 flow = vec2(fbm(buv * 3.0 + vec2(0.0, t * 0.04)), fbm(buv * 3.0 + vec2(5.2, -t * 0.035))) - 0.5;
      buv += uFlow * flow + vec2(uShift / uP.x, 0.0);
      vec3 ph = texture(uBody, buv).rgb * uBodyGain;
      vec3 phLit = ph * (0.62 + 0.38 * thick) + (1.0 - thick) * 0.25 * uBack * exp(-uSigma * 0.3);
      liq = mix(liq, phLit, uBodyMix);
    }

    // Cream: clouds that billow, curl and slowly blend in.
    if (uCream > 0.0) {
      vec2 q = w * 0.005;
      q.y -= t * 0.018;
      vec2 warp = vec2(fbm(q * 2.0 + t * 0.03), fbm(q * 2.0 - t * 0.025 + 3.7));
      float dens = fbm(q + 1.8 * warp);
      float lo = 0.62 - 0.32 * uCream;
      dens = smoothstep(lo, lo + 0.28, dens) * uCream;
      if (uCreamTop > 0.5) dens *= exp(-max(0.0, depth) / 140.0);
      vec3 cream = uCreamCol * (0.72 + 0.28 * thick) + 0.08;
      liq = mix(liq, cream, clamp(dens, 0.0, 0.92));
      liq = mix(liq, uCreamCol * 0.8, uCream * 0.18 * (uCreamTop > 0.5 ? exp(-max(0.0, depth) / 200.0) : 1.0));
    }

    // Caustics, brightest just under the surface.
    float cs = caustic(w * 0.0035 + vec2(uShift * 0.002, 0.0), t * 0.55);
    liq += uCaustic * cs * smoothstep(0.0, 40.0, depth) * exp(-max(0.0, depth) / 520.0) * (0.35 + 0.65 * thick);

    // Glow under the surface for dark drinks, and gentle loss of light with depth.
    liq += uSurfGlow * exp(-max(0.0, depth) / max(1.0, uSurfGlowDepth));
    liq *= 1.0 - 0.22 * smoothstep(0.0, uP.y, depth);

    // Cream tendrils sinking from a creamy head.
    if (uTendrils > 0.0 && uHead > 0) {
      float td = fbm(vec2(w.x * 0.035 + uFoamShift * 0.01, depth * 0.012 - t * 0.06));
      float m = smoothstep(0.55, 0.8, td) * exp(-max(0.0, depth) / 70.0) * uTendrils;
      liq = mix(liq, uHeadBot, m);
    }

    // Meniscus where nothing covers the surface: a lit lip, a dark band from
    // total internal reflection, a moving glint.
    if (uHead == 0) {
      float lip = 1.0 - smoothstep(0.0, 3.0, depth);
      float dark = smoothstep(2.0, 4.5, depth) * (1.0 - smoothstep(5.0, 12.0, depth));
      liq = mix(liq, uMenLip, lip * 0.7);
      liq = mix(liq, uMenDark, dark * (uClear > 0.5 ? 0.25 : 0.55));
      float gl = (1.0 - smoothstep(0.0, 1.4, abs(depth - 0.6))) * (0.4 + 0.6 * noise(vec2(w.x * 0.02 + t * 0.4, 0.0)));
      liq += uMenGlint * gl * 0.6;
    }

    float edge = smoothstep(-2.0, 0.8, depth);
    col = mix(col, liq, edge);
  }

  // The head: foam, cream or crema, sampled from its photo through moving
  // noise, with lit top, soft base that melts into the drink, and popping cells.
  if (wet && uHead > 0) {
    float lumpAmp = uHead == 1 ? 0.35 : (uHead == 2 ? 0.45 : 0.08);
    float lump = (fbm(vec2(w.x * 0.018 + uFoamShift * 0.004, t * 0.04)) - 0.5) * uFoamH * lumpAmp;
    float top = surf - uFoamH + lump;
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
      vec2 cell = floor(vec2(w.x, w.y - top) / 3.0);
      float life = fract(hash(cell) * 7.0 + t * (0.15 + hash(cell + 3.0) * 0.4));
      h += vec3(0.08) * smoothstep(0.96, 1.0, life) * (1.0 - hv);
      float a = smoothstep(top - 1.0, top + 1.2, w.y) * (1.0 - smoothstep(surf - 2.0, surf + reach, w.y));
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
      float dens = smoothstep(0.5, 0.85, s) * exp(-above / 170.0) * smoothstep(0.0, 25.0, above);
      col = mix(col, vec3(0.94, 0.93, 0.91), dens * 0.35);
    }
  }

  // The glass: refraction darkens the very edges, a fresnel reflection of the
  // room grows toward them, and highlights drift as the phone turns.
  col *= 1.0 - 0.38 * smoothstep(0.92, 1.0, abs(u));
  vec3 refl = room(vec2(uP.x - p.x, p.y));
  col = mix(col, refl, 0.1 * pow(abs(u), 3.0));
  float xn = p.x / uP.x;
  float vfade = smoothstep(0.0, 0.2, p.y / uP.y) * smoothstep(1.0, 0.75, p.y / uP.y);
  float h1 = exp(-pow((xn - (0.045 + 0.012 * sin(uGrav))) / 0.004, 2.0)) * 0.13;
  float h2 = exp(-pow((xn - (0.86 + 0.03 * sin(uGrav))) / 0.045, 2.0)) * 0.07;
  col += vec3(h1 + h2) * (0.4 + 0.6 * vfade);

  // Condensation on cold glass.
  if (uCondAmt > 0.0) {
    vec2 cuv = p / uP;
    if (uCondMap.x < 0.0) cuv.x = 1.0 - cuv.x;
    float aspect = (uP.x / uP.y) / (768.0 / 1152.0);
    cuv.x = (cuv.x - 0.5) * aspect + 0.5 + (uCondMap.z - 0.5) * (1.0 - aspect);
    vec3 m = texture(uCond, cuv).rgb;
    col = 1.0 - (1.0 - col) * (1.0 - m * uCondAmt);
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
  vec3 c = uTint * (0.35 + rim * 0.9) + vec3(1.0) * spec * 0.9 + uTint * crescent * 0.5;
  float a = clamp(0.18 + rim * 0.75 + spec * 0.9 + dark * 0.25, 0.0, 1.0);
  c = mix(c, vec3(0.08, 0.04, 0.0), dark * 0.45);
  outColor = vec4(c * a, a);
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

  function init(canvas) {
    try {
      gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false });
      if (!gl) return false;
      prog = link(VERT, FRAG);
      bubbleProg = link(BVERT, BFRAG);
    } catch (e) {
      console.warn('WebGL unavailable, using the 2D renderer:', e.message);
      gl = null;
      return false;
    }
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    bubbleBuf = gl.createBuffer();
    const names = (src) => [...src.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]);
    for (const n of names(FRAG)) loc[n] = gl.getUniformLocation(prog, n);
    for (const n of names(BVERT + BFRAG)) bloc[n] = gl.getUniformLocation(bubbleProg, n);
    // Placeholders until the real textures arrive.
    for (const k of ['room', 'cond', 'body', 'head']) setTexture(k, null);
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
    const wrap = key === 'room' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  function resize(width, height) {
    if (!gl) return;
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(v => Number(v) / 255);

  function render(s) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
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

    const bind = (unit, key, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex[key]);
      i1(name, unit);
    };
    bind(0, 'room', 'uRoom');
    bind(1, 'cond', 'uCond');
    bind(2, 'body', 'uBody');
    bind(3, 'head', 'uHeadTex');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Bubbles on top, blended.
    const n = s.bubbles.length / 3;
    if (n > 0) {
      gl.useProgram(bubbleProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(bloc.uRes, gl.canvas.width, gl.canvas.height);
      gl.uniform1f(bloc.uDpr, s.dpr);
      gl.uniformMatrix3fv(bloc.uFwd, false, s.fwd);
      gl.uniform3fv(bloc.uTint, s.bubbleTint);
      const aCorner = gl.getAttribLocation(bubbleProg, 'aCorner');
      const aBubble = gl.getAttribLocation(bubbleProg, 'aBubble');
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aCorner, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.bubbles, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aBubble);
      gl.vertexAttribPointer(aBubble, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aBubble, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.vertexAttribDivisor(aBubble, 0);
      gl.disableVertexAttribArray(aBubble);
    }
  }

  return { init, setTexture, resize, render, rgb, WAVES, get ok() { return !!gl; } };
})();
