/**
 * Runway and taxiway/apron materials.
 *
 * Runway markings are evaluated analytically per fragment from the
 * AC 150/5340-1M layout computed in markings.ts (threshold stripes,
 * designators from the glyph atlas, centreline, aiming point, touchdown
 * zone, edge stripes, displaced threshold bar/arrows, blast pad chevrons).
 * This is a procedurally drawn texture in runway coordinates: crisp at any
 * distance, box-filtered with fwidth to avoid shimmer, and it lives on the
 * same surface as the pavement (no decal z-fighting).
 *
 * Both materials extend MeshStandardMaterial (lights, shadows, aircraft
 * landing lights all work) and apply the shared aerial perspective.
 */
import * as THREE from 'three';
import { GLSL_AERIAL, GLSL_WORLD_UNIFORMS, type WorldUniforms } from '../shared/atmosphere';
import { GLSL_CLOUD_FIELD } from '../shared/cloudField';
import type { RunwayMarkingLayout } from './markings';
import type { GlyphAtlas } from './glyphAtlas';
import type { SurfaceType } from './surfaces';

/** Surface codes understood by the shaders. */
export function surfaceCode(s: SurfaceType): number {
  switch (s) {
    case 'asphalt':
    case 'unknown':
      return 0;
    case 'concrete':
      return 1;
    case 'grass':
      return 2;
    case 'dirt':
      return 3;
    case 'gravel':
      return 4;
    case 'snow':
      return 5;
    default:
      return 0;
  }
}

const MAX_GLYPHS = 3;

const PAVEMENT_COMMON = /* glsl */ `
${GLSL_WORLD_UNIFORMS}
${GLSL_AERIAL}
${GLSL_CLOUD_FIELD}
float band(float x, float a, float b, float w) {
  return clamp((x - a) / w + 0.5, 0.0, 1.0) * clamp((b - x) / w + 0.5, 0.0, 1.0);
}
float rectMask(float s, float t, float s0, float s1, float t0, float t1, float fs, float ft) {
  return band(s, s0, s1, fs) * band(t, t0, t1, ft);
}
// Periodic stripe: 1 inside [0, len) of every period, antialiased.
float periodic(float x, float period, float len, float w) {
  float m = mod(x, period);
  return band(m, 0.0, len, w) + band(m - period, 0.0, len, w);
}
float pn(vec2 pFt, float scaleFt, int ch) {
  vec4 t = texture2D(uNoiseTex, pFt / scaleFt);
  return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a;
}
vec3 pavementBase(float code, vec2 pFt, float dist, out float rough) {
  float big = pn(pFt, 1600.0, 0);
  float mid = pn(pFt, 180.0, 1);
  float fine = pn(pFt, 9.0, 3);
  float fade = 1.0 - smoothstep(150.0, 900.0, dist);
  vec3 c;
  if (code < 0.5) {
    // Asphalt: dark aggregate with oxidised patches and repairs (EST albedo ~0.08-0.12).
    c = mix(vec3(0.070, 0.070, 0.075), vec3(0.115, 0.112, 0.108), big * 0.7 + mid * 0.3);
    c *= mix(1.0, 0.85 + 0.3 * fine, fade);
    rough = 0.88;
  } else if (code < 1.5) {
    // Portland cement concrete (EST albedo ~0.3), slab joints handled by the caller.
    c = mix(vec3(0.255, 0.250, 0.235), vec3(0.330, 0.322, 0.300), big * 0.6 + mid * 0.4);
    c *= mix(1.0, 0.9 + 0.2 * fine, fade);
    rough = 0.82;
  } else if (code < 2.5) {
    // Mowed grass strip with mowing lanes.
    float lane = step(0.5, fract(pFt.y / 12.0));
    c = mix(vec3(0.055, 0.090, 0.030), vec3(0.075, 0.105, 0.038), lane * 0.6 + mid * 0.4);
    c *= mix(1.0, 0.85 + 0.3 * fine, fade);
    rough = 0.95;
  } else if (code < 3.5) {
    c = mix(vec3(0.16, 0.12, 0.085), vec3(0.21, 0.16, 0.11), mid) * mix(1.0, 0.85 + 0.3 * fine, fade);
    rough = 0.95;
  } else if (code < 4.5) {
    c = mix(vec3(0.20, 0.18, 0.16), vec3(0.26, 0.24, 0.21), mid) * mix(1.0, 0.8 + 0.4 * fine, fade);
    rough = 0.93;
  } else {
    c = vec3(0.78, 0.80, 0.84) * (0.95 + 0.05 * mid);
    rough = 0.5;
  }
  return c;
}
`;

const RUNWAY_FRAG_PARS = /* glsl */ `
varying vec2 vRwy;
varying vec3 vWorldPosR;
uniform float uLenFt;
uniform float uWidFt;
uniform float uShoulderFt;
uniform float uSurface;
uniform float uEdgeW;
uniform vec4 uCl;          // start (ft from A), length, period, stripe fraction
uniform float uClW;
uniform vec4 uEndA[2];     // cls, stripes per side, stripe unit, displaced ft
uniform vec4 uEndB[2];     // aim start, aim len, aim width, aim inner half
uniform vec4 uEndC[2];     // tdz groups, tdz bar width, tdz gap, blast pad ft
uniform vec4 uGlyphBox[${MAX_GLYPHS * 2}];
uniform vec4 uGlyphUV[${MAX_GLYPHS * 2}];
uniform sampler2D uGlyphTex;
uniform float uRubber;
${PAVEMENT_COMMON}
float gRoughR;
float gPaint;

float tdzGroupMask(float ul, float av, float groups, float barW, float gap, float inner, float fs, float ft) {
  float m = 0.0;
  for (int g = 0; g < 5; g++) {
    if (float(g) >= groups) break;
    float start = g == 0 ? 520.0 : g == 1 ? 1520.0 : g == 2 ? 2020.0 : g == 3 ? 2520.0 : 3020.0;
    float bars = g == 0 ? 3.0 : (g < 3 ? 2.0 : 1.0);
    float inLen = band(ul, start, start + 75.0, fs);
    if (inLen <= 0.0) continue;
    for (int b = 0; b < 3; b++) {
      if (float(b) >= bars) break;
      float a0 = inner + float(b) * (barW + gap);
      m = max(m, inLen * band(av, a0, a0 + barW, ft));
    }
  }
  return m;
}

vec3 runwayColour() {
  float s = vRwy.x;
  float t = vRwy.y;
  float fs = max(fwidth(s), 0.02);
  float ft = max(fwidth(t), 0.02);
  float dist = length(vWorldPosR - cameraPosition);
  int e = s < uLenFt * 0.5 ? 0 : 1;
  float u = e == 0 ? s : uLenFt - s;
  float v = e == 0 ? t : -t;
  float av = abs(v);
  vec4 A = uEndA[e];
  vec4 B = uEndB[e];
  vec4 C = uEndC[e];
  float cls = A.x;
  float disp = A.w;
  float ul = u - disp;
  float halfW = uWidFt * 0.5;
  float white = 0.0;
  float yellow = 0.0;
  bool paved = uSurface < 1.5;
  float rubber = 0.0;

  float rough;
  vec3 col = pavementBase(uSurface, vec2(s, t), dist, rough);

  if (paved) {
    // Shoulders: older, lighter asphalt.
    if (av > halfW) col = mix(col, vec3(0.105, 0.102, 0.098), 0.7);
    // Concrete slab joints: 20 ft transverse, 12.5 ft longitudinal (EST typical PCC slab size).
    if (uSurface > 0.5 && av <= halfW) {
      float jf = 1.0 - smoothstep(300.0, 1200.0, dist);
      float jt = periodic(s + 10.0, 20.0, 0.35, fs) + periodic(t + halfW, 12.5, 0.35, ft);
      col *= 1.0 - 0.35 * clamp(jt, 0.0, 1.0) * jf;
    }
    // Tyre rubber deposits in the touchdown zones (300-3,000 ft past each threshold, near the centreline).
    float tz = smoothstep(250.0, 500.0, ul) * (1.0 - smoothstep(2200.0, 3200.0, ul));
    float lanes = exp(-pow(av / (uWidFt * 0.16), 2.0));
    float streak = pn(vec2(s * 0.02, t), 3.0, 1) * 0.6 + pn(vec2(s, t), 60.0, 0) * 0.4;
    rubber = clamp(tz * lanes * (0.35 + 0.8 * streak) * uRubber, 0.0, 0.85);
    col = mix(col, vec3(0.025, 0.025, 0.027), rubber);

    if (u < 0.0) {
      // Blast pad chevrons (yellow, 45 deg, 3 ft wide, apex toward the runway).
      float bl = C.w;
      if (-u <= bl && av <= halfW) {
        float spacing = bl < 250.0 ? 50.0 : 100.0;
        float q = -u - av;
        yellow = max(yellow, periodic(q, spacing, 3.0 * 1.4142, max(fs, ft) * 1.4142) * step(0.0, q));
      }
    } else if (cls > 0.5 && av <= halfW) {
      // Edge stripes.
      if (uEdgeW > 0.0) white = max(white, band(av, halfW - uEdgeW, halfW, ft));
      if (disp > 0.0 && ul < 0.0) {
        // Displaced threshold: 10 ft bar, arrowheads 5 ft before it, centreline arrows (Figure A-7).
        white = max(white, band(ul, -10.0, 0.0, fs));
        float nHeads = uWidFt >= 100.0 ? 4.0 : (uWidFt >= 75.0 ? 3.0 : 2.0);
        float pitch = uWidFt / nHeads;
        float a = -5.0 - ul; // distance behind the arrowhead apex
        if (a >= 0.0 && a <= 45.0) {
          float lat = mod(v + halfW, pitch) - pitch * 0.5;
          float armT = a * (7.5 / 45.0);
          white = max(white, band(abs(lat), armT - 1.5, armT + 1.5, ft));
        }
        // Centreline arrows every 200 ft beyond the arrowhead row: head 45 ft + shaft 75 ft x 1.5 ft.
        float w = -(ul + 80.0);
        if (w >= 0.0 && ul > -disp + 20.0) {
          float m = mod(w, 200.0);
          float headT = m * (7.5 / 45.0);
          if (m <= 45.0) white = max(white, band(av, headT - 1.5, headT + 1.5, ft));
          else if (m <= 120.0) white = max(white, band(av, -0.75, 0.75, ft));
        }
      } else if (ul >= 0.0) {
        // Threshold stripes 20-170 ft.
        float nps = A.y;
        float unit = A.z;
        if (nps > 0.5) {
          float inS = band(ul, 20.0, 170.0, fs);
          if (inS > 0.0) {
            float k = floor((av - unit) / (2.0 * unit));
            if (k >= 0.0 && k < nps) {
              float a0 = unit + k * 2.0 * unit;
              white = max(white, inS * band(av, a0, a0 + unit, ft));
            }
          }
          // Threshold bar when a blast pad precedes the threshold (2.9.1.2).
          if (C.w > 0.0) white = max(white, band(ul, -10.0, 0.0, fs) * step(av, halfW));
        }
        // Aiming point.
        if (B.y > 0.0) white = max(white, rectMask(ul, av, B.x, B.x + B.y, B.w, B.w + B.z, fs, ft));
        // Touchdown zone bars.
        if (C.x > 0.0) white = max(white, tdzGroupMask(ul, av, C.x, C.y, C.z, B.w, fs, ft));
        // Designators.
        for (int g = 0; g < ${MAX_GLYPHS}; g++) {
          vec4 box = uGlyphBox[e * ${MAX_GLYPHS} + g];
          if (box.y <= box.x) continue;
          if (ul < box.x || ul > box.y || v < box.z || v > box.w) continue;
          vec4 r = uGlyphUV[e * ${MAX_GLYPHS} + g];
          vec2 guv = vec2((v - box.z) / (box.w - box.z), (ul - box.x) / (box.y - box.x));
          white = max(white, texture2D(uGlyphTex, r.xy + guv * r.zw).r);
        }
      }
    }
    // Centreline (uses runway s from end A).
    if (uCl.y > 0.0 && av <= halfW) {
      float cu = s - uCl.x;
      if (cu >= 0.0 && cu <= uCl.y) white = max(white, periodic(cu, uCl.z, uCl.z * uCl.w, fs) * band(t, -uClW * 0.5, uClW * 0.5, ft));
    }
  }

  // Paint: retro-reflective white/yellow with wear; rubber darkens paint in the TDZ.
  float wear = 0.78 + 0.22 * pn(vec2(s, t), 14.0, 3);
  vec3 paintW = vec3(0.74, 0.74, 0.72) * wear;
  vec3 paintY = vec3(0.72, 0.52, 0.07) * wear;
  col = mix(col, paintW * (1.0 - rubber * 0.8), clamp(white, 0.0, 1.0));
  col = mix(col, paintY, clamp(yellow, 0.0, 1.0));
  gPaint = max(white, yellow);
  gRoughR = mix(rough, 0.6, gPaint);
  // Wet pavement: darker and glossier.
  col *= 1.0 - 0.3 * uWetness;
  gRoughR = mix(gRoughR, 0.18, uWetness * 0.8);
  col *= 1.0 - 0.55 * cloudShadowAt(vWorldPosR);
  return col;
}
`;

function applyCommon(
  mat: THREE.MeshStandardMaterial,
  uniforms: WorldUniforms,
  extraUniforms: Record<string, THREE.IUniform>,
  vertPars: string,
  vertMain: string,
  fragPars: string,
  colourExpr: string,
  roughExpr: string,
  cacheKey: string,
): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, extraUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = ${colourExpr};`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = ${roughExpr};`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <opaque_fragment>', 'outgoingLight = applyAerial(outgoingLight, vWorldPosR);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => cacheKey;
}

/** Per-runway material. Geometry must carry `aRwy` = (s ft from end A, t ft right of centreline). */
export function createRunwayMaterial(
  layout: RunwayMarkingLayout,
  surface: SurfaceType,
  uniforms: WorldUniforms,
  atlas: GlyphAtlas,
  rubber: number,
): THREE.MeshStandardMaterial {
  const endA = layout.ends.map((e) => new THREE.Vector4(e.cls, e.stripesPerSide, e.stripeUnitFt, e.displacedFt));
  const endB = layout.ends.map((e) => new THREE.Vector4(e.aimStartFt, e.aimLenFt, e.aimWidthFt, e.aimInnerHalfFt));
  const endC = layout.ends.map((e) => new THREE.Vector4(e.tdzGroups, e.tdzBarWFt, e.tdzGapFt, e.blastFt));
  const boxes: THREE.Vector4[] = [];
  const uvs: THREE.Vector4[] = [];
  for (let e = 0; e < 2; e++) {
    for (let g = 0; g < MAX_GLYPHS; g++) {
      const gb = layout.ends[e].glyphs[g];
      if (gb && atlas.rects[gb.char]) {
        boxes.push(new THREE.Vector4(gb.s0, gb.s1, gb.t0, gb.t1));
        const r = atlas.rects[gb.char];
        uvs.push(new THREE.Vector4(r[0], r[1], r[2], r[3]));
      } else {
        boxes.push(new THREE.Vector4(0, 0, 0, 0));
        uvs.push(new THREE.Vector4(0, 0, 0, 0));
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, fog: false, name: 'amg-runway' });
  applyCommon(
    mat,
    uniforms,
    {
      uLenFt: { value: layout.lengthFt },
      uWidFt: { value: layout.widthFt },
      uShoulderFt: { value: layout.shoulderFt },
      uSurface: { value: surfaceCode(surface) },
      uEdgeW: { value: layout.edgeStripeFt },
      uCl: { value: new THREE.Vector4(layout.clStartFt, layout.clLengthFt, layout.clPeriodFt, layout.clStripeFrac) },
      uClW: { value: layout.clWidthFt },
      uEndA: { value: endA },
      uEndB: { value: endB },
      uEndC: { value: endC },
      uGlyphBox: { value: boxes },
      uGlyphUV: { value: uvs },
      uGlyphTex: { value: atlas.texture },
      uRubber: { value: rubber },
    },
    'attribute vec2 aRwy;\nvarying vec2 vRwy;\nvarying vec3 vWorldPosR;',
    'vRwy = aRwy;\nvWorldPosR = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    RUNWAY_FRAG_PARS,
    'runwayColour()',
    'gRoughR',
    'amg-runway-v1',
  );
  return mat;
}

const PAVE_FRAG_PARS = /* glsl */ `
varying vec4 vPave;
varying vec3 vWorldPosR;
${PAVEMENT_COMMON}
float gRoughP;
vec3 paveColour() {
  // vPave = (along ft, across ft, kind, hold-line along ft). kind: 0 taxiway, 1 apron, 2 connector.
  float s = vPave.x;
  float t = vPave.y;
  float kind = vPave.z;
  float fs = max(fwidth(s), 0.02);
  float ft = max(fwidth(t), 0.02);
  float dist = length(vWorldPosR - cameraPosition);
  float rough;
  vec3 col = pavementBase(kind > 0.5 && kind < 1.5 ? 1.0 : 0.0, vec2(s, t), dist, rough);
  float yellow = 0.0;
  if (kind > 0.5 && kind < 1.5) {
    // Apron slab joints (EST 20 ft x 20 ft).
    float jf = 1.0 - smoothstep(300.0, 1200.0, dist);
    float jt = periodic(s, 20.0, 0.35, fs) + periodic(t, 20.0, 0.35, ft);
    col *= 1.0 - 0.3 * clamp(jt, 0.0, 1.0) * jf;
  } else {
    // Taxiway centreline: continuous yellow, 6 in wide (AC 150/5340-1M 4.2).
    yellow = max(yellow, band(t, -0.25, 0.25, ft));
    if (kind > 1.5) {
      // Runway holding position marking (Figure A-13): 4 yellow lines 12 in wide, 12 in apart;
      // the two solid lines on the taxiway side, dashed (3 ft dash / 3 ft gap) on the runway side.
      float h = vPave.w;
      float d = s - h; // + toward the taxiway (holding side)
      for (int k = 0; k < 4; k++) {
        float c0 = -3.5 + float(k) * 2.0;
        float line = band(d, c0, c0 + 1.0, fs);
        if (k < 2) line *= periodic(t + 100.0, 6.0, 3.0, ft);
        yellow = max(yellow, line);
      }
    }
  }
  float wear = 0.78 + 0.22 * pn(vec2(s, t), 14.0, 3);
  col = mix(col, vec3(0.72, 0.52, 0.07) * wear, clamp(yellow, 0.0, 1.0));
  gRoughP = mix(rough, 0.6, yellow);
  col *= 1.0 - 0.3 * uWetness;
  gRoughP = mix(gRoughP, 0.18, uWetness * 0.8);
  col *= 1.0 - 0.55 * cloudShadowAt(vWorldPosR);
  return col;
}
`;

/** Shared taxiway/apron material. Geometry carries `aPave` = (along ft, across ft, kind, hold-line ft). */
export function createPavementMaterial(uniforms: WorldUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, fog: false, name: 'amg-pavement' });
  applyCommon(
    mat,
    uniforms,
    {},
    'attribute vec4 aPave;\nvarying vec4 vPave;\nvarying vec3 vWorldPosR;',
    'vPave = aPave;\nvWorldPosR = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    PAVE_FRAG_PARS,
    'paveColour()',
    'gRoughP',
    'amg-pavement-v1',
  );
  return mat;
}
