import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { DISPLAY_VARS } from '../../../src/cockpit/types';
import { WindowManager, DEFAULT_DU_LAYOUT, sideDus } from '../../../src/avionics/honeywell-epic/logic/windows';
import { DuFormat, EPIC_VARS, Win } from '../../../src/avionics/honeywell-epic/vars';

const IDS = ['epic.du1', 'epic.du2', 'epic.du3', 'epic.du4'];

function setup() {
  const vars = new SimVars();
  const wm = new WindowManager(vars, { duIds: IDS });
  return { vars, wm };
}

describe('WindowManager', () => {
  it('starts with the G650 power-up layout and publishes what is shown', () => {
    const { vars, wm } = setup();
    for (let n = 1; n <= 4; n++) {
      const d = DEFAULT_DU_LAYOUT[n - 1];
      expect(vars.get(EPIC_VARS.duShownMain(n))).toBe(d.main);
      expect(vars.get(EPIC_VARS.duShownUpper(n))).toBe(d.upper);
      expect(vars.get(EPIC_VARS.duShownLower(n))).toBe(d.lower);
      expect(vars.get(EPIC_VARS.duOperating(n))).toBe(1);
    }
    expect(wm.pfdShown).toEqual([true, true]);
    // Secondary engine on DU2 -> the primary engine window is not compacted.
    expect(wm.engineCompact).toBe(false);
  });

  it('allows full PFD only on DU1/DU4 and full MAP only on DU2/DU3', () => {
    const { wm } = setup();
    expect(wm.select(2, 'full', Win.Pfd)).toBe(false);
    expect(wm.select(1, 'full', Win.Map)).toBe(false);
    expect(wm.select(1, 'full', Win.Pfd)).toBe(true);
    expect(wm.select(3, 'full', Win.Map)).toBe(true);
    expect(wm.select(2, 'main', Win.Pfd)).toBe(false);
    expect(wm.select(2, 'upper', Win.Map)).toBe(false);
    expect(wm.select(2, 'upper', Win.SynFuel)).toBe(true);
    wm.update(0);
    expect(wm.view[0].format).toBe(DuFormat.Full);
    expect(wm.view[2].format).toBe(DuFormat.Full);
  });

  it('full MAP on DU2 forces engine + CAS on DU3 and full MAP on only one centre DU', () => {
    const { vars, wm } = setup();
    wm.select(2, 'full', Win.Map);
    wm.update(0);
    expect(wm.view[2].upper).toBe(Win.Engine);
    expect(wm.view[2].lower).toBe(Win.Cas);
    // Selecting full MAP on DU3 reverts DU2 to split.
    wm.select(3, 'full', Win.Map);
    wm.update(0);
    expect(vars.get(EPIC_VARS.duFormat(2))).toBe(DuFormat.Split);
    expect(wm.view[1].lower).toBe(Win.Cas);
  });

  it('reverts full MAP on a secondary engine exceedance, a checklist call-up or an adjacent DU failure', () => {
    const { vars, wm } = setup();
    wm.select(2, 'full', Win.Map);
    vars.set(EPIC_VARS.engExceed2, 1);
    wm.update(0);
    expect(vars.get(EPIC_VARS.duFormat(2))).toBe(DuFormat.Split);
    vars.set(EPIC_VARS.engExceed2, 0);
    wm.select(2, 'full', Win.Map);
    wm.checklistCalledUp();
    wm.update(0);
    expect(vars.get(EPIC_VARS.duFormat(2))).toBe(DuFormat.Split);
    wm.select(2, 'full', Win.Map);
    vars.set('fail.epic.du3', 1);
    wm.update(0);
    expect(vars.get(EPIC_VARS.duFormat(2))).toBe(DuFormat.Split);
  });

  it('MFD display switching puts the PFD on DU2 / DU3', () => {
    const { vars, wm } = setup();
    vars.set(EPIC_VARS.mfdSwitch(1), 1);
    wm.update(0);
    expect(wm.view[1].main).toBe(Win.Pfd);
    vars.set(EPIC_VARS.mfdSwitch(1), 0);
    wm.update(0);
    expect(wm.view[1].main).toBe(Win.Map);
  });

  it('a DU switched OFF or unpowered shows nothing; the PFD reverts to the standby display', () => {
    const { vars, wm } = setup();
    vars.set(EPIC_VARS.duSwitch(1), 0);
    wm.update(0);
    expect(vars.get(EPIC_VARS.duOperating(1))).toBe(0);
    expect(vars.get(EPIC_VARS.duShownMain(1))).toBe(Win.Blank);
    expect(wm.pfdShown[0]).toBe(false);
    // Pilot selects MFD switching: PFD on DU2 again.
    vars.set(EPIC_VARS.mfdSwitch(1), 1);
    wm.update(0);
    expect(wm.pfdShown[0]).toBe(true);
    vars.set(DISPLAY_VARS.power('epic.du4'), 0);
    wm.update(0);
    expect(vars.get(EPIC_VARS.duOperating(4))).toBe(0);
  });

  it('forces CAS and the primary engine window onto a working DU (EST) and compacts the engine window', () => {
    const { wm } = setup();
    // Remove CAS from DU1 and DU3, engine from DU1 and DU2.
    wm.select(1, 'upper', Win.SynFuel);
    wm.select(1, 'lower', Win.SynEcs);
    wm.select(2, 'upper', Win.SynHydraulics);
    wm.select(2, 'lower', Win.SynDoors);
    wm.select(3, 'upper', Win.WptList);
    wm.update(0);
    expect(wm.isShown(Win.Cas)).toBe(true);
    expect(wm.isShown(Win.Engine)).toBe(true);
    expect(wm.view[2].lower).toBe(Win.Cas); // DU3 first in the CAS order
    expect(wm.view[1].upper).toBe(Win.Engine); // DU2 first in the engine order
    expect(wm.engineCompact).toBe(true);
  });

  it('pilot controls DU 1-3 and copilot DU 2-4', () => {
    expect(sideDus(1)).toEqual([1, 2, 3]);
    expect(sideDus(2)).toEqual([2, 3, 4]);
  });
});
