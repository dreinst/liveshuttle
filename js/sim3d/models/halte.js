// Halte shuttle: atap, tiang, bangku, dan papan nama. Semua halte digabung ke satu geometri.
import * as THREE from '../../vendor/three.bundle.min.js';
import { GeoBuf } from '../geobuf.js';

export const DIMS = { len: 4.2, depth: 1.6, height: 2.6 };

function signTexture(res, name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0f766e';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffffff';
  g.font = '600 34px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('HALTE LIVESHUTTLE', 22, 38);
  g.font = '700 40px system-ui, sans-serif';
  let t = name;
  while (g.measureText(t).width > 470 && t.length > 4) t = `${t.slice(0, -2)}…`;
  g.fillText(t, 22, 90);
  const tex = res.add(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** list: [{ name, shelter: [x, z], h }] (h = arah jalan). Mengembalikan Group. */
export function createHalteGroup(ctx, list) {
  const { res } = ctx;
  const group = new THREE.Group();
  group.name = 'halte';
  const buf = new GeoBuf();
  const roof = new THREE.Color('#0f766e');
  const post = new THREE.Color('#d8dcdb');
  const bench = new THREE.Color('#b08968');
  const base = new THREE.Color('#e7e2d8');
  for (const hl of list) {
    const [cx, cz] = hl.shelter;
    const h = hl.h;
    const c = Math.cos(h);
    const s = Math.sin(h);
    buf.obox(cx, cz, h, DIMS.len + 0.6, DIMS.depth + 0.4, 0, 0.1, base);
    buf.obox(cx, cz, h, DIMS.len, DIMS.depth, 2.45, 2.6, roof);
    for (const u of [-DIMS.len / 2 + 0.2, DIMS.len / 2 - 0.2]) {
      // tiang di sisi belakang (menjauhi jalan = ke kiri arah jalan)
      const v = -DIMS.depth / 2 + 0.15;
      buf.obox(cx + c * u - s * v, cz + s * u + c * v, h, 0.1, 0.1, 0.1, 2.45, post);
    }
    const vb = -DIMS.depth / 2 + 0.45;
    buf.obox(cx - s * vb, cz + c * vb, h, DIMS.len - 0.8, 0.45, 0.45, 0.55, bench);
    // dinding belakang kaca tipis
    const vw = -DIMS.depth / 2 + 0.08;
    buf.obox(cx - s * vw, cz + c * vw, h, DIMS.len - 0.3, 0.05, 0.6, 2.3, new THREE.Color('#bfe3de'));
  }
  const mesh = new THREE.Mesh(res.add(buf.build()), res.add(new THREE.MeshLambertMaterial({ vertexColors: true })));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  // papan nama di atas atap, menghadap jalan
  for (const hl of list) {
    const tex = signTexture(res, hl.name);
    const mat = res.add(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const sign = new THREE.Mesh(res.add(new THREE.PlaneGeometry(2.4, 0.6)), mat);
    const [cx, cz] = hl.shelter;
    sign.position.set(cx, 3.0, cz);
    // bidang menghadap ke kanan arah jalan (ke badan jalan)
    sign.rotation.y = -hl.h;
    group.add(sign);
  }
  ctx.scene.add(group);
  return group;
}
