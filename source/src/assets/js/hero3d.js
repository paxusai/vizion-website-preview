/* Vizion Insurance — homepage 3D hero (WebGL2, no dependencies).
   One continuous camera shot, partly automatic and partly driven by scroll:
     1. the camera descends through the clouds        (plays on load)
     2. the Vizion seed and its green leaves assemble (the logo's iris and leaf)
     3. a glass shield dome builds from the ground up  (protection)
     4. six pillars rise, one per line of insurance    (labels link to each product)
   The scene is ray-marched in a single fragment shader. Pages without WebGL2,
   or visitors who prefer reduced motion, keep the still image instead. */
(function () {
  'use strict';

  var root = document.documentElement;
  var hero = document.querySelector('[data-hero3d]');
  if (!hero || !root.classList.contains('can-3d')) return;

  var stage = hero.querySelector('.hero-3d-stage');
  var canvas = hero.querySelector('.hero-canvas');
  var phases = Array.prototype.slice.call(hero.querySelectorAll('[data-phase]'));
  var services = hero.querySelector('.hero-services');
  var serviceLinks = services ? Array.prototype.slice.call(services.querySelectorAll('[data-pillar]')) : [];
  var progressEl = hero.querySelector('.hero-progress');
  var progressSteps = progressEl ? Array.prototype.slice.call(progressEl.querySelectorAll('[data-step]')) : [];
  var progressBar = progressEl && progressEl.querySelector('.hero-progress-bar span');

  // ?still=1 renders one fixed, centred frame (used to make the fallback image).
  var still = /[?&]still=1\b/.test(window.location.search);

  function fallback() { root.classList.remove('can-3d'); }

  var gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: still
    });
  } catch (e) { gl = null; }
  if (!gl) { fallback(); return; }

  /* ------------------------------------------------------------------
     Shaders
     ------------------------------------------------------------------ */
  var VERT = '#version 300 es\nin vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 fragColor;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;',
    'uniform float uFocal;',
    'uniform vec2 uShift;',
    'uniform mat3 uRingRot[3];',
    'uniform vec4 uRingP[3];',      // radius, thickness, sin(half aperture), cos(half aperture)
    'uniform float uCore, uDome, uPillar, uLines, uCloud, uDusk, uHover, uHQ;',

    '#define PI 3.14159265',
    'const vec3 CORE = vec3(0.0, 1.62, 0.0);',
    'const float PLINTH_R = 3.7;',
    'const float PLINTH_H = 0.16;',
    'const float DOME_R = 3.35;',
    'const float RING_R = 2.5;',
    'const float SECTOR = PI / 3.0;',
    'const vec3 PAPER = vec3(0.969, 0.965, 0.945);',
    'const vec3 GREEN = vec3(0.16, 0.62, 0.30);',
    'const vec3 BOUND_C = vec3(0.0, 1.0, 0.0);',
    'const float BOUND_R = 4.1;',

    'vec3 sunDir; vec3 sunCol; vec3 skyCol;',
    'float glowRing; float glowCore;',

    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
    '  for (int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= 0.5; } return v; }',

    'float sdCappedTorus(vec3 p, vec2 sc, float ra, float rb){ p.x = abs(p.x);',
    '  float k = (sc.y * p.x > sc.x * p.y) ? dot(p.xy, sc) : length(p.xy);',
    '  return sqrt(max(dot(p, p) + ra * ra - 2.0 * ra * k, 0.0)) - rb; }',
    'float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }',
    // A leaf after the logo's crescent: a thin blade bent along an arc of radius rp.x, centred on +y and
    // spanning the ring's current aperture. Pointed at both ends, widest towards the base, halves folded
    // up along a raised midrib. info = (position from base to tip -1..1, offset from the midrib, half-width).
    // Each leaf lies inside a capped torus around its arc, slightly wider than the blade.
    'float leafBound(vec3 p, vec4 rp){ return sdCappedTorus(p, rp.zw, rp.x, rp.y * 2.2); }',
    'float sdLeaf(vec3 p, vec4 rp, out vec3 info){',
    '  float ra = rp.x, t0 = rp.y;',
    '  float rho = length(p.xy);',
    '  float ang = atan(rp.z, rp.w);',
    '  float th = atan(p.x, p.y);',
    '  if (abs(th) > ang) {',
    '    info = vec3(sign(th), 0.0, 0.0);',
    '    return length(vec3(p.xy - ra * vec2(sign(th) * rp.z, rp.w), p.z)) - 0.003;',
    '  }',
    '  float len = ang * ra;',
    '  float w0 = min(t0 * 2.1, 0.22 * len);',
    '  float u = th / ang;',
    '  float prof = max((1.0 - u * u) * (1.0 - 0.35 * u), 0.0);',
    '  float w = w0 * prof + 1e-4;',
    '  float d = rho - ra;',
    '  float z = p.z - 1.0 * d * d - 0.15 * u * d;',
    '  float tk = t0 * 0.38 * sqrt(prof) + 0.0015;',
    '  vec2 e = vec2(d, z);',
    '  float k0 = length(e / vec2(w, tk)), k1 = length(e / vec2(w * w, tk * tk));',
    '  float blade = k0 * (k0 - 1.0) / k1;',
    '  float rib = length(e) - (t0 * 0.5 * sqrt(prof) + 0.002);',
    '  info = vec3(u, d, w);',
    '  float slope = w0 * 2.7 / len;',
    '  return smin(blade, rib, 0.012) * inversesqrt(1.16 + slope * slope);',
    '}',
    // The seed (the logo's iris): a teardrop, full at the base and drawn to a point at the top, a little
    // flattened, with a fine seam around its edge. Leans like the iris in the logo; s scales it in.
    'const mat3 SEED_AXES = mat3(0.929, -0.371, 0.0, 0.371, 0.929, 0.0, 0.0, 0.0, 1.0);',
    'float sdSeed(vec3 p, float s){',
    '  float bound = length(p) - 0.66 * s;',
    '  if (bound > 0.08) return bound;',
    '  vec3 q = p * SEED_AXES / s;',
    '  float taper = 1.0 - 0.62 * smoothstep(-0.7, 0.64, q.y);',
    '  vec3 r = vec3(0.46, 0.64, 0.38) * vec3(taper, 1.0, taper);',
    '  float k0 = length(q / r), k1 = length(q / (r * r));',
    '  float d = k0 * (k0 - 1.0) / k1;',
    '  d += 0.016 * exp(-q.z * q.z * 900.0);',
    '  return d * s * 0.7;',
    '}',
    'float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }',
    'float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }',
    'vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r){ vec3 oc = ro - c; float b = dot(oc, rd); float h = b * b - dot(oc, oc) + r * r;',
    '  if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h); }',

    // Pillars sit at 30° + i·60°; polar repetition finds the nearest one.
    'int sectorOf(vec2 xz){ float a = atan(xz.y, xz.x) - SECTOR * 0.5; return int(mod(floor(a / SECTOR + 0.5), 6.0)); }',
    // Heights as comparisons, not an array: indexing a const array at run time is very slow on Direct3D (ANGLE).
    'float pillarBase(int i){ return i == 0 ? 1.30 : i == 1 ? 0.92 : i == 2 ? 1.12 : i == 3 ? 0.82 : i == 4 ? 1.22 : 1.00; }',
    'float pillarH(int i){ float r = clamp(uPillar * 1.7 - float(i) * 0.14, 0.0, 1.0); return pillarBase(i) * r * r * (3.0 - 2.0 * r); }',

    'vec2 map(vec3 p){',
    '  vec2 res = vec2(sdCyl(p - vec3(0.0, PLINTH_H * 0.5, 0.0), PLINTH_R - 0.03, PLINTH_H * 0.5 - 0.03) - 0.03, 1.0);',
    '  int i = sectorOf(p.xz);',
    '  float h = pillarH(i);',
    '  if (h > 0.004) {',
    '    vec2 q = rot(-(SECTOR * 0.5 + float(i) * SECTOR)) * p.xz;',
    '    float d = sdRoundBox(vec3(q.x - RING_R, p.y - PLINTH_H - h * 0.5, q.y), vec3(0.17, h * 0.5, 0.17), min(0.045, h * 0.5));',
    '    if (d < res.x) res = vec2(d, 2.0);',
    '  }',
    // Only the leaf whose bound is nearest gets the full shape; the others count by their bounds.
    '  vec3 q, qn = vec3(0.0); vec4 rpn = vec4(1.0); float b1 = 1e9, b2 = 1e9;',
    '  for (int k = 0; k < 3; k++) {',
    '    q = uRingRot[k] * (p - CORE);',
    '    float b = leafBound(q, uRingP[k]);',
    '    if (b < b1) { b2 = b1; b1 = b; qn = q; rpn = uRingP[k]; } else b2 = min(b2, b);',
    '  }',
    '  float dl = b1;',
    '  if (b1 < 0.03) { vec3 info; dl = min(sdLeaf(qn, rpn, info), b2); }',
    '  if (dl < res.x) res = vec2(dl, 3.0);',
    '  float dc = sdSeed(p - CORE, max(uCore, 0.02));',
    '  if (dc < res.x) res = vec2(dc, 4.0);',
    '  return res;',
    '}',
    // Where on its leaf a point lies (see sdLeaf), for shading.
    'vec3 leafInfo(vec3 p){',
    '  vec3 best = vec3(0.0, 0.0, 1.0); float bd = 1e9; vec3 info;',
    '  for (int k = 0; k < 3; k++) {',
    '    vec3 q = uRingRot[k] * (p - CORE);',
    '    if (leafBound(q, uRingP[k]) > 0.03) continue;',
    '    float d = sdLeaf(q, uRingP[k], info);',
    '    if (d < bd) { bd = d; best = info; }',
    '  }',
    '  return best;',
    '}',

    'vec2 march(vec3 ro, vec3 rd, float tmin, float tmax, int steps, bool collect){',
    '  float t = tmin; float id = -1.0;',
    '  for (int i = 0; i < 128; i++){',
    '    if (i >= steps) break;',
    '    vec2 h = map(ro + rd * t);',
    '    if (collect) {',
    '      if (h.y > 3.5) glowCore += exp(-h.x * 9.0) * 0.022;',
    '      else if (h.y > 2.5) glowRing += exp(-h.x * 16.0) * 0.014;',
    '    }',
    '    if (h.x < 0.0012 * t) { id = h.y; break; }',
    '    t += h.x * 0.92;',
    '    if (t > tmax) break;',
    '  }',
    '  return vec2(t, id);',
    '}',

    'vec3 calcNormal(vec3 p){ const vec2 e = vec2(1.0, -1.0) * 0.0015;',
    '  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x); }',

    'float softShadow(vec3 ro, vec3 rd){',
    '  vec2 b = sphereHit(ro, rd, vec3(0.0, 1.35, 0.0), 3.3);',
    '  if (b.y < 0.0) return 1.0;',
    '  float res = 1.0; float t = max(b.x, 0.02);',
    '  int steps = uHQ > 0.5 ? 40 : 24;',
    '  for (int i = 0; i < 40; i++){',
    '    if (i >= steps) break;',
    '    float h = map(ro + rd * t).x;',
    '    res = min(res, 9.0 * h / t);',
    '    t += clamp(h, 0.03, 0.45);',
    '    if (res < 0.002 || t > b.y) break;',
    '  }',
    '  return clamp(res, 0.0, 1.0);',
    '}',

    'float calcAO(vec3 p, vec3 n){ float occ = 0.0, s = 1.0;',
    '  for (int i = 0; i < 4; i++){ float h = 0.02 + 0.11 * float(i); occ += (h - map(p + n * h).x) * s; s *= 0.75; }',
    '  return clamp(1.0 - 2.4 * occ, 0.0, 1.0); }',

    // Linear-space surroundings, used for reflections on metal and glass.
    'vec3 envLin(vec3 d){',
    '  vec3 sky = mix(vec3(0.78, 0.86, 0.83), vec3(0.96, 0.96, 0.94), smoothstep(0.0, 0.6, d.y));',
    '  vec3 c = mix(vec3(0.72, 0.71, 0.67), sky, smoothstep(-0.06, 0.06, d.y)) * 1.5;',
    '  float s = max(dot(d, sunDir), 0.0);',
    '  return c + sunCol * (pow(s, 350.0) * 5.0 + pow(s, 10.0) * 0.12);',
    '}',

    // Display-space sky; equals the page background so the canvas edges disappear.
    'vec3 skyDisp(vec3 rd){',
    '  vec3 c = mix(vec3(0.925, 0.950, 0.935), PAPER, smoothstep(-0.02, 0.45, rd.y));',
    '  c = mix(c, PAPER, smoothstep(0.0, -0.3, rd.y));',
    '  float s = max(dot(rd, sunDir), 0.0);',
    '  return c + vec3(1.0, 0.9, 0.7) * pow(s, 6.0) * 0.05 * (0.4 + uDusk);',
    '}',

    'vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',

    // Cloud sheets the camera descends through at the start.
    'vec2 cloudUV(vec2 xz, int idx){ return xz * 0.21 + vec2(float(idx) * 3.7 + uTime * 0.02, float(idx) * 1.3 + uTime * 0.01); }',
    'float cloudLo(){ return 0.62 - 0.26 * uCloud; }',
    'float cloudShadow(vec3 p){',
    '  if (uCloud < 0.01) return 1.0;',
    '  float t = (5.0 - p.y) / sunDir.y;',
    '  float lo = cloudLo();',
    '  return 1.0 - 0.55 * smoothstep(lo, lo + 0.12, fbm(cloudUV(p.xz + sunDir.xz * t, 1))) * uCloud;',
    '}',
    'vec3 clouds(vec3 base, vec3 ro, vec3 rd, float tScene){',
    '  vec3 acc = vec3(0.0); float T = 1.0;',
    '  vec2 sd = normalize(sunDir.xz) * 0.05;',
    '  float lo = cloudLo();',
    '  for (int k = 0; k < 3; k++){',
    '    int idx = rd.y < 0.0 ? 2 - k : k;',
    '    float t = (3.6 + 1.4 * float(idx) - ro.y) / rd.y;',
    '    if (t <= 0.0 || t > tScene) continue;',
    '    vec2 q = cloudUV(ro.xz + rd.xz * t, idx);',
    '    float n = fbm(q);',
    '    float a = smoothstep(lo, lo + 0.12, n) * uCloud;',
    '    a *= smoothstep(0.4, 3.5, t) * (1.0 - smoothstep(55.0, 120.0, t));',
    '    if (a < 0.003) continue;',
    // Brighter where the cloud rises toward the sun, grey-green in the folds.
    '    float relief = clamp((n - fbm(q + sd)) * 7.0 + 0.55, 0.0, 1.0);',
    '    vec3 cc = mix(vec3(0.70, 0.77, 0.76), vec3(1.0, 0.997, 0.98), relief);',
    '    cc = mix(cc, cc * vec3(1.03, 0.95, 0.88), uDusk);',
    '    acc += T * a * cc; T *= 1.0 - a;',
    '  }',
    '  return acc + T * base;',
    '}',

    // Faint street-plan rings and spokes around the plinth, read from above as a planned city.
    'vec3 groundPlan(vec3 col, vec3 p, float rr, float t){',
    '  if (rr < PLINTH_R) return col;',
    '  float w = 0.012 + t * 0.0016;',
    '  float ringD = abs(fract(rr / 1.6 + 0.5) - 0.5) * 1.6;',
    '  float spokeD = abs(fract(atan(p.z, p.x) / (2.0 * PI) * 12.0 + 0.5) - 0.5) * (2.0 * PI / 12.0) * rr;',
    '  float line = max(1.0 - smoothstep(0.0, w, ringD), (1.0 - smoothstep(0.0, w, spokeD)) * 0.7);',
    '  return mix(col, col * vec3(0.84, 0.92, 0.88), line * (0.35 + 0.5 * uCloud));',
    '}',

    // Light lines on the plinth: the circle of protection and a line from the core to each pillar.
    'vec3 plinthGlow(vec2 xz){',
    '  float r = length(xz);',
    '  vec3 e = GREEN * exp(-abs(r - 3.28) * 45.0) * (0.6 + 2.6 * uDome);',
    '  e += GREEN * exp(-abs(r - 0.72) * 55.0) * (0.5 + 2.2 * uLines);',
    '  int i = sectorOf(xz);',
    '  vec2 q = rot(-(SECTOR * 0.5 + float(i) * SECTOR)) * xz;',
    '  float prog = clamp(uLines * 1.6 - float(i) * 0.1, 0.0, 1.0);',
    '  float x0 = 0.72, x1 = RING_R - 0.2;',
    '  float seg = step(x0, q.x) * step(q.x, x0 + (x1 - x0) * prog);',
    '  float hov = abs(float(i) - uHover) < 0.5 ? 1.0 : 0.0;',
    '  float pulse = 0.55 + 0.45 * sin(q.x * 7.0 - uTime * 3.0);',
    '  e += GREEN * exp(-abs(q.y) * 55.0) * seg * pulse * (2.6 + 3.5 * hov);',
    '  return e;',
    '}',

    'vec3 shade(vec3 p, vec3 n, vec3 rd, float id, bool cheap){',
    '  vec3 v = -rd;',
    '  float ndl = max(dot(n, sunDir), 0.0);',
    '  float sh = ((cheap || ndl <= 0.0) ? 1.0 : softShadow(p + n * 0.01, sunDir)) * cloudShadow(p);',
    '  float ao = cheap ? 1.0 : calcAO(p, n);',
    '  float ndh = max(dot(n, normalize(sunDir + v)), 0.0);',
    '  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);',
    '  vec3 amb = skyCol * (0.6 + 0.4 * n.y) * ao + vec3(0.9, 0.88, 0.82) * 0.2 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0) * ao;',
    '  vec3 lc = CORE - p; float dl = length(lc);',
    '  vec3 coreLight = vec3(1.0, 0.8, 0.45) * 1.1 * uCore * max(dot(n, lc / dl), 0.0) / (1.0 + dl * dl * 0.8);',
    '  vec3 col; vec3 emis = vec3(0.0);',
    '  if (id < 1.5) {',
    '    vec3 alb = vec3(0.86, 0.85, 0.82);',
    '    col = alb * (sunCol * ndl * sh + amb + coreLight) + sunCol * pow(ndh, 60.0) * 0.12 * sh;',
    '    if (n.y > 0.9) emis += plinthGlow(p.xz);',
    '  } else if (id < 2.5) {',
    '    int i = sectorOf(p.xz);',
    '    float top = PLINTH_H + pillarH(i);',
    '    float hov = abs(float(i) - uHover) < 0.5 ? 1.0 : 0.0;',
    '    vec3 alb = vec3(0.91, 0.91, 0.89);',
    '    col = alb * (sunCol * ndl * sh + amb + coreLight) + sunCol * pow(ndh, 90.0) * 0.3 * sh;',
    '    float band = 1.0 - smoothstep(0.02, 0.034, abs(p.y - (top - 0.13)));',
    '    float cap = smoothstep(0.85, 0.95, n.y) * 0.35;',
    '    emis += GREEN * (band * (4.0 + 4.0 * hov) + cap * (1.0 + 2.0 * hov)) + GREEN * hov * 0.4;',
    '  } else if (id < 3.5) {',
    // Leaf: the logo's two greens from base to tip, a pale midrib and side veins, a waxy sheen,
    // and light showing through where the sun is behind it.
    '    vec3 lf = leafInfo(p);',
    '    float across = clamp(abs(lf.y) / max(lf.z, 1e-3), 0.0, 1.0);',
    '    vec3 alb = mix(vec3(0.012, 0.16, 0.045), vec3(0.04, 0.30, 0.08), smoothstep(-1.0, 0.9, lf.x));',
    '    float midrib = 1.0 - smoothstep(0.07, 0.2, across);',
    '    float vein = 1.0 - smoothstep(0.05, 0.14, abs(fract(lf.x * 14.0 - across * 1.3) - 0.5));',
    '    vein *= smoothstep(0.1, 0.25, across) * (1.0 - smoothstep(0.7, 0.95, across)) * (1.0 - smoothstep(6.0, 14.0, length(p - uCamPos)));',
    '    alb = mix(alb, vec3(0.07, 0.38, 0.11), vein * 0.4);',
    '    alb = mix(alb, vec3(0.26, 0.52, 0.18), midrib * 0.5);',
    '    float back = max(-dot(n, sunDir), 0.0);',
    '    vec3 trans = alb * sunCol * (0.5 * back + 0.9 * pow(max(dot(rd, sunDir), 0.0), 4.0)) * (1.0 - 0.5 * midrib);',
    '    float F = 0.04 + 0.96 * fres;',
    '    col = alb * (sunCol * ndl * sh + amb + coreLight) + trans * sh;',
    '    col += F * envLin(reflect(rd, n)) * ao * 0.3 + sunCol * pow(ndh, 90.0) * (0.3 + F) * sh;',
    '    emis += GREEN * fres * 0.35;',
    '  } else {',
    '    vec3 f0 = vec3(0.62, 0.47, 0.22);',
    '    vec3 F = f0 + (1.0 - f0) * fres * 0.6;',
    '    col = F * envLin(reflect(rd, n)) * ao * 0.42 + f0 * 0.25 * (sunCol * ndl * sh + amb) + sunCol * pow(ndh, 120.0) * 1.4 * sh * F;',
    '    vec3 ax = normalize(vec3(sin(uTime * 0.25) * 0.8, 0.3, 0.9));',
    '    float facing = dot(n, ax);',
    '    col = mix(col, col * vec3(0.5, 0.42, 0.26), smoothstep(0.62, 0.9, facing));',
    '    float arc = (1.0 - smoothstep(0.0, 0.05, abs(facing - 0.5))) * smoothstep(0.0, 0.5, dot(n, normalize(vec3(-0.6, 0.8, 0.2))));',
    '    emis += vec3(1.0, 0.93, 0.76) * arc * 1.6;',
    '    emis += vec3(1.0, 0.76, 0.36) * (0.5 + 0.2 * sin(uTime * 1.8)) * fres * uCore;',
    '  }',
    '  return col + emis;',
    '}',

    // Shield dome: glass with a geodesic lattice that builds upward with a scan line.
    'vec3 domeLayer(vec3 base, vec3 p, vec3 rd, float t, bool back){',
    '  float y = p.y - PLINTH_H;',
    '  float formH = uDome * DOME_R * 1.04;',
    '  if (y < 0.0 || y > formH) return base;',
    '  vec3 n = (p - vec3(0.0, PLINTH_H, 0.0)) / DOME_R;',
    '  float phi = asin(clamp(n.y, -1.0, 1.0));',
    '  float cphi = max(cos(phi), 0.08);',
    '  vec2 g = vec2(atan(n.z, n.x) / (2.0 * PI) * 30.0, phi / (0.5 * PI) * 8.0);',
    '  float px = t / (uRes.y * uFocal);',
    '  vec2 w = px * vec2(30.0 / (2.0 * PI * DOME_R * cphi), 8.0 / (0.5 * PI * DOME_R)) * 1.4 + 0.02;',
    '  vec3 fam = vec3(g.x, g.y, g.x + g.y);',
    '  vec3 ww = vec3(w.x, w.y, w.x + w.y);',
    '  vec3 l = 1.0 - smoothstep(vec3(0.0), ww, 0.5 - abs(fract(fam) - 0.5));',
    '  float lines = max(l.x, max(l.y, l.z * 0.55)) * (1.0 - smoothstep(0.8, 0.98, n.y));',
    '  float fres = pow(1.0 - abs(dot(n, rd)), 2.5);',
    '  float edge = exp(-abs(y - formH) * 15.0) * (1.0 - smoothstep(0.97, 1.0, uDome));',
    '  float alpha = 0.025 + 0.24 * fres + lines * (0.13 + 0.2 * fres) + edge * 0.85;',
    '  if (back) alpha *= 0.45;',
    '  vec3 tint = mix(vec3(0.86, 0.95, 0.90), vec3(0.22, 0.66, 0.36), clamp(lines + edge * 0.6, 0.0, 1.0));',
    '  tint = mix(tint, vec3(1.0), edge * 0.35);',
    '  return mix(base, tint, clamp(alpha, 0.0, 0.9));',
    '}',

    'void main(){',
    '  sunDir = normalize(mix(vec3(-0.45, 0.82, 0.38), vec3(-0.78, 0.42, 0.46), uDusk));',
    '  sunCol = mix(vec3(1.0, 0.97, 0.92) * 2.4, vec3(1.0, 0.8, 0.56) * 2.3, uDusk);',
    '  skyCol = mix(vec3(0.70, 0.78, 0.76), vec3(0.78, 0.72, 0.70), uDusk) * 0.85;',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y - uShift;',
    '  vec3 ro = uCamPos;',
    '  vec3 rd = normalize(uv.x * uCamRight + uv.y * uCamUp + uFocal * uCamFwd);',
    '  glowRing = 0.0; glowCore = 0.0;',
    '  vec3 col = vec3(0.0); float tScene = 1e9; bool sky = false; bool hit = false;',
    '  vec2 bs = sphereHit(ro, rd, BOUND_C, BOUND_R);',
    '  if (bs.y > 0.0) {',
    '    vec2 m = march(ro, rd, max(bs.x, 0.0), bs.y, uHQ > 0.5 ? 110 : 72, true);',
    '    if (m.y > 0.0) {',
    '      vec3 p = ro + rd * m.x; vec3 n = calcNormal(p);',
    '      col = shade(p, n, rd, m.y, false);',
    '      if (m.y < 1.5 && n.y > 0.9 && uHQ > 0.5) {',
    '        vec3 r = reflect(rd, n);',
    '        vec3 rc = envLin(r);',
    '        vec2 rb = sphereHit(p, r, BOUND_C, BOUND_R);',
    '        vec2 rm = march(p + n * 0.02, r, 0.02, max(rb.y, 0.05), 40, false);',
    '        if (rm.y > 1.5) { vec3 rp = p + r * rm.x; rc = shade(rp, calcNormal(rp), r, rm.y, true); }',
    '        col = mix(col, rc, 0.07 + 0.3 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0));',
    '      }',
    '      tScene = m.x; hit = true;',
    '    }',
    '  }',
    '  if (!hit) {',
    '    if (rd.y < 0.0) {',
    '      float t = -ro.y / rd.y; vec3 p = ro + rd * t;',
    '      float rr = length(p.xz);',
    '      float sh = (rr < 10.0 ? softShadow(p + vec3(0.0, 0.01, 0.0), sunDir) : 1.0) * cloudShadow(p);',
    '      float ao = 1.0 - 0.4 * exp(-max(rr - PLINTH_R, 0.0) * 2.2);',
    '      vec3 lc = CORE - p; float dl = length(lc);',
    '      col = vec3(0.93, 0.92, 0.88) * (sunCol * sunDir.y * 1.25 * sh + skyCol * 1.1 * ao) + vec3(1.0, 0.8, 0.45) * 0.5 * uCore * (lc.y / dl) / (1.0 + dl * dl * 0.4);',
    '      col = groundPlan(col, p, rr, t);',
    '      tScene = t;',
    '    } else { sky = true; }',
    '  }',
    '  vec3 disp;',
    '  if (sky) disp = skyDisp(rd);',
    '  else {',
    '    disp = pow(aces(col), vec3(1.0 / 2.2));',
    '    vec3 p = ro + rd * tScene;',
    '    disp = mix(disp, skyDisp(rd), smoothstep(7.5, 22.0, length(p.xz)));',
    '  }',
    '  if (uDome > 0.001) {',
    '    vec2 dh = sphereHit(ro, rd, vec3(0.0, PLINTH_H, 0.0), DOME_R);',
    '    if (dh.y > 0.0) {',
    '      if (dh.y < tScene) disp = domeLayer(disp, ro + rd * dh.y, rd, dh.y, true);',
    '      if (dh.x > 0.0 && dh.x < tScene) disp = domeLayer(disp, ro + rd * dh.x, rd, dh.x, false);',
    '    }',
    '  }',
    '  disp += vec3(0.20, 0.70, 0.38) * glowRing * 0.55 + vec3(1.0, 0.78, 0.40) * glowCore * 0.5 * uCore;',
    '  if (uCloud > 0.001) disp = clouds(disp, ro, rd, tScene);',
    '  disp += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;',
    '  fragColor = vec4(disp, 1.0);',
    '}'
  ].join('\n');

  // Compiling this shader can take a second or two on some systems. With
  // KHR_parallel_shader_compile it happens off the main thread and the frame
  // loop simply waits; the hero copy is already visible meanwhile.
  var parallel = gl.getExtension('KHR_parallel_shader_compile');
  var vs = gl.createShader(gl.VERTEX_SHADER);
  var fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(vs, VERT);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(vs);
  gl.compileShader(fs);
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);

  var U = {};
  var linked = false;
  // Returns true once the program can draw, false while it is still compiling, null if it failed.
  function programReady() {
    if (linked) return true;
    if (parallel && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (window.console) console.warn('Vizion hero shader:', gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
      return null;
    }
    linked = true;
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    ['uRes', 'uTime', 'uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd', 'uFocal', 'uShift', 'uRingRot', 'uRingP',
      'uCore', 'uDome', 'uPillar', 'uLines', 'uCloud', 'uDusk', 'uHover', 'uHQ'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });
    return true;
  }

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  // Camera keyframes along the journey (J): distance, elevation°, azimuth°, target height.
  var KEYS = [
    { j: 0.00, r: 15.5, e: 54, a: 18, ty: 2.0 },
    { j: 0.24, r: 8.6, e: 27, a: 36, ty: 1.55 },
    { j: 0.50, r: 8.4, e: 19, a: 68, ty: 1.25 },
    { j: 0.78, r: 8.9, e: 25, a: 100, ty: 1.05 },
    { j: 1.00, r: 9.8, e: 29, a: 122, ty: 1.0 }
  ];
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function keyAt(j) {
    var i = 0;
    while (i < KEYS.length - 2 && j > KEYS[i + 1].j) i++;
    var k0 = KEYS[Math.max(i - 1, 0)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(i + 2, KEYS.length - 1)];
    var t = clamp((j - k1.j) / (k2.j - k1.j), 0, 1);
    var out = {};
    ['r', 'e', 'a', 'ty'].forEach(function (f) { out[f] = catmull(k0[f], k1[f], k2[f], k3[f], t); });
    return out;
  }

  function rotMat(rx, ry, rz) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // Orthonormal columns from rx/ry, then turned by rz; stored column-major for GLSL.
    var m = [
      [cy, 0, -sy], [sx * sy, cx, sx * cy], [cx * sy, -sx, cx * cy]
    ];
    var r = [];
    for (var c = 0; c < 3; c++) {
      var x = m[c][0], y = m[c][1];
      r.push(cz * x - sz * y, sz * x + cz * y, m[c][2]);
    }
    return r;
  }

  var RINGS = [
    { r: 1.0, t: 0.062, ap: 0.86, rx: 1.15, ry: 0.0, rz: 0.2, spin: 0.32 },
    { r: 1.27, t: 0.05, ap: 0.78, rx: 0.5, ry: 2.1, rz: -0.6, spin: -0.26 },
    { r: 1.54, t: 0.042, ap: 0.7, rx: -0.4, ry: 4.2, rz: 1.1, spin: 0.2 }
  ];
  var PH = [1.30, 0.92, 1.12, 0.82, 1.22, 1.00];
  var PLINTH_H = 0.16, RING_R = 2.5;

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var budget = still ? 1.1e6 : (coarse ? 2.6e5 : 6.2e5);   // rendered pixels per frame
  var hq = still || !coarse;
  var width = 0, height = 0, cssW = 0, cssH = 0;
  var startTime = performance.now();
  var lastFrame = startTime;
  var J = 0, scrollP = 0;
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  var hover = -1;
  var visible = true;
  var running = false;
  var ready = false;
  var frameTimes = [];
  var phaseIndex = -1;
  var cam = { pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1], focal: 1.5, shift: [0, 0] };

  function resize() {
    cssW = stage.clientWidth || window.innerWidth;
    cssH = stage.clientHeight || window.innerHeight;
    if (still) { width = 1200; height = 900; }
    else {
      var s = clamp(Math.sqrt(budget / (cssW * cssH)), 0.35, Math.min(window.devicePixelRatio || 1, 1.5));
      width = Math.max(2, Math.round(cssW * s));
      height = Math.max(2, Math.round(cssH * s));
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function readScroll() {
    var r = hero.getBoundingClientRect();
    var travel = r.height - stage.clientHeight;
    scrollP = travel > 0 ? clamp(-r.top / travel, 0, 1) : 0;
  }

  function updateCamera(time) {
    var aspect = still ? width / height : cssW / cssH;
    var wide = aspect > 1.05;
    var k = keyAt(J);
    var rMul = 1, focal = 1.55, shift = [0, 0];
    if (still) { rMul = 0.92; }
    else if (wide) { shift = [Math.min(0.2 * aspect, 0.42), -0.02]; }
    else {
      var t = clamp((aspect - 0.45) / 0.6, 0, 1);
      rMul = mix(1.55, 1.12, t);
      focal = mix(1.12, 1.4, t);
      // The opening copy is tall on phones; the later captions are shorter, so the scene rises.
      shift = [0, mix(-0.2, -0.14, t) + 0.07 * smooth(0.5, 1, J)];
    }
    var settle = smooth(0.78, 1, J);
    var az = (k.a + mouse.x * 7 + settle * Math.sin(time * 0.07) * 9) * Math.PI / 180;
    var el = (k.e + mouse.y * 3) * Math.PI / 180;
    var R = k.r * rMul;
    var target = [0, k.ty, 0];
    var pos = [target[0] + R * Math.cos(el) * Math.sin(az), target[1] + R * Math.sin(el), target[2] + R * Math.cos(el) * Math.cos(az)];
    var fwd = norm([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
    var right = norm(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);
    cam.pos = pos; cam.fwd = fwd; cam.right = right; cam.up = up; cam.focal = focal; cam.shift = shift;
  }

  function project(p) {
    var v = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
    var z = dot(v, cam.fwd);
    if (z <= 0.1) return null;
    var ux = dot(v, cam.right) / z * cam.focal + cam.shift[0];
    var uy = dot(v, cam.up) / z * cam.focal + cam.shift[1];
    return [ux * cssH + cssW / 2, cssH / 2 - uy * cssH];
  }

  // Label widths, read once per layout change rather than every frame.
  var labelW = [];
  function measureLabels() { labelW = serviceLinks.map(function (a) { return a.offsetWidth; }); }

  function setPhase(i) {
    if (i === phaseIndex) return;
    phaseIndex = i;
    if (i === 2) measureLabels();
    hero.setAttribute('data-phase', String(i));
    phases.forEach(function (el) { el.classList.toggle('is-active', Number(el.getAttribute('data-phase')) === i); });
    progressSteps.forEach(function (el) { el.classList.toggle('is-active', Number(el.getAttribute('data-step')) <= i); });
    if (services) services.classList.toggle('is-visible', i === 2);
  }

  function frame(now) {
    running = false;
    if (!visible && !still) return;
    var status = programReady();
    if (status === null) { fallback(); return; }
    if (!status) { schedule(); return; }
    // Start the automatic descent from the first frame actually drawn.
    if (!ready) { startTime = now; lastFrame = now; }
    var dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    var time = still ? 2.0 : (now - startTime) / 1000;

    // Journey: the first part plays by itself, the rest follows the scroll.
    var intro = still ? 1 : easeOut(clamp((now - startTime) / 3400, 0, 1));
    var target = still ? 1 : clamp(0.24 * intro + 0.76 * scrollP, 0, 1);
    J = still ? 1 : J + (target - J) * (1 - Math.exp(-dt * 3.2));
    mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-dt * 3));
    mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-dt * 3));

    var ring = smooth(0.05, 0.3, J);
    var dome = smooth(0.34, 0.62, J);
    var pillar = smooth(0.56, 0.86, J);
    var lines = smooth(0.7, 0.96, J);
    var cloud = 1 - smooth(0.03, 0.22, J);
    var dusk = smooth(0.45, 1, J);
    var core = smooth(0.0, 0.16, J);

    resize();
    updateCamera(time);

    var rot = [], rp = [];
    RINGS.forEach(function (g, i) {
      var e = easeOut(clamp(ring * 1.5 - i * 0.25, 0, 1));
      var swirl = (1 - e) * 3;
      var m = rotMat(g.rx + 0.22 * Math.sin(time * 0.21 + i) + swirl * 0.4, g.ry + time * g.spin + swirl, g.rz + swirl * 0.3);
      rot.push.apply(rot, m);
      var half = mix(0.05, g.ap, e) * Math.PI;
      rp.push(g.r * mix(2.3, 1, e), g.t, Math.sin(half), Math.cos(half));
    });

    gl.uniform2f(U.uRes, width, height);
    gl.uniform1f(U.uTime, time);
    gl.uniform3fv(U.uCamPos, cam.pos);
    gl.uniform3fv(U.uCamRight, cam.right);
    gl.uniform3fv(U.uCamUp, cam.up);
    gl.uniform3fv(U.uCamFwd, cam.fwd);
    gl.uniform1f(U.uFocal, cam.focal);
    gl.uniform2fv(U.uShift, cam.shift);
    gl.uniformMatrix3fv(U.uRingRot, false, new Float32Array(rot));
    gl.uniform4fv(U.uRingP, new Float32Array(rp));
    gl.uniform1f(U.uCore, core);
    gl.uniform1f(U.uDome, dome);
    gl.uniform1f(U.uPillar, pillar);
    gl.uniform1f(U.uLines, lines);
    gl.uniform1f(U.uCloud, cloud);
    gl.uniform1f(U.uDusk, dusk);
    gl.uniform1f(U.uHover, hover);
    gl.uniform1f(U.uHQ, hq ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!ready) {
      ready = true;
      canvas.classList.add('is-ready');
      hero.classList.add('is-3d-ready');
      if (still) { window.__vizStill = true; return; }
    }

    // Overlay: text phases, progress, and labels that follow the pillars.
    setPhase(J < 0.3 ? 0 : J < 0.66 ? 1 : 2);
    if (progressBar) progressBar.style.transform = 'scaleX(' + J.toFixed(3) + ')';
    serviceLinks.forEach(function (a, k) {
      var i = Number(a.getAttribute('data-pillar'));
      var ang = Math.PI / 6 + i * Math.PI / 3;
      var h = PH[i] * smooth(0, 1, clamp(pillar * 1.7 - i * 0.14, 0, 1));
      var s = project([Math.cos(ang) * RING_R, PLINTH_H + h + 0.32, Math.sin(ang) * RING_R]);
      if (!s) return;
      var half = (labelW[k] || 0) / 2 + 8;   // keep each label inside the screen
      var x = clamp(s[0], half, cssW - half);
      a.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + s[1].toFixed(1) + 'px,0) translate(-50%,-100%)';
    });

    // Adapt quality: drop reflections first, then resolution, if frames run long.
    frameTimes.push(dt);
    if (frameTimes.length >= 40) {
      var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length;
      frameTimes = [];
      if (avg > 0.026) {
        if (hq) hq = false;
        else budget = Math.max(1.2e5, budget * 0.78);
      }
    }
    schedule();
  }

  function schedule() {
    if (running) return;
    running = true;
    window.requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */
  if (!still) {
    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('resize', function () { readScroll(); measureLabels(); schedule(); });
    if (!coarse) {
      window.addEventListener('pointermove', function (e) {
        mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
    }
    serviceLinks.forEach(function (a) {
      var i = Number(a.getAttribute('data-pillar'));
      function on() { hover = i; }
      function off() { if (hover === i) hover = -1; }
      a.addEventListener('pointerenter', on);
      a.addEventListener('pointerleave', off);
      a.addEventListener('focus', on);
      a.addEventListener('blur', off);
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && !document.hidden;
        if (visible) { lastFrame = performance.now(); schedule(); }
      }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      if (visible) { lastFrame = performance.now(); schedule(); }
    });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); fallback(); });
    readScroll();
  }
  schedule();
})();
