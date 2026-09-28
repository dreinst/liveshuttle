// Pejalan kaki low poly. Tiap bagian tubuh (badan, kepala, rambut atau jilbab, lengan, tangan, kaki, sepatu,
// tas punggung, payung) satu InstancedMesh dengan satu material bersama, jadi puluhan orang tetap murah.
// Langkah kaki dan ayunan lengan mengikuti st.phase (bertambah sesuai jarak tempuh, jadi makin cepat berjalan
// makin cepat langkahnya). Diam (st.moving false) memakai pose berdiri. st.rain 0 sampai 1 membuka payung.
import * as THREE from '../../vendor/three.bundle.min.js';

export const DIMS = { radius: 0.25, height: 1.65 };
export const SKIN = ['#f1c9a5', '#d9a47c', '#b37a52', '#8a5a3c', '#e8b98f'];
export const CLOTH = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#e5e7eb', '#fb923c', '#38bdf8', '#94a3b8', '#1e3a5f'];

const HAIR = ['#1f1a17', '#2b211c', '#3a2a20'];
const HIJAB = ['#e7c6d0', '#c9d8e8', '#efe3c8', '#b9c9b3', '#8a93b8', '#d8a7a0', '#f4f1ea', '#5b6b8c'];
const SHOE = ['#1f1f23', '#e8e6e0', '#5a4636', '#3a4450'];
const PACK = ['#2f3b4c', '#8a3b35', '#3f6f5a', '#e2b93b', '#445a8a', '#1f1f23'];
const UMBRELLA = ['#e04f5f', '#3f7fbf', '#f2c14e', '#2f9e8f', '#7a5cc4', '#1f2a3a'];

const _M = new THREE.Matrix4();
const _L = new THREE.Matrix4();
const _R = new THREE.Matrix4();
const _X = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Sifat acak per orang disimpan per objek warna baju (dibuat sekali per orang oleh pemanggil).
const TRAITS = new WeakMap();
const pick = (a) => new THREE.Color(a[Math.floor(Math.random() * a.length)]);
function traits(key) {
  let t = TRAITS.get(key);
  if (!t) {
    t = { hijab: Math.random() < 0.3, pack: Math.random() < 0.35, umbrella: Math.random() < 0.3, hair: pick(HAIR), scarf: pick(HIJAB), shoe: pick(SHOE), bag: pick(PACK), umb: pick(UMBRELLA) };
    if (key) TRAITS.set(key, t);
  }
  return t;
}

/** Sendi (lengan atau kaki) di titik putar (px, py, pz): ayun maju mundur (sumbu z) lalu sedikit keluar (sumbu x). */
function joint(px, py, pz, swing, roll) {
  _R.makeRotationZ(swing).multiply(_X.makeRotationX(roll)).setPosition(px, py, pz);
  return _L.multiplyMatrices(_M, _R);
}

const MATS = new WeakMap();

export function createInstanced(ctx, capacity) {
  const { res, scene } = ctx;
  let mat = MATS.get(res);
  if (!mat) MATS.set(res, (mat = res.add(new THREE.MeshLambertMaterial({ color: '#ffffff' }))));
  const mk = (geo, per, shadow) => {
    const m = new THREE.InstancedMesh(res.add(geo), mat, capacity * per);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.setColorAt(0, new THREE.Color('#ffffff'));
    scene.add(m);
    return m;
  };
  const V = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
  const torso = mk(new THREE.CylinderGeometry(0.17, 0.14, 0.54, 8).scale(0.62, 1, 1).translate(0, 1.11, 0), 1, true);
  const head = mk(new THREE.SphereGeometry(0.11, 10, 8).translate(0.01, 1.52, 0), 1, true);
  const hair = mk(new THREE.SphereGeometry(0.116, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.44).rotateZ(0.55).translate(0, 1.53, 0), 1, false);
  // jilbab: bentuk putar dari puncak kepala sampai bahu, digeser ke belakang supaya wajah menyembul di depan
  const hijab = mk(new THREE.LatheGeometry(V([[0.21, 1.3], [0.16, 1.38], [0.12, 1.43], [0.132, 1.51], [0.122, 1.59], [0.075, 1.64], [0, 1.655]]), 12).translate(-0.035, 0, 0), 1, true);
  const legs = mk(new THREE.BoxGeometry(0.13, 0.79, 0.14).translate(0, -0.395, 0), 2, true);
  const feet = mk(new THREE.BoxGeometry(0.22, 0.08, 0.12).translate(0.04, -0.82, 0), 2, false);
  const arms = mk(new THREE.BoxGeometry(0.085, 0.5, 0.09).translate(0, -0.25, 0), 2, false);
  const hands = mk(new THREE.BoxGeometry(0.075, 0.09, 0.07).translate(0, -0.55, 0), 2, false);
  const pack = mk(new THREE.BoxGeometry(0.15, 0.36, 0.28).translate(-0.18, 1.14, 0), 1, false);
  const umbrella = mk(new THREE.LatheGeometry(V([[0.012, 0], [0.012, 0.9], [0.55, 0.9], [0.32, 1.04], [0, 1.1]]), 8), 1, true);
  const all = [torso, head, hair, hijab, legs, feet, arms, hands, pack, umbrella];
  return {
    /** st = { x, z, h, y, scale, phase, moving, body, skin, pants, rain? (0 sampai 1) } */
    set(i, st) {
      const t = traits(st.body);
      const sc = st.scale || 1;
      const s = st.moving ? Math.sin(st.phase) : 0;
      const bob = st.moving ? Math.abs(Math.cos(st.phase)) * 0.03 * sc : 0;
      _q.setFromAxisAngle(_up, -st.h);
      _p.set(st.x, (st.y || 0) + bob, st.z);
      _M.compose(_p, _q, _s.setScalar(sc));
      torso.setMatrixAt(i, _M);
      torso.setColorAt(i, st.body);
      head.setMatrixAt(i, _M);
      head.setColorAt(i, st.skin);
      hair.setMatrixAt(i, t.hijab ? ZERO : _M);
      hair.setColorAt(i, t.hair);
      hijab.setMatrixAt(i, t.hijab ? _M : ZERO);
      hijab.setColorAt(i, t.scarf);
      pack.setMatrixAt(i, t.pack ? _M : ZERO);
      pack.setColorAt(i, t.bag);
      const u = t.umbrella ? Math.min(1, (+st.rain || 0) * 2.5) : 0;
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        const j = i * 2 + k;
        joint(0, 0.86, 0.085 * side, -0.5 * s * side, 0);
        legs.setMatrixAt(j, _L);
        feet.setMatrixAt(j, _L);
        legs.setColorAt(j, st.pants);
        feet.setColorAt(j, t.shoe);
        let a = 0.4 * s * side;
        if (side > 0) a += (0.55 - a) * u; // tangan kanan memegang payung
        joint(0, 1.35, 0.2 * side, a, -0.08 * side);
        arms.setMatrixAt(j, _L);
        hands.setMatrixAt(j, _L);
        arms.setColorAt(j, st.body);
        hands.setColorAt(j, st.skin);
      }
      // payung: tertutup (tidak tampak) saat kering, mekar di atas kepala saat hujan
      if (u > 0) {
        _R.makeRotationZ(0.25).scale(_s.set(u, 0.5 + 0.5 * u, u)).setPosition(0.29, 0.88, 0.2);
        umbrella.setMatrixAt(i, _L.multiplyMatrices(_M, _R));
      } else umbrella.setMatrixAt(i, ZERO);
      umbrella.setColorAt(i, t.umb);
    },
    commit(n) {
      for (const m of all) {
        m.count = m.instanceMatrix.count > capacity ? n * 2 : n;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    },
  };
}
