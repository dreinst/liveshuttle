// Angkot Malang: mikrolet biru muda (minibus kecil seperti Suzuki Carry) dengan kode trayek di atas kaca
// depan dan di kedua sisi, deretan jendela samping, dan pintu penumpang yang terbuka di sisi kiri.
import * as THREE from '../../vendor/three.bundle.min.js';
import { GeoBuf } from '../geobuf.js';
import { vehicle, newBuf, box, prism, carDetails, ROLE } from './parts.js';

export const DIMS = { len: 4.15, wid: 1.65, height: 1.95, wheelbase: 2.43 };
export const PALETTE = ['#8fd3f0', '#7cc8ea', '#9adbf3'];
export const ROUTE = 'LDG'; // kode trayek Landungsari, Dinoyo, Gadang

function routeSign(res) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#17315c';
  g.font = 'bold 50px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ROUTE, 128, 35);
  const tex = res.add(new THREE.CanvasTexture(cv));
  tex.colorSpace = THREE.SRGBColorSpace;
  const b = new GeoBuf();
  const W = new THREE.Color('#ffffff');
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  const hw = DIMS.wid / 2 + 0.012;
  // depan (teks dibaca dari depan), sisi kiri dan sisi kanan
  b.quad([1.255, 1.66, 0.46], [1.255, 1.66, -0.46], [1.255, 1.8, -0.46], [1.255, 1.8, 0.46], 1, 0, 0, W, uv);
  b.quad([-0.7, 0.58, -hw], [-1.5, 0.58, -hw], [-1.5, 0.78, -hw], [-0.7, 0.78, -hw], 0, 0, -1, W, uv);
  b.quad([-1.5, 0.58, hw], [-0.7, 0.58, hw], [-0.7, 0.78, hw], [-1.5, 0.78, hw], 0, 0, 1, W, uv);
  return { geo: b.build(), mat: res.add(new THREE.MeshLambertMaterial({ map: tex })) };
}

export function createInstanced(ctx, capacity) {
  const hw = DIMS.wid / 2;
  const b = newBuf();
  prism(b, ROLE.PAINT, '#fff', [[-2.075, 0.3], [2.04, 0.3], [2.075, 0.9], [1.55, 1.04], [-2.075, 1.04]], -hw, hw);
  prism(b, ROLE.FIX, '#2b3441', [[-2.06, 1.02], [1.56, 1.02], [1.22, 1.64], [-2.06, 1.64]], 0.02 - hw, hw - 0.02);
  box(b, ROLE.PAINT, '#fff', -2.075, 1.62, -hw, 1.24, 1.84, hw);
  box(b, ROLE.FIX, '#f4f6f6', -2.08, 0.97, -hw - 0.006, 1.5, 1.02, hw + 0.006);
  for (const x of [-1.98, -1.3, -0.6, 0.3]) box(b, ROLE.PAINT, '#fff', x, 1.02, -hw - 0.004, x + 0.12, 1.63, hw + 0.004);
  box(b, ROLE.FIX, '#1e2429', -0.48, 0.4, -hw - 0.012, 0.3, 1.62, -hw + 0.02);
  box(b, ROLE.FIX, '#3a4048', -0.48, 0.3, -hw - 0.07, 0.3, 0.36, -hw);
  carDetails(b, DIMS.len, DIMS.wid, { lampY: 0.64, tailY: 0.62, mirrorX: 1.4, mirrorY: 1.0 });
  const f = DIMS.wheelbase / 2 + 0.2;
  const r = f - DIMS.wheelbase;
  const z = hw - 0.07;
  return vehicle(ctx, capacity, 'angkot', { body: b, wheel: { r: 0.3, w: 0.2, at: [[f, z], [f, -z], [r, z], [r, -z]] }, extras: [routeSign(ctx.res)] });
}
