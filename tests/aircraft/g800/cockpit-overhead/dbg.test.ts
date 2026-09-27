import { it } from 'vitest';
import { topZ, halfWidth } from '../../../../src/aircraft/g800/cockpit/glazing';
import { SHELL_INSET } from '../../../../src/aircraft/g800/cockpit/layout';
it('dbg', () => {
  for (const x of [12.9, 12.84, 12.7, 12.5, 12.3, 12.12]) console.log(`x=${x} ` + [0, 0.2, 0.34, 0.4].map((y) => `y${y}:${topZ(x, y, SHELL_INSET).toFixed(3)}`).join(' '));
  for (const x of [12.0, 11.76, 11.5]) console.log(`x=${x} hw(-0.35)=${halfWidth(x, -0.35, SHELL_INSET).toFixed(3)} hw(-0.2)=${halfWidth(x, -0.2, SHELL_INSET).toFixed(3)} hw(-0.05)=${halfWidth(x, -0.05, SHELL_INSET).toFixed(3)}`);
});
