/**
 * Procedural terrain material.
 *
 * A MeshStandardMaterial extended through `onBeforeCompile`, so scene lights
 * (sun, moon, hemisphere, the aircraft's landing/taxi spot lights) and shadow
 * maps work unchanged. The albedo is synthesised per fragment from per-vertex
 * attributes written by the tile builder:
 *   aTerrain = (noise x, noise y [m, periodic], elevation [m MSL], latitude [deg])
 *   aFlat    = airport flattening weight (mowed grass)
 * Biomes: grass, forest, farmland patchwork (Voronoi fields), dry grass and
 * desert in the subtropical belts, boreal forest and tundra at high latitude,
 * rock on steep slopes, snow above a latitude/season dependent snow line,
 * water (elevation <= 0) with depth colour, shoreline, ripples, sun glint
 * and sky reflection. Aerial perspective matches the sky model.
 */
import * as THREE from 'three';
import { GLSL_AERIAL, GLSL_WORLD_UNIFORMS, type WorldUniforms } from '../shared/atmosphere';
import { GLSL_BIOME } from './biome';
import { GLSL_CLOUD_FIELD } from '../shared/cloudField';

/** Period (m) of the terrain noise coordinates; every noise scale divides it. */
export const TERRAIN_NOISE_PERIOD_M = 262144;

const VERT_PARS = /* glsl */ `
attribute vec4 aTerrain;
attribute float aFlat;
varying vec4 vTerrain;
varying float vFlat;
varying float vUpDot;
varying vec3 vWorldPosT;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vTerrain;
varying float vFlat;
varying float vUpDot;
varying vec3 vWorldPosT;
${GLSL_WORLD_UNIFORMS}
${GLSL_AERIAL}
${GLSL_CLOUD_FIELD}
${GLSL_BIOME}
const float NOISE_P = ${TERRAIN_NOISE_PERIOD_M.toFixed(1)};
float gWater;
float gRough;
vec2 gBump;

float tn(vec2 p, float repeats, int ch) {
  vec4 t = texture2D(uNoiseTex, p * (repeats / NOISE_P));
  return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a;
}

vec3 fieldColour(float id) {
  // Crop palette (linear albedo): green crops, ripe wheat, ploughed soil, pasture, stubble, rapeseed.
  if (id < 0.18) return vec3(0.075, 0.105, 0.035);
  if (id < 0.34) return vec3(0.215, 0.175, 0.085);
  if (id < 0.48) return vec3(0.105, 0.078, 0.052);
  if (id < 0.66) return vec3(0.060, 0.095, 0.034);
  if (id < 0.82) return vec3(0.180, 0.155, 0.095);
  if (id < 0.90) return vec3(0.240, 0.215, 0.040);
  return vec3(0.090, 0.120, 0.045);
}

vec3 terrainAlbedo() {
  float elev = vTerrain.z;
  float lat = vTerrain.w;
  vec2 p = vTerrain.xy;
  float slope = 1.0 - clamp(vUpDot, 0.0, 1.0); // 1 - cos(slope angle)
  float dist = length(vWorldPosT - cameraPosition);

  float region = tn(p, 4.0, 0);
  float regionG = tn(p, 4.0, 1);
  float mid = tn(p, 16.0, 0);
  float midG = tn(p, 64.0, 1);
  float fieldId = tn(p, 64.0, 2);
  float smallField = tn(p, 256.0, 2);
  float det = tn(p, 2048.0, 3);
  float fine = tn(p, 16384.0, 3);
  float detFade = 1.0 - smoothstep(1500.0, 6000.0, dist);
  float fineFade = 1.0 - smoothstep(60.0, 400.0, dist);

  float absLat = abs(lat);
  // Subtropical arid belts (descending Hadley circulation, ~15-35 deg) modulated regionally.
  float belt = smoothstep(10.0, 18.0, absLat) * (1.0 - smoothstep(32.0, 40.0, absLat));
  float arid = clamp(belt * (0.25 + region) - 0.2, 0.0, 1.0);
  // Continental dryness: high mid-latitude plateaus and plains (e.g. High Plains, Iberian meseta,
  // Anatolia) are semi-arid in the rain shadow of mountains. EST heuristic without land-cover data.
  float midLat = smoothstep(28.0, 34.0, absLat) * (1.0 - smoothstep(50.0, 56.0, absLat));
  arid = max(arid, midLat * smoothstep(900.0, 1700.0, elev) * (0.2 + 0.3 * regionG) * (1.0 - smoothstep(0.01, 0.05, slope)));
  // Late-summer drought at 30-45 deg (Mediterranean-type summers): golden grass peaking ~day 240
  // (NH) / ~day 57 (SH). EST seasonal heuristic.
  float dryPhase = cos((uDayOfYear - (lat >= 0.0 ? 240.0 : 57.0)) / 365.25 * 6.283185307);
  float summerDry = max(0.0, dryPhase) * smoothstep(28.0, 32.0, absLat) * (1.0 - smoothstep(43.0, 47.0, absLat));
  arid = max(arid, 0.32 * summerDry * (0.5 + regionG) * (1.0 - smoothstep(1800.0, 2600.0, elev)));
  float boreal = smoothstep(48.0, 58.0, absLat);
  float tundra = smoothstep(62.0, 70.0, absLat);
  float snowL = snowLine(lat, uDayOfYear);
  float treeLine = max(0.0, snowL - 600.0 + 250.0 * (mid - 0.5)); // EST: tree line ~600 m below the snow line (Colorado ~3,300-3,500 m, Alps ~2,200 m)

  vec3 grass = mix(vec3(0.050, 0.080, 0.028), vec3(0.085, 0.105, 0.042), mid);
  vec3 forest = mix(vec3(0.020, 0.038, 0.016), vec3(0.030, 0.050, 0.022), regionG);
  forest = mix(forest, vec3(0.016, 0.030, 0.020), boreal);
  vec3 dryGrass = mix(vec3(0.150, 0.130, 0.075), vec3(0.200, 0.165, 0.100), midG);
  vec3 sand = mix(vec3(0.400, 0.300, 0.190), vec3(0.540, 0.420, 0.280), mid);
  vec3 rock = mix(vec3(0.150, 0.140, 0.130), vec3(0.230, 0.205, 0.175), det);
  vec3 tundraC = mix(vec3(0.110, 0.100, 0.070), vec3(0.140, 0.130, 0.090), midG);
  vec3 snowC = vec3(0.80, 0.82, 0.86);

  vec3 col = grass;
  // Forest patches, denser in wetter regions, none above the tree line or on cliffs.
  // Orographic moisture: mountain slopes below the tree line are mostly forested (e.g. Rockies, Alps).
  float montane = smoothstep(0.01, 0.06, slope) * smoothstep(600.0, 1500.0, elev);
  float fcover = mid * 0.55 + regionG * 0.45 + (smallField - 0.5) * 0.15 + 0.2 * montane;
  float fmask = smoothstep(0.50, 0.58, fcover) * (1.0 - arid * (1.0 - 0.6 * montane)) * (1.0 - tundra) * (1.0 - smoothstep(treeLine - 150.0, treeLine, elev));
  // Farmland on flat, low, temperate, well-watered ground.
  // Farmland on nearly flat ground (slope metric 1 - cos: 0.006 ~ 6 deg, 0.002 ~ 3.6 deg).
  float farm = smoothstep(0.006, 0.002, slope) * (1.0 - smoothstep(900.0, 1500.0, elev)) * (1.0 - smoothstep(0.25, 0.45, arid))
             * (1.0 - boreal) * smoothstep(0.42, 0.58, region) * (1.0 - fmask);
  vec3 fields = mix(fieldColour(fieldId), fieldColour(smallField), step(0.62, midG));
  fields = mix(fields, grass, 0.3);
  col = mix(col, forest, fmask);
  col = mix(col, fields, farm * 0.8);
  col = mix(col, dryGrass, smoothstep(0.15, 0.45, arid));
  col = mix(col, sand, smoothstep(0.50, 0.80, arid) * (1.0 - smoothstep(0.2, 0.35, slope)));
  col = mix(col, tundraC, tundra * (1.0 - fmask));
  // Alpine meadow and scree above the tree line.
  col = mix(col, mix(tundraC, rock, 0.5), smoothstep(treeLine, treeLine + 300.0, elev));
  // Rock on steep slopes (> ~35 deg).
  col = mix(col, rock, smoothstep(0.13, 0.25, slope + (det - 0.5) * 0.08));
  // Snow above the snow line, not on cliffs steeper than ~50 deg.
  float snowMask = smoothstep(snowL - 80.0, snowL + 120.0, elev + (mid - 0.5) * 400.0) * (1.0 - smoothstep(0.30, 0.40, slope));
  col = mix(col, snowC, snowMask);
  // Mowed airport grass inside graded areas: the local vegetation, more uniform and a little greener.
  vec3 mowed = mix(col, grass, 0.35) * (0.95 + 0.1 * smallField);
  col = mix(col, mowed, vFlat * (1.0 - snowMask) * (1.0 - smoothstep(0.5, 0.8, arid) * 0.5));

  // Detail variation to avoid blur at low altitude.
  col *= mix(1.0, 0.82 + 0.36 * det, detFade);
  col *= mix(1.0, 0.88 + 0.24 * fine, fineFade * (1.0 - snowMask * 0.7));
  gBump = vec2(fine - 0.5, det - 0.5) * fineFade;
  col *= 1.0 - 0.35 * uWetness * (1.0 - snowMask);
  // Cloud shadows (scattered/broken cumulus): darken where the sun ray crosses the layer.
  col *= 1.0 - 0.55 * cloudShadowAt(vWorldPosT);

  // Water where the terrain model is at or below sea level (and not an airport).
  float w = smoothstep(0.4, -0.4, elev) * (1.0 - vFlat);
  float depth = max(-elev, 0.0);
  vec3 shallow = vec3(0.020, 0.090, 0.085);
  vec3 deep = vec3(0.003, 0.014, 0.030);
  vec3 waterC = mix(shallow, deep, 1.0 - exp(-depth / 12.0));
  // Beach / shoreline sand just above sea level, and surf foam at the edge.
  float beach = (1.0 - smoothstep(0.5, 3.0, elev)) * step(0.0, elev) * (1.0 - vFlat) * (1.0 - smoothstep(0.08, 0.15, slope));
  col = mix(col, vec3(0.45, 0.39, 0.28), beach * 0.8);
  float foam = smoothstep(-1.2, -0.1, elev) * (1.0 - smoothstep(-0.1, 0.3, elev)) * (0.6 + 0.4 * det);
  waterC = mix(waterC, vec3(0.55, 0.58, 0.60), foam * 0.7 * (1.0 - smoothstep(2000.0, 8000.0, dist)));
  col = mix(col, waterC, w);
  gWater = w * (1.0 - foam * 0.8);
  gRough = mix(mix(0.93, 0.55, snowMask), 0.05, gWater);
  gRough = mix(gRough, 0.35, uWetness * (1.0 - gWater) * 0.6);
  return col;
}

// Normal perturbation from a height gradient (Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU", 2010).
vec3 perturbNormalTerrain(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy) {
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

const COLOR_FRAGMENT = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb = terrainAlbedo();
`;

const NORMAL_FRAGMENT = /* glsl */ `
#include <normal_fragment_maps>
{
  // Wind ripples on water (two scrolling detail octaves), grain bump on land.
  vec2 wp = vTerrain.xy;
  float t = uTime;
  float r1 = texture2D(uNoiseTex, wp * (8192.0 / NOISE_P) + vec2(t * 0.011, t * 0.007)).a;
  float r2 = texture2D(uNoiseTex, wp * (32768.0 / NOISE_P) - vec2(t * 0.019, t * 0.013)).a;
  float ripple = (r1 * 0.6 + r2 * 0.4);
  float dist = length(vWorldPosT - cameraPosition);
  float rippleFade = 1.0 - smoothstep(3000.0, 15000.0, dist);
  vec2 dH = vec2(dFdx(ripple), dFdy(ripple)) * 3.0 * gWater * rippleFade;
  dH += vec2(dFdx(gBump.x), dFdy(gBump.x)) * 0.6 * (1.0 - gWater);
  normal = perturbNormalTerrain(-vViewPosition, normal, dH);
}
`;

const OUTPUT_FRAGMENT = /* glsl */ `
{
  // Sky reflection on water (Schlick Fresnel, F0 = 0.02 for water).
  vec3 V = normalize(vViewPosition);
  vec3 Rv = reflect(-V, normal);
  vec3 Rw = normalize((vec4(Rv, 0.0) * viewMatrix).xyz);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
  vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, clamp(Rw.y * 1.6, 0.0, 1.0));
  outgoingLight += skyRefl * fres * gWater;
  outgoingLight = applyAerial(outgoingLight, vWorldPosT);
}
#include <opaque_fragment>
`;

/**
 * Creates the shared terrain material. `uniforms` are referenced (not
 * copied): updating the WorldUniforms values updates every tile.
 */
export function createTerrainMaterial(uniforms: WorldUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    fog: false, // aerial perspective is applied in-shader, before tone mapping
    name: 'amg-terrain',
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvTerrain = aTerrain;\nvFlat = aFlat;\nvUpDot = objectNormal.y;\nvWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', COLOR_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', NORMAL_FRAGMENT)
      .replace('#include <opaque_fragment>', OUTPUT_FRAGMENT);
  };
  mat.customProgramCacheKey = () => 'amg-terrain-v1';
  return mat;
}
