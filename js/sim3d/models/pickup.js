// Mobil bak pengantar barang (seperti Suzuki Carry pikap): kabin pendek, bak terbuka berisi kotak barang dan karung.
import { vehicle, newBuf, box, pair, prism, carDetails, ROLE } from './parts.js';

export const DIMS = { len: 4.2, wid: 1.7, height: 1.85, wheelbase: 2.65 };
export const PALETTE = ['#f1efe9', '#c8ccd1', '#2f4a6b', '#9b2f28'];

export function createInstanced(ctx, capacity) {
  const hw = DIMS.wid / 2;
  const b = newBuf();
  prism(b, ROLE.PAINT, '#fff', [[0.62, 0.3], [2.08, 0.3], [2.1, 0.62], [2.06, 0.98], [0.62, 0.98]], -hw, hw);
  prism(b, ROLE.FIX, '#2b3441', [[0.66, 0.96], [2.04, 0.96], [1.78, 1.62], [0.7, 1.64]], 0.05 - hw, hw - 0.05);
  box(b, ROLE.PAINT, '#fff', 0.68, 1.6, 0.07 - hw, 1.8, 1.72, hw - 0.07);
  box(b, ROLE.FIX, '#2a2f36', -2.1, 0.3, 0.1 - hw, 0.62, 0.52, hw - 0.1);
  box(b, ROLE.FIX, '#8b9096', -2.08, 0.52, -hw, 0.6, 0.58, hw);
  pair(b, ROLE.PAINT, '#fff', -2.08, 0.58, hw - 0.06, 0.6, 1.0, hw);
  box(b, ROLE.PAINT, '#fff', -2.1, 0.52, -hw, -2.03, 1.0, hw);
  box(b, ROLE.FIX, '#2a2f36', 0.56, 0.58, 0.08 - hw, 0.62, 1.5, hw - 0.08);
  box(b, ROLE.FIX, '#c9a26a', -1.9, 0.58, -0.7, -1.1, 1.08, 0.05);
  box(b, ROLE.FIX, '#b88f58', -1.0, 0.58, -0.2, -0.3, 0.98, 0.65);
  box(b, ROLE.FIX, '#e8e0cc', -1.9, 0.58, 0.15, -1.3, 0.85, 0.7);
  carDetails(b, DIMS.len, DIMS.wid, { lampY: 0.66, tailY: 0.46, mirrorX: 1.72, mirrorY: 1.0 });
  const f = DIMS.wheelbase / 2 + 0.1;
  const r = f - DIMS.wheelbase;
  const z = hw - 0.07;
  return vehicle(ctx, capacity, 'pickup', { body: b, wheel: { r: 0.3, w: 0.2, at: [[f, z], [f, -z], [r, z], [r, -z]] } });
}
