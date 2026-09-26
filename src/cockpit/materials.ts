/**
 * PBR material library for cockpits.
 *
 * One `CockpitMaterials` instance per cockpit. Named materials are created on
 * first use and shared by every part that asks for the same name; per-instance
 * materials (annunciator lenses, display glass) are tracked for disposal.
 *
 * Palettes hold the manufacturer paint colours. Sources:
 *  - Boeing 737: panel paint FS 595 36440 "Light Gull Gray" is Boeing's
 *    specified cockpit colour (flaps2approach.com, "Differences in Colour,
 *    Manufacturer, and Layout in the Center Pedestal", 2018); FS 36440 is
 *    sRGB #ACACA4 (perbang.dk FS colour table). Aftermarket panels (Gables)
 *    use RAL 7011 iron grey (#434B4D, RAL colour chart), offered as
 *    'boeing-ral7011'.
 *  - Gulfstream, Bombardier, Cessna: no public paint specification exists.
 *    Values are EST: sampled from manufacturer flight-deck press photographs
 *    (charcoal/dark-grey panels, black crackle glareshields), then darkened
 *    slightly because press photos are over-lit.
 *  - Annunciator colours follow 14 CFR 25.1322 (red = warning, amber =
 *    caution, green = safe operation, white/blue/cyan = advisory); the exact
 *    shades are EST (typical LED/filtered-incandescent Korry lens colours).
 */
import * as THREE from 'three';
import {
  brushedRoughness,
  carpetNormal,
  crackleNormal,
  fabricNormal,
  knurlNormal,
  leatherNormal,
  paintNormal,
  screwHeadTexture,
} from './textures';

export type PaletteId = 'boeing' | 'boeing-ral7011' | 'gulfstream' | 'bombardier' | 'citation' | 'cessna172';

/** Lamp colours for annunciators, lit legends and indicator lights. */
export type LampColor = 'red' | 'amber' | 'green' | 'white' | 'blue' | 'cyan' | 'magenta';

export interface PaletteDef {
  name: string;
  /** Main panel paint. */
  panel: THREE.ColorRepresentation;
  panelRoughness: number;
  /** Surface finish of panels: smooth satin paint, textured paint or wrinkle (crackle) finish. */
  panelFinish: 'smooth' | 'textured' | 'crackle';
  /** Backing structure visible in gaps between panel modules, bezel recesses. */
  panelDark: THREE.ColorRepresentation;
  glareshield: THREE.ColorRepresentation;
  /** Instrument/display bezels. */
  bezel: THREE.ColorRepresentation;
  knob: THREE.ColorRepresentation;
  knobRoughness: number;
  /** Toggle-switch bat handles: chrome (most jets) or black. */
  handle: 'chrome' | 'black';
  /** Sidewalls, headliner. */
  interior: THREE.ColorRepresentation;
  headliner: THREE.ColorRepresentation;
  carpet: THREE.ColorRepresentation;
  seat: THREE.ColorRepresentation;
  seatMaterial: 'leather' | 'fabric';
  yoke: THREE.ColorRepresentation;
  /** Daylight colour of engraved label fill (white translucent acrylic under the paint). */
  labelFill: THREE.ColorRepresentation;
  /** Colour of the panel backlighting at night. */
  backlight: THREE.ColorRepresentation;
  /** Colour of flood/dome lighting. */
  flood: THREE.ColorRepresentation;
}

/** EST: blackbody ~2850 K (CIE illuminant A, incandescent) seen through a white diffuser, as sRGB. */
const INCANDESCENT = '#ffd29a';
/** EST: cool-white LED panel lighting (~5000 K) as sRGB. */
const LED_WHITE = '#eef2ff';

export const PALETTES: Record<PaletteId, PaletteDef> = {
  boeing: {
    name: 'Boeing 737 (FS 36440 Light Gull Gray)',
    panel: '#acaca4', // FS 595 36440, see header
    panelRoughness: 0.62,
    panelFinish: 'textured',
    panelDark: '#55595b', // EST: grey module backing/rails
    glareshield: '#161616',
    bezel: '#27292b',
    knob: '#1b1b1c',
    knobRoughness: 0.55,
    handle: 'chrome',
    interior: '#9ea2a1', // EST: 737NG sidewall liner grey
    headliner: '#b8bab6',
    carpet: '#3a3e44',
    seat: '#2f3542', // EST: blue-grey fabric crew seats
    seatMaterial: 'fabric',
    yoke: '#2a2a2a',
    labelFill: '#f1f1ea',
    backlight: INCANDESCENT,
    flood: INCANDESCENT,
  },
  'boeing-ral7011': {
    name: 'Boeing 737 (RAL 7011 aftermarket)',
    panel: '#434b4d', // RAL 7011 iron grey
    panelRoughness: 0.6,
    panelFinish: 'textured',
    panelDark: '#2a2f31',
    glareshield: '#161616',
    bezel: '#222426',
    knob: '#1b1b1c',
    knobRoughness: 0.55,
    handle: 'chrome',
    interior: '#9ea2a1',
    headliner: '#b8bab6',
    carpet: '#3a3e44',
    seat: '#2f3542',
    seatMaterial: 'fabric',
    yoke: '#2a2a2a',
    labelFill: '#f1f1ea',
    backlight: INCANDESCENT,
    flood: INCANDESCENT,
  },
  gulfstream: {
    name: 'Gulfstream (charcoal)',
    panel: '#3a3c3f', // EST (see header)
    panelRoughness: 0.55,
    panelFinish: 'smooth',
    panelDark: '#1f2123',
    glareshield: '#121212',
    bezel: '#1b1c1e',
    knob: '#151516',
    knobRoughness: 0.45,
    handle: 'chrome',
    interior: '#cdc6b8', // EST: cream leather/composite sidewalls
    headliner: '#d9d3c7',
    carpet: '#4a453e',
    seat: '#d4c6ad', // EST: tan leather
    seatMaterial: 'leather',
    yoke: '#1f1f20',
    labelFill: '#f4f4f0',
    backlight: LED_WHITE,
    flood: LED_WHITE,
  },
  bombardier: {
    name: 'Bombardier Global (dark grey)',
    panel: '#34373b', // EST
    panelRoughness: 0.55,
    panelFinish: 'smooth',
    panelDark: '#1d1f22',
    glareshield: '#121212',
    bezel: '#1a1b1d',
    knob: '#161617',
    knobRoughness: 0.5,
    handle: 'chrome',
    interior: '#bdb8ae',
    headliner: '#cfcac0',
    carpet: '#3d3b38',
    seat: '#3b3a39', // EST: dark leather crew seats
    seatMaterial: 'leather',
    yoke: '#1e1e1f',
    labelFill: '#f4f4f0',
    backlight: LED_WHITE,
    flood: LED_WHITE,
  },
  citation: {
    name: 'Cessna Citation (dark grey)',
    panel: '#2e3033', // EST
    panelRoughness: 0.5,
    panelFinish: 'smooth',
    panelDark: '#1a1b1d',
    glareshield: '#131313',
    bezel: '#1b1c1e',
    knob: '#141415',
    knobRoughness: 0.45,
    handle: 'chrome',
    interior: '#b9b2a5',
    headliner: '#cdc7bc',
    carpet: '#3f3c38',
    seat: '#c9bca4', // EST: light leather
    seatMaterial: 'leather',
    yoke: '#1c1c1d',
    labelFill: '#f4f4f0',
    backlight: LED_WHITE,
    flood: LED_WHITE,
  },
  cessna172: {
    name: 'Cessna 172S (textured grey plastic)',
    panel: '#2c2d2f', // EST: textured dark-grey ABS panel overlay
    panelRoughness: 0.8,
    panelFinish: 'textured',
    panelDark: '#1b1c1d',
    glareshield: '#1a1a1a',
    bezel: '#1c1c1d',
    knob: '#18181a',
    knobRoughness: 0.6,
    handle: 'black',
    interior: '#8d8983', // EST: grey plastic sidewalls
    headliner: '#bdb9b1',
    carpet: '#3a3836',
    seat: '#3d3a36', // EST: dark leather/vinyl seats
    seatMaterial: 'leather',
    yoke: '#1c1c1d',
    labelFill: '#f2f2ee',
    backlight: '#fff0d8', // EST: 172S LED post/edge lighting, warm white
    flood: '#fff0d8',
  },
};

/** sRGB lamp colours (EST shades, colour meaning per 14 CFR 25.1322). */
export const LAMP_COLORS: Record<LampColor, string> = {
  red: '#ff2a1c',
  amber: '#ffb000',
  green: '#3dff5a',
  white: '#f2f6ff',
  blue: '#3f9bff',
  cyan: '#38e3ff',
  magenta: '#ff4fe8',
};

/** Names of the shared materials. */
export type MaterialName =
  | 'panel'
  | 'panelDark'
  | 'panelEdge'
  | 'glareshield'
  | 'bezel'
  | 'bezelGloss'
  | 'knob'
  | 'knobKnurled'
  | 'knobGrey'
  | 'knobWhite'
  | 'knobRed'
  | 'knobMetal'
  | 'chrome'
  | 'aluminium'
  | 'steel'
  | 'brass'
  | 'handle'
  | 'handleBlack'
  | 'screw'
  | 'screwPhillips'
  | 'screwSlot'
  | 'screwHex'
  | 'rubber'
  | 'plasticBlack'
  | 'plasticGrey'
  | 'guardRed'
  | 'guardBlack'
  | 'guardYellow'
  | 'guardClear'
  | 'wire'
  | 'leather'
  | 'fabric'
  | 'carpet'
  | 'interior'
  | 'headliner'
  | 'frame'
  | 'yoke'
  | 'yokeGrip'
  | 'paintWhite'
  | 'paintRed'
  | 'paintYellow'
  | 'paintBlack'
  | 'windowGlass'
  | 'lcdOff'
  | 'hitbox';

type AnyMat = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial;

export class CockpitMaterials {
  readonly palette: PaletteDef;
  private readonly cache = new Map<string, THREE.Material>();
  private readonly owned = new Set<THREE.Material>();
  private readonly textures = new Map<string, THREE.Texture>();
  private envMap: THREE.Texture | null = null;
  private envScale = 1;
  /**
   * Interior occlusion (shared uniforms): a cockpit interior sees only part
   * of the sky through its windows, and the renderer has no ambient
   * occlusion, so the indirect (hemisphere/environment) light reaching
   * cockpit surfaces is scaled down. Direct light (sun through the windows,
   * flood lights) is unaffected. EST: ~40 % of the hemisphere is visible
   * from a panel through a typical windshield + side windows.
   */
  readonly interior = { diffuse: { value: 0.4 }, specular: { value: 0.7 } };

  constructor(palette: PaletteId | PaletteDef) {
    this.palette = typeof palette === 'string' ? PALETTES[palette] : palette;
    if (!this.palette) throw new Error(`Unknown cockpit palette '${String(palette)}'`);
  }

  /** Shared named material (created on first use). Do not mutate or dispose it. */
  get(name: MaterialName): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      m = this.make(name);
      m.name = `cockpit.${name}`;
      this.cache.set(name, m);
      this.patchInterior(m);
      this.applyEnv(m);
    }
    return m;
  }

  /**
   * A shared custom-coloured material of a given kind, e.g. a red knob or a
   * yellow/black striped handle colour. Cached per (kind, colour).
   */
  custom(kind: 'paint' | 'plastic' | 'metal' | 'gloss', color: THREE.ColorRepresentation, roughness?: number): THREE.Material {
    const key = `custom.${kind}.${new THREE.Color(color).getHexString()}.${roughness ?? ''}`;
    let m = this.cache.get(key);
    if (!m) {
      const base: Record<typeof kind, [number, number]> = { paint: [0.6, 0], plastic: [0.45, 0], metal: [0.3, 1], gloss: [0.18, 0] };
      const [r, met] = base[kind];
      m = std({ color, roughness: roughness ?? r, metalness: met });
      m.name = key;
      this.cache.set(key, m);
      this.patchInterior(m);
      this.applyEnv(m);
    }
    return m;
  }

  /**
   * Per-instance annunciator lens material. `off` look: dark tinted lens
   * (colour * 0.12, glossy); lit look: emissive in the lamp colour. Callers
   * drive `emissiveIntensity` (0 = off). `legend` is an alpha/mask texture
   * whose white pixels glow (legend-lit) or stay dark (field-lit, see labels).
   */
  lens(color: LampColor | THREE.ColorRepresentation, emissiveMap: THREE.Texture | null, tintOff = 0.1): THREE.MeshStandardMaterial {
    const c = new THREE.Color(typeof color === 'string' && color in LAMP_COLORS ? LAMP_COLORS[color as LampColor] : color);
    const m = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(tintOff).offsetHSL(0, -0.2, 0),
      roughness: 0.22,
      metalness: 0,
      emissive: c,
      emissiveMap,
      emissiveIntensity: 0,
    });
    m.name = 'cockpit.lens';
    this.track(m);
    return m;
  }

  /** Per-instance material that glows with a legend texture (engraved backlit caps, key legends). */
  backlitLegend(map: THREE.Texture | null, fill: THREE.ColorRepresentation, glow: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: fill,
      map,
      transparent: true,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0,
      emissive: glow,
      emissiveMap: map,
      emissiveIntensity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    m.name = 'cockpit.legend';
    this.track(m);
    return m;
  }

  /** Cover glass over a display: faint reflections and glare, no visible tint. */
  displayGlass(): THREE.MeshPhysicalMaterial {
    let m = this.cache.get('displayGlass') as THREE.MeshPhysicalMaterial | undefined;
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        roughness: 0.06,
        metalness: 0,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 0.5,
      });
      m.name = 'cockpit.displayGlass';
      m.userData.envBase = 0.8;
      this.cache.set('displayGlass', m);
      this.patchInterior(m);
      this.applyEnv(m);
    }
    return m;
  }

  /** Registers an externally created material so dispose() frees it. */
  track<T extends THREE.Material>(m: T): T {
    this.owned.add(m);
    this.patchInterior(m);
    this.applyEnv(m);
    return m;
  }

  /** Sets the interior occlusion factors (indirect diffuse and specular multipliers, 0..1). */
  setInteriorOcclusion(diffuse: number, specular = this.interior.specular.value): void {
    this.interior.diffuse.value = diffuse;
    this.interior.specular.value = specular;
  }

  /**
   * Applies the interior-occlusion shader patch to a MeshStandard/Physical
   * material (idempotent). Called for every material created here; call it
   * for materials created elsewhere that live in the cockpit.
   */
  patchInterior(m: THREE.Material): void {
    const s = m as THREE.MeshStandardMaterial;
    if (!s.isMeshStandardMaterial || s.userData.cockpitInterior) return;
    s.userData.cockpitInterior = true;
    const u = this.interior;
    // Chain any existing hook (materials from other modules may have their own).
    const prevCompile = s.onBeforeCompile;
    const prevKey = s.customProgramCacheKey;
    s.onBeforeCompile = (shader, renderer) => {
      prevCompile.call(s, shader, renderer);
      shader.uniforms.cockpitAoDiffuse = u.diffuse;
      shader.uniforms.cockpitAoSpecular = u.specular;
      shader.fragmentShader =
        'uniform float cockpitAoDiffuse;\nuniform float cockpitAoSpecular;\n' +
        shader.fragmentShader.replace(
          '#include <aomap_fragment>',
          '#include <aomap_fragment>\n\treflectedLight.indirectDiffuse *= cockpitAoDiffuse;\n\treflectedLight.indirectSpecular *= cockpitAoSpecular;',
        );
    };
    s.customProgramCacheKey = () => `${prevKey.call(s)}|cockpitInterior`;
    s.needsUpdate = true;
  }

  /** Stops tracking and disposes a per-instance material. */
  release(m: THREE.Material): void {
    if (this.owned.delete(m)) m.dispose();
  }

  /**
   * Sets an environment map on every cockpit material (e.g. a PMREM of
   * `RoomEnvironment` for interior reflections). null = use scene.environment.
   */
  setEnvironment(tex: THREE.Texture | null): void {
    this.envMap = tex;
    for (const m of this.cache.values()) this.applyEnv(m);
    for (const m of this.owned) this.applyEnv(m);
  }

  /** Scales every material's envMapIntensity (Lighting dims reflections at night). */
  setEnvironmentScale(scale: number): void {
    if (Math.abs(scale - this.envScale) < 1e-3) return;
    this.envScale = scale;
    for (const m of this.cache.values()) this.scaleEnv(m);
    for (const m of this.owned) this.scaleEnv(m);
  }

  /** Procedural texture by name (shared). */
  texture(name: 'crackle' | 'paint' | 'leather' | 'fabric' | 'carpet' | 'knurl' | 'brushed'): THREE.Texture {
    let t = this.textures.get(name);
    if (!t) {
      switch (name) {
        case 'crackle':
          t = crackleNormal();
          break;
        case 'paint':
          t = paintNormal();
          break;
        case 'leather':
          t = leatherNormal();
          break;
        case 'fabric':
          t = fabricNormal();
          break;
        case 'carpet':
          t = carpetNormal();
          break;
        case 'knurl':
          t = knurlNormal();
          break;
        case 'brushed':
          t = brushedRoughness();
          break;
      }
      this.textures.set(name, t);
    }
    return t;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    for (const m of this.owned) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.cache.clear();
    this.owned.clear();
    this.textures.clear();
  }

  // ---------------------------------------------------------------------------

  private applyEnv(m: THREE.Material): void {
    const s = m as THREE.MeshStandardMaterial;
    if (!('envMapIntensity' in s)) return;
    // Dielectrics get weaker interior reflections than metals (EST).
    if (s.userData.envBase === undefined) s.userData.envBase = s.envMapIntensity * ((s.metalness ?? 0) >= 0.5 ? 1 : 0.5);
    s.envMap = this.envMap;
    s.envMapIntensity = s.userData.envBase * this.envScale;
    s.needsUpdate = true;
  }

  private scaleEnv(m: THREE.Material): void {
    const s = m as THREE.MeshStandardMaterial;
    if (!('envMapIntensity' in s) || s.userData.envBase === undefined) return;
    s.envMapIntensity = s.userData.envBase * this.envScale;
  }

  private tiled(name: Parameters<CockpitMaterials['texture']>[0], repeat: number): THREE.Texture {
    // Clones share the image data (one GPU upload per source) but carry their own repeat.
    const key = `${name}@${repeat}`;
    let t = this.textures.get(key);
    if (!t) {
      t = this.texture(name).clone();
      t.repeat.set(repeat, repeat);
      t.needsUpdate = true;
      this.textures.set(key, t);
    }
    return t;
  }

  private make(name: MaterialName): AnyMat {
    const p = this.palette;
    switch (name) {
      case 'panel': {
        // Panel UVs are in metres (ExtrudeGeometry world UVs): repeat = cycles per metre.
        const finish = p.panelFinish;
        return std({
          color: p.panel,
          roughness: p.panelRoughness,
          metalness: 0,
          normalMap: finish === 'smooth' ? null : this.tiled(finish === 'crackle' ? 'crackle' : 'paint', finish === 'crackle' ? 6 : 10),
          normalScale: finish === 'crackle' ? 0.6 : 0.25,
        });
      }
      case 'panelDark':
        return std({ color: p.panelDark, roughness: 0.75, metalness: 0 });
      case 'panelEdge':
        return std({ color: new THREE.Color(p.panel).multiplyScalar(0.85), roughness: p.panelRoughness, metalness: 0 });
      case 'glareshield':
        // ~2.5 mm wrinkle cells (22 cells per tile, 16 tiles per metre).
        return std({ color: p.glareshield, roughness: 0.88, metalness: 0, normalMap: this.tiled('crackle', 16), normalScale: 0.7 });
      case 'bezel':
        return std({ color: p.bezel, roughness: 0.5, metalness: 0.05, normalMap: this.tiled('paint', 20), normalScale: 0.15 });
      case 'bezelGloss':
        return std({ color: p.bezel, roughness: 0.25, metalness: 0.05 });
      case 'knob':
        // Anodized aluminium or moulded plastic knobs: dark, semi-matte.
        return std({ color: p.knob, roughness: p.knobRoughness, metalness: 0.15 });
      case 'knobKnurled':
        return std({ color: p.knob, roughness: p.knobRoughness, metalness: 0.2, normalMap: this.texture('knurl'), normalScale: 1 });
      case 'knobGrey':
        return std({ color: '#6a6d70', roughness: 0.45, metalness: 0.3 });
      case 'knobWhite':
        return std({ color: '#e9e9e4', roughness: 0.4, metalness: 0 });
      case 'knobRed':
        return std({ color: '#b3160f', roughness: 0.4, metalness: 0 });
      case 'knobMetal':
        return std({ color: '#b9bcbf', roughness: 0.32, metalness: 1, roughnessMap: this.tiled('brushed', 1) });
      case 'chrome':
        return std({ color: '#e8e9ea', roughness: 0.12, metalness: 1 });
      case 'aluminium':
        return std({ color: '#c4c7ca', roughness: 0.38, metalness: 1, roughnessMap: this.tiled('brushed', 1) });
      case 'steel':
        return std({ color: '#8d9194', roughness: 0.35, metalness: 1 });
      case 'brass':
        return std({ color: '#c9a45a', roughness: 0.3, metalness: 1 });
      case 'handle':
        return p.handle === 'chrome' ? std({ color: '#dfe1e3', roughness: 0.16, metalness: 1 }) : std({ color: '#141414', roughness: 0.35, metalness: 0.1 });
      case 'handleBlack':
        return std({ color: '#141414', roughness: 0.35, metalness: 0.1 });
      case 'screw':
        return std({ color: '#5d6063', roughness: 0.4, metalness: 0.9 });
      case 'screwPhillips':
      case 'screwSlot':
      case 'screwHex': {
        const kind = name === 'screwPhillips' ? 'phillips' : name === 'screwSlot' ? 'slot' : 'hex';
        const key = `screwtex.${kind}`;
        let tex = this.textures.get(key);
        let nrm = this.textures.get(`${key}.n`);
        if (!tex || !nrm) {
          const t = screwHeadTexture(kind);
          tex = t.map;
          nrm = t.normal;
          this.textures.set(key, tex);
          this.textures.set(`${key}.n`, nrm);
        }
        return std({ color: '#9a9ea2', map: tex, normalMap: nrm, roughness: 0.4, metalness: 0.9 });
      }
      case 'rubber':
        return std({ color: '#161616', roughness: 0.92, metalness: 0 });
      case 'plasticBlack':
        return std({ color: '#121213', roughness: 0.4, metalness: 0 });
      case 'plasticGrey':
        return std({ color: '#4b4e52', roughness: 0.5, metalness: 0 });
      case 'guardRed':
        return std({ color: '#c3140c', roughness: 0.3, metalness: 0 });
      case 'guardBlack':
        return std({ color: '#141414', roughness: 0.35, metalness: 0 });
      case 'guardYellow':
        return std({ color: '#e0b400', roughness: 0.35, metalness: 0 });
      case 'guardClear': {
        const m = new THREE.MeshPhysicalMaterial({
          color: '#dde6ee',
          roughness: 0.1,
          metalness: 0,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        return m;
      }
      case 'wire':
        return std({ color: '#1a1a1a', roughness: 0.4, metalness: 0.6 });
      case 'leather':
        return std({ color: p.seat, roughness: 0.62, metalness: 0, normalMap: this.tiled('leather', 6), normalScale: 0.6 });
      case 'fabric':
        return std({ color: p.seat, roughness: 0.95, metalness: 0, normalMap: this.tiled('fabric', 8), normalScale: 0.8 });
      case 'carpet':
        return std({ color: p.carpet, roughness: 1, metalness: 0, normalMap: this.tiled('carpet', 4), normalScale: 1 });
      case 'interior':
        return std({ color: p.interior, roughness: 0.75, metalness: 0, normalMap: this.tiled('paint', 6), normalScale: 0.3 });
      case 'headliner':
        return std({ color: p.headliner, roughness: 0.9, metalness: 0, normalMap: this.tiled('fabric', 10), normalScale: 0.3 });
      case 'frame':
        return std({ color: p.glareshield, roughness: 0.7, metalness: 0 });
      case 'yoke':
        return std({ color: p.yoke, roughness: 0.4, metalness: 0.05 });
      case 'yokeGrip':
        return std({ color: new THREE.Color(p.yoke).multiplyScalar(0.8), roughness: 0.75, metalness: 0, normalMap: this.tiled('leather', 30), normalScale: 0.5 });
      case 'paintWhite':
        return std({ color: '#ecece6', roughness: 0.5, metalness: 0 });
      case 'paintRed':
        return std({ color: '#c01a12', roughness: 0.5, metalness: 0 });
      case 'paintYellow':
        return std({ color: '#e8c000', roughness: 0.5, metalness: 0 });
      case 'paintBlack':
        return std({ color: '#111111', roughness: 0.6, metalness: 0 });
      case 'windowGlass': {
        const m = new THREE.MeshPhysicalMaterial({
          color: '#bfd4d8',
          roughness: 0.02,
          metalness: 0,
          transparent: true,
          opacity: 0.05,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        return m;
      }
      case 'lcdOff':
        return std({ color: '#050607', roughness: 0.15, metalness: 0 });
      case 'hitbox': {
        const m = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, visible: false });
        return m;
      }
    }
  }
}

function std(o: Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & { normalScale?: number | THREE.Vector2 }): THREE.MeshStandardMaterial {
  const { normalScale, ...rest } = o;
  const m = new THREE.MeshStandardMaterial(rest);
  if (normalScale !== undefined) {
    if (typeof normalScale === 'number') m.normalScale.set(normalScale, normalScale);
    else m.normalScale.copy(normalScale);
  }
  return m;
}
