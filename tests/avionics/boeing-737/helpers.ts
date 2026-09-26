/**
 * Test harness for the 737NG FMC / CDU: a real nav database (public/data),
 * the nav Fms in Boeing style, the FMC core and one or two CDUs driven
 * through key presses, plus a minimal aircraft state.
 */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, GPS } from '../../../src/core/vars';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { Fms } from '../../../src/nav/fms/Fms';
import { resolveB737Config, type B737Config } from '../../../src/avionics/boeing-737/config';
import { B737Fmc } from '../../../src/avionics/boeing-737/fmc/Fmc';
import { Cdu } from '../../../src/avionics/boeing-737/fmc/Cdu';

let shared: NavDatabaseImpl | null = null;

export async function navDb(): Promise<NavDatabaseImpl> {
  if (!shared) {
    shared = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await shared.load();
  }
  return shared;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  fms: Fms;
  fmc: B737Fmc;
  cdu: Cdu;
  cdu2: Cdu;
  /** Presses keys by id ('INIT_REF', 'L1', 'EXEC', ...). */
  press: (...keys: string[]) => void;
  /** Types scratchpad text (letters, digits, '/', '.', ' ', '-'). */
  type: (text: string) => void;
  /** Types text then presses a line select key. */
  enter: (text: string, lsk: string) => void;
  step: (seconds?: number) => void;
  screen: () => string[];
  text: () => string;
}

export async function rig(cfg: B737Config = {}, pos = { lat: 40.8501, lon: -74.0608, elev: 9 }): Promise<Rig> {
  const db = await navDb();
  const vars = new SimVars();
  const events = new EventBus();
  const rc = resolveB737Config(cfg);
  const fms = new Fms({ vars, events, nav: db }, { style: 'boeing', engineCount: 2 });
  const fmc = new B737Fmc({ vars, events, cfg: rc, fms });
  const cdu = new Cdu(fmc, 1, events);
  const cdu2 = new Cdu(fmc, 2, events);
  vars.set(GPS.valid, 1);
  vars.set(GPS.lat, pos.lat);
  vars.set(GPS.lon, pos.lon);
  vars.set(GPS.gs, 0);
  vars.set(GPS.magVar, -13);
  vars.set(GPS.utcH, 14.5);
  vars.set('gear.air_ground', 1);
  vars.set(ADC.baroAlt(1), pos.elev);
  vars.set(ADC.sat(1), 15);
  vars.set(ADC.tas(1), 0);
  vars.set('fuel.total_kg', 8000);
  vars.set('fuel.tank0_kg', 3000);
  vars.set('fuel.tank1_kg', 3000);
  vars.set('fuel.tank2_kg', 2000);
  const step = (seconds = 0.2): void => {
    const n = Math.max(1, Math.round(seconds / 0.05));
    for (let i = 0; i < n; i++) {
      fms.update(0.05);
      fmc.update(0.05);
      cdu.update(0.05);
      cdu2.update(0.05);
    }
  };
  const press = (...keys: string[]): void => {
    for (const k of keys) {
      cdu.key(k);
      step(0.05);
    }
  };
  const type = (text: string): void => {
    for (const ch of text.toUpperCase()) {
      if (ch === ' ') cdu.key('SP');
      else if (ch === '-') cdu.key('+/-');
      else cdu.key(ch);
    }
  };
  const enter = (text: string, lsk: string): void => {
    type(text);
    press(lsk);
  };
  const screen = (): string[] => cdu.render().lines();
  step(0.1);
  return { vars, events, fms, fmc, cdu, cdu2, press, type, enter, step, screen, text: () => screen().join('\n') };
}
