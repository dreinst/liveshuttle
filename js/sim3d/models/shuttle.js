// LiveShuttle: shuttle listrik otonom kecil, panjang 6 m, 12 kursi, warna toska dan putih.
// Bentuk kotak tanpa kap mesin dan tanpa kursi pengemudi, kaca besar melingkar, pintu geser ganda di
// sisi KIRI (sisi trotoar di Indonesia), tulisan LiveShuttle, papan tujuan di depan, polong sensor di
// atap dengan LiDAR yang berputar pelan, radar kecil di keempat sudut, kamera, batang lampu LED di
// depan dan belakang, lampu rem, lampu sein, roda yang berputar, dan penumpang duduk yang terlihat
// dari luar kaca.
//
// Koordinat lokal: x maju, y ke atas, z ke kanan. Titik acuan di tanah, di tengah jejak kendaraan.
// Semua bagian statis yang tidak tembus pandang digabung dalam satu geometri berwarna per titik
// supaya hanya sedikit draw call.
import * as THREE from '../../vendor/three.bundle.min.js';
import { GeoBuf } from '../geobuf.js';

export const DIMS = { len: 6.0, wid: 2.1, height: 2.75, wheelbase: 4.0, seats: 12 };

const L = DIMS.len;
const W = DIMS.wid;
const R_CORNER = 0.42;
const DOOR = { x0: -0.32, x1: 0.98 }; // bukaan pintu di sisi kiri (x lokal)
const Y = { skirt0: 0.28, body0: 0.36, belt0: 1.05, glass0: 1.2, glass1: 2.3, roof1: 2.6, floor: 0.44 };

const C = {
  white: new THREE.Color('#f5f7f6'),
  teal: new THREE.Color('#12a594'),
  tealDark: new THREE.Color('#0d7f73'),
  dark: new THREE.Color('#262c33'),
  chassis: new THREE.Color('#3a4149'),
  roof: new THREE.Color('#eef2f1'),
  pod: new THREE.Color('#dde3e2'),
  floor: new THREE.Color('#8d969c'),
  seat: new THREE.Color('#1f8f83'),
  seatBase: new THREE.Color('#9aa3a8'),
  dash: new THREE.Color('#39424b'),
  rail: new THREE.Color('#e8c547'),
  lens: new THREE.Color('#12171c'),
};

/**
 * Titik persegi panjang bersudut bulat di bidang x,z. Urutan: sudut depan kanan, sisi kanan (dari depan
 * ke belakang, dipecah di splitR), sudut belakang kanan, sudut belakang kiri, sisi kiri (dari belakang
 * ke depan, dipecah di splitL), sudut depan kiri.
 */
function roundRect(len, wid, r, segs, cx = 0, splitR = null, splitL = null) {
  const hl = len / 2;
  const hw = wid / 2;
  const pts = [];
  const arc = (ax, az, a0) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      pts.push([cx + ax + Math.cos(a) * r, az + Math.sin(a) * r]);
    }
  };
  arc(hl - r, hw - r, 0); // depan kanan (x+, z+)
  if (splitR) for (const x of splitR) pts.push([cx + x, hw]);
  arc(-hl + r, hw - r, Math.PI / 2); // belakang kanan
  arc(-hl + r, -hw + r, Math.PI); // belakang kiri
  if (splitL) for (const x of splitL) pts.push([cx + x, -hw]);
  arc(hl - r, -hw + r, (Math.PI * 3) / 2); // depan kiri
  return pts;
}

/** Dinding tegak di sepanjang kontur tertutup, normal menghadap keluar. skip(ax, az, bx, bz) melewati ruas. */
function band(buf, pts, y0, y1, color, skip) {
  const n = pts.length;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
  }
  cx /= n;
  cz /= n;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) continue;
    if (skip && skip(a[0], a[1], b[0], b[1])) continue;
    let nx = (b[1] - a[1]) / len;
    let nz = -(b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2 - cx;
    const mz = (a[1] + b[1]) / 2 - cz;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    buf.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nx, 0, nz, color);
  }
}

/** Tutup datar menghadap ke atas (up = true) atau ke bawah. */
function cap(buf, pts, y, color, up = true) {
  if (up) {
    buf.flatPoly(pts, y, color);
    return;
  }
  // segitiga kipas dari titik tengah, menghadap ke bawah
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
  }
  cx /= pts.length;
  cz /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    buf.tri([cx, y, cz], [b[0], y, b[1]], [a[0], y, a[1]], 0, -1, 0, color);
  }
}

/** Kotak lokal (x0..x1, y0..y1, z0..z1). */
function box(buf, x0, y0, z0, x1, y1, z1, color, opts) {
  buf.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), color, opts);
}

function canvasTex(res, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = res.add(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas: c, g };
}

/** Tulisan LiveShuttle di sisi badan (latar tembus pandang). */
function letteringTexture(res) {
  return canvasTex(res, 1024, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // simbol kecil: tiga garis melengkung seperti sinyal (sensor) di dalam lingkaran toska
    g.fillStyle = '#12a594';
    g.beginPath();
    g.arc(78, h / 2, 54, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 9;
    g.lineCap = 'round';
    for (const r of [16, 30, 44]) {
      g.beginPath();
      g.arc(58, h / 2 + 6, r, -Math.PI / 2.6, Math.PI / 2.6);
      g.stroke();
    }
    g.font = '800 96px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#0d7f73';
    g.fillText('Live', 158, h / 2 + 4);
    const wLive = g.measureText('Live').width;
    g.fillStyle = '#12a594';
    g.fillText('Shuttle', 158 + wLive, h / 2 + 4);
  });
}

/** Papan tujuan LED (teks kuning oranye di latar gelap). */
function drawDestination(g, w, h, text) {
  g.fillStyle = '#0b0f13';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffb547';
  g.textBaseline = 'middle';
  let size = 44;
  g.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  while (g.measureText(text).width > w - 24 && size > 20) {
    size -= 2;
    g.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  }
  const tw = g.measureText(text).width;
  g.fillText(text, Math.max(12, (w - tw) / 2), h / 2 + 2);
  // kisi titik halus supaya terlihat seperti papan LED
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
}

/** Gabungkan geometri silinder three.js dengan satu warna per geometri (untuk roda). */
function mergeColored(parts) {
  let nv = 0;
  let ni = 0;
  for (const { geo } of parts) {
    nv += geo.attributes.position.count;
    ni += geo.index.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);
  let ov = 0;
  let oi = 0;
  for (const { geo, color } of parts) {
    const n = geo.attributes.position.count;
    pos.set(geo.attributes.position.array, ov * 3);
    nor.set(geo.attributes.normal.array, ov * 3);
    for (let i = 0; i < n; i++) {
      col[(ov + i) * 3] = color.r;
      col[(ov + i) * 3 + 1] = color.g;
      col[(ov + i) * 3 + 2] = color.b;
    }
    const a = geo.index.array;
    for (let k = 0; k < a.length; k++) idx[oi + k] = a[k] + ov;
    oi += a.length;
    ov += n;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Posisi kursi (x, z, arah hadap) berurutan sesuai urutan penumpang mengisi kursi. */
export function seatLayout() {
  const hw = W / 2 - 0.42;
  const right = [1.72, 1.1, 0.48, -0.14, -0.76].map((x) => [x, hw, Math.PI / 2]); // menghadap ke tengah (z-)
  const left = [1.78, 1.28, -0.95, -1.5].map((x) => [x, -hw, -Math.PI / 2]); // menghadap ke tengah (z+)
  const rear = [-0.55, 0, 0.55].map((z) => [-2.28, z, 0]); // bangku belakang menghadap ke depan
  // urutan mengisi: selang-seling supaya penumpang tersebar
  return [right[1], left[2], rear[1], right[3], left[0], right[0], rear[0], left[3], right[2], rear[2], left[1], right[4]];
}

const ARCH = [
  [1.45, 2.55],
  [-2.55, -1.45],
];

export function createShuttle(ctx) {
  const { res } = ctx;
  const g = new THREE.Group();
  g.name = 'liveshuttle';
  const body = new GeoBuf();
  const hl = L / 2;
  const hw = W / 2;
  const segs = 3;
  const splitR = [2.55, 1.45, -1.45, -2.55];
  const splitL = [-2.55, -1.45, DOOR.x0, DOOR.x1, 1.45, 2.55];
  const outline = roundRect(L, W, R_CORNER, segs, 0, splitR, splitL);
  const onSide = (az, bz, sgn) => sgn * az > hw - 0.03 && sgn * bz > hw - 0.03;
  const within = (ax, bx, x0, x1) => Math.min(ax, bx) >= x0 - 0.01 && Math.max(ax, bx) <= x1 + 0.01;
  const isDoorEdge = (ax, az, bx, bz) => onSide(az, bz, -1) && within(ax, bx, DOOR.x0, DOOR.x1);
  const isArchEdge = (ax, az, bx, bz) => (onSide(az, bz, 1) || onSide(az, bz, -1)) && ARCH.some(([x0, x1]) => within(ax, bx, x0, x1));
  const lowSkip = (ax, az, bx, bz) => isDoorEdge(ax, az, bx, bz) || isArchEdge(ax, az, bx, bz);

  // ===== badan =====
  band(body, outline, Y.skirt0, Y.body0, C.chassis, lowSkip);
  band(body, outline, Y.body0, 0.8, C.white, lowSkip);
  band(body, outline, 0.8, Y.belt0, C.white, isDoorEdge);
  band(body, outline, Y.belt0, Y.glass0, C.teal, isDoorEdge);
  // lengkung roda: dinding dalam dan langit-langit gelap supaya roda terlihat dan bagian dalam tertutup
  for (const [x0, x1] of ARCH) {
    for (const sg of [1, -1]) {
      box(body, x0, Y.skirt0, sg * (hw - 0.36), x1, 0.8, sg * (hw - 0.32), C.dark);
      box(body, x0, 0.78, sg * (hw - 0.36), x1, 0.82, sg * hw, C.dark);
    }
  }
  // bawah badan (di antara dinding dalam lengkung roda)
  const under = [
    [-hl + 0.25, -hw + 0.36],
    [hl - 0.25, -hw + 0.36],
    [hl - 0.25, hw - 0.36],
    [-hl + 0.25, hw - 0.36],
  ];
  cap(body, under, Y.skirt0, C.chassis, false);
  // atap: tepi toska tipis lalu atap putih, dengan tutup bawah (plafon) untuk tampilan dari kabin
  const roofPts = roundRect(L, W, R_CORNER, segs);
  band(body, roofPts, Y.glass1, Y.glass1 + 0.08, C.teal);
  band(body, roofPts, Y.glass1 + 0.08, Y.roof1, C.roof);
  cap(body, roofPts, Y.roof1, C.roof, true);
  cap(body, roofPts, Y.glass1, new THREE.Color('#e9eceb'), false);
  // pilar kaca: empat sudut dan dua di tiap sisi (termasuk tepi pintu)
  const pillar = (x, z, sx = 0.1, sz = 0.1) => box(body, x - sx / 2, Y.glass0, z - sz / 2, x + sx / 2, Y.glass1, z + sz / 2, C.white);
  for (const [x, z] of [
    [hl - 0.12, hw - 0.12],
    [hl - 0.12, -hw + 0.12],
    [-hl + 0.12, hw - 0.12],
    [-hl + 0.12, -hw + 0.12],
  ])
    pillar(x, z, 0.16, 0.16);
  pillar(0.2, hw - 0.02, 0.1, 0.06);
  pillar(-1.4, hw - 0.02, 0.1, 0.06);
  pillar(DOOR.x0 - 0.05, -hw + 0.02, 0.1, 0.06);
  pillar(DOOR.x1 + 0.05, -hw + 0.02, 0.1, 0.06);
  // bingkai gelap di tepi bukaan pintu
  box(body, DOOR.x0 - 0.02, Y.body0, -hw - 0.012, DOOR.x0 + 0.03, Y.glass1, -hw + 0.06, C.dark);
  box(body, DOOR.x1 - 0.03, Y.body0, -hw - 0.012, DOOR.x1 + 0.02, Y.glass1, -hw + 0.06, C.dark);
  box(body, DOOR.x0, Y.glass1 - 0.05, -hw - 0.012, DOOR.x1, Y.glass1, -hw + 0.06, C.dark);
  // ambang pintu
  box(body, DOOR.x0, Y.skirt0, -hw, DOOR.x1, Y.floor, -hw + 0.12, C.chassis);
  // bemper depan dan belakang
  box(body, hl - 0.2, 0.3, -hw + 0.28, hl + 0.03, 0.52, hw - 0.28, C.tealDark);
  box(body, -hl - 0.03, 0.3, -hw + 0.28, -hl + 0.2, 0.52, hw - 0.28, C.tealDark);
  // radar kecil di keempat sudut bemper
  for (const [x, z] of [
    [hl - 0.2, hw - 0.18],
    [hl - 0.2, -hw + 0.18],
    [-hl + 0.2, hw - 0.18],
    [-hl + 0.2, -hw + 0.18],
  ]) {
    const sx = Math.sign(x);
    const sz = Math.sign(z);
    box(body, x + sx * 0.12, 0.5, z + sz * 0.02, x + sx * 0.26, 0.64, z - sz * 0.14, C.lens);
  }
  // polong sensor di atap bagian depan, kamera depan dan samping
  const pod = roundRect(1.5, 1.24, 0.3, 2, 1.75);
  band(body, pod, Y.roof1, Y.roof1 + 0.2, C.pod);
  cap(body, pod, Y.roof1 + 0.2, C.pod, true);
  box(body, 2.48, Y.roof1 + 0.05, -0.18, 2.52, Y.roof1 + 0.15, 0.18, C.lens);
  box(body, 1.6, Y.roof1 + 0.05, -0.64, 1.9, Y.roof1 + 0.15, -0.6, C.lens);
  box(body, 1.6, Y.roof1 + 0.05, 0.6, 1.9, Y.roof1 + 0.15, 0.64, C.lens);
  box(body, 1.75, Y.roof1 + 0.2, -0.24, 2.05, Y.roof1 + 0.26, 0.24, C.pod);
  // kamera kecil di atas kaca belakang
  box(body, -hl - 0.02, Y.glass1 + 0.12, -0.12, -hl + 0.05, Y.glass1 + 0.22, 0.12, C.lens);

  // ===== kabin: lantai, kursi, pegangan, dasbor =====
  cap(
    body,
    [
      [-hl + 0.15, -hw + 0.36],
      [hl - 0.15, -hw + 0.36],
      [hl - 0.15, hw - 0.36],
      [-hl + 0.15, hw - 0.36],
    ],
    Y.floor,
    C.floor,
  );
  for (const sg of [1, -1]) box(body, -1.45, Y.skirt0, sg * (hw - 0.36), 1.45, Y.floor, sg * (hw - 0.06), C.floor, { top: true });
  const seats = seatLayout();
  for (const [x, z, face] of seats) {
    // alas, dudukan, sandaran (sandaran di belakang arah hadap)
    const fx = Math.cos(face);
    const fz = -Math.sin(face);
    const sw = 0.5;
    const sd = 0.46;
    const ax = Math.abs(fx) > 0.5 ? sd : sw;
    const az = Math.abs(fx) > 0.5 ? sw : sd;
    box(body, x - ax / 2 + 0.04, Y.floor, z - az / 2 + 0.04, x + ax / 2 - 0.04, 0.82, z + az / 2 - 0.04, C.seatBase);
    box(body, x - ax / 2, 0.82, z - az / 2, x + ax / 2, 0.92, z + az / 2, C.seat);
    const bx = x - fx * (sd / 2 - 0.06);
    const bz = z - fz * (sd / 2 - 0.06);
    const tx = Math.abs(fx) > 0.5 ? 0.08 : sw;
    const tz = Math.abs(fx) > 0.5 ? sw : 0.08;
    box(body, bx - tx / 2, 0.92, bz - tz / 2, bx + tx / 2, 1.5, bz + tz / 2, C.seat);
  }
  // tiang pegangan kuning di dekat pintu
  for (const x of [DOOR.x0 + 0.1, DOOR.x1 - 0.1]) box(body, x - 0.025, Y.floor, -hw + 0.55 - 0.025, x + 0.025, Y.glass1 + 0.05, -hw + 0.55 + 0.025, C.rail);
  box(body, DOOR.x0 + 0.1, Y.glass1 + 0.02, -hw + 0.53, DOOR.x1 - 0.1, Y.glass1 + 0.07, -hw + 0.58, C.rail);
  // dasbor rendah di depan (tanpa setir): konsol dengan layar
  box(body, hl - 0.62, Y.floor, -hw + 0.22, hl - 0.2, 1.02, hw - 0.22, C.dash);
  box(body, hl - 0.66, 1.02, -hw + 0.2, hl - 0.16, 1.08, hw - 0.2, new THREE.Color('#2b3239'));

  const bodyMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const bodyMesh = new THREE.Mesh(res.add(body.build()), bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  g.add(bodyMesh);

  // ===== kaca melingkar (tembus pandang, penumpang terlihat dari luar) =====
  const glass = new GeoBuf();
  const gl = roundRect(L - 0.03, W - 0.03, R_CORNER - 0.015, segs, 0, null, [DOOR.x0, DOOR.x1]);
  band(glass, gl, Y.glass0, Y.glass1, new THREE.Color('#ffffff'), isDoorEdge);
  const glassMat = res.add(
    new THREE.MeshPhongMaterial({ color: '#1d4852', specular: '#cfe9ee', shininess: 70, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  const glassMesh = new THREE.Mesh(res.add(glass.build()), glassMat);
  glassMesh.renderOrder = 2;
  g.add(glassMesh);

  // ===== pintu geser ganda di sisi kiri =====
  const doorW = (DOOR.x1 - DOOR.x0) / 2;
  const doorPanels = [];
  const panelOpaque = new GeoBuf();
  box(panelOpaque, -doorW / 2, Y.body0 + 0.02, -0.03, doorW / 2, Y.belt0, 0.03, C.white);
  box(panelOpaque, -doorW / 2, Y.belt0, -0.03, doorW / 2, Y.glass0, 0.03, C.teal);
  box(panelOpaque, -doorW / 2, Y.glass1 - 0.06, -0.03, doorW / 2, Y.glass1 - 0.02, 0.03, C.white);
  box(panelOpaque, -doorW / 2, Y.glass0, -0.03, -doorW / 2 + 0.05, Y.glass1 - 0.02, 0.03, C.white);
  box(panelOpaque, doorW / 2 - 0.05, Y.glass0, -0.03, doorW / 2, Y.glass1 - 0.02, 0.03, C.white);
  const panelGeo = res.add(panelOpaque.build());
  const panelGlass = new GeoBuf();
  box(panelGlass, -doorW / 2 + 0.05, Y.glass0, -0.012, doorW / 2 - 0.05, Y.glass1 - 0.06, 0.012, new THREE.Color('#ffffff'));
  const panelGlassGeo = res.add(panelGlass.build());
  for (const side of [-1, 1]) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(panelGeo, bodyMat);
    m.castShadow = true;
    const gm = new THREE.Mesh(panelGlassGeo, glassMat);
    gm.renderOrder = 2;
    grp.add(m, gm);
    const x0 = (DOOR.x0 + DOOR.x1) / 2 + side * (doorW / 2);
    grp.position.set(x0, 0, -hw + 0.005);
    grp.userData.x0 = x0;
    grp.userData.side = side;
    g.add(grp);
    doorPanels.push(grp);
  }

  // ===== tulisan LiveShuttle di kedua sisi =====
  const let1 = letteringTexture(res);
  const letMat = res.add(new THREE.MeshLambertMaterial({ map: let1.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const letGeoR = res.add(new THREE.PlaneGeometry(2.3, 0.36));
  const letR = new THREE.Mesh(letGeoR, letMat);
  letR.position.set(-0.55, 0.72, hw + 0.004);
  g.add(letR);
  const letL = new THREE.Mesh(letGeoR, letMat);
  letL.position.set(-1.62, 0.72, -hw - 0.004);
  letL.rotation.y = Math.PI; // bidang menghadap ke kiri, teks tetap terbaca dari kiri
  letL.scale.set(0.8, 0.8, 1);
  g.add(letL);

  // ===== papan tujuan di depan (dan kecil di belakang) =====
  const dest = canvasTex(res, 512, 80, (gg, w, h) => drawDestination(gg, w, h, 'LiveShuttle'));
  const destMat = res.add(new THREE.MeshBasicMaterial({ map: dest.tex, toneMapped: false }));
  const destMesh = new THREE.Mesh(res.add(new THREE.PlaneGeometry(1.3, 0.2)), destMat);
  destMesh.position.set(hl + 0.006, Y.glass1 + 0.17, 0);
  destMesh.rotation.y = Math.PI / 2;
  g.add(destMesh);
  const destRear = new THREE.Mesh(res.add(new THREE.PlaneGeometry(0.9, 0.14)), destMat);
  destRear.position.set(-hl - 0.006, Y.glass1 + 0.17, 0);
  destRear.rotation.y = -Math.PI / 2;
  g.add(destRear);

  // ===== lampu: batang LED depan (putih) dan belakang (merah), sein di keempat sudut =====
  const ledFront = new GeoBuf();
  box(ledFront, hl - 0.005, 0.92, -hw + 0.34, hl + 0.012, 0.98, hw - 0.34, new THREE.Color('#ffffff'));
  for (const z of [-hw + 0.52, hw - 0.52]) box(ledFront, hl - 0.005, 0.72, z - 0.2, hl + 0.014, 0.84, z + 0.2, new THREE.Color('#ffffff'));
  const headMat = res.add(new THREE.MeshBasicMaterial({ color: '#dff7f3', toneMapped: false }));
  g.add(new THREE.Mesh(res.add(ledFront.build()), headMat));
  const ledRear = new GeoBuf();
  box(ledRear, -hl - 0.012, 0.92, -hw + 0.34, -hl + 0.005, 0.98, hw - 0.34, new THREE.Color('#ffffff'));
  for (const z of [-hw + 0.52, hw - 0.52]) box(ledRear, -hl - 0.014, 0.72, z - 0.2, -hl + 0.005, 0.84, z + 0.2, new THREE.Color('#ffffff'));
  const tailMat = res.add(new THREE.MeshBasicMaterial({ color: '#7a1f1f', toneMapped: false }));
  g.add(new THREE.Mesh(res.add(ledRear.build()), tailMat));
  const sigGeo = (zSign) => {
    const b = new GeoBuf();
    const z = zSign * (hw - 0.2);
    box(b, hl - 0.06, 0.74, z - 0.08, hl + 0.016, 0.84, z + 0.08, new THREE.Color('#ffffff'));
    box(b, -hl - 0.016, 0.62, z - 0.08, -hl + 0.06, 0.7, z + 0.08, new THREE.Color('#ffffff'));
    // sein samping kecil di atas roda depan
    box(b, DIMS.wheelbase / 2 + 0.62, 0.9, zSign * (hw + 0.006) - 0.004, DIMS.wheelbase / 2 + 0.78, 0.96, zSign * (hw + 0.006) + 0.004, new THREE.Color('#ffffff'));
    return res.add(b.build());
  };
  const sigOff = new THREE.Color('#8a5a1c');
  const sigOn = new THREE.Color('#ffb020');
  const sigLMat = res.add(new THREE.MeshBasicMaterial({ color: sigOff, toneMapped: false }));
  const sigRMat = res.add(new THREE.MeshBasicMaterial({ color: sigOff, toneMapped: false }));
  g.add(new THREE.Mesh(sigGeo(-1), sigLMat), new THREE.Mesh(sigGeo(1), sigRMat));

  // ===== roda (ban gelap dan dop terang), roda depan ikut berbelok =====
  const tire = new THREE.CylinderGeometry(0.37, 0.37, 0.26, 16);
  tire.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10);
  hub.rotateX(Math.PI / 2);
  const wheelGeo = res.add(mergeColored([
    { geo: tire, color: new THREE.Color('#1b1e22') },
    { geo: hub, color: new THREE.Color('#c9d0d4') },
  ]));
  const wheelMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const wheels = [];
  for (const [x, z, front] of [
    [DIMS.wheelbase / 2, hw - 0.15, true],
    [DIMS.wheelbase / 2, -hw + 0.15, true],
    [-DIMS.wheelbase / 2, hw - 0.15, false],
    [-DIMS.wheelbase / 2, -hw + 0.15, false],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.37, z);
    const m = new THREE.Mesh(wheelGeo, wheelMat);
    m.castShadow = true;
    pivot.add(m);
    g.add(pivot);
    wheels.push({ pivot, mesh: m, front });
  }

  // ===== LiDAR di atas polong, berputar pelan =====
  const lidar = new THREE.Group();
  lidar.position.set(1.9, Y.roof1 + 0.26, 0);
  const lidarBody = new THREE.Mesh(res.add(new THREE.CylinderGeometry(0.17, 0.19, 0.22, 20)), res.add(new THREE.MeshLambertMaterial({ color: '#20272e' })));
  lidarBody.position.y = 0.11;
  const lidarWin = new THREE.Mesh(res.add(new THREE.BoxGeometry(0.05, 0.08, 0.16)), res.add(new THREE.MeshBasicMaterial({ color: '#5eead4', toneMapped: false })));
  lidarWin.position.set(0.17, 0.12, 0);
  const lidarCap = new THREE.Mesh(res.add(new THREE.CylinderGeometry(0.12, 0.17, 0.05, 20)), res.add(new THREE.MeshLambertMaterial({ color: '#e7ecea' })));
  lidarCap.position.y = 0.245;
  lidar.add(lidarBody, lidarWin, lidarCap);
  g.add(lidar);

  // ===== penumpang yang duduk (InstancedMesh per bagian tubuh) =====
  const seatsXZ = seatLayout();
  const nSeat = seatsXZ.length;
  const torsoGeo = res.add(new THREE.BoxGeometry(0.26, 0.5, 0.36));
  torsoGeo.translate(0, 1.18, 0);
  const headGeo = res.add(new THREE.SphereGeometry(0.12, 10, 8));
  headGeo.translate(0, 1.57, 0);
  const legGeo = res.add(new THREE.BoxGeometry(0.44, 0.14, 0.32));
  legGeo.translate(0.18, 0.99, 0);
  const pMat = (c) => res.add(new THREE.MeshLambertMaterial({ color: c }));
  const torsoI = new THREE.InstancedMesh(torsoGeo, pMat('#ffffff'), nSeat);
  const headI = new THREE.InstancedMesh(headGeo, pMat('#ffffff'), nSeat);
  const legI = new THREE.InstancedMesh(legGeo, pMat('#ffffff'), nSeat);
  const shirts = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#f472b6', '#64748b', '#0ea5e9', '#eab308', '#e11d48', '#14b8a6', '#a3a3a3'];
  const skins = ['#f1c9a5', '#d9a47c', '#b37a52', '#8a5a3c', '#e8b98f'];
  const hijab = ['#1f2937', '#be185d', '#0f766e', '#6d28d9', '#b45309'];
  const pants = ['#2b3445', '#3d3a36', '#1f2a3a', '#58606b'];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3(1, 1, 1);
  const cc = new THREE.Color();
  seatsXZ.forEach(([x, z, face], i) => {
    q.setFromAxisAngle(up, face);
    pv.set(x, 0, z);
    m4.compose(pv, q, sv);
    torsoI.setMatrixAt(i, m4);
    legI.setMatrixAt(i, m4);
    headI.setMatrixAt(i, m4);
    torsoI.setColorAt(i, cc.set(shirts[i % shirts.length]));
    legI.setColorAt(i, cc.set(pants[i % pants.length]));
    headI.setColorAt(i, cc.set(i % 4 === 1 ? hijab[i % hijab.length] : skins[(i * 3) % skins.length]));
  });
  for (const m of [torsoI, headI, legI]) {
    m.count = 0;
    m.frustumCulled = false;
    g.add(m);
  }

  // ===== lampu depan (malam dan kabut) =====
  const headlight = new THREE.SpotLight('#fff1d6', 0, 70, 0.62, 0.55, 1.2);
  headlight.position.set(hl, 0.9, 0);
  headlight.target.position.set(hl + 18, 0, 0);
  g.add(headlight, headlight.target);

  ctx.scene.add(g);

  let spin = 0;
  let roll = 0;
  let destText = '';
  let pax = -1;
  let blinkPhase = 0;
  const cHeadDay = new THREE.Color('#dff7f3');
  const cHeadNight = new THREE.Color('#ffffff');
  const cTail = new THREE.Color('#7a1f1f');
  const cTailNight = new THREE.Color('#c21d1d');
  const cBrake = new THREE.Color('#ff2a1f');
  return {
    group: g,
    headlight,
    lidar,
    /** Tulis teks papan tujuan (hanya digambar ulang bila berubah). */
    setDestination(text) {
      if (text === destText) return;
      destText = text;
      drawDestination(dest.g, dest.canvas.width, dest.canvas.height, text);
      dest.tex.needsUpdate = true;
    },
    setPassengers(n) {
      const k = Math.max(0, Math.min(nSeat, n | 0));
      if (k === pax) return;
      pax = k;
      torsoI.count = headI.count = legI.count = k;
    },
    /**
     * st = { x, z, h, v, steer (rad, positif ke kanan), braking, night, dtReal, simDt, blink (-1 kiri,
     * 1 kanan, 0), door (0 tertutup sampai 1 terbuka), lidarSpin (rad per detik) }
     */
    update(st) {
      g.position.set(st.x, 0, st.z);
      g.rotation.y = -st.h;
      // LiDAR di atap berputar pelan (satu putaran tiap 5 detik) supaya tenang dilihat
      spin += (st.dtReal || 0) * (st.lidarSpin || (Math.PI * 2) / 5);
      lidar.rotation.y = -spin;
      roll += ((st.v || 0) * (st.simDt || 0)) / 0.37;
      const steer = st.steer || 0;
      for (const w of wheels) {
        w.mesh.rotation.z = -roll;
        if (w.front) w.pivot.rotation.y = -steer;
      }
      // pintu: keluar sedikit, lalu bergeser (panel depan ke depan, panel belakang ke belakang)
      const d = Math.max(0, Math.min(1, st.door || 0));
      const outT = Math.min(1, d / 0.25);
      const slideT = Math.max(0, (d - 0.2) / 0.8);
      const sl = slideT * slideT * (3 - 2 * slideT);
      for (const p of doorPanels) {
        p.position.z = -hw + 0.005 - 0.07 * outT;
        p.position.x = p.userData.x0 + p.userData.side * sl * (doorW - 0.02);
      }
      const night = !!st.night;
      headMat.color.copy(night ? cHeadNight : cHeadDay);
      tailMat.color.copy(st.braking ? cBrake : night ? cTailNight : cTail);
      headlight.intensity = night ? 38 : 0;
      blinkPhase += st.dtReal || 0;
      const on = Math.floor(blinkPhase * 2.6) % 2 === 0;
      sigLMat.color.copy(st.blink < 0 && on ? sigOn : sigOff);
      sigRMat.color.copy(st.blink > 0 && on ? sigOn : sigOff);
    },
    /** Tampilan kabin: kaca disembunyikan supaya jalan terlihat jelas dari balik dasbor. */
    setCabin(on) {
      glassMesh.visible = !on;
    },
  };
}
