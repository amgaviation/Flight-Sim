/**
 * Daylight cockpit fill (materials.interior + CockpitLighting.interiorFill): the interior bounce
 * irradiance follows the world's global illuminance, the daylight adaptation of the shade light fades
 * out at dusk (night lighting unchanged), and the shader patch applies both to the indirect light only.
 * Label materials read the atlas as a coverage alpha map (minified legends keep their brightness).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../src/core/SimVars';
import { EventBus } from '../../src/core/EventBus';
import { createCockpitEnv } from '../../src/cockpit/env';

function rig(palette: 'gulfstream' | 'boeing' | 'cessna172' = 'gulfstream') {
  const vars = new SimVars();
  const env = createCockpitEnv({ vars, events: new EventBus() }, { palette });
  return { vars, env, u: env.materials.interior };
}

describe('cockpit interior fill', () => {
  it('bounce follows the global illuminance; adaptation only in daylight', () => {
    const { vars, env, u } = rig();
    // Full daylight: 100,000 lux (ambient 1), world render scale ~4.5 units at 1e5 lux.
    vars.set('env.ambient_light', 1);
    vars.set('world.render_units_per_lux', 4.5e-5);
    env.lighting.update(0.1);
    const f = env.lighting.interiorFill;
    const rho = f.reflectance;
    expect(rho).toBeGreaterThan(0.2);
    expect(rho).toBeLessThan(0.5);
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const expected = (1 - u.diffuse.value) * rho * ((f.admitted * 1e5 * 4.5e-5) / (1 - rho));
    expect(lum(u.bounce.value)).toBeCloseTo(expected, 4);
    // Bounce is ~1-3 % of the global illuminance (integrating-sphere estimate).
    expect(lum(u.bounce.value) / 4.5).toBeGreaterThan(0.01);
    expect(lum(u.bounce.value) / 4.5).toBeLessThan(0.04);
    expect(u.adapt.value).toBeCloseTo(f.adaptation, 6);
    // Cream Gulfstream interior tints the bounce warm.
    expect(u.bounce.value.r).toBeGreaterThan(u.bounce.value.b);
    // Dusk (~50 lux) and night: no adaptation, negligible bounce.
    vars.set('env.ambient_light', 0.45);
    vars.set('world.render_units_per_lux', 2e-3);
    env.lighting.update(0.1);
    expect(u.adapt.value).toBe(1);
    expect(u.adaptSpecular.value).toBe(1);
    expect(lum(u.bounce.value)).toBeLessThan(0.002);
    // Without a world (no render scale) there is no bounce.
    const r2 = rig();
    r2.vars.set('env.ambient_light', 1);
    r2.env.lighting.update(0.1);
    expect(lum(r2.u.bounce.value)).toBe(0);
  });

  it('palette reflectance: light interiors bounce more than dark ones', () => {
    const g = rig('gulfstream').env.lighting.interiorFill.reflectance;
    const c = rig('cessna172').env.lighting.interiorFill.reflectance;
    expect(g).toBeGreaterThan(c);
  });

  it('the interior patch scales only the indirect terms and adds the bounce', () => {
    const { env } = rig();
    const m = env.materials.get('panel') as THREE.MeshStandardMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {\n#include <lights_fragment_end>\n#include <aomap_fragment>\n}',
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('cockpitBounce * BRDF_Lambert( material.diffuseColor )');
    expect(shader.fragmentShader).toContain('* cockpitAdapt');
    expect(shader.fragmentShader).not.toContain('directDiffuse *='); // direct light untouched
    expect(shader.uniforms.cockpitBounce).toBe(env.materials.interior.bounce);
    expect(shader.uniforms.cockpitAdapt).toBe(env.materials.interior.adapt);
  });

  it('labels use the atlas as a coverage alpha map', () => {
    const { env } = rig();
    const l = env.labels.text('FUEL', { height: 0.003 });
    const mat = l.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeNull();
    expect(mat.emissiveMap).toBeNull();
    expect(mat.transparent).toBe(true);
  });
});
