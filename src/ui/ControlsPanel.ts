/**
 * Controls settings: game controllers (live axis/button preview, axis target,
 * invert, deadzone, curve, sensitivity, three-point calibration, button ->
 * action binding; saved per device id) and keyboard bindings (rebind by
 * pressing a key; reset to defaults).
 */
import { h, clear, button, select, slider } from './dom';
import type { InputManager, DeviceStatus } from '../input/InputManager';
import { ACTIONS, chordLabel, type ActionId, type KeyBinding } from '../input/actions';
import { AXIS_TARGETS, isUnipolar, type AxisBinding, type AxisTarget } from '../input/devices';
import { CalibrationRecorder, DEFAULT_CALIBRATION, DEFAULT_SHAPE, processBipolar, processUnipolar } from '../input/axisMath';

const ACTION_OPTIONS: { value: string; label: string }[] = [{ value: '', label: '(none)' }, ...ACTIONS.map((a) => ({ value: a.id, label: `${a.group}: ${a.label}` }))];

export class ControlsPanel {
  readonly el: HTMLElement;
  private readonly input: InputManager;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly live: { dev: string; axis: number; raw: HTMLDivElement; out: HTMLDivElement; txt: HTMLElement }[] = [];
  private readonly liveButtons: { dev: string; index: number; el: HTMLElement }[] = [];
  private calibrating: { dev: string; axis: number; rec: CalibrationRecorder; until: number; note: HTMLElement } | null = null;
  private deviceKey = '';
  private readonly devBox = h('div');
  private readonly keyBox = h('div');

  constructor(input: InputManager) {
    this.input = input;
    this.el = h('div', { class: 'amg-controls' }, [
      h('div', { class: 'amg-section', style: 'margin-top:0' }, 'Game controllers'),
      h('div', { class: 'amg-hint', style: 'display:block;margin-bottom:8px' }, 'Press any button on a joystick, yoke, throttle quadrant or pedals so the browser reports it. Settings are saved per device.'),
      this.devBox,
      h('div', { class: 'amg-section' }, 'Keyboard'),
      this.keyBox,
    ]);
    this.renderDevices();
    this.renderKeys();
    this.timer = setInterval(() => this.tick(), 90);
  }

  private tick(): void {
    const devs = this.input.devices();
    const key = devs.map((d) => `${d.id}:${d.axes.length}:${d.buttons.length}`).join('|');
    if (key !== this.deviceKey) {
      this.renderDevices(devs);
      return;
    }
    for (const r of this.live) {
      const d = devs.find((x) => x.id === r.dev);
      if (!d) continue;
      const raw = d.axes[r.axis] ?? 0;
      const b = d.profile.axes[r.axis];
      r.raw.style.left = `${((raw + 1) / 2) * 100 - 1}%`;
      let out = 0;
      if (b && b.target !== 'none' && b.target !== 'hat_look') out = isUnipolar(b.target) ? processUnipolar(raw, b.cal, b.shape) : processBipolar(raw, b.cal, b.shape);
      const uni = b ? isUnipolar(b.target) : false;
      r.out.style.left = uni ? '0%' : `${out >= 0 ? 50 : 50 + out * 50}%`;
      r.out.style.width = uni ? `${out * 100}%` : `${Math.abs(out) * 50}%`;
      r.txt.textContent = `${raw.toFixed(3)} -> ${out.toFixed(2)}`;
      if (this.calibrating && this.calibrating.dev === r.dev && this.calibrating.axis === r.axis) this.calibrating.rec.add(raw);
    }
    for (const b of this.liveButtons) {
      const d = devs.find((x) => x.id === b.dev);
      b.el.classList.toggle('active', !!d && (d.buttons[b.index] ?? 0) > 0.5);
    }
    const c = this.calibrating;
    if (c) {
      const left = Math.max(0, (c.until - performance.now()) / 1000);
      c.note.textContent = left > 0 ? `Move the axis through its full range, then let it rest at centre... ${left.toFixed(1)} s` : '';
      if (left <= 0) this.finishCalibration(devs);
    }
  }

  private finishCalibration(devs: DeviceStatus[]): void {
    const c = this.calibrating!;
    this.calibrating = null;
    const d = devs.find((x) => x.id === c.dev);
    if (!d) return;
    const cal = c.rec.result(d.axes[c.axis]);
    const p = d.profile;
    const b = p.axes[c.axis] ?? { target: 'none', cal: { ...DEFAULT_CALIBRATION }, shape: { ...DEFAULT_SHAPE } };
    if (cal) {
      b.cal = cal;
      p.axes[c.axis] = b;
      this.input.saveProfile(p);
      c.note.textContent = `Calibrated: min ${cal.min.toFixed(3)}, centre ${cal.center.toFixed(3)}, max ${cal.max.toFixed(3)}`;
    } else c.note.textContent = 'Calibration failed: the axis did not move enough.';
  }

  private renderDevices(devs: DeviceStatus[] = this.input.devices()): void {
    clear(this.devBox);
    this.live.length = 0;
    this.liveButtons.length = 0;
    this.deviceKey = devs.map((d) => `${d.id}:${d.axes.length}:${d.buttons.length}`).join('|');
    if (devs.length === 0) {
      this.devBox.appendChild(h('div', { class: 'amg-hint', style: 'display:block' }, 'No controllers detected.'));
      return;
    }
    for (const d of devs) this.devBox.appendChild(this.renderDevice(d));
  }

  private renderDevice(d: DeviceStatus): HTMLElement {
    const p = d.profile;
    const save = () => this.input.saveProfile(p);
    const box = h('div', { class: 'amg-card', style: 'cursor:default' }, [
      h('div', { class: 'amg-row', style: 'margin:0' }, [
        h('span', { class: 'amg-title' }, d.id),
        h('span', { class: 'amg-badge' }, d.mapping || 'raw'),
        h('span', { style: 'flex:1' }),
        button('Reset device', () => {
          this.input.resetProfile(d);
          this.renderDevices();
        }, 'small danger'),
      ]),
    ]);
    const table = h('table', { class: 'amg-table' });
    table.appendChild(h('tr', {}, ['Axis', 'Live (raw / output)', 'Function', 'Invert', 'Deadzone', 'Curve', 'Sensitivity', ''].map((t) => h('th', {}, t))));
    for (let i = 0; i < d.axes.length; i++) {
      const b: AxisBinding = p.axes[i] ?? { target: 'none', cal: { ...DEFAULT_CALIBRATION }, shape: { ...DEFAULT_SHAPE } };
      const ensure = () => {
        p.axes[i] = b;
      };
      const raw = h('div', { style: 'width:2%;background:#fff' });
      const out = h('div');
      const txt = h('span', { class: 'amg-mono' }, '');
      this.live.push({ dev: d.id, axis: i, raw, out, txt });
      const note = h('span', { class: 'amg-hint' });
      table.appendChild(
        h('tr', {}, [
          h('td', {}, String(i)),
          h('td', {}, [h('div', { class: 'amg-bar' }, [out, raw]), txt]),
          h('td', {}, select(AXIS_TARGETS.map((t) => ({ value: t.id, label: t.label })), b.target, (v) => ((b.target = v as AxisTarget), ensure(), save()))),
          h('td', {}, h('input', { type: 'checkbox', checked: b.shape.invert, onchange: (e: Event) => ((b.shape.invert = (e.target as HTMLInputElement).checked), ensure(), save()) })),
          h('td', {}, slider(b.shape.deadzone, { min: 0, max: 0.3, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ((b.shape.deadzone = v), ensure(), save()) })),
          h('td', {}, slider(b.shape.curve, { min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2), onInput: (v) => ((b.shape.curve = v), ensure(), save()) })),
          h('td', {}, slider(b.shape.sensitivity, { min: 0.2, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ((b.shape.sensitivity = v), ensure(), save()) })),
          h('td', {}, [
            button('Calibrate', () => {
              ensure();
              this.calibrating = { dev: d.id, axis: i, rec: new CalibrationRecorder(), until: performance.now() + 5000, note };
            }, 'small'),
            note,
          ]),
        ]),
      );
    }
    box.appendChild(table);
    if (d.buttons.length) {
      box.appendChild(h('div', { class: 'amg-section' }, 'Buttons'));
      const grid = h('div', { class: 'amg-grid2' });
      for (let i = 0; i < d.buttons.length; i++) {
        const lamp = h('span', { class: 'amg-btn small', style: 'min-width:34px;text-align:center' }, String(i));
        this.liveButtons.push({ dev: d.id, index: i, el: lamp });
        grid.appendChild(
          h('div', { class: 'amg-row', style: 'margin:0' }, [
            lamp,
            select(ACTION_OPTIONS, (p.buttons[i] ?? '') as string, (v) => {
              if (v) p.buttons[i] = v as ActionId;
              else delete p.buttons[i];
              save();
            }),
          ]),
        );
      }
      box.appendChild(grid);
    }
    return box;
  }

  private renderKeys(): void {
    clear(this.keyBox);
    this.keyBox.appendChild(
      h('div', { class: 'amg-row' }, [
        button('Reset keyboard to defaults', () => {
          this.input.resetKeyBindings();
          this.renderKeys();
        }, 'small danger'),
        h('span', { class: 'amg-hint' }, 'Click "Add" or a key to change it, then press the new key (Esc cancels).'),
      ]),
    );
    const table = h('table', { class: 'amg-table' });
    table.appendChild(h('tr', {}, [h('th', {}, 'Action'), h('th', {}, 'Keys'), h('th', {}, '')]));
    for (const row of this.input.actionTable()) {
      const keys = h('td', {});
      for (const k of row.keys) {
        keys.appendChild(
          h('kbd', { title: 'Click to remove', style: 'cursor:pointer', onclick: () => this.removeKey(row.id, k) }, chordLabel(k)),
        );
      }
      table.appendChild(
        h('tr', {}, [
          h('td', {}, row.label),
          keys,
          h('td', {}, button('Add', () => this.captureKey(row.id, keys), 'small')),
        ]),
      );
    }
    this.keyBox.appendChild(table);
  }

  private removeKey(action: ActionId, k: { code: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): void {
    const list = this.input.keyBindings.filter((b) => !(b.action === action && b.code === k.code && !!b.ctrl === !!k.ctrl && !!b.shift === !!k.shift && !!b.alt === !!k.alt));
    this.input.setKeyBindings(list);
    this.renderKeys();
  }

  private captureKey(action: ActionId, cell: HTMLElement): void {
    cell.appendChild(h('span', { class: 'amg-warn' }, ' press a key...'));
    this.input.captureNextKey((c) => {
      // A chord maps to one action: remove it elsewhere first.
      const list: KeyBinding[] = this.input.keyBindings.filter((b) => !(b.code === c.code && !!b.ctrl === !!c.ctrl && !!b.shift === !!c.shift && !!b.alt === !!c.alt));
      list.push({ action, code: c.code, ctrl: c.ctrl || undefined, shift: c.shift || undefined, alt: c.alt || undefined });
      this.input.setKeyBindings(list);
      this.renderKeys();
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.input.captureNextKey(null);
  }
}
