/**
 * Simple airport buildings: terminal, hangars and control tower, with
 * procedural facade textures and night-lit windows. Materials are shared by
 * every airport (one set per World).
 */
import * as THREE from 'three';

export interface BuildingMaterials {
  terminal: THREE.MeshStandardMaterial;
  hangar: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
  /** 0 = day, 1 = night: scales window emission. */
  setNight(n: number): void;
  dispose(): void;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function tex(canvas: HTMLCanvasElement | OffscreenCanvas, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBuildingMaterials(): BuildingMaterials {
  const rand = rng(42);
  // Terminal facade: glass curtain wall bays (one texture repeat = 12 m x 12 m, 3 floors).
  const fc = makeCanvas(256, 256);
  const fx = fc.getContext('2d') as CanvasRenderingContext2D;
  fx.fillStyle = '#9aa0a6';
  fx.fillRect(0, 0, 256, 256);
  const ec = makeCanvas(256, 256);
  const ex = ec.getContext('2d') as CanvasRenderingContext2D;
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, 256, 256);
  for (let floor = 0; floor < 3; floor++) {
    const y0 = floor * 85 + 18;
    for (let bay = 0; bay < 4; bay++) {
      const x0 = bay * 64 + 4;
      fx.fillStyle = '#26323c';
      fx.fillRect(x0, y0, 56, 56);
      fx.fillStyle = 'rgba(120,150,170,0.35)';
      fx.fillRect(x0, y0, 56, 8);
      const lit = rand() > 0.35;
      ex.fillStyle = lit ? `rgb(${230 + rand() * 25},${200 + rand() * 30},${140 + rand() * 40})` : '#000';
      ex.fillRect(x0 + 2, y0 + 2, 52, 52);
    }
  }
  // Hangar: vertical corrugated cladding.
  const hc = makeCanvas(128, 128);
  const hx = hc.getContext('2d') as CanvasRenderingContext2D;
  for (let i = 0; i < 128; i++) {
    const v = 150 + 25 * Math.sin((i / 128) * Math.PI * 16) + rand() * 6;
    hx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
    hx.fillRect(i, 0, 1, 128);
  }
  const facade = tex(fc, true);
  const emissive = tex(ec, true);
  const cladding = tex(hc, true);
  const terminal = new THREE.MeshStandardMaterial({ map: facade, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35, metalness: 0.2, name: 'amg-terminal' });
  const hangar = new THREE.MeshStandardMaterial({ map: cladding, roughness: 0.55, metalness: 0.4, name: 'amg-hangar' });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.9, metalness: 0, name: 'amg-concrete' });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x9fd6ff, emissiveIntensity: 0, roughness: 0.1, metalness: 0.6, name: 'amg-tower-glass' });
  const roof = new THREE.MeshStandardMaterial({ color: 0x5b5f63, roughness: 0.8, metalness: 0.2, name: 'amg-roof' });
  const textures = [facade, emissive, cladding];
  return {
    terminal,
    hangar,
    concrete,
    glass,
    roof,
    textures,
    setNight(n: number) {
      terminal.emissiveIntensity = 1.4 * n;
      glass.emissiveIntensity = 0.25 * n;
    },
    dispose() {
      for (const m of [terminal, hangar, concrete, glass, roof]) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

/** Box with UVs scaled to metres / repeat so facade textures tile at a fixed size. */
function scaledBox(w: number, h: number, d: number, repeatM: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const nz = Math.abs(nrm.getZ(i));
    const u = nx > 0.5 ? pos.getZ(i) : nz > 0.5 ? pos.getX(i) : pos.getX(i);
    const v = nx > 0.5 || nz > 0.5 ? pos.getY(i) + h / 2 : pos.getZ(i);
    uv.setXY(i, u / repeatM, v / repeatM);
  }
  return g;
}

/** Terminal building (length along local x). Origin at ground centre. */
export function terminalMesh(m: BuildingMaterials, length: number, depth: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(scaledBox(length, height, depth, 12), [m.terminal, m.terminal, m.roof, m.roof, m.terminal, m.terminal]);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  return g;
}

export function hangarMesh(m: BuildingMaterials, width: number, depth: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(scaledBox(width, height, depth, 8), [m.hangar, m.hangar, m.roof, m.roof, m.hangar, m.hangar]);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // Low-pitch roof ridge.
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.01, depth * 0.55, height * 0.18, 4, 1, false, Math.PI / 4), m.roof);
  ridge.scale.set(width / (depth * 0.78), 1, 1);
  ridge.position.y = height + height * 0.09;
  g.add(ridge);
  return g;
}

/** Control tower: concrete shaft, glass cab and roof. */
export function towerMesh(m: BuildingMaterials, height: number): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, height, 16), m.concrete);
  shaft.position.y = height / 2;
  shaft.castShadow = true;
  g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 5, 8), m.glass);
  cab.position.y = height + 2.5;
  cab.castShadow = true;
  g.add(cab);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 1, 8), m.roof);
  roof.position.y = height + 5.5;
  g.add(roof);
  return g;
}
