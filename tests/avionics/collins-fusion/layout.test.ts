import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { LayoutManager, allowedIn, defaultLayout, SLOT_RECTS } from '../../../src/avionics/collins-fusion/logic/layout';
import { FUSION_VARS, Win } from '../../../src/avionics/collins-fusion/vars';

function setup() {
  const vars = new SimVars();
  const op = [true, true, true, true];
  const lay = new LayoutManager(vars, (n) => op[n - 1]);
  return { vars, op, lay };
}

const contents = (lay: LayoutManager, n: number) => lay.shown[n - 1].windows.map((w) => `${w.slot}:${w.win}`).join(' ');

describe('Pro Line Fusion window layout', () => {
  it('default layout: PFDs outboard, EICAS + SYSTEMS upper centre, FMS lower centre (AIN 2012)', () => {
    const { lay, vars } = setup();
    expect(contents(lay, 1)).toBe(`L:${Win.Pfd} R:${Win.Map}`);
    expect(contents(lay, 2)).toBe(`L:${Win.Eicas} R:${Win.Sys}`);
    expect(contents(lay, 3)).toBe(`L:${Win.Fms} R:${Win.Map}`); // FMS beside a map on AFD 3 (photo EB190582 e_ped_mid)
    expect(contents(lay, 4)).toBe(`L:${Win.Map} R:${Win.Pfd}`);
    expect(vars.get(FUSION_VARS.pfdOn(1))).toBe(1);
    expect(vars.get(FUSION_VARS.pfdOn(2))).toBe(4);
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(2);
    // Owners: outboard displays belong to their pilot, centre halves by side.
    const w3 = lay.shown[2].windows;
    expect(w3.find((w) => w.slot === 'L')!.owner).toBe(1);
    expect(w3.find((w) => w.slot === 'R')!.owner).toBe(2);
    expect(defaultLayout()).toHaveLength(4);
  });

  it('placement rules', () => {
    expect(allowedIn(1, 'L', Win.Pfd)).toBe(true);
    expect(allowedIn(1, 'R', Win.Pfd)).toBe(false); // PFD in the outboard half only
    expect(allowedIn(2, 'L', Win.Pfd)).toBe(false);
    expect(allowedIn(2, 'F', Win.Map)).toBe(true);
    expect(allowedIn(1, 'F', Win.Map)).toBe(false); // full MFW formats on the centre AFDs only
    expect(allowedIn(3, 'LU', Win.Fms)).toBe(false); // FMS / SYSTEMS need a half window
    expect(allowedIn(3, 'LU', Win.Vsd)).toBe(true);
    expect(allowedIn(1, 'RU', Win.Chart)).toBe(true);
    expect(allowedIn(2, 'R', Win.Eicas)).toBe(true);
    expect(SLOT_RECTS.RL).toEqual({ x: 512, y: 320, w: 512, h: 320 });
  });

  it('selects contents, splits halves into quarters and goes full screen', () => {
    const { lay, vars } = setup();
    expect(lay.select(3, 'R', Win.Chart)).toBe(true);
    expect(vars.get(FUSION_VARS.afdWin(3, 'R'))).toBe(Win.Chart);
    expect(lay.setHalfSplit(3, 'R', true)).toBe(true);
    expect(lay.select(3, 'RU', Win.Vsd)).toBe(true);
    expect(contents(lay, 3)).toBe(`L:${Win.Fms} RU:${Win.Vsd} RL:${Win.Vsd}`);
    // PFD halves cannot be split, FMS is not allowed in a quarter.
    expect(lay.setHalfSplit(1, 'L', true)).toBe(false);
    expect(lay.select(3, 'RL', Win.Fms)).toBe(false);
    // Full format: the PFD fills an outboard AFD.
    expect(lay.setFull(1, true)).toBe(true);
    expect(contents(lay, 1)).toBe(`F:${Win.Pfd}`);
    expect(lay.setFull(1, false)).toBe(true);
    expect(lay.selected(1, 'L')).toBe(Win.Pfd);
    // The EICAS half keeps the upper centre display split.
    expect(lay.setFull(2, true)).toBe(false);
  });

  it('EICAS is unique: selecting it elsewhere swaps it with the old place', () => {
    const { lay, vars } = setup();
    expect(lay.select(3, 'L', Win.Eicas)).toBe(true);
    expect(lay.selected(3, 'L')).toBe(Win.Eicas);
    expect(lay.selected(2, 'L')).toBe(Win.Fms);
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(3);
    // The EICAS window cannot be replaced directly.
    expect(lay.select(3, 'L', Win.Map)).toBe(false);
  });

  it('nine memory selections per pilot: store / recall', () => {
    const { lay } = setup();
    lay.select(3, 'R', Win.Chkl);
    lay.store(1, 5);
    lay.reset();
    expect(lay.selected(3, 'R')).toBe(Win.Map);
    expect(lay.recall(1, 5)).toBe(true);
    expect(lay.selected(3, 'R')).toBe(Win.Chkl);
    // Memory 2 preset: full PFDs, synoptics on the lower centre display (AIN 2012).
    lay.recall(2, 2);
    expect(contents(lay, 1)).toBe(`F:${Win.Pfd}`);
    expect(lay.selected(3, 'L')).toBe(Win.Sys);
    expect(lay.recall(1, 10)).toBe(false);
  });

  it('reversion: a lost PFD display moves the PFD to the upper centre AFD, EICAS moves down', () => {
    const { lay, op, vars } = setup();
    op[0] = false;
    lay.tick();
    expect(lay.shown[0].operating).toBe(false);
    expect(lay.shown[0].windows).toHaveLength(0);
    const w2 = lay.shown[1].windows.find((w) => w.slot === 'L')!;
    expect(w2.win).toBe(Win.Pfd);
    expect(w2.pfdSide).toBe(1);
    expect(vars.get(FUSION_VARS.pfdOn(1))).toBe(2);
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(3);
    expect(vars.get(FUSION_VARS.afdReversion(2))).toBe(1);
    expect(vars.get(FUSION_VARS.afdOperating(1))).toBe(0);
    // Restored: back to normal.
    op[0] = true;
    lay.tick();
    expect(vars.get(FUSION_VARS.pfdOn(1))).toBe(1);
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(2);
  });

  it('reversion: upper centre lost -> EICAS on the lower centre AFD; both centre AFDs lost -> outboard composite', () => {
    const { lay, op, vars } = setup();
    op[1] = false;
    lay.tick();
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(3);
    op[2] = false;
    lay.tick();
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(1);
    expect(contents(lay, 1)).toBe(`L:${Win.Pfd} R:${Win.Eicas}`);
  });

  it('RSP DSPL REV: PFD + EICAS composite on the on-side outboard AFD', () => {
    const { lay, vars } = setup();
    vars.set(FUSION_VARS.rspDspl(2), 1);
    lay.tick();
    expect(contents(lay, 4)).toBe(`L:${Win.Eicas} R:${Win.Pfd}`);
    expect(vars.get(FUSION_VARS.eicasOn)).toBe(4);
    expect(lay.shown[1].windows.some((w) => w.win === Win.Eicas)).toBe(false);
  });

  it('reads the selection back from the vars (state restore)', () => {
    const { lay, vars } = setup();
    vars.set(FUSION_VARS.afdWin(3, 'R'), Win.Vsd);
    lay.readVars();
    lay.update();
    expect(lay.windowOf(3, 'R')!.win).toBe(Win.Vsd);
    expect(lay.windowAt(3, 700, 100)!.win).toBe(Win.Vsd);
    expect(lay.windowAt(3, 100, 100)!.win).toBe(Win.Fms);
  });
});
