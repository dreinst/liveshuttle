// Mobil kota kecil (seperti Daihatsu Ayla atau Toyota Agya): hatchback pendek, kaca gelap, atap sewarna badan.
import { vehicle, newBuf, box, prism, carDetails, ROLE } from './parts.js';

export const DIMS = { len: 3.7, wid: 1.62, height: 1.5, wheelbase: 2.45 };
export const PALETTE = ['#c7ccd4', '#8d96a3', '#e8e4dc', '#5b6675', '#a23b32', '#3d5a80', '#d9c7a7', '#7a8f7a'];

export function createInstanced(ctx, capacity) {
  const hw = DIMS.wid / 2;
  const b = newBuf();
  prism(b, ROLE.PAINT, '#fff', [[-1.85, 0.22], [1.82, 0.22], [1.85, 0.46], [1.78, 0.7], [0.72, 0.86], [-1.76, 0.9], [-1.85, 0.7]], -hw, hw);
  prism(b, ROLE.FIX, '#2b3441', [[-1.74, 0.88], [0.78, 0.84], [0.02, 1.4], [-1.58, 1.42]], 0.06 - hw, hw - 0.06);
  box(b, ROLE.PAINT, '#fff', -1.62, 1.4, 0.08 - hw, 0.06, 1.48, hw - 0.08);
  box(b, ROLE.PAINT, '#fff', -0.62, 0.86, 0.04 - hw, -0.5, 1.41, hw - 0.04);
  carDetails(b, DIMS.len, DIMS.wid, { lampY: 0.54, tailY: 0.68, mirrorX: 0.6, mirrorY: 0.86 });
  const x = DIMS.wheelbase / 2;
  const z = hw - 0.07;
  return vehicle(ctx, capacity, 'car', { body: b, wheel: { r: 0.29, w: 0.2, at: [[x, z], [x, -z], [-x, z], [-x, -z]] } });
}
