"""QA mandiri model pelajaran Persepsi: keselamatan pejalan kaki dan waktu tunggu tugas prediksi.

Pemakaian: python3 tests/persepsi_verify_model.py [detik_per_run] [jumlah_seed]
Server: python3 tests/serve.py 8263

Pemeriksa di sini ditulis ulang tanpa memakai penghitung milik pelajaran:
  kontak      lingkaran pejalan kaki vs kotak berarah kendaraan (koordinat dunia), juga mobil parkir
  zebra       sudut kotak kendaraan (koordinat dunia, diproyeksikan ke jalan) masuk pita zebra cross
              yang sedang diseberangi
  celah       saat penyeberang mulai melangkah, semua kendaraan yang mendekat bisa berhenti sebelum
              TEPI zebra dengan rem penuh model DAN jeda aktuasi 0,25 detik
  trotoar     pejalan kaki di aspal (|d| < 3,5 m) di luar zebra, kendaraan keluar aspal
Serangan: normal, stress (padat), inject (kecepatan dipaksa vmax tiap langkah),
boost (cruise, vmax, aMax dinaikkan: perencana ngebut), resets (Ulangi berkali-kali).
"""
import json
import sys

from playwright.sync_api import sync_playwright

from persepsi_verify_util import CHROME, BASE

SIM = float(sys.argv[1]) if len(sys.argv) > 1 else 600
SEEDS = int(sys.argv[2]) if len(sys.argv) > 2 else 6

JS = r"""
async ({ sim, seeds }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const { createScene } = await import('/js/lessons/persepsi/scene.js');
  const map = await loadMap('machung');
  const street = buildStreet(map);
  const DT = 1 / 60;
  const g0 = 9.81;
  const corners = (b) => {
    const c = Math.cos(b.heading), s = Math.sin(b.heading), L = b.length / 2, W = b.width / 2;
    return [[L, W], [L, -W], [-L, -W], [-L, W]].map(([u, v]) => ({ x: b.x + u * c - v * s, y: b.y + u * s + v * c }));
  };
  // jarak titik ke kotak berarah dikurangi jari-jari (negatif = beririsan), dihitung sendiri
  function gapCircleBox(p, b) {
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    const dx = p.x - b.x, dy = p.y - b.y;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    const ex = Math.max(Math.abs(u) - b.length / 2, 0), ey = Math.max(Math.abs(v) - b.width / 2, 0);
    return Math.hypot(ex, ey) - p.radius;
  }
  function sat(a, b) {
    const ca = corners(a), cb = corners(b);
    for (const h of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
      const ax = Math.cos(h), ay = Math.sin(h);
      const pa = ca.map((p) => p.x * ax + p.y * ay), pb = cb.map((p) => p.x * ax + p.y * ay);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
    return true;
  }
  function run(seed, mode, secs) {
    const scene = createScene({ street, seed });
    if (mode === 'stress' || mode === 'resets' || mode === 'boost') scene.state.stress = true;
    const o = { seed, mode, sec: secs, contacts: 0, cs: [], zebra: 0, zs: [], starts: 0, bad: 0, bs: [], pedOnRoad: 0, pr: [], vehOffRoad: 0, vr: [],
      vehCol: 0, vc: [], minGap: Infinity, maxSpeed: 0, crossings: 0 };
    const prev = new Map();
    const pairs = new Set();
    const N = Math.round(secs / DT);
    for (let i = 0; i < N; i++) {
      if (mode === 'inject') { scene.ego.v = scene.ego.vmax; for (const v of scene.traffic) v.v = v.vmax; }
      if (mode === 'boost') {
        for (const v of [scene.ego, ...scene.traffic]) if (!v._b) { v._b = 1; v.cruise = 16; v.vmax = 16; v.aMax = 4; }
      }
      if (mode === 'resets' && i % 1500 === 700) { scene.reset(); scene.state.stress = true; prev.clear(); pairs.clear(); }
      scene.update(DT);
      const veh = [scene.ego, ...scene.traffic];
      const peds = scene.peds.filter((p) => !p.gone);
      for (const v of veh) {
        o.maxSpeed = Math.max(o.maxSpeed, v.v);
        const ext = Math.abs(v.d) + v.width / 2;
        if (ext > 3.5 + 1e-6) { o.vehOffRoad++; if (o.vr.length < 3) o.vr.push({ t: +scene.state.time.toFixed(2), id: v.id, d: +v.d.toFixed(2) }); }
      }
      for (const p of peds) {
        for (const v of [...veh, ...street.parked]) {
          if (Math.hypot(v.x - p.x, v.y - p.y) > 9) continue;
          const g = gapCircleBox(p, v);
          if (g < 0) { o.contacts++; if (o.cs.length < 5) o.cs.push({ t: +scene.state.time.toFixed(2), p: p.id, role: p.role, st: p.state, v: v.id, vv: +(v.v || 0).toFixed(2), g: +g.toFixed(3) }); }
          if (v.role !== 'parked' && (v.v || 0) > 0.05 && g < o.minGap) { o.minGap = g; o.minAt = { p: p.id, role: p.role, st: p.state, v: v.id, vv: +v.v.toFixed(2), pd: +p.d.toFixed(2), vd: +v.d.toFixed(2) }; }
        }
        const onZebra = p.role === 'crosser' && p.state === 'cross';
        if (!onZebra && Math.abs(p.d) < 3.5) { o.pedOnRoad++; if (o.pr.length < 3) o.pr.push({ t: +scene.state.time.toFixed(2), p: p.id, role: p.role, st: p.state, d: +p.d.toFixed(2) }); }
        const was = prev.get(p.id);
        if (p.role === 'crosser' && was !== 'cross' && p.state === 'cross') {
          o.starts++;
          const cw = p.cw;
          for (const v of veh) {
            // posisi s tiap sudut kotak (dunia -> jalan), bukan s pusat kendaraan
            const ss = corners(v).map((c) => street.frenet(c.x, c.y, v.s, 20).s);
            const lo = Math.min(...ss), hi = Math.max(...ss);
            const nearEdge = v.dir > 0 ? cw.s - cw.half : cw.s + cw.half;
            const frontS = v.dir > 0 ? hi : lo;
            const rearS = v.dir > 0 ? lo : hi;
            if (v.dir * (rearS - (cw.s + v.dir * cw.half)) > 0) continue; // sudah lewat
            const dist = v.dir * (nearEdge - frontS);
            const a = Math.min(v.aBrake, 0.7 * g0);
            const need = (v.v * v.v) / (2 * a) + v.v * 0.25;
            if (dist < need) { o.bad++; if (o.bs.length < 5) o.bs.push({ t: +scene.state.time.toFixed(2), p: p.id, v: v.id, dist: +dist.toFixed(2), need: +need.toFixed(2), vv: +v.v.toFixed(2) }); }
          }
        }
        prev.set(p.id, p.state);
      }
      for (const cw of street.crosswalks) {
        if (!scene.peds.some((p) => p.role === 'crosser' && p.cw === cw && p.state === 'cross')) continue;
        for (const v of veh) {
          if (Math.abs(v.s - cw.s) > 12) continue;
          const ss = corners(v).map((c) => street.frenet(c.x, c.y, v.s, 20).s);
          if (Math.max(...ss) > cw.s - cw.half && Math.min(...ss) < cw.s + cw.half) {
            o.zebra++; if (o.zs.length < 3) o.zs.push({ t: +scene.state.time.toFixed(2), cw: cw.id, v: v.id, vv: +v.v.toFixed(2) });
          }
        }
      }
      const now = new Set();
      for (let a = 0; a < veh.length; a++) for (let b = a + 1; b < veh.length; b++) {
        if (Math.hypot(veh[a].x - veh[b].x, veh[a].y - veh[b].y) > 6) continue;
        if (sat(veh[a], veh[b])) now.add(veh[a].id + '|' + veh[b].id);
      }
      for (const k of now) if (!pairs.has(k)) { o.vehCol++; if (o.vc.length < 4) o.vc.push({ t: +scene.state.time.toFixed(2), k }); }
      pairs.clear(); for (const k of now) pairs.add(k);
    }
    o.minGap = +o.minGap.toFixed(3);
    o.maxSpeed = +o.maxSpeed.toFixed(2);
    const sf = scene.safety;
    o.lesson = { ped: sf.pedestrianContacts, red: sf.redLightViolations, other: sf.otherCollisions, brakes: sf.shieldBrakes, clamps: sf.shieldClamps, crossings: sf.crossings, boardings: sf.boardings };
    return o;
  }
  const out = [];
  for (let k = 0; k < seeds; k++) out.push(run(101 + k * 13, 'normal', sim));
  out.push(run(5, 'stress', sim));
  out.push(run(77, 'stress', sim));
  out.push(run(5, 'inject', sim / 2));
  out.push(run(91, 'inject', sim / 2));
  out.push(run(5, 'boost', sim / 2));
  out.push(run(63, 'boost', sim / 2));
  out.push(run(17, 'resets', sim / 2));
  // posisi ruas terhadap kampus
  const a = street.pose(street.route.start, 0), b = street.pose(street.route.end, 0);
  return { runs: out, route: { start: { x: +a.x.toFixed(1), y: +a.y.toFixed(1) }, end: { x: +b.x.toFixed(1), y: +b.y.toFixed(1) } }, crosswalks: street.crosswalks.map((c) => c.s), haltes: street.haltes.map((h) => h.s), parked: street.parked.length, length: street.length };
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(BASE + "tests/persepsi_verify_blank.html")
    res = page.evaluate(JS, {"sim": SIM, "seeds": SEEDS})
    browser.close()

runs = res["runs"]
keys = ["contacts", "zebra", "starts", "bad", "pedOnRoad", "vehOffRoad", "vehCol"]
tot = {k: sum(r[k] for r in runs) for k in keys}
tot["lessonPed"] = sum(r["lesson"]["ped"] for r in runs)
tot["lessonRed"] = sum(r["lesson"]["red"] for r in runs)
tot["minGap"] = min(r["minGap"] for r in runs)
tot["simSeconds"] = sum(r["sec"] for r in runs)
print(json.dumps({"runs": runs, "total": tot, "meta": {k: v for k, v in res.items() if k != "runs"}, "errors": errors}, indent=1, ensure_ascii=False))
ok = tot["contacts"] == 0 and tot["zebra"] == 0 and tot["lessonPed"] == 0 and tot["lessonRed"] == 0 and not errors
print("LULUS" if ok else "GAGAL")
