// Penghalus gambar deteksi. Persepsi berjalan 10 kali per detik, sedangkan layar 60 kali per
// detik. Tanpa penghalus, setiap kotak dan titik deteksi melompat setiap pindaian dan tampak
// berkedip. Di sini posisi gambar bergeser halus dari hasil pindaian sebelumnya ke hasil yang baru,
// deteksi baru muncul pelan-pelan, dan deteksi yang hilang memudar sebentar. Angka pada label
// (kecepatan radar, persen keyakinan) diratakan ringan supaya tidak berganti setiap pindaian.
//
// Deteksi yang berasal dari objek bergerak ditempelkan pada objek itu (anchor): yang digeser halus
// adalah selisih deteksi terhadap objek, jadi galat sensornya tetap terlihat, tetapi kotak tidak
// tertinggal di belakang kendaraan yang melaju. Cara ini mirip kompensasi gerak pada tampilan
// diagnosis mobil uji.
//
// Ini hanya cara menggambar. Model persepsi dan tugas tetap memakai hasil pindaian apa adanya.

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerpBox = (f, t, u) => (f && t ? { minX: f.minX + (t.minX - f.minX) * u, minY: f.minY + (t.minY - f.minY) * u, maxX: f.maxX + (t.maxX - f.maxX) * u, maxY: f.maxY + (t.maxY - f.maxY) * u } : t);
const shiftBox = (b, x, y) => (b ? { minX: b.minX + x, minY: b.minY + y, maxX: b.maxX + x, maxY: b.maxY + y } : null);

/**
 * opts: { move (detik geser, bawaan 0,12), fadeIn (0,15), fadeOut (0,3), smooth (bobot rata-rata angka, 0,35) }
 * Hasil: { scan(list, now), items(now), get(key, now), clear() }
 *   list: [{ key, x, y, det, anchor?, box?, value? }]  box = { minX, minY, maxX, maxY } (ikut digeser halus)
 */
export function createSmoother({ move = 0.12, fadeIn = 0.15, fadeOut = 0.3, smooth = 0.35 } = {}) {
  const map = new Map();
  let lastNow = -Infinity;

  // posisi relatif (selisih terhadap anchor) atau absolut bila tanpa anchor
  function rel(e, now) {
    const u = ease((now - e.t0) / move);
    return { x: e.fx + (e.tx - e.fx) * u, y: e.fy + (e.ty - e.fy) * u, u };
  }
  function base(e) {
    const a = e.anchor;
    return a && !a.gone ? { x: a.x, y: a.y } : e.lastBase;
  }
  function pos(e, now) {
    const r = rel(e, now);
    const b = base(e);
    return { x: b.x + r.x, y: b.y + r.y, u: r.u };
  }

  const boxAt = (e, u, b) => shiftBox(lerpBox(e.fbox, e.tbox, u), b.x, b.y);

  return {
    /**
     * Masukkan hasil satu pindaian: [{ key, x, y, det, anchor?, box?, value? }].
     * anchor = objek yang diukur (punya x, y yang terus bergerak). Kunci yang tidak muncul lagi mulai memudar.
     */
    scan(list, now) {
      if (now < lastNow - 1e-6) map.clear(); // waktu mundur (Ulangi)
      lastNow = now;
      const seen = new Set();
      for (const it of list) {
        seen.add(it.key);
        const anchor = it.anchor || null;
        const bx = anchor ? anchor.x : 0;
        const by = anchor ? anchor.y : 0;
        const ox = it.x - bx;
        const oy = it.y - by;
        const box = shiftBox(it.box, -bx, -by);
        let e = map.get(it.key);
        if (!e || e.anchor !== anchor) {
          e = { fx: ox, fy: oy, tx: ox, ty: oy, t0: now, born: now, gone: null, det: it.det, fbox: null, tbox: box, value: it.value, anchor, lastBase: { x: bx, y: by } };
          map.set(it.key, e);
          continue;
        }
        const r = rel(e, now);
        e.fx = r.x;
        e.fy = r.y;
        e.tx = ox;
        e.ty = oy;
        e.fbox = lerpBox(e.fbox, e.tbox, r.u);
        e.tbox = box;
        e.t0 = now;
        e.det = it.det;
        e.lastBase = { x: bx, y: by };
        if (e.gone != null) {
          e.born = now - fadeIn * Math.max(0, 1 - (now - e.gone) / fadeOut);
          e.gone = null;
        }
        if (it.value != null) e.value = e.value == null || !Number.isFinite(e.value) ? it.value : e.value + smooth * (it.value - e.value);
      }
      for (const [k, e] of map) {
        if (!seen.has(k) && e.gone == null) {
          e.gone = now;
          // saat memudar, deteksi berhenti mengikuti objek (sensor sudah tidak melihatnya)
          const p = pos(e, now);
          e.fx = e.tx = p.x;
          e.fy = e.ty = p.y;
          if (e.tbox) {
            e.tbox = boxAt(e, 1, base(e));
            e.fbox = null;
          }
          e.anchor = null;
          e.lastBase = { x: 0, y: 0 };
        }
      }
    },
    /** Daftar untuk digambar: { key, x, y, alpha, det, box, value, fading }. */
    items(now) {
      const out = [];
      for (const [k, e] of map) {
        if (e.gone != null && now - e.gone >= fadeOut) {
          map.delete(k);
          continue;
        }
        const p = pos(e, now);
        const aIn = Math.min(1, Math.max(0, (now - e.born) / fadeIn));
        const aOut = e.gone != null ? 1 - (now - e.gone) / fadeOut : 1;
        out.push({ key: k, x: p.x, y: p.y, alpha: Math.max(0, Math.min(aIn, aOut)), det: e.det, box: boxAt(e, p.u, base(e)), value: e.value, fading: e.gone != null });
      }
      return out;
    },
    /** Posisi gambar satu kunci saat ini, atau null. */
    get(key, now) {
      const e = map.get(key);
      return e ? pos(e, now) : null;
    },
    clear() {
      map.clear();
      lastNow = -Infinity;
    },
  };
}

/**
 * Titik LiDAR yang menempel pada objek bergerak. Tiap pindaian, titik pada sebuah objek disimpan
 * dalam koordinat lokal objek itu, lalu digambar pada pose objek saat ini dan memudar dalam
 * `keep` detik. Hasilnya klaster yang ikut bergerak mulus bersama objek, tanpa coretan jejak.
 * Hasil: { add(points, objectsById, now), draw(g, now, drawPts(g, points, alpha)), clear() }
 */
export function createAttachedCloud({ keep = 0.35 } = {}) {
  let scans = []; // { t, groups: Map(id -> { obj, pts: [{ lx, ly }] }) }
  return {
    add(points, byId, now) {
      if (scans.length && now < scans[scans.length - 1].t - 1e-6) scans = [];
      const groups = new Map();
      for (const p of points) {
        const o = byId.get(p.targetId);
        if (!o) continue;
        let gp = groups.get(o.id);
        if (!gp) groups.set(o.id, (gp = { obj: o, pts: [] }));
        const c = Math.cos(o.heading || 0);
        const s = Math.sin(o.heading || 0);
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        gp.pts.push({ lx: dx * c + dy * s, ly: -dx * s + dy * c });
      }
      scans.push({ t: now, groups });
      scans = scans.filter((sc) => now - sc.t < keep);
    },
    /** drawPts(g, points, k) menggambar satu pindaian; k = 1 untuk yang terbaru, turun ke 0 saat memudar. */
    draw(g, now, drawPts) {
      for (const sc of scans) {
        const age = now - sc.t;
        if (age < -1e-6 || age >= keep) continue;
        const k = 1 - age / keep;
        const pts = [];
        for (const { obj, pts: local } of sc.groups.values()) {
          if (obj.gone) continue;
          const c = Math.cos(obj.heading || 0);
          const s = Math.sin(obj.heading || 0);
          for (const q of local) pts.push({ x: obj.x + q.lx * c - q.ly * s, y: obj.y + q.lx * s + q.ly * c });
        }
        if (pts.length) drawPts(g, pts, k);
      }
    },
    clear() {
      scans = [];
    },
  };
}
