/**
 * Environment: sky, sun/moon light, haze, clouds and precipitation driven by
 * the env.* SimVars.
 *
 * Reads:  env.time_utc_h, env.day_of_year (fallback: system clock),
 *         env.visibility_m, env.cloud_base_ft (AGL of the reference field),
 *         env.cloud_cover, env.precip, env.sl_temp_c,
 *         fdm.wind_dir_deg / fdm.wind_kt (cloud drift, precipitation).
 * Writes: env.sun_elev_deg, env.ambient_light,
 *         world.cloud_base_msl_ft, world.cloud_top_msl_ft, world.in_cloud (0..1).
 */
import * as THREE from 'three';
import type { SimVars } from '../../core/SimVars';
import { ENV, FDM } from '../../core/vars';
import type { ReferenceFrame } from '../ReferenceFrame';
import { DEG2RAD, FT_TO_M, M_TO_FT, clamp, smoothstep } from '../geo';
import {
  KOSCHMIEDER,
  defaultSkyParams,
  skyRadiance,
  sunTransmittance,
  type SkyParams,
  type WorldUniforms,
} from '../shared/atmosphere';
import { CloudField } from '../shared/cloudField';
import { sharedNoise } from '../shared/noise';
import { createMoonPosition, createSunPosition, horizontalToVector, julianDayFromDayOfYear, moonPosition, sunPosition } from './solar';
import { ambientLevel, clearSkyIlluminanceLux, cloudTransmission, moonIlluminanceLux } from './illumination';
import { SkyDome } from './SkyDome';
import { StarField } from './StarField';
import { CloudLayer } from './Clouds';
import { Precipitation } from './Precipitation';
import type { QualitySettings } from '../quality';
import { WORLD_VARS } from '../worldVars';

export { WORLD_VARS };

/** Rayleigh extinction of clear air at 550 nm, sea level (1/m). Bucholtz (1995): ~0.0116 /km. */
const RAYLEIGH_BETA_550 = 1.16e-5;

export interface EnvironmentOptions {
  scene: THREE.Scene;
  vars: SimVars;
  frame: ReferenceFrame;
  uniforms: WorldUniforms;
  quality: QualitySettings;
  /** Calendar year for env.day_of_year (default: current UTC year). */
  year?: number;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _rgb: [number, number, number] = [0, 0, 0];
const _rgb2: [number, number, number] = [0, 0, 0];

export class Environment {
  readonly group = new THREE.Group();
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly sky: SkyDome;
  readonly stars: StarField;
  readonly clouds: CloudLayer;
  readonly precipitation: Precipitation;
  readonly fog: THREE.FogExp2;
  private readonly vars: SimVars;
  private readonly frame: ReferenceFrame;
  private readonly u: WorldUniforms;
  private readonly sp: SkyParams = defaultSkyParams();
  private readonly sun = createSunPosition();
  private readonly moon = createMoonPosition();
  private readonly sunDirScene = new THREE.Vector3(0, 1, 0);
  private readonly moonDirScene = new THREE.Vector3(0, -1, 0);
  private readonly skyAmbient = new THREE.Color();
  private readonly year: number | undefined;
  private sunScale = 3;
  private hazeBaseSmoothed = NaN;
  private cloudRefElevM = NaN;
  private timeS = 0;
  private precipOn = false;
  /** Julian day of the current frame (UT). */
  jd = 2451545;
  /** Last computed ambient illuminance (lux). */
  lux = 1e5;

  constructor(opts: EnvironmentOptions) {
    this.vars = opts.vars;
    this.frame = opts.frame;
    this.u = opts.uniforms;
    this.year = opts.year;
    this.group.name = 'environment';
    const noise = sharedNoise();
    this.u.uNoiseTex.value = noise.texture;

    this.sky = new SkyDome(this.u);
    this.group.add(this.sky.mesh);
    this.stars = new StarField(this.u);
    this.group.add(this.stars.group);
    this.clouds = new CloudLayer(this.u, new CloudField(noise.field), opts.quality.cloudSlices, opts.quality.cloudRadiusM);
    this.group.add(this.clouds.group);
    this.precipitation = new Precipitation(opts.quality.precipParticles);
    this.group.add(this.precipitation.lines);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.name = 'sun';
    this.sunLight.castShadow = opts.quality.shadows;
    this.configureShadows(opts.quality);
    this.group.add(this.sunLight);
    this.group.add(this.sunLight.target);
    this.hemiLight = new THREE.HemisphereLight(0x8899bb, 0x445533, 1);
    this.hemiLight.name = 'sky-ambient';
    this.group.add(this.hemiLight);
    this.fog = new THREE.FogExp2(0xaabbcc, 1e-5);
    opts.scene.fog = this.fog;

    // Calibrate the sun so a white Lambertian surface under a 60 deg sun is ~4x
    // brighter than the horizon sky, the daylight luminance ratio (EST from
    // ~8,000 cd/m2 horizon sky vs ~30,000 cd/m2 white paper in sunlight).
    const sp = defaultSkyParams();
    const sy = Math.sin(60 * DEG2RAD);
    const sx = Math.cos(60 * DEG2RAD);
    skyRadiance(-sx, 0.05, 0, sx, sy, 0, sp, _rgb);
    const horizonLum = 0.2126 * _rgb[0] + 0.7152 * _rgb[1] + 0.0722 * _rgb[2];
    sunTransmittance(sy, sp, _rgb2);
    const tLum = 0.2126 * _rgb2[0] + 0.7152 * _rgb2[1] + 0.0722 * _rgb2[2];
    // Radiance of white Lambert in three.js = E * sin(el) / pi.
    this.sunScale = (4 * horizonLum * Math.PI) / (sy * tLum);
  }

  setQuality(q: QualitySettings): void {
    this.clouds.setSliceCount(q.cloudSlices);
    this.sunLight.castShadow = q.shadows;
    this.configureShadows(q);
  }

  private configureShadows(q: QualitySettings): void {
    const s = this.sunLight.shadow;
    s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = s.camera as THREE.OrthographicCamera;
    // EST: 120 m square around the camera covers the aircraft and nearby ground.
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    cam.near = 10;
    cam.far = 4000;
    s.bias = -0.0004;
    s.normalBias = 0.02;
    cam.updateProjectionMatrix();
  }

  /** Converts a local ENU unit vector at (lat, lon) into the scene frame. */
  private enuToScene(lat: number, lon: number, v: { x: number; y: number; z: number }, out: THREE.Vector3): void {
    this.frame.enuQuaternion(lat, lon, _q);
    out.set(v.x, v.y, v.z).applyQuaternion(_q).normalize();
  }

  /**
   * Per-frame update.
   * @param cameraWorld camera position (scene)
   * @param camLat/camLon/camAltM camera geodetic position
   * @param groundElevM terrain/field elevation under the camera (m)
   * @param refFieldElevM elevation of the reporting field for cloud bases (NaN: use ground)
   */
  update(
    dt: number,
    camera: THREE.Camera,
    cameraWorld: THREE.Vector3,
    camLat: number,
    camLon: number,
    camAltM: number,
    groundElevM: number,
    refFieldElevM: number,
    pixelRatio: number,
  ): void {
    const vars = this.vars;
    const u = this.u;
    this.timeS = (this.timeS + dt) % 3600;
    u.uTime.value = this.timeS;

    // --- Time.
    const now = new Date();
    const year = this.year ?? now.getUTCFullYear();
    const hours = vars.has(ENV.timeUtcHours)
      ? vars.get(ENV.timeUtcHours)
      : now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const startOfYear = Date.UTC(year, 0, 1);
    const doy = vars.has(ENV.dayOfYear) ? vars.get(ENV.dayOfYear) : Math.floor((now.getTime() - startOfYear) / 86400000) + 1;
    this.jd = julianDayFromDayOfYear(year, doy, hours);
    u.uDayOfYear.value = doy;

    // --- Sun and moon.
    sunPosition(this.jd, camLat, camLon, this.sun);
    moonPosition(this.jd, camLat, camLon, this.moon);
    horizontalToVector(this.sun.elevationDeg, this.sun.azimuthDeg, _v);
    this.enuToScene(camLat, camLon, _v, this.sunDirScene);
    horizontalToVector(this.moon.elevationDeg, this.moon.azimuthDeg, _v);
    this.enuToScene(camLat, camLon, _v, this.moonDirScene);
    u.uSunDir.value.copy(this.sunDirScene);
    u.uMoonDir.value.copy(this.moonDirScene);
    const sunEl = this.sun.elevationDeg;
    vars.set(ENV.sunElevation, sunEl);
    vars.set(WORLD_VARS.moonElevDeg, this.moon.elevationDeg);
    vars.set(WORLD_VARS.sunAzimuthDeg, this.sun.azimuthDeg);

    // --- Weather inputs.
    const visM = vars.has(ENV.visibilityM) ? Math.max(20, vars.get(ENV.visibilityM)) : 40_000;
    const cover = clamp(vars.get(ENV.cloudCover, 0), 0, 1);
    const baseAglFt = vars.has(ENV.cloudBaseFt) ? vars.get(ENV.cloudBaseFt) : 5000;
    const precip = clamp(vars.get(ENV.precip, 0), 0, 1);
    const slTempC = vars.has(ENV.oatSeaLevelC) ? vars.get(ENV.oatSeaLevelC) : 15;
    const windDir = vars.get(FDM.windDir, 0);
    const windMs = vars.get(FDM.windSpeed, 0) * 0.514444;

    // Reference elevation for cloud bases (METAR bases are AGL at the reporting field), smoothed.
    const refNow = Number.isFinite(refFieldElevM) ? refFieldElevM : groundElevM;
    this.cloudRefElevM = Number.isFinite(this.cloudRefElevM) ? this.cloudRefElevM + (refNow - this.cloudRefElevM) * Math.min(1, dt / 30) : refNow;
    const baseM = this.cloudRefElevM + baseAglFt * FT_TO_M;
    // EST layer thickness: cumulus 600-1,300 m growing with cover; stratus/overcast ~800 m.
    const thick = cover >= 0.85 ? 800 : 600 + 700 * cover;
    const topM = baseM + thick;
    const hasClouds = this.clouds.setParams({ baseM, topM, cover });
    vars.set(WORLD_VARS.cloudBaseMslFt, baseM * M_TO_FT);
    vars.set(WORLD_VARS.cloudTopMslFt, topM * M_TO_FT);
    // Wind drift of the cloud field (wind blows FROM windDir; scene x = east, z = south).
    const toRad = (windDir + 180) * DEG2RAD;
    const wE = Math.sin(toRad) * windMs;
    const wN = Math.cos(toRad) * windMs;
    this.clouds.drift(-wE * dt, wN * dt); // field moves with the wind: sample offset moves opposite
    const below = hasClouds && camAltM < baseM;
    const above = hasClouds && camAltM > topM;
    const inCloud = hasClouds ? this.clouds.densityAt(cameraWorld.x, cameraWorld.z, camAltM) : 0;
    vars.set(WORLD_VARS.inCloud, inCloud);

    // --- Haze / visibility. METAR caps at 10 km / 10 SM; above ~8 km blend toward
    // typical clear-air visual range (EST 80 km) so distant terrain hazes plausibly.
    const effVis = visM < 8000 ? visM : visM + (80_000 - visM) * smoothstep(8000, 16000, visM);
    const hazeGround = Number.isFinite(groundElevM) ? groundElevM : 0;
    this.hazeBaseSmoothed = Number.isFinite(this.hazeBaseSmoothed) ? this.hazeBaseSmoothed + (hazeGround - this.hazeBaseSmoothed) * Math.min(1, dt / 20) : hazeGround;
    u.uHazeBeta.value = Math.max(0, KOSCHMIEDER / effVis - RAYLEIGH_BETA_550);
    u.uHazeBase.value = this.hazeBaseSmoothed;
    // EST: fog/mist hugs the ground; haze fills the ~1.5 km boundary layer.
    u.uHazeScale.value = visM < 1000 ? 120 : visM < 5000 ? 400 : 1500;
    u.uAirBeta.value = RAYLEIGH_BETA_550;
    u.uCamAlt.value = camAltM;

    // --- Sky model parameters: turbidity rises as visibility drops (EST mapping).
    this.sp.turbidity = clamp(1.9 + 45_000 / effVis, 1.9, 10);
    this.sp.altitude = Math.max(0, camAltM);
    u.uSkyTurbidity.value = this.sp.turbidity;
    u.uSkyRayleigh.value = this.sp.rayleigh;
    u.uSkyMie.value = this.sp.mieCoefficient;
    u.uSkyMieG.value = this.sp.mieDirectionalG;
    u.uSkyAltitude.value = this.sp.altitude;
    u.uSkyExposure.value = this.sp.exposure;

    const s = this.sunDirScene;
    // Horizon colours toward and away from the sun, and the zenith.
    const hx = Math.hypot(s.x, s.z) > 1e-6 ? s.x / Math.hypot(s.x, s.z) : 1;
    const hz = Math.hypot(s.x, s.z) > 1e-6 ? s.z / Math.hypot(s.x, s.z) : 0;
    skyRadiance(hx * 0.999, 0.03, hz * 0.999, s.x, s.y, s.z, this.sp, _rgb);
    u.uFogSunColor.value.setRGB(_rgb[0], _rgb[1], _rgb[2]);
    skyRadiance(-hx * 0.999, 0.03, -hz * 0.999, s.x, s.y, s.z, this.sp, _rgb);
    u.uFogColor.value.setRGB(_rgb[0], _rgb[1], _rgb[2]);
    skyRadiance(0, 1, 0, s.x, s.y, s.z, this.sp, _rgb);
    u.uSkyZenith.value.setRGB(_rgb[0], _rgb[1], _rgb[2]);
    u.uSkyHorizon.value.copy(u.uFogColor.value).lerp(u.uFogSunColor.value, 0.3);
    // Average sky radiance for ambient lighting (EST: 40% zenith, 60% horizon).
    this.skyAmbient.copy(u.uSkyZenith.value).multiplyScalar(0.4).add(_c.copy(u.uSkyHorizon.value).multiplyScalar(0.6));

    // --- Illumination.
    let lux = clearSkyIlluminanceLux(sunEl) + moonIlluminanceLux(this.moon.elevationDeg, this.moon.illuminated);
    const cloudT = below || inCloud > 0 ? cloudTransmission(cover) : 1;
    lux *= cloudT * (1 - 0.6 * inCloud);
    this.lux = lux;
    const ambient = ambientLevel(lux);
    vars.set(ENV.ambientLight, ambient);
    u.uAmbient.value = ambient;
    const night = smoothstep(-2, -12, sunEl);
    u.uNight.value = night;

    // Overcast / low visibility greys the sky light seen from below the layer.
    const grey = below ? smoothstep(0.5, 1.0, cover) : 0;
    const fogGrey = Math.max(grey, 1 - smoothstep(1500, 6000, visM));
    if (fogGrey > 0) {
      for (const c of [u.uFogColor.value, u.uFogSunColor.value, u.uSkyZenith.value, u.uSkyHorizon.value, this.skyAmbient]) {
        const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * (grey > 0 ? cloudT * 1.6 : 1);
        c.lerp(_c.setRGB(l, l, l * 1.03), fogGrey);
      }
    }

    // Sun (or moon) directional light.
    sunTransmittance(Math.max(s.y, 0), this.sp, _rgb);
    const sunVis = smoothstep(-1.5, 2.5, sunEl);
    const moonVis = (1 - sunVis) * smoothstep(-1, 5, this.moon.elevationDeg);
    const directCloud = below ? 1 - 0.95 * smoothstep(0.7, 1.0, cover) : 1;
    const directIn = 1 - inCloud * 0.9;
    const light = this.sunLight;
    const usingSun = sunVis > 0.001 || moonVis < 0.001;
    if (usingSun) {
      light.color.setRGB(_rgb[0], _rgb[1], _rgb[2]);
      light.intensity = this.sunScale * sunVis * directCloud * directIn;
      light.position.copy(cameraWorld).addScaledVector(s, 2000);
    } else {
      // Moonlight: bluish (Purkinje-shifted rendering convention), tiny intensity.
      const m = this.moonDirScene;
      light.color.setRGB(0.55, 0.62, 0.8);
      // Physical ratio moon/sun illuminance (lux / 100,000) boosted for display (EST x800,
      // a rendering convention: dark-adapted vision cannot be reproduced on a monitor).
      const moonLux = moonIlluminanceLux(this.moon.elevationDeg, this.moon.illuminated);
      light.intensity = this.sunScale * (moonLux / 1e5) * 800 * moonVis * directCloud;
      light.position.copy(cameraWorld).addScaledVector(m, 2000);
    }
    light.target.position.copy(cameraWorld);
    light.target.updateMatrixWorld();
    u.uSunColor.value.copy(light.color).multiplyScalar(light.intensity);

    // Hemisphere light: sky irradiance pi * L_sky (three.js multiplies by albedo/pi).
    this.hemiLight.color.copy(this.skyAmbient);
    const sunIrr = light.intensity * Math.max(0, usingSun ? s.y : this.moonDirScene.y);
    this.hemiLight.groundColor.setRGB(0.12, 0.12, 0.1).multiplyScalar((sunIrr + Math.PI * (0.2126 * this.skyAmbient.r + 0.7152 * this.skyAmbient.g + 0.0722 * this.skyAmbient.b)) / Math.PI);
    this.hemiLight.intensity = Math.PI;
    // Night floor so the world never renders pitch black (starlight/airglow ~0.002 lux).
    this.hemiLight.color.r = Math.max(this.hemiLight.color.r, 0.0006);
    this.hemiLight.color.g = Math.max(this.hemiLight.color.g, 0.0008);
    this.hemiLight.color.b = Math.max(this.hemiLight.color.b, 0.0014);

    // --- In-cloud whiteout.
    const k = (light.intensity * 0.5) / Math.PI;
    const cloudLit = _c.setRGB(
      this.skyAmbient.r * 0.9 + light.color.r * k,
      this.skyAmbient.g * 0.9 + light.color.g * k,
      this.skyAmbient.b * 0.9 + light.color.b * k,
    );
    u.uCloudBeta.value = inCloud * (KOSCHMIEDER / 35); // EST: ~35 m visibility inside dense cloud
    if (inCloud > 0) {
      u.uFogColor.value.lerp(cloudLit, inCloud);
      u.uFogSunColor.value.lerp(cloudLit, inCloud);
    }
    // Cloud shadows on the ground only for broken cumulus seen from below/above, not overcast.
    u.uCloudShadow.value = hasClouds ? (1 - smoothstep(0.75, 0.9, cover)) * sunVis : 0;

    // Standard-material fog (aircraft exterior etc.): FogExp2 matched at the visibility distance.
    const betaCam = u.uHazeBeta.value * Math.exp(-Math.max(0, camAltM - this.hazeBaseSmoothed) / u.uHazeScale.value) + RAYLEIGH_BETA_550 + u.uCloudBeta.value;
    this.fog.color.copy(u.uFogColor.value);
    // 1 - exp(-(rho d)^2) equals 1 - exp(-beta d) at d = 3.912 / beta when rho = beta / sqrt(3.912).
    this.fog.density = betaCam / Math.sqrt(KOSCHMIEDER);

    // --- Wetness for ground shading.
    const tempAtGround = slTempC - 0.0065 * Math.max(0, groundElevM);
    const snow = tempAtGround < 1;
    const targetWet = !snow ? precip : 0;
    u.uWetness.value += (targetWet - u.uWetness.value) * Math.min(1, dt / (targetWet > u.uWetness.value ? 60 : 600));

    // --- Sky objects.
    const far = (camera as THREE.PerspectiveCamera).far ?? 1e6;
    this.sky.update(cameraWorld, far, night * this.moon.illuminated * smoothstep(-1, 3, this.moon.elevationDeg));
    const starVis = smoothstep(-4, -14, sunEl) * (below ? 1 - smoothstep(0.3, 0.8, cover) : 1) * (1 - inCloud) * smoothstep(1000, 10000, effVis);
    const moonBright = (0.25 + 0.75 * night) * 0.9 * (below ? 1 - smoothstep(0.6, 0.95, cover) : 1) * (1 - inCloud);
    this.stars.update(this.frame, this.jd, camLat, camLon, camera, cameraWorld, far, starVis, this.moonDirScene, this.sunDirScene, moonBright, pixelRatio);
    this.clouds.update(cameraWorld, camAltM, this.skyAmbient);

    // --- Precipitation below the cloud base.
    const tempAtCam = slTempC - 0.0065 * Math.max(0, camAltM);
    this.precipOn = precip > 0.01 && (camAltM < topM || !hasClouds) && !above;
    this.precipitation.update(dt, cameraWorld, this.precipOn ? precip : 0, tempAtCam < 1, wE, wN, ambient, this.timeS);
  }

  /** Sun direction in scene coordinates (unit). */
  get sunDirection(): THREE.Vector3 {
    return this.sunDirScene;
  }

  get sunElevationDeg(): number {
    return this.sun.elevationDeg;
  }

  dispose(): void {
    this.sky.dispose();
    this.stars.dispose();
    this.clouds.dispose();
    this.precipitation.dispose();
    this.sunLight.dispose();
    this.hemiLight.dispose();
    this.group.removeFromParent();
  }
}
