import { describe, expect, it } from 'vitest';
import { SimVars } from '../../src/core/SimVars';
import { DISPLAY_VARS } from '../../src/cockpit/types';
import { CanvasDisplay, CallbackDisplay } from '../../src/avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../src/avionics/common/draw/context';
import { CasModel } from '../../src/avionics/common/draw/CasWindow';
import { MenuList, ModeAnnunciator, TEXT_UI_GARMIN, FMA_GARMIN } from '../../src/avionics/common/draw/MenuList';
import { SoftKeyBar, SOFTKEYS_GARMIN } from '../../src/avionics/common/draw/SoftKeyBar';
import { ChecklistView, CHECKLIST_GARMIN } from '../../src/avionics/common/draw/Checklist';
import { terrainBand } from '../../src/avionics/common/draw/TerrainRaster';
import { MovingMap, MAP_GARMIN } from '../../src/avionics/common/draw/MovingMap';
import { SpeedTape, SPEED_TAPE_GARMIN } from '../../src/avionics/common/draw/SpeedTape';
import { StrokeFont } from '../../src/avionics/common/StrokeFont';

/** Minimal recording 2D context: every method is a no-op that counts calls. */
function fakeContext(): { ctx: Ctx2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
      return (..._args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
      };
    },
    set(t, key: string, v) {
      t[key] = v;
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, calls };
}

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: Map<string, number> } {
  const { ctx, calls } = fakeContext();
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('CanvasDisplay', () => {
  it('uses logical coordinates independent of the pixel ratio', () => {
    const { canvas } = fakeCanvas();
    const d = new CallbackDisplay({ id: 'pfd1', width: 1024, height: 768, pixelRatio: 1.5, canvas }, () => undefined);
    expect(d.width).toBe(1536);
    expect(d.height).toBe(1152);
    expect(d.logicalWidth).toBe(1024);
    expect(d.refreshHz).toBe(30);
  });

  it('only redraws when invalidated, animating, brightness changes or a watched var moves', () => {
    const vars = new SimVars();
    const { canvas } = fakeCanvas();
    let draws = 0;
    const d = new CallbackDisplay({ id: 'mfd', width: 100, height: 100, vars, canvas }, () => draws++);
    d.watchVar('adc1.ias_kt', 1);
    expect(d.render(0.03)).toBe(true); // first frame
    expect(d.render(0.03)).toBe(false);
    vars.set('adc1.ias_kt', 100.2);
    expect(d.render(0.03)).toBe(true);
    vars.set('adc1.ias_kt', 100.4); // within the 1 kt quantum
    expect(d.render(0.03)).toBe(false);
    vars.set('adc1.ias_kt', 101.6);
    expect(d.render(0.03)).toBe(true);
    d.invalidate();
    expect(d.render(0.03)).toBe(true);
    vars.set(DISPLAY_VARS.brightness('mfd'), 0.5);
    expect(d.render(0.03)).toBe(true);
    expect(d.brightness).toBe(0.5);
    d.setBrightness(0.2);
    expect(d.brightness).toBe(0.2);
    d.setAnimating(true);
    expect(d.render(0.03)).toBe(true);
    expect(d.render(0.03)).toBe(true);
    expect(draws).toBe(7);
  });

  it('goes black once when unpowered and boots on power-up', () => {
    const vars = new SimVars();
    const { canvas } = fakeCanvas();
    let draws = 0;
    let boots = 0;
    class Boot extends CanvasDisplay {
      protected draw(): void {
        draws++;
      }
      protected override drawBoot(): void {
        boots++;
      }
    }
    const d = new Boot({ id: 'eicas', width: 100, height: 100, vars, canvas, bootTimeS: 1 });
    vars.set(DISPLAY_VARS.power('eicas'), 0);
    expect(d.render(0.03)).toBe(true); // black frame
    expect(d.render(0.03)).toBe(false);
    expect(d.powered).toBe(false);
    vars.set(DISPLAY_VARS.power('eicas'), 1);
    for (let i = 0; i < 10; i++) expect(d.render(0.1)).toBe(true);
    expect(boots).toBe(10);
    expect(d.render(0.1)).toBe(true);
    expect(draws).toBe(1);
    d.setPowered(false);
    expect(d.render(0.1)).toBe(true);
    expect(d.render(0.1)).toBe(false);
  });

  it('converts pointer events to logical pixels', () => {
    const { canvas } = fakeCanvas();
    let got: [number, number] = [0, 0];
    class Touch extends CanvasDisplay {
      protected draw(): void {}
      protected override onPointerLogical(x: number, y: number): void {
        got = [x, y];
      }
    }
    const d = new Touch({ id: 'gtc', width: 400, height: 300, pixelRatio: 2, canvas });
    d.onPointer(200, 100, 'down');
    expect(got).toEqual([100, 50]);
  });
});

describe('CasModel', () => {
  it('orders warnings, cautions, advisories, status; newest first; tracks acknowledgement', () => {
    const cas = new CasModel();
    cas.set('a', 'FUEL LOW', 'caution', true);
    cas.set('b', 'ENG FIRE', 'warning', true);
    cas.set('c', 'IGN ON', 'advisory', true);
    cas.set('d', 'OIL PRESS', 'warning', true);
    cas.set('e', 'GEN OFF', 'caution', true);
    expect(cas.list.map((m) => m.text)).toEqual(['OIL PRESS', 'ENG FIRE', 'GEN OFF', 'FUEL LOW', 'IGN ON']);
    expect(cas.unackedWarnings).toBe(2);
    expect(cas.unackedCautions).toBe(2);
    cas.acknowledge('warning');
    expect(cas.unackedWarnings).toBe(0);
    expect(cas.unackedCautions).toBe(2);
    cas.setActive('b', false);
    expect(cas.list.length).toBe(4);
    // Re-activation is a new message.
    cas.setActive('b', true);
    expect(cas.unackedWarnings).toBe(1);
    expect(cas.highestLevel).toBe('warning');
    cas.acknowledgeAll();
    expect(cas.unackedWarnings + cas.unackedCautions).toBe(0);
  });

  it('advisories do not need acknowledgement by default', () => {
    const cas = new CasModel();
    cas.set('x', 'ANTI ICE ON', 'advisory', true);
    expect(cas.list[0].acknowledged).toBe(true);
  });
});

describe('text UI helpers', () => {
  it('MenuList skips disabled items and scrolls with the cursor', () => {
    const m = new MenuList({ x: 0, y: 0, w: 200, h: 100, style: TEXT_UI_GARMIN });
    m.setItems(['A', { label: 'B', enabled: false }, 'C', 'D', 'E', 'F', 'G']);
    expect(m.cursor).toBe(0);
    m.move(1);
    expect(m.cursor).toBe(2);
    m.move(10);
    expect(m.cursor).toBe(6);
    expect(m.scroll).toBeGreaterThan(0);
    expect(m.select()).toBe(6);
    m.move(-5);
    expect(m.cursor).toBe(0);
    expect(m.scroll).toBe(0);
  });

  it('SoftKeyBar returns labels of live keys only', () => {
    const sk = new SoftKeyBar({ x: 0, y: 740, w: 1200, h: 28, count: 12, style: SOFTKEYS_GARMIN });
    sk.setLabels(['', 'INSET', 'PFD']);
    sk.setKey(3, 'OBS', 'disabled');
    expect(sk.press(0)).toBe('');
    expect(sk.press(1)).toBe('INSET');
    expect(sk.animating).toBe(true);
    expect(sk.press(3)).toBe('');
    expect(sk.keyAt(150, 750)).toBe(1);
    sk.update(1);
    expect(sk.animating).toBe(false);
  });

  it('ModeAnnunciator highlights mode changes for the configured time', () => {
    const f = new ModeAnnunciator({ x: 0, y: 0, w: 400, h: 40, columns: 2, style: FMA_GARMIN });
    f.set(0, 'HDG');
    f.update(0.1);
    expect(f.animating).toBe(true);
    for (let i = 0; i < 110; i++) f.update(0.1);
    expect(f.animating).toBe(false);
    f.set(0, 'GPS');
    f.update(0.1);
    expect(f.animating).toBe(true);
  });

  it('ChecklistView ticks items, advances and auto-checks', () => {
    const vars = new SimVars();
    const v = new ChecklistView({ x: 0, y: 0, w: 300, h: 300, style: CHECKLIST_GARMIN });
    v.setChecklist({
      title: 'Before Start',
      phase: 'ground',
      items: [
        { challenge: 'Brakes', response: 'SET' },
        { challenge: 'Beacon', response: 'ON', check: (s) => s.get('ac.lights.beacon') > 0 },
        { challenge: 'Fuel', response: 'BOTH' },
      ],
    });
    v.toggle();
    expect(v.checked).toEqual([true, false, false]);
    expect(v.cursor).toBe(1);
    vars.set('ac.lights.beacon', 1);
    v.autoCheck(vars);
    expect(v.checked[1]).toBe(true);
    v.move(1);
    v.toggle();
    expect(v.complete).toBe(true);
  });
});

describe('map and terrain', () => {
  it('Garmin relative terrain and EGPWS bands', () => {
    expect(terrainBand('relative', 50).band).toBe(2);
    expect(terrainBand('relative', -150).band).toBe(1);
    expect(terrainBand('relative', -1200).band).toBe(0);
    expect(terrainBand('egpws', 2500)).toEqual({ band: 2, density: 0.5 });
    expect(terrainBand('egpws', 1500)).toEqual({ band: 1, density: 0.5 });
    expect(terrainBand('egpws', -400)).toEqual({ band: 1, density: 0.25 });
    expect(terrainBand('egpws', -400, true)).toEqual({ band: 3, density: 0.5 });
    expect(terrainBand('egpws', -1500)).toEqual({ band: 3, density: 0.25 });
    expect(terrainBand('egpws', -2500).band).toBe(0);
  });

  it('MovingMap ranges, orientation and projection', () => {
    const map = new MovingMap({ rect: { x: 0, y: 0, w: 800, h: 600 }, style: MAP_GARMIN, ownX: 400, ownY: 400, rangePx: 300 });
    map.setRange(12);
    expect(map.state.rangeNm).toBe(10);
    expect(map.rangeUp()).toBe(15);
    expect(map.rangeDown()).toBe(10);
    expect(map.pxPerNmNow()).toBe(30);
    Object.assign(map.state, { lat: 47, lon: -122, heading: 80, track: 90, gsKt: 120, orientation: 'track-up' });
    expect(map.upBearing()).toBe(90);
    map.update(0.03);
    // A point 10 nm east is straight ahead (screen up) at 300 px.
    const p = map.project(47, -122 + 10 / (60 * Math.cos((47 * Math.PI) / 180)), { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(400, 3);
    expect(p.y).toBeCloseTo(100, 3);
    const ll = map.unproject(p.x, p.y, { lat: 0, lon: 0 });
    expect(ll.lat).toBeCloseTo(47, 6);
    map.pan(0, -60);
    expect(map.state.panActive).toBe(true);
    expect(map.upBearing()).toBe(0);
    expect(map.state.panLat).toBeCloseTo(47 + 2 / 60, 6);
    map.clearPan();
    expect(map.state.panActive).toBe(false);
  });
});

describe('speed tape logic', () => {
  it('computes trend, overspeed and low-speed flags', () => {
    const t = new SpeedTape({ x: 0, y: 0, w: 100, h: 400, style: SPEED_TAPE_GARMIN });
    Object.assign(t.state, { ias: 250, maxKt: 245, accelKtS: 1.5 });
    t.update(0.1);
    expect(t.state.overspeed).toBe(true);
    expect(t.state.trendKt).toBeCloseTo(9, 9); // 6 s Garmin trend
    Object.assign(t.state, { ias: 90, lowSpeedAwarenessKt: 95, maxKt: NaN });
    t.update(0.1);
    expect(t.state.lowSpeed).toBe(true);
    Object.assign(t.state, { mach: 0.41 });
    t.update(0.1);
    expect(t.machVisible).toBe(true);
  });
});

describe('stroke font', () => {
  it('has the avionics character set and fixed advance', () => {
    const f = new StrokeFont();
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ./-+:°()<>[]%*#=!?') expect(f.has(ch)).toBe(true);
    expect(f.has('a')).toBe(true); // lower case maps to upper case
    expect(f.width('0000', 20)).toBeCloseTo(2 * f.width('00', 20) + 1.4 * (20 * 0.72) / 6, 9);
    const { ctx, calls } = fakeContext();
    f.draw(ctx, 'N1 92.4', 0, 0, 20, '#fff');
    expect(calls.get('stroke')).toBe(1); // one stroke per string
  });
});
