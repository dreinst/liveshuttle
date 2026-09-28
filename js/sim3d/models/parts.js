// Alat bantu model kendaraan NPC. Satu jenis kendaraan = satu geometri badan (cat, kaca, lampu, pengendara
// digabung) + satu geometri roda, masing-masing satu InstancedMesh. Warna tiap titik punya "peran"
// (lihat ROLE) yang dibaca shader, jadi cat, lampu rem, sein, dan lampu malam per kendaraan cukup satu draw call.
// Antarmuka untuk kode lalu lintas tetap: set(i, keadaan) lalu commit(n).
import * as THREE from '../../vendor/three.bundle.min.js';
import { GeoBuf } from '../geobuf.js';

/** Peran titik: 0 tetap, 1 cat (warna instans), 2 warna kedua (jaket pengendara), 3 lampu depan,
 *  4 lampu belakang/rem, 5 sein kiri, 6 sein kanan. */
export const ROLE = { FIX: 0, PAINT: 1, ALT: 2, HEAD: 3, TAIL: 4, SIGL: 5, SIGR: 6 };

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const newBuf = () => Object.assign(new GeoBuf(), { roles: [] });
const tag = (b, role) => {
  while (b.roles.length < b.n) b.roles.push(role);
};

/** Kotak sejajar sumbu di ruang model (x maju, y atas, z kanan). */
export function box(b, role, col, x0, y0, z0, x1, y1, z1) {
  b.box(x0, y0, z0, x1, y1, z1, _c.set(col));
  tag(b, role);
}

/** Pasangan kotak kiri dan kanan (z0..z1 dicerminkan). Peran sein otomatis kiri/kanan. */
export function pair(b, role, col, x0, y0, z0, x1, y1, z1) {
  box(b, role === ROLE.SIGR ? ROLE.SIGL : role, col, x0, y0, -z1, x1, y1, -z0);
  box(b, role, col, x0, y0, z0, x1, y1, z1);
}

/** Profil samping pts [[x, y], ...] yang dipertebal dari z0 ke z1 (hidung, kaca depan miring, dan sebagainya). */
export function prism(b, role, col, pts, z0, z1) {
  const c = _c.set(col);
  const v2 = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const s = THREE.ShapeUtils.isClockWise(v2) ? -1 : 1;
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) {
    for (const [z, nz] of [[z0, -1], [z1, 1]]) b.tri([pts[i][0], pts[i][1], z], [pts[j][0], pts[j][1], z], [pts[k][0], pts[k][1], z], 0, 0, nz, c);
  }
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    b.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], (s * (by - ay)) / l, (-s * (bx - ax)) / l, 0, c);
  }
  tag(b, role);
}

const TIRE = new THREE.Color('#1d2024');
const RIM = new THREE.Color('#c9ced4');
const HUB = new THREE.Color('#6b7178');

/** Roda berpusat di titik asal, sumbu z. Pelek berjari-jari selang-seling supaya putarannya terlihat. */
function wheelGeo(r, w) {
  const b = new GeoBuf();
  const N = 10;
  const hw = w / 2;
  const ri = r * 0.62;
  const P = (a, rr, z) => [Math.cos(a) * rr, Math.sin(a) * rr, z];
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    b.quad(P(a0, r, -hw), P(a1, r, -hw), P(a1, r, hw), P(a0, r, hw), Math.cos(am), Math.sin(am), 0, TIRE);
    for (const z of [-hw, hw]) {
      b.quad(P(a0, ri, z), P(a1, ri, z), P(a1, r, z), P(a0, r, z), 0, 0, Math.sign(z), TIRE);
      b.tri([0, 0, z], P(a0, ri, z), P(a1, ri, z), 0, 0, Math.sign(z), k % 2 ? RIM : HUB);
    }
  }
  return b.build();
}

// Material bersama semua kendaraan NPC. Shader Lambert biasa ditambah pemilihan warna per peran dan cahaya lampu.
function roleMaterial(res) {
  const mat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRole;\nattribute vec4 iLamp;\nattribute vec3 iAlt;\nvarying float vGlow;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vColor.rgb = color.rgb; vGlow = 0.0;
        int role = int(aRole + 0.5);
        if (role == 1) vColor.rgb *= instanceColor.rgb;
        else if (role == 2) vColor.rgb *= iAlt;
        else if (role >= 3) {
          float on = role == 3 ? iLamp.x : role == 4 ? max(iLamp.x * 0.5, iLamp.y) : role == 5 ? iLamp.z : iLamp.w;
          vColor.rgb *= mix(0.5, 1.0, on); vGlow = on;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 1.3;');
  };
  return mat;
}

const MATS = new WeakMap(); // res -> { role, wheel }
function mats(res) {
  let m = MATS.get(res);
  if (!m) MATS.set(res, (m = { role: roleMaterial(res), wheel: res.add(new THREE.MeshLambertMaterial({ vertexColors: true })) }));
  return m;
}

function inst(ctx, geo, mat, n, name, shadow) {
  const mesh = new THREE.InstancedMesh(ctx.res.add(geo), mat, n);
  mesh.count = 0;
  mesh.frustumCulled = false; // posisi berubah tiap bingkai
  mesh.castShadow = shadow;
  mesh.name = name;
  mesh.setColorAt(0, _c.set('#ffffff'));
  ctx.scene.add(mesh);
  return mesh;
}

// Sifat acak per kendaraan (jaket pengendara, ada boncengan) disimpan per objek warna kendaraan,
// karena warna itu dibuat sekali per kendaraan oleh kode lalu lintas. Tidak ada perubahan antarmuka.
const JACKET = ['#2f3b4c', '#6b4f3a', '#3f6f5a', '#8a3b35', '#445a8a', '#1f1f23', '#7a7f87'];
const TRAITS = new WeakMap();
function traits(color) {
  let t = TRAITS.get(color);
  if (!t) {
    const pick = (a) => new THREE.Color(a[Math.floor(Math.random() * a.length)]);
    t = { alt: pick(JACKET), pax: Math.random() < 0.35, paxColor: pick(['#e58fa8', '#8fb8de', '#f2d27a', '#9ccf9c', '#d9d4c8']) };
    if (color) TRAITS.set(color, t);
  }
  return t;
}

/**
 * Pabrik InstancedMesh untuk satu jenis kendaraan.
 * spec = { body: newBuf() yang sudah diisi, wheel: { r, w, at: [[x, z], ...] },
 *          extras: [{ body | geo + mat, color?(st, t), show?(st, t) }] } (extras ikut matriks badan).
 */
export function vehicle(ctx, capacity, name, spec) {
  const M = mats(ctx.res);
  const roleGeo = (buf) => {
    const g = buf.build();
    g.setAttribute('aRole', new THREE.Float32BufferAttribute(buf.roles, 1));
    g.setAttribute('iLamp', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    g.setAttribute('iAlt', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    return g;
  };
  const bodyGeo = roleGeo(spec.body);
  const lamp = bodyGeo.attributes.iLamp;
  const alt = bodyGeo.attributes.iAlt;
  const body = inst(ctx, bodyGeo, M.role, capacity, `${name}:badan`, true);
  const { r, w, at } = spec.wheel;
  const wheels = inst(ctx, wheelGeo(r, w), M.wheel, capacity * at.length, `${name}:roda`, false);
  const extras = (spec.extras || []).map((e) => ({ ...e, mesh: inst(ctx, e.body ? roleGeo(e.body) : e.geo, e.mat || M.role, capacity, `${name}:tambahan`, !!e.body) }));
  const meshes = [body, wheels, ...extras.map((e) => e.mesh)];
  // putaran roda dihitung dari perpindahan tiap slot (maju positif, mundur negatif)
  const lastX = new Float32Array(capacity);
  const lastZ = new Float32Array(capacity);
  const roll = new Float32Array(capacity);
  return {
    meshes,
    /** st = { x, z, h, y?, color, braking, night, blink (-1 kiri, 1 kanan, 0), hazard?, blinkOn, passenger? } */
    set(i, st) {
      const t = traits(st.color);
      _q.setFromAxisAngle(_up, -st.h);
      _p.set(st.x, st.y || 0, st.z);
      _m.compose(_p, _q, _one);
      body.setMatrixAt(i, _m);
      body.setColorAt(i, st.color || _c.set('#ffffff'));
      const sig = st.blinkOn ? 1 : 0;
      lamp.setXYZW(i, st.night ? 1 : 0, st.braking ? 1 : 0, st.blink < 0 || st.hazard ? sig : 0, st.blink > 0 || st.hazard ? sig : 0);
      alt.setXYZ(i, t.alt.r, t.alt.g, t.alt.b);
      for (const e of extras) {
        e.mesh.setMatrixAt(i, !e.show || e.show(st, t) ? _m : ZERO);
        if (e.color) e.mesh.setColorAt(i, e.color(st, t));
      }
      const dx = st.x - lastX[i];
      const dz = st.z - lastZ[i];
      if (dx * dx + dz * dz < 9) roll[i] = (roll[i] + (dx * Math.cos(st.h) + dz * Math.sin(st.h)) / r) % (Math.PI * 2);
      lastX[i] = st.x;
      lastZ[i] = st.z;
      for (let k = 0; k < at.length; k++) {
        _w.makeRotationZ(-roll[i]).setPosition(at[k][0], r, at[k][1]);
        wheels.setMatrixAt(i * at.length + k, _w.premultiply(_m));
      }
    },
    commit(n) {
      for (const mesh of meshes) mesh.count = n;
      wheels.count = n * at.length;
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
      lamp.needsUpdate = true;
      alt.needsUpdate = true;
    },
  };
}

/** Kaca, lampu, bemper, spion, dan pelat yang sama bentuknya untuk mobil biasa. L panjang, W lebar. */
export function carDetails(b, L, W, { lampY, tailY, mirrorX, mirrorY }) {
  const hl = L / 2;
  const hw = W / 2;
  pair(b, ROLE.HEAD, '#f4f1e4', hl - 0.1, lampY, hw - 0.42, hl + 0.01, lampY + 0.12, hw - 0.12);
  box(b, ROLE.FIX, '#2a2f36', hl - 0.06, lampY - 0.12, -hw + 0.45, hl + 0.015, lampY + 0.08, hw - 0.45);
  pair(b, ROLE.SIGR, '#ffae3a', hl - 0.16, lampY + 0.01, hw - 0.1, hl - 0.02, lampY + 0.1, hw + 0.01);
  pair(b, ROLE.TAIL, '#e0342a', -hl - 0.015, tailY, hw - 0.36, -hl + 0.06, tailY + 0.16, hw - 0.1);
  pair(b, ROLE.SIGR, '#ffae3a', -hl - 0.015, tailY - 0.09, hw - 0.36, -hl + 0.06, tailY - 0.01, hw - 0.1);
  box(b, ROLE.FIX, '#2a2f36', -hl - 0.03, 0.22, -hw + 0.02, -hl + 0.12, 0.42, hw - 0.02);
  box(b, ROLE.FIX, '#2a2f36', hl - 0.12, 0.22, -hw + 0.02, hl + 0.03, 0.38, hw - 0.02);
  box(b, ROLE.FIX, '#f2f2ee', -hl - 0.04, 0.3, -0.24, -hl - 0.02, 0.4, 0.24);
  pair(b, ROLE.PAINT, '#ffffff', mirrorX, mirrorY, hw, mirrorX + 0.14, mirrorY + 0.1, hw + 0.13);
}
