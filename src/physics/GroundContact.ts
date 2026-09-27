/**
 * Landing-gear and structure ground contact.
 *
 * Per contact (a `GearContactConfig`):
 *  - The terrain under the contact is sampled once per physics step
 *    (`WorldQuery.sampleGround`) and treated as a plane (elevation + normal)
 *    for all substeps of that step.
 *  - Gear struts compress along the body z axis: compression s is the strut
 *    travel needed to bring the extended contact point onto the terrain
 *    plane, s = -h / |a . n| (h = height of the extended point above the
 *    plane, a = strut axis, n = terrain normal). Force = k s + c ds/dt
 *    (never pulls), with a stiff bump stop past `travel_m`. The normal force
 *    acts along the terrain normal at the compressed contact point.
 *  - Tyre forces in the terrain plane along the wheel heading (body x turned
 *    by the steering angle): rolling resistance, braking (brake vars x
 *    brakeCoeff x surface friction, wheel locks and slides when the demand
 *    exceeds the available grip), cornering force from the slip angle with a
 *    saturating Pacejka-style curve F = N mu sin(C atan(B alpha)),
 *    B = 10/rad, C = 1.6 (EST: peak near 8-9 deg slip, typical aircraft
 *    tyres), combined in a friction circle.
 *  - Below 0.3 m/s the tyre switches to a stiction "anchor": a critically
 *    damped spring to a ground point, limited to the static friction force
 *    (rolling resistance, brakes or lateral grip) and slipping when
 *    exceeded. This makes a parked aircraft sit perfectly still (no creep or
 *    jitter) and lets the parking brake hold against idle thrust, while an
 *    unbraked aircraft still starts rolling when thrust beats rolling
 *    resistance.
 *  - Castering wheels generate no side force (free swivel); a steerable
 *    castering wheel (Cessna-style spring link) breaks out at 25% of its
 *    normal load.
 *  - Retractable gear only contacts when `gear.pos{i}` >= 0.98 (down and
 *    locked); a gear in transit or up collapses and the structure contacts
 *    take over.
 *  - Structure contacts (`isStructure`) are stiff springs along the normal
 *    with sliding friction; the FDM treats their impacts as crash events.
 *
 * Surface friction/rolling multipliers (EST, relative to dry pavement; typical
 * published ranges: dry pavement tyre mu 0.7-0.8, wet ~0.4-0.5, grass/dirt
 * 0.4-0.6, snow 0.2-0.3, standing water very low):
 */
import { clamp01 } from '../core/math';
import { Mat3, Quat, Vec3 } from '../core/linalg';
import { DEG_TO_RAD, G0, MS_TO_KT } from '../core/units';
import { meridianRadius, primeVerticalRadius } from '../core/geo';
import type { SimVars } from '../core/SimVars';
import { GEAR } from '../core/vars';
import type { GroundSample, WorldQuery } from '../world/types';
import type { GearContactConfig } from './types';

export type SurfaceType = GroundSample['surface'];

export interface SurfaceProperties {
  /** Multiplier on tyre static/dynamic friction and braking. */
  friction: number;
  /** Multiplier on rolling resistance. */
  rolling: number;
  /** True for paved surfaces (rain reduces friction). */
  paved: boolean;
}

export const SURFACE_PROPERTIES: Readonly<Record<SurfaceType, SurfaceProperties>> = {
  asphalt: { friction: 1.0, rolling: 1.0, paved: true },
  concrete: { friction: 1.0, rolling: 1.0, paved: true },
  grass: { friction: 0.55, rolling: 4.0, paved: false },
  dirt: { friction: 0.65, rolling: 3.0, paved: false },
  gravel: { friction: 0.6, rolling: 3.5, paved: false },
  water: { friction: 0.08, rolling: 20.0, paved: false },
  snow: { friction: 0.3, rolling: 5.0, paved: false },
  unknown: { friction: 1.0, rolling: 1.0, paved: true },
};

/** Friction loss on a fully wet paved surface (env.precip = 1). EST: wet ~0.55 x dry. */
const WET_PAVED_LOSS = 0.45;
const V_STICK = 0.3; // m/s
const ANCHOR_OMEGA = 15; // rad/s
const ANCHOR_ZETA = 1.0;
const PACEJKA_B = 10;
const PACEJKA_C = 1.6;
const CASTER_BREAKOUT = 0.25;
const GEAR_DOWN_LOCKED = 0.98;
/**
 * Flat tyre (GEAR.tireFlat): EST the contact point rises by about half a light-aircraft tyre's
 * section height (6.00-6: ~0.15 m section, rim flange then ~0.07 m off the ground), and the
 * deflated tyre adds a large rolling drag (EST mu ~0.25, the "use brake on the good wheel"
 * directional pull of POH 172S Sec 3 "Landing with a flat main tire").
 */
const FLAT_TIRE_DROP_M = 0.07;
const FLAT_TIRE_ROLL_MU = 0.25;

/** Per-contact runtime state (exposed read-only for diagnostics and tests). */
export class ContactState {
  readonly cfg: GearContactConfig;
  readonly bodyPos = new Vec3();
  /** Terrain plane for the current step (NED relative to the step-start CG). */
  readonly planePoint = new Vec3();
  readonly planeNormal = new Vec3(0, 0, -1); // "up" expressed in NED
  surface: SurfaceType = 'unknown';
  sampled = false;
  /** Compression (m along the strut / normal). */
  compression = 0;
  /** Normal force (N). */
  normalForce = 0;
  inContact = false;
  wasInContact = false;
  /** Normal approach speed at the moment of first contact (m/s, + = into the ground). */
  touchdownSpeed = 0;
  /** Seconds of continuous contact. */
  contactTime = 0;
  skidding = false;
  /** Wheel rim speed (m/s). */
  wheelSpeed = 0;
  /** Stiction anchor displacement (NED, in the terrain plane). */
  readonly anchor = new Vec3();
  anchorActive = false;
  /** Last force (NED) and application point (body, relative to CG). */
  readonly force = new Vec3();
  /** Tyre deflation 0..1 this step (GEAR.tireFlat of its gear index; 0 for structure). */
  flat = 0;

  constructor(cfg: GearContactConfig) {
    this.cfg = cfg;
    this.bodyPos.setArray(cfg.position_m);
  }
}

export class GroundContact {
  readonly contacts: ContactState[];
  /** Total ground force (body axes, N) and moment about the CG (body, N·m) of the last evaluation. */
  readonly forceBody = new Vec3();
  readonly momentBody = new Vec3();
  /** Any landing gear (not structure) carrying load. */
  onGround = false;
  /** Largest gear touchdown sink rate this step (m/s). */
  maxTouchdownSpeed = 0;
  /** Largest structure impact speed this step (m/s) and longest structure contact time (s). */
  structureImpactSpeed = 0;
  structureContactTime = 0;
  structureContactName = '';
  /** A gear or structure contact touched water. */
  touchingWater = false;
  /** Max reach of any contact from the CG (m), for deciding when to sample terrain. */
  readonly maxReach: number;

  private readonly vars: SimVars;
  private readonly posVars: string[];
  private readonly steerVar = GEAR.steerDeg;
  private readonly brakeLVar = GEAR.brakeLeft;
  private readonly brakeRVar = GEAR.brakeRight;
  private readonly gearIndices: number[];
  private readonly wowVars: string[];
  private readonly compVars: string[];
  private readonly speedVars: string[];
  /** Per contact: GEAR.tireFlat var of its gear index ('' for structure contacts). */
  private readonly flatVars: string[];
  private readonly idxWow: Float64Array;
  private readonly idxComp: Float64Array;
  private readonly idxSpeed: Float64Array;
  /** Wetness of paved surfaces 0..1 (env.precip), set by the FDM. */
  wetness = 0;

  // scratch
  private readonly rb = new Vec3();
  private readonly pc = new Vec3();
  private readonly vc = new Vec3();
  private readonly axis = new Vec3();
  private readonly fwd = new Vec3();
  private readonly right = new Vec3();
  private readonly tmp = new Vec3();
  private readonly tmp2 = new Vec3();
  private readonly fB = new Vec3();
  private readonly m = new Mat3();

  constructor(configs: readonly GearContactConfig[], vars: SimVars) {
    this.vars = vars;
    this.contacts = configs.map((c) => new ContactState(c));
    this.posVars = configs.map((c) => (c.gearIndex >= 0 ? GEAR.pos(c.gearIndex) : ''));
    this.flatVars = configs.map((c) => (c.gearIndex >= 0 && !c.isStructure ? GEAR.tireFlat(c.gearIndex) : ''));
    const idx = [...new Set(configs.filter((c) => c.gearIndex >= 0).map((c) => c.gearIndex))].sort((a, b) => a - b);
    this.gearIndices = idx;
    this.wowVars = idx.map((i) => GEAR.weightOnWheels(i));
    this.compVars = idx.map((i) => GEAR.compression(i));
    this.speedVars = idx.map((i) => GEAR.wheelSpeedKt(i));
    this.idxWow = new Float64Array(idx.length);
    this.idxComp = new Float64Array(idx.length);
    this.idxSpeed = new Float64Array(idx.length);
    let reach = 0;
    for (const c of configs) reach = Math.max(reach, Math.hypot(c.position_m[0], c.position_m[1], c.position_m[2]));
    this.maxReach = reach;
  }

  /** True if contact `i` can carry load (fixed gear, structure, or retractable gear down and locked). */
  isActive(i: number): boolean {
    return this.isActiveIdx(i);
  }

  /**
   * Samples the terrain plane under every contact for this physics step.
   * @param latDeg/lonDeg/altM CG position; q attitude; cg body CG position
   */
  sampleTerrain(world: WorldQuery, latDeg: number, lonDeg: number, altM: number, q: Quat, cg: Vec3): void {
    const mr = meridianRadius(latDeg) + altM;
    const nr = (primeVerticalRadius(latDeg) + altM) * Math.max(1e-6, Math.cos(latDeg * DEG_TO_RAD));
    for (const c of this.contacts) {
      this.rb.subVectors(c.bodyPos, cg);
      q.rotate(this.rb, this.pc);
      const lat = latDeg + (this.pc.x / mr) / DEG_TO_RAD;
      const lon = lonDeg + (this.pc.y / nr) / DEG_TO_RAD;
      const g = world.sampleGround(lat, lon);
      const elev = Number.isFinite(g.elevation_m) ? g.elevation_m : 0;
      const nE = g.normal[0];
      const nN = g.normal[1];
      const nU = g.normal[2];
      const inv = 1 / Math.max(1e-9, Math.hypot(nE, nN, nU));
      // Plane point: directly below/above the contact at sample time (NED relative to the CG).
      c.planePoint.set(this.pc.x, this.pc.y, altM - elev);
      c.planeNormal.set(nN * inv, nE * inv, -nU * inv);
      if (c.planeNormal.z > -0.2) c.planeNormal.set(0, 0, -1); // reject vertical/invalid normals
      c.surface = g.surface;
      c.sampled = true;
    }
  }

  /** Marks all contacts as out of range (aircraft high above the terrain). */
  clearTerrain(): void {
    for (const c of this.contacts) c.sampled = false;
  }

  /** Resets stiction anchors, wheel speeds and contact history (after reposition). */
  reset(): void {
    for (const c of this.contacts) {
      c.anchor.zero();
      c.anchorActive = false;
      c.wheelSpeed = 0;
      c.contactTime = 0;
      c.wasInContact = false;
      c.inContact = false;
      c.skidding = false;
      c.compression = 0;
      c.normalForce = 0;
    }
  }

  /**
   * Computes ground forces for the current (sub)state.
   * @param dPos CG displacement since `sampleTerrain` (NED, m)
   * @param q body->NED attitude
   * @param vNed CG velocity (NED, m/s)
   * @param wBody body angular rate (rad/s)
   * @param cg CG position (body)
   * @param dt substep (s); 0 = static evaluation (no damping, no friction, no state change)
   */
  compute(dPos: Vec3, q: Quat, vNed: Vec3, wBody: Vec3, cg: Vec3, dt: number): void {
    const staticMode = dt <= 0;
    const fBody = this.forceBody.zero();
    const mBody = this.momentBody.zero();
    q.toMatrix(this.m);
    this.onGround = false;
    if (!staticMode) {
      this.maxTouchdownSpeed = 0;
      this.structureImpactSpeed = 0;
      this.structureContactTime = 0;
      this.structureContactName = '';
      this.touchingWater = false;
    }
    const brakeL = clamp01(this.vars.get(this.brakeLVar));
    const brakeR = clamp01(this.vars.get(this.brakeRVar));
    const steerDeg = this.vars.get(this.steerVar);
    // Strut axis (body +z) in NED.
    const e = this.m.e;
    this.axis.set(e[2], e[5], e[8]);

    for (let ci = 0; ci < this.contacts.length; ci++) {
      const c = this.contacts[ci];
      const cfg = c.cfg;
      c.force.zero();
      if (!c.sampled || !this.isActiveIdx(ci)) {
        this.noContact(c, dt);
        continue;
      }
      const n = c.planeNormal;
      // Contact point (extended) relative to the step-start CG, NED.
      this.rb.subVectors(c.bodyPos, cg);
      q.rotate(this.rb, this.pc).add(dPos);
      this.tmp.subVectors(this.pc, c.planePoint);
      const fv = this.flatVars[ci];
      c.flat = fv ? clamp01(this.vars.get(fv)) : 0;
      // A flat tyre's contact point sits higher (closer to the axle): the airplane settles on that side.
      const h = this.tmp.dot(n) + c.flat * FLAT_TIRE_DROP_M;
      if (h >= 0) {
        this.noContact(c, dt);
        continue;
      }
      // Contact point velocity (NED): v + R (w x r).
      this.tmp.crossVectors(wBody, this.rb);
      q.rotate(this.tmp, this.vc).add(vNed);
      const hdot = this.vc.dot(n); // + = moving away from the ground
      let s: number;
      let sdot: number;
      const isStruct = cfg.isStructure === true;
      if (isStruct) {
        s = -h;
        sdot = -hdot;
      } else {
        const an = this.axis.dot(n); // negative when the strut points into the ground
        if (an > -0.2) {
          this.noContact(c, dt);
          continue;
        }
        s = h / an;
        sdot = hdot / an;
      }
      let F = cfg.springK_Npm * s;
      if (s > cfg.travel_m) F += 10 * cfg.springK_Npm * (s - cfg.travel_m);
      if (!staticMode) F += cfg.dampingC_Nspm * sdot * (s > cfg.travel_m ? 3 : 1);
      if (F < 0) F = 0;
      c.compression = s;
      c.normalForce = F;
      const wasIn = c.wasInContact;
      c.inContact = F > 0 || s > 0;
      if (!isStruct && F > 0) this.onGround = true;

      // Normal force along the terrain normal.
      c.force.copy(n).scale(F);

      if (!staticMode) {
        if (!wasIn) {
          c.touchdownSpeed = Math.max(0, -hdot);
          c.contactTime = 0;
          if (isStruct) {
            if (c.touchdownSpeed > this.structureImpactSpeed) {
              this.structureImpactSpeed = c.touchdownSpeed;
              this.structureContactName = cfg.name;
            }
          } else if (c.touchdownSpeed > this.maxTouchdownSpeed) this.maxTouchdownSpeed = c.touchdownSpeed;
        }
        c.contactTime += dt;
        c.wasInContact = true;
        if (isStruct && c.contactTime > this.structureContactTime) {
          this.structureContactTime = c.contactTime;
          if (!this.structureContactName) this.structureContactName = cfg.name;
        }
        const surf = SURFACE_PROPERTIES[c.surface] ?? SURFACE_PROPERTIES.unknown;
        if (c.surface === 'water') this.touchingWater = true;
        const wet = surf.paved ? 1 - WET_PAVED_LOSS * clamp01(this.wetness) : 1;
        const muSurf = surf.friction * wet;
        this.frictionForce(c, F, muSurf, surf.rolling, isStruct, cfg.brake === 'left' ? brakeL : cfg.brake === 'right' ? brakeR : 0, steerDeg, dt);
      }

      // Apply at the compressed contact point: body offset moved up the strut (or normal).
      q.rotateInverse(c.force, this.fB);
      this.rb.z -= s;
      this.tmp2.crossVectors(this.rb, this.fB);
      fBody.add(this.fB);
      mBody.add(this.tmp2);
    }
  }

  private isActiveIdx(ci: number): boolean {
    const cfg = this.contacts[ci].cfg;
    if (cfg.isStructure || !cfg.retractable || cfg.gearIndex < 0) return true;
    return this.vars.get(this.posVars[ci], 1) >= GEAR_DOWN_LOCKED;
  }

  private noContact(c: ContactState, dt: number): void {
    c.inContact = false;
    c.compression = 0;
    c.normalForce = 0;
    c.anchorActive = false;
    c.anchor.zero();
    c.skidding = false;
    if (dt > 0) {
      c.wasInContact = false;
      c.contactTime = 0;
      // Free wheel spins down in the air (faster when braked).
      const braked = c.cfg.brake === 'left' ? this.vars.get(this.brakeLVar) : c.cfg.brake === 'right' ? this.vars.get(this.brakeRVar) : 0;
      const tau = braked > 0.1 ? 0.3 : 8;
      c.wheelSpeed *= Math.exp(-dt / tau);
    }
  }

  /** Adds tyre/structure friction forces (NED) to `c.force`. */
  private frictionForce(
    c: ContactState,
    N: number,
    muSurf: number,
    rollingMul: number,
    isStruct: boolean,
    brake: number,
    steerDeg: number,
    dt: number,
  ): void {
    const cfg = c.cfg;
    const n = c.planeNormal;
    // In-plane contact velocity.
    const vn = this.vc.dot(n);
    const vp = this.tmp.copy(this.vc).addScaled(n, -vn);
    const speed = vp.length();

    if (isStruct) {
      // Scraping: sliding friction opposite the in-plane velocity.
      if (speed > 1e-6) {
        const mu = cfg.dynamicFriction * muSurf * Math.tanh(speed / 0.2);
        c.force.addScaled(vp, (-mu * N) / speed);
      }
      c.wheelSpeed = 0;
      return;
    }

    // Wheel heading: body x turned by the steering angle, projected into the plane.
    let delta = 0;
    if (cfg.steerable) delta = Math.max(-cfg.maxSteer_deg, Math.min(cfg.maxSteer_deg, steerDeg)) * DEG_TO_RAD;
    const e = this.m.e;
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    // R * (cd, sd, 0)
    this.fwd.set(e[0] * cd + e[1] * sd, e[3] * cd + e[4] * sd, e[6] * cd + e[7] * sd);
    this.fwd.addScaled(n, -this.fwd.dot(n)).normalize();
    this.right.crossVectors(this.fwd, n);
    const vf = vp.dot(this.fwd);
    const vs = vp.dot(this.right);

    const muPeak = cfg.staticFriction * muSurf;
    const muSlide = cfg.dynamicFriction * muSurf;
    const muRoll = (cfg.rollingFriction + c.flat * FLAT_TIRE_ROLL_MU) * rollingMul;
    const muBrake = cfg.brakeCoeff * clamp01(brake) * muSurf;
    const locked = muBrake > muPeak;
    c.skidding = locked && speed > V_STICK;
    const freeCaster = cfg.castering && !cfg.steerable;
    const latLimit = freeCaster ? 0 : cfg.castering ? CASTER_BREAKOUT * N : muPeak * N;

    let Ff: number;
    let Fs: number;
    if (speed < V_STICK) {
      // ---- stiction anchor
      if (!c.anchorActive) {
        c.anchor.zero();
        c.anchorActive = true;
      }
      c.anchor.addScaled(vp, dt);
      c.anchor.addScaled(n, -c.anchor.dot(n));
      const mEff = Math.max(N / G0, 1);
      const k = mEff * ANCHOR_OMEGA * ANCHOR_OMEGA;
      const cDamp = 2 * ANCHOR_ZETA * ANCHOR_OMEGA * mEff;
      const df = c.anchor.dot(this.fwd);
      const ds = c.anchor.dot(this.right);
      Ff = -k * df - cDamp * vf;
      Fs = -k * ds - cDamp * vs;
      const longLimit = (locked ? muPeak : Math.min(muPeak, muBrake + muRoll)) * N;
      let newDf = df;
      let newDs = ds;
      if (Math.abs(Ff) > longLimit) {
        Ff = Math.sign(Ff) * longLimit;
        newDf = -(Ff + cDamp * vf) / k;
      }
      if (Math.abs(Fs) > latLimit) {
        Fs = Math.sign(Fs) * latLimit;
        newDs = latLimit > 0 ? -(Fs + cDamp * vs) / k : 0;
      }
      c.anchor.copy(this.fwd).scale(newDf).addScaled(this.right, newDs);
      c.wheelSpeed = Math.abs(vf);
    } else {
      // ---- rolling / sliding
      c.anchorActive = false;
      c.anchor.zero();
      if (locked) {
        // Locked wheel: sliding friction opposite the in-plane velocity, no cornering.
        Ff = (-muSlide * N * vf) / speed;
        Fs = (-muSlide * N * vs) / speed;
        c.wheelSpeed *= Math.exp(-dt / 0.05);
      } else {
        const muL = Math.min(muPeak, muBrake + muRoll);
        Ff = -muL * N * Math.tanh(vf / 0.1);
        const slip = Math.atan2(vs, Math.max(Math.abs(vf), 0.5));
        Fs = -muPeak * N * Math.sin(PACEJKA_C * Math.atan(PACEJKA_B * slip));
        if (Math.abs(Fs) > latLimit) Fs = Math.sign(Fs) * latLimit;
        // Friction circle.
        const tot = Math.hypot(Ff, Fs);
        const lim = muPeak * N;
        if (tot > lim) {
          Ff *= lim / tot;
          Fs *= lim / tot;
        }
        c.wheelSpeed = Math.abs(vf);
      }
    }
    c.force.addScaled(this.fwd, Ff).addScaled(this.right, Fs);
  }

  /** Writes gear.wow*, gear.compression*, gear.wheel_speed*_kt. */
  publish(): void {
    const idx = this.gearIndices;
    this.idxWow.fill(0);
    this.idxComp.fill(0);
    this.idxSpeed.fill(0);
    for (const c of this.contacts) {
      const gi = c.cfg.gearIndex;
      if (gi < 0 || c.cfg.isStructure) continue;
      const k = idx.indexOf(gi);
      if (k < 0) continue;
      if (c.normalForce > 0) this.idxWow[k] = 1;
      const comp = clamp01(c.compression / Math.max(1e-6, c.cfg.travel_m));
      if (comp > this.idxComp[k]) this.idxComp[k] = comp;
      const ws = c.wheelSpeed * MS_TO_KT;
      if (ws > this.idxSpeed[k]) this.idxSpeed[k] = ws;
    }
    for (let k = 0; k < idx.length; k++) {
      this.vars.set(this.wowVars[k], this.idxWow[k]);
      this.vars.set(this.compVars[k], this.idxComp[k]);
      this.vars.set(this.speedVars[k], this.idxSpeed[k]);
    }
  }
}
