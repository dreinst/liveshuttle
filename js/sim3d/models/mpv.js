// MPV keluarga tujuh kursi (seperti Toyota Avanza): kap pendek, kabin panjang, rel atap.
import { vehicle, newBuf, box, pair, prism, carDetails, ROLE } from './parts.js';

export const DIMS = { len: 4.4, wid: 1.74, height: 1.72, wheelbase: 2.75 };
export const PALETTE = ['#e6e3dd', '#9aa3ad', '#4f5966', '#2f3b4c', '#8a3b35', '#b8ad96', '#6d7f8f'];

export function createInstanced(ctx, capacity) {
  const hw = DIMS.wid / 2;
  const b = newBuf();
  prism(b, ROLE.PAINT, '#fff', [[-2.2, 0.24], [2.17, 0.24], [2.2, 0.5], [2.12, 0.78], [1.15, 0.96], [-2.16, 1.0], [-2.2, 0.62]], -hw, hw);
  prism(b, ROLE.FIX, '#27303c', [[-2.12, 0.98], [1.2, 0.94], [0.5, 1.6], [-2.06, 1.64]], 0.06 - hw, hw - 0.06);
  box(b, ROLE.PAINT, '#fff', -2.08, 1.6, 0.08 - hw, 0.52, 1.7, hw - 0.08);
  for (const x of [-0.35, -1.45]) box(b, ROLE.PAINT, '#fff', x, 0.96, 0.04 - hw, x + 0.12, 1.62, hw - 0.04);
  pair(b, ROLE.FIX, '#3a4048', -1.9, 1.7, hw - 0.22, 0.3, 1.75, hw - 0.16);
  carDetails(b, DIMS.len, DIMS.wid, { lampY: 0.62, tailY: 0.8, mirrorX: 0.98, mirrorY: 0.98 });
  const x = DIMS.wheelbase / 2;
  const z = hw - 0.07;
  return vehicle(ctx, capacity, 'mpv', { body: b, wheel: { r: 0.31, w: 0.21, at: [[x, z], [x, -z], [-x, z], [-x, -z]] } });
}
