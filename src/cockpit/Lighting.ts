/**
 * Cockpit lighting: panel backlighting zones, flood/dome/storm/map lights and
 * annunciator brightness.
 *
 * A *zone* is a dimmer channel: a SimVar holding 0..1 intensity (written by
 * the aircraft lighting system from its rheostat knobs and bus power). Every
 * material registered to a zone gets `emissiveIntensity = level * gain`, and
 * every real light attached to the zone gets `intensity = level * candela`.
 * Levels are filtered with a short first-order lag (incandescent filament
 * warm-up; set `lagS: 0` for LED lighting).
 *
 * Lights are real THREE.PointLight / SpotLight objects (no shadows). Keep the
 * count small (<= 4-5 per cockpit): every light adds per-fragment cost to all
 * lit materials in the scene. Lights stay `visible` at zero intensity so
 * toggling them never triggers shader recompilation.
 *
 * Photometry: Three.js r155+ uses physical units (point/spot intensity in
 * candela, irradiance = I / d^2). The defaults below are EST, tuned in
 * headless renders so that at full dimmer a flood-lit white label/knob 0.5 m
 * away reads clearly at the world module's night exposure (docs/modules/
 * world.md, section 8) while dark panel paint stays dark, as in real
 * cockpits.
 */
import * as THREE from 'three';
import type { SimVars } from '../core/SimVars';
import { ALERT, ENV } from '../core/vars';
import type { CockpitLightingZone } from './types';
import type { CockpitMaterials } from './materials';
import { bodyToLocalV, type BodyVec } from './frame';

export interface LightingZoneOptions {
  id: string;
  /** SimVar with 0..1 intensity. Default `ac.light.<id>`. */
  intensityVar?: string;
  /** Optional power var: zone is dark while this var is 0 (missing var = powered). */
  powerVar?: string;
  /** Emissive colour of materials in this zone (default palette backlight). */
  color?: THREE.ColorRepresentation;
  /** Emissive intensity at level 1 (default 0.9). */
  gain?: number;
  /** Response time constant (s). Default 0.05 (filament); 0 = instant (LED). */
  lagS?: number;
  /** Response curve exponent applied to the var (dimmers are roughly perceptual): level = var^gamma. Default 1. */
  gamma?: number;
}

export interface CockpitLightSpec {
  id: string;
  kind: 'point' | 'spot';
  /** Zone whose level drives this light. */
  zone: string;
  /** Body-frame position (m). */
  position_m: BodyVec;
  /** Spot target, body frame (m). */
  target_m?: BodyVec;
  color?: THREE.ColorRepresentation;
  /** Luminous intensity at level 1 (candela, Three.js physical units). */
  candela: number;
  /** Cut-off distance (m). Default 2.5. */
  distance?: number;
  decay?: number;
  /** Spot cone half-angle (deg). Default 35. */
  angleDeg?: number;
  penumbra?: number;
}

interface Zone {
  id: string;
  intensityVar: string;
  powerVar: string | null;
  color: THREE.Color;
  gain: number;
  lagS: number;
  gamma: number;
  level: number;
  applied: number;
  materials: { m: THREE.MeshStandardMaterial; gain: number }[];
  lights: { light: THREE.PointLight | THREE.SpotLight; candela: number }[];
}

/** world/worldVars.ts WORLD_VARS.renderUnitsPerLux: scene light units per lux (incl. eye adaptation). */
const RENDER_UNITS_PER_LUX = 'world.render_units_per_lux';

export class CockpitLighting {
  private readonly vars: SimVars;
  private readonly materials: CockpitMaterials;
  private readonly zoneMap = new Map<string, Zone>();
  private readonly zoneList: Zone[] = [];
  private readonly lights: THREE.Light[] = [];
  /** Annunciator brightness: var (1 = BRT, 0 = DIM) and the DIM level. */
  private annunVar: string | null = null;
  private annunDim = 0.3;
  private annunInvert = false;
  private annunPowerVar: string | null = null;
  private envScale = -1;
  /** Var read for display/reflection scaling at night (0..1). */
  ambientVar: string = ENV.ambientLight;
  /**
   * Daylight wash-out of panel backlighting and cockpit lights (0 = none).
   * Rendering is "pre-adapted": the world module brightens night scenes for
   * the dark-adapted eye, so backlighting and floods are drawn at their
   * night-adapted brightness and faded in daylight, where real backlit
   * legends (~10 cd/m2) are invisible against sunlit surfaces. Annunciators
   * and displays are sunlight-readable and are not washed out. EST curve:
   * factor = 1 - washout * smoothstep(0.45, 0.9, env.ambient_light).
   */
  daylightWashout = 0.85;
  private wash = 1;
  /** Lamp-test var (ALERT.annunTest). */
  lampTestVar: string = ALERT.annunTest;
  /**
   * Daylight interior fill (materials.interior `bounce` / `adapt`), updated
   * every frame from the world's illumination:
   *
   *  - bounce: sunlight and skylight admitted through the windows is
   *    inter-reflected by the interior (integrating-sphere estimate): mean
   *    interior irradiance E_int = admitted x E_global / (1 - rho), and a
   *    surface whose hemisphere sees the interior over the fraction
   *    (1 - skyVisibility) receives (1 - V) x rho x E_int from it. E_global
   *    (global horizontal illuminance, lux) is recovered from env.ambient_light
   *    (log photocell scale, world/sky/illumination.ts: 0.1 lux -> 0,
   *    100,000 lux -> 1) and converted with world.render_units_per_lux.
   *    `admitted` EST 0.06: tau (~0.8 laminated windshield) x window area
   *    (~2.5 m2 windshield + side windows) x 0.5 (mean projection of the
   *    windows) / interior surface (~17 m2) of a bizjet / airliner flight
   *    deck; `reflectance` EST from the palette's sidewall, headliner,
   *    carpet and panel colours. Aircraft with more glass (a 172's cabin)
   *    may raise `admitted`.
   *  - adapt: the pilot's eye (and any photograph of a flight deck) adapts
   *    to the shaded interior, whereas the renderer's exposure follows the
   *    sky (world/sky/Environment.ts adaptation). EST perceptual gain (x3.2,
   *    ~1.7 EV, tuned on daylight screenshots against flight-deck photos:
   *    dark-grey panels read mid-grey, engraved legends near white) on the
   *    indirect (shade) light of the interior in full daylight, faded out
   *    with the same curve as the backlight wash-out, so dusk and night
   *    lighting are unchanged. Direct sun and cockpit lamps are not scaled.
   */
  readonly interiorFill = { admitted: 0.06, reflectance: 0.3, adaptation: 3.2, adaptationSpecular: 1.3 };
  /** Linear RGB of the mean interior reflectance, normalised to luminance 1 (bounce tint). */
  private readonly bounceTint = new THREE.Color(1, 1, 1);

  constructor(vars: SimVars, materials: CockpitMaterials) {
    this.vars = vars;
    this.materials = materials;
    // Mean interior reflectance (EST area weights: sidewalls 35 %, headliner 20 %, floor 15 %, panels and
    // glareshield 30 %), from the palette colours (sRGB -> linear).
    const p = materials.palette;
    const acc = new THREE.Color(0, 0, 0);
    const add = (c: THREE.ColorRepresentation, w: number) => acc.add(new THREE.Color(c).multiplyScalar(w));
    add(p.interior, 0.35);
    add(p.headliner, 0.2);
    add(p.carpet, 0.15);
    add(p.panel, 0.2);
    add(p.glareshield, 0.1);
    const lum = 0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b;
    this.interiorFill.reflectance = Math.min(0.7, Math.max(0.05, lum));
    if (lum > 1e-6) this.bounceTint.copy(acc).multiplyScalar(1 / lum);
  }

  /** Adds (or reconfigures) a backlight / flood zone. */
  addZone(opts: LightingZoneOptions): void {
    const z = this.zone(opts.id);
    if (opts.intensityVar) z.intensityVar = opts.intensityVar;
    if (opts.powerVar !== undefined) z.powerVar = opts.powerVar;
    if (opts.color !== undefined) {
      z.color.set(opts.color);
      for (const e of z.materials) e.m.emissive.copy(z.color);
    }
    if (opts.gain !== undefined) z.gain = opts.gain;
    if (opts.lagS !== undefined) z.lagS = opts.lagS;
    if (opts.gamma !== undefined) z.gamma = opts.gamma;
    z.applied = -1;
  }

  /** True when a zone exists. */
  hasZone(id: string): boolean {
    return this.zoneMap.has(id);
  }

  /** Current filtered level (0..1) of a zone. */
  level(id: string): number {
    return this.zoneMap.get(id)?.level ?? 0;
  }

  /**
   * Registers a material whose emissive follows a zone (engraved labels,
   * backlit knob index lines, key legends). The zone is created on demand
   * with intensity var `ac.light.<zone>`.
   */
  registerBacklight(m: THREE.MeshStandardMaterial, zoneId: string, gain = 1): void {
    const z = this.zone(zoneId);
    m.emissive.copy(z.color);
    z.materials.push({ m, gain });
    m.emissiveIntensity = z.level * this.wash * z.gain * gain;
  }

  /** Zone and gain a material was registered with by {@link registerBacklight} (null when it follows no zone). */
  zoneOf(m: THREE.Material): { zone: string; gain: number } | null {
    for (const z of this.zoneList) {
      for (const e of z.materials) if (e.m === m) return { zone: z.id, gain: e.gain };
    }
    return null;
  }

  /** Removes a material from every zone. */
  unregister(m: THREE.Material): void {
    for (const z of this.zoneList) {
      const i = z.materials.findIndex((e) => e.m === m);
      if (i >= 0) z.materials.splice(i, 1);
    }
  }

  /**
   * Adds a real light driven by a zone. The light is parented to `parent`
   * (the cockpit root, whose frame is the aircraft datum).
   */
  addLight(spec: CockpitLightSpec, parent: THREE.Object3D): THREE.PointLight | THREE.SpotLight {
    const z = this.zone(spec.zone);
    const color = new THREE.Color(spec.color ?? z.color);
    let light: THREE.PointLight | THREE.SpotLight;
    if (spec.kind === 'spot') {
      const s = new THREE.SpotLight(color, 0, spec.distance ?? 2.5, THREE.MathUtils.degToRad(spec.angleDeg ?? 35), spec.penumbra ?? 0.6, spec.decay ?? 2);
      bodyToLocalV(spec.position_m, s.position);
      const t = spec.target_m ?? [spec.position_m[0], spec.position_m[1], spec.position_m[2] + 1];
      bodyToLocalV(t, s.target.position);
      parent.add(s.target);
      light = s;
    } else {
      const p = new THREE.PointLight(color, 0, spec.distance ?? 2.5, spec.decay ?? 2);
      bodyToLocalV(spec.position_m, p.position);
      light = p;
    }
    light.name = `cockpit.light.${spec.id}`;
    light.castShadow = false;
    parent.add(light);
    z.lights.push({ light, candela: spec.candela });
    this.lights.push(light);
    z.applied = -1;
    return light;
  }

  /** Convenience presets (EST candela values, see header). */
  addDomeLight(id: string, zone: string, position_m: BodyVec, parent: THREE.Object3D, candela = 3): THREE.PointLight {
    return this.addLight({ id, kind: 'point', zone, position_m, candela, distance: 3 }, parent) as THREE.PointLight;
  }
  addFloodLight(id: string, zone: string, position_m: BodyVec, target_m: BodyVec, parent: THREE.Object3D, candela = 2, angleDeg = 50): THREE.SpotLight {
    return this.addLight({ id, kind: 'spot', zone, position_m, target_m, candela, angleDeg, penumbra: 0.8, distance: 2.5 }, parent) as THREE.SpotLight;
  }
  /** Storm lights: bright white floods used against lightning flash blindness. */
  addStormLight(id: string, zone: string, position_m: BodyVec, target_m: BodyVec, parent: THREE.Object3D, candela = 8): THREE.SpotLight {
    return this.addLight({ id, kind: 'spot', zone, position_m, target_m, candela, angleDeg: 60, penumbra: 0.9, distance: 3, color: '#ffffff' }, parent) as THREE.SpotLight;
  }
  addMapLight(id: string, zone: string, position_m: BodyVec, target_m: BodyVec, parent: THREE.Object3D, candela = 3): THREE.SpotLight {
    return this.addLight({ id, kind: 'spot', zone, position_m, target_m, candela, angleDeg: 22, penumbra: 0.5, distance: 1.8 }, parent) as THREE.SpotLight;
  }

  /**
   * Annunciator brightness control: `varName` 1 = BRIGHT, 0 = DIM (or the
   * reverse with `invert`). `powerVar` 0 turns all annunciators dark.
   */
  setAnnunciatorDimming(varName: string | null, dimLevel = 0.3, invert = false, powerVar: string | null = null): void {
    this.annunVar = varName;
    this.annunDim = dimLevel;
    this.annunInvert = invert;
    this.annunPowerVar = powerVar;
  }

  /** Multiplier for annunciator emissive intensity (0 when annunciator power is off). */
  annunciatorLevel(): number {
    const v = this.vars;
    if (this.annunPowerVar && v.has(this.annunPowerVar) && v.get(this.annunPowerVar) === 0) return 0;
    if (!this.annunVar || !v.has(this.annunVar)) return 1;
    const bright = v.get(this.annunVar) !== 0;
    return (this.annunInvert ? !bright : bright) ? 1 : this.annunDim;
  }

  /** True while the annunciator lamp test is active. */
  lampTest(): boolean {
    return this.vars.get(this.lampTestVar) !== 0;
  }

  /** Per-frame update. Allocation-free. */
  update(dt: number): void {
    const v = this.vars;
    const amb = v.has(this.ambientVar) ? Math.min(1, Math.max(0, v.get(this.ambientVar))) : 1;
    const t = Math.min(1, Math.max(0, (amb - 0.45) / 0.45));
    const wash = 1 - this.daylightWashout * t * t * (3 - 2 * t);
    const washChanged = Math.abs(wash - this.wash) > 1e-3;
    if (washChanged) this.wash = wash;
    for (let i = 0; i < this.zoneList.length; i++) {
      const z = this.zoneList[i];
      let target = Math.min(1, Math.max(0, v.get(z.intensityVar)));
      if (z.gamma !== 1) target = Math.pow(target, z.gamma);
      if (z.powerVar && v.has(z.powerVar) && v.get(z.powerVar) === 0) target = 0;
      if (z.lagS > 0 && dt > 0) z.level += (target - z.level) * (1 - Math.exp(-dt / z.lagS));
      else z.level = target;
      if (Math.abs(z.level - target) < 1e-4) z.level = target;
      if (washChanged || Math.abs(z.level - z.applied) > 1e-4) {
        z.applied = z.level;
        const lvl = z.level * this.wash;
        const lg = lvl * z.gain;
        for (let k = 0; k < z.materials.length; k++) z.materials[k].m.emissiveIntensity = lg * z.materials[k].gain;
        for (let k = 0; k < z.lights.length; k++) z.lights[k].light.intensity = lvl * z.lights[k].candela;
      }
    }
    // Reflections: interior env map dims with ambient light (EST curve).
    const s = 0.08 + 0.92 * amb * amb * (3 - 2 * amb);
    if (Math.abs(s - this.envScale) > 0.01) {
      this.envScale = s;
      this.materials.setEnvironmentScale(s);
    }
    this.updateInteriorFill(amb, t * t * (3 - 2 * t));
  }

  /** Bounce irradiance and daylight adaptation of the interior indirect light (see `interiorFill`). */
  private updateInteriorFill(amb: number, day: number): void {
    const u = this.materials.interior;
    const f = this.interiorFill;
    const v = this.vars;
    const unitsPerLux = v.get(RENDER_UNITS_PER_LUX, 0);
    let eBounce = 0;
    if (unitsPerLux > 0 && v.has(this.ambientVar)) {
      const lux = Math.pow(10, 6 * amb - 1);
      const rho = f.reflectance;
      const sky = Math.min(1, Math.max(0, u.diffuse.value));
      eBounce = (1 - sky) * rho * ((f.admitted * lux * unitsPerLux) / (1 - rho));
    }
    const b = u.bounce.value;
    const t = this.bounceTint;
    if (Math.abs(b.g - eBounce * t.g) > 1e-5 * (1 + eBounce)) b.setRGB(eBounce * t.r, eBounce * t.g, eBounce * t.b);
    u.adapt.value = 1 + (f.adaptation - 1) * day;
    u.adaptSpecular.value = 1 + (f.adaptationSpecular - 1) * day;
  }

  /** Zone descriptors for `CockpitBuild.lighting`. */
  zones(): CockpitLightingZone[] {
    return this.zoneList.map((z) => ({ id: z.id, intensityVar: z.intensityVar, color: z.color.clone() }));
  }

  dispose(): void {
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.lights.length = 0;
    this.zoneList.length = 0;
    this.zoneMap.clear();
  }

  private zone(id: string): Zone {
    let z = this.zoneMap.get(id);
    if (!z) {
      z = {
        id,
        intensityVar: `ac.light.${id}`,
        powerVar: null,
        color: new THREE.Color(this.materials.palette.backlight),
        gain: 0.9,
        lagS: 0.05,
        gamma: 1,
        level: 0,
        applied: -1,
        materials: [],
        lights: [],
      };
      this.zoneMap.set(id, z);
      this.zoneList.push(z);
    }
    return z;
  }
}
