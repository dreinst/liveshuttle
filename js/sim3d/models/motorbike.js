// Sepeda motor skuter (seperti Honda Beat) dengan pengendara berhelm. Helm sewarna motor, jaket pengendara
// acak, dan sebagian motor membawa penumpang boncengan (st.passenger, bila tidak diisi dipilih acak).
import { vehicle, newBuf, box, pair, prism, ROLE } from './parts.js';

export const DIMS = { len: 1.9, wid: 0.72, height: 1.65, wheelbase: 1.28 };
export const PALETTE = ['#d9d4c8', '#2c3440', '#b33a2e', '#3f6f9f', '#1f1f23', '#e2b93b', '#6a7d5a'];

const HELMET = [[0, 1.5], [0.3, 1.5], [0.35, 1.62], [0.3, 1.76], [0.12, 1.81], [0, 1.72]];
const helmet = (b, role, col, x) => prism(b, role, col, HELMET.map(([u, y]) => [u + x, y]), -0.14, 0.14);

export function createInstanced(ctx, capacity) {
  const b = newBuf();
  // motor
  prism(b, ROLE.PAINT, '#fff', [[0.22, 0.32], [0.4, 0.32], [0.56, 1.0], [0.44, 1.02]], -0.18, 0.18);
  prism(b, ROLE.FIX, '#2a2f36', [[0.6, 0.26], [0.68, 0.26], [0.56, 1.0], [0.48, 1.0]], -0.04, 0.04);
  box(b, ROLE.PAINT, '#fff', 0.5, 0.55, -0.07, 0.8, 0.6, 0.07);
  box(b, ROLE.FIX, '#2a2f36', 0.46, 1.0, -0.34, 0.56, 1.06, 0.34);
  box(b, ROLE.PAINT, '#fff', 0.44, 0.95, -0.14, 0.62, 1.1, 0.14);
  box(b, ROLE.HEAD, '#f4f1e4', 0.6, 0.98, -0.09, 0.645, 1.06, 0.09);
  pair(b, ROLE.SIGR, '#ffae3a', 0.56, 1.0, 0.16, 0.62, 1.05, 0.22);
  box(b, ROLE.FIX, '#2a2f36', -0.1, 0.3, -0.16, 0.26, 0.38, 0.16);
  prism(b, ROLE.PAINT, '#fff', [[-0.86, 0.42], [-0.1, 0.32], [0.06, 0.58], [-0.2, 0.8], [-0.86, 0.78]], -0.15, 0.15);
  box(b, ROLE.FIX, '#2a2f36', -0.78, 0.78, -0.14, 0.02, 0.88, 0.14);
  box(b, ROLE.TAIL, '#e0342a', -0.9, 0.62, -0.08, -0.85, 0.72, 0.08);
  pair(b, ROLE.SIGR, '#ffae3a', -0.9, 0.6, 0.09, -0.85, 0.66, 0.15);
  box(b, ROLE.FIX, '#8b9096', -0.75, 0.22, 0.14, -0.25, 0.3, 0.2);
  // pengendara
  box(b, ROLE.FIX, '#2b3445', -0.4, 0.84, -0.17, 0.12, 0.98, 0.17);
  pair(b, ROLE.FIX, '#2b3445', 0.1, 0.4, 0.06, 0.24, 0.92, 0.18);
  pair(b, ROLE.FIX, '#1f1f23', 0.12, 0.38, 0.06, 0.34, 0.46, 0.18);
  prism(b, ROLE.ALT, '#fff', [[-0.4, 0.92], [-0.1, 0.92], [0.02, 1.46], [-0.24, 1.5]], -0.2, 0.2);
  for (const z of [-0.28, 0.2]) prism(b, ROLE.ALT, '#fff', [[-0.1, 1.36], [0.0, 1.46], [0.5, 1.1], [0.44, 1.0]], z, z + 0.08);
  pair(b, ROLE.FIX, '#3a3530', 0.44, 1.0, 0.26, 0.54, 1.1, 0.34);
  helmet(b, ROLE.PAINT, '#fff', -0.3);
  box(b, ROLE.FIX, '#1b222b', 0.0, 1.56, -0.11, 0.055, 1.69, 0.11);
  // penumpang boncengan (warna baju = warna instans mesh ini)
  const p = newBuf();
  box(p, ROLE.FIX, '#3d3a36', -0.8, 0.86, -0.17, -0.42, 0.98, 0.17);
  pair(p, ROLE.FIX, '#3d3a36', -0.5, 0.44, 0.12, -0.38, 0.92, 0.24);
  pair(p, ROLE.FIX, '#1f1f23', -0.5, 0.4, 0.12, -0.3, 0.46, 0.24);
  prism(p, ROLE.PAINT, '#fff', [[-0.86, 0.94], [-0.56, 0.94], [-0.54, 1.42], [-0.8, 1.46]], -0.19, 0.19);
  pair(p, ROLE.PAINT, '#fff', -0.6, 1.1, 0.19, -0.3, 1.18, 0.25);
  helmet(p, ROLE.FIX, '#eeeae2', -0.84);
  box(p, ROLE.FIX, '#1b222b', -0.54, 1.56, -0.1, -0.5, 1.68, 0.1);
  const pax = { body: p, color: (st, t) => t.paxColor, show: (st, t) => st.passenger ?? t.pax };
  return vehicle(ctx, capacity, 'motorbike', { body: b, wheel: { r: 0.26, w: 0.1, at: [[0.64, 0], [-0.64, 0]] }, extras: [pax] });
}
