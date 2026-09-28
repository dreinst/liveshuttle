// Hitung jarak lintasan konektor belok ke kerb trotoar di sudut blok (sudut di node +-7 m,
// dibulatkan dengan jari-jari GRID.CURB_R bila ada). Mobil selebar 1,8 m (NPC) atau 1,86 m (ego)
// menyentuh kerb bila jarak < setengah lebar mobil.
import { buildGraph, GRID } from '../js/sim3d/roadgraph.js';
const g = buildGraph();
const H = GRID.HALF;
const R = GRID.CURB_R || 0;
// jarak titik (x, z) ke blok yang sudutnya di (cx, cz) dan membentang ke arah (sx, sz)
const curbDist = (x, z, cx, cz, sx, sz) => {
  const u = (x - cx) * sx;
  const w = (z - cz) * sz;
  if (u >= R || w >= R) return Math.max(0, -Math.min(u, w));
  return Math.max(0, Math.hypot(R - u, R - w) - R);
};
console.log('jari-jari kerb sudut:', R, 'm');
const res = { L: [], R: [], S: [] };
for (const n of g.nodes) {
  const cornersPts = [[n.x - H, n.z - H, -1, -1], [n.x + H, n.z - H, 1, -1], [n.x + H, n.z + H, 1, 1], [n.x - H, n.z + H, -1, 1]];
  for (const c of n.conns) {
    const p = c.poly;
    let best = Infinity;
    for (let s = 0; s <= p.len; s += 0.05) {
      const q = p.at(s, {});
      for (const [cx, cz, sx, sz] of cornersPts) {
        const d = curbDist(q.x, q.z, cx, cz, sx, sz);
        if (d < best) best = d;
      }
    }
    res[c.move].push({ node: n.id, deg: n.deg, from: c.fromLane.k, to: c.toLane.k, d: best, len: p.len });
  }
}
for (const m of ['L', 'R', 'S']) {
  const arr = res[m];
  const ds = arr.map((x) => x.d).sort((a, b) => a - b);
  const over = arr.filter((x) => x.d < 0.9).length;
  console.log(m, 'n', arr.length, 'jarak min ke kerb sudut', ds[0].toFixed(2), 'median', ds[Math.floor(ds.length / 2)].toFixed(2), 'jumlah < 0,9 m (setengah lebar NPC):', over);
}
const ex = res.L.find((x) => x.deg === 4);
console.log('contoh belok kiri di simpul', ex.node, 'jarak pusat lintasan ke sudut', ex.d.toFixed(2), 'm, panjang', ex.len.toFixed(1), 'm');
