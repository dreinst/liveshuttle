// Galian jalan kecil: lubang tanah, pembatas plastik oranye putih di sekelilingnya, dan papan
// peringatan. Juga pembatas "jalan ditutup" untuk alat Tutup jalan. Semua bagian satu situs digabung
// dalam satu geometri berwarna per titik.
import * as THREE from '../../vendor/three.bundle.min.js';
import { GeoBuf } from '../geobuf.js';

export const DIMS = { len: 7.0, wid: 2.5 };

const ORANGE = new THREE.Color('#f07c1e');
const WHITE = new THREE.Color('#f6f4ee');
const DIRT = new THREE.Color('#8a6a4a');
const DIRT2 = new THREE.Color('#6f543a');
const POLE = new THREE.Color('#9aa1a8');
const SIGN = new THREE.Color('#f4c21c');
const DARK = new THREE.Color('#2a2f36');
const RED = new THREE.Color('#d8342c');

/** Satu pembatas plastik (panjang 1,2 m) berpusat di (u, v) lokal dengan arah a. */
function barrier(buf, cx, cz, h, u, v, a) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  const x = cx + c * u - s * v;
  const z = cz + s * u + c * v;
  buf.obox(x, z, h + a, 1.2, 0.34, 0.0, 0.45, ORANGE);
  buf.obox(x, z, h + a, 1.1, 0.26, 0.45, 0.62, WHITE);
  buf.obox(x, z, h + a, 1.0, 0.2, 0.62, 0.8, ORANGE);
}

/** Situs galian di (x, z) dengan arah jalan h. */
export function buildRoadworks(res, x, z, h) {
  const buf = new GeoBuf();
  const hl = DIMS.len / 2;
  const hw = DIMS.wid / 2;
  // tanah galian dan gundukan
  buf.obox(x, z, h, DIMS.len - 1.4, DIMS.wid - 0.7, 0.04, 0.09, DIRT2);
  const c = Math.cos(h);
  const s = Math.sin(h);
  buf.obox(x + c * 1.2 - s * 0.2, z + s * 1.2 + c * 0.2, h, 1.8, 1.0, 0.09, 0.4, DIRT);
  buf.obox(x - c * 1.0 + s * 0.1, z - s * 1.0 - c * 0.1, h + 0.3, 1.2, 0.8, 0.09, 0.28, DIRT);
  // pembatas di sekeliling
  for (const u of [-hl + 0.7, -hl + 2, hl - 2, hl - 0.7]) {
    barrier(buf, x, z, h, u, -hw, 0);
    barrier(buf, x, z, h, u, hw, 0);
  }
  barrier(buf, x, z, h, -hl, -0.55, Math.PI / 2);
  barrier(buf, x, z, h, -hl, 0.55, Math.PI / 2);
  barrier(buf, x, z, h, hl, -0.55, Math.PI / 2);
  barrier(buf, x, z, h, hl, 0.55, Math.PI / 2);
  // papan peringatan segitiga di depan (arah datang kendaraan)
  const px = x - c * (hl + 1.4);
  const pz = z - s * (hl + 1.4);
  buf.obox(px, pz, h, 0.06, 0.06, 0, 1.3, POLE);
  const tri = (y0, size, col, off) => {
    const nx = -c;
    const nz = -s;
    const lx = s;
    const lz = -c;
    const ox = px + nx * off;
    const oz = pz + nz * off;
    buf.tri([ox - lx * size, y0, oz - lz * size], [ox + lx * size, y0, oz + lz * size], [ox, y0 + size * 1.7, oz], nx, 0, nz, col);
  };
  tri(1.2, 0.5, RED, 0.04);
  tri(1.28, 0.38, SIGN, 0.05);
  buf.obox(px - c * 0.06, pz - s * 0.06, h, 0.02, 0.06, 1.42, 1.62, DARK);
  const mesh = new THREE.Mesh(res.add(buf.build()), sharedMat(res));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Pembatas jalan ditutup selebar w, berpusat di (x, z), melintang terhadap arah jalan h. */
export function buildClosure(res, x, z, h, w) {
  const buf = new GeoBuf();
  const c = Math.cos(h);
  const s = Math.sin(h);
  const lx = s;
  const lz = -c;
  const n = Math.max(1, Math.round(w / 1.25));
  for (let i = 0; i < n; i++) {
    const v = (i - (n - 1) / 2) * 1.25;
    const bx = x + lx * v;
    const bz = z + lz * v;
    // kaki
    for (const e of [-0.5, 0.5]) buf.obox(bx + lx * e, bz + lz * e, h, 0.08, 0.08, 0, 1.0, POLE);
    // papan bergaris merah putih
    for (let k = 0; k < 4; k++) {
      const col = k % 2 ? WHITE : RED;
      const e0 = -0.6 + k * 0.3;
      buf.obox(bx + lx * (e0 + 0.15), bz + lz * (e0 + 0.15), h, 0.06, 0.3, 0.72, 1.0, col);
    }
  }
  const mesh = new THREE.Mesh(res.add(buf.build()), sharedMat(res));
  mesh.castShadow = true;
  return mesh;
}

let MAT = null;
let MAT_RES = null;
function sharedMat(res) {
  if (!MAT || MAT_RES !== res) {
    MAT = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
    MAT_RES = res;
  }
  return MAT;
}
