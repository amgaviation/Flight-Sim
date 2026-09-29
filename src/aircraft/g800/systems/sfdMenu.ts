/**
 * SFD bezel MENU buttons (G600 BL7C0704 crop g600_gp_l: a round MENU button beside each standby flight display).
 * The ESIS touch SFD model (src/avionics/honeywell-epic/displays/standby.ts) has one menu: the barometric-setting keys
 * (- / + / STD / IN-HPA / CLOSE). MENU opens / closes it, exactly as a touch on the display's baro field does.
 * SCOPE: brightness and other SFD menu items are not modelled.
 */
import type { EventBus } from '../../../core/EventBus';
import type { Subsystem } from '../../types';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import { G800_VARS as V } from '../vars';

export class G800SfdMenu implements Subsystem {
  readonly name = 'g800.sfd_menu';
  private readonly offs: (() => void)[] = [];

  constructor(events: EventBus, suite: EpicSuite) {
    for (const side of [1, 2] as const) {
      this.offs.push(
        events.on(V.sfdMenuEvent(side), (x) => {
          if (x === 0) return; // release
          const d = suite.standby[side - 1];
          // Tap on the baro field (top right of the 480 x 420 logical canvas): toggles the baro keys.
          if (d) d.onPointer(400 * d.pixelRatio, 20 * d.pixelRatio, 'up');
        }),
      );
    }
  }

  update(): void {
    // Event driven.
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
