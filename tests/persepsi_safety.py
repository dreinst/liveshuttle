"""Uji keselamatan model pelajaran Persepsi (Jalan Karangampel Timur), dijalankan di browser tanpa menggambar.

Pemakaian: python3 tests/persepsi_safety.py [detik_simulasi_per_run] [jumlah_seed]
Butuh server: python3 tests/serve.py 8243

Modul street.js dan scene.js diimpor langsung, peta 'machung' dimuat, lalu dunia dijalankan
dengan dt tetap 1/60 detik. Pemeriksa di sini MANDIRI dari pemantau milik pelajaran:
  - kontak: lingkaran pejalan kaki beririsan dengan kotak kendaraan mana pun (koordinat dunia);
  - zebra dipakai: tidak ada kendaraan yang bergerak di atas zebra cross yang sedang diseberangi;
  - penerimaan celah: saat penyeberang mulai melangkah, setiap kendaraan yang mendekat masih bisa
    berhenti sebelum batas zebra dengan rem penuh yang benar-benar bisa dicapai model;
  - tabrakan kendaraan dengan kendaraan (dihitung terpisah, bukan aturan keselamatan).
Mode serangan:
  normal  lalu lintas biasa, beberapa seed;
  stress  lalu lintas padat dan penyeberang terus-menerus di semua zebra cross;
  force   setiap langkah semua kendaraan dipaksa ke kecepatan maksimum (seperti gas penuh);
  resets  Ulangi di tengah jalan berkali-kali, digabung dengan stress.
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8243/"
SIM = float(sys.argv[1]) if len(sys.argv) > 1 else 600
SEEDS = int(sys.argv[2]) if len(sys.argv) > 2 else 6

JS = r"""
async ({ sim, seeds }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const { createScene } = await import('/js/lessons/persepsi/scene.js');
  const { G } = await import('/js/engine/math.js');
  const map = await loadMap('machung');
  const street = buildStreet(map);
  const DT = 1 / 60;
  const MU = 0.7;

  function circleBox(px, py, r, b) {
    const c = Math.cos(b.heading || 0), s = Math.sin(b.heading || 0);
    const dx = px - b.x, dy = py - b.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const qx = Math.max(-b.length / 2, Math.min(b.length / 2, lx));
    const qy = Math.max(-b.width / 2, Math.min(b.width / 2, ly));
    return Math.hypot(lx - qx, ly - qy) - r;
  }
  function boxCorners(b) {
    const c = Math.cos(b.heading), s = Math.sin(b.heading), L = b.length / 2, W = b.width / 2;
    return [[L, W], [L, -W], [-L, -W], [-L, W]].map(([u, v]) => ({ x: b.x + u * c - v * s, y: b.y + u * s + v * c }));
  }
  function overlap(a, b) {
    const ca = boxCorners(a), cb = boxCorners(b);
    for (const h of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
      const ax = Math.cos(h), ay = Math.sin(h);
      const pa = ca.map((p) => p.x * ax + p.y * ay), pb = cb.map((p) => p.x * ax + p.y * ay);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
  }

  function run(seed, mode) {
    const scene = createScene({ street, seed });
    if (mode === 'stress' || mode === 'resets') scene.state.stress = true;
    const out = { seed, mode, ticks: 0, contacts: 0, contactSamples: [], zebraIntrusions: 0, zebraSamples: [], minGapMoving: Infinity,
      crossStarts: 0, badStarts: 0, badStartSamples: [], vehCollisions: 0, colSamples: [], passes: 0, egoStops: 0, laps: 0, resets: 0 };
    const prevState = new Map();
    const passSeen = new Set();
    const colPairs = new Set();
    let wasStopped = false;
    const N = Math.round(sim / DT);
    for (let i = 0; i < N; i++) {
      if (mode === 'force') {
        scene.ego.v = scene.ego.vmax;
        for (const v of scene.traffic) v.v = v.vmax;
      }
      if (mode === 'resets' && i % 1777 === 900) { scene.reset(); scene.state.stress = true; out.resets++; prevState.clear(); colPairs.clear(); }
      scene.update(DT);
      out.ticks++;
      const vehicles = [scene.ego, ...scene.traffic];
      const all = [...vehicles, ...street.parked];
      const peds = scene.peds.filter((p) => !p.gone);
      for (const p of peds) {
        for (const v of all) {
          if (Math.hypot(v.x - p.x, v.y - p.y) > 8) continue;
          const g = circleBox(p.x, p.y, p.radius, v);
          if (g < 0) {
            out.contacts++;
            if (out.contactSamples.length < 5) out.contactSamples.push({ t: +scene.state.time.toFixed(2), ped: p.id, role: p.role, st: p.state, veh: v.id, vs: +(v.v || 0).toFixed(2), g: +g.toFixed(3) });
          }
          if (v.role !== 'parked' && (v.v || 0) > 0.05) out.minGapMoving = Math.min(out.minGapMoving, g);
        }
        // penerimaan celah saat penyeberang baru melangkah (rem penuh yang bisa dicapai model)
        const prev = prevState.get(p.id);
        if (p.role === 'crosser' && prev === 'wait' && p.state === 'cross') {
          out.crossStarts++;
          const cw = p.cw;
          for (const v of vehicles) {
            const front = v.s + v.dir * v.length / 2;
            const rear = v.s - v.dir * v.length / 2;
            const edge = cw.s - v.dir * cw.half;
            const dist = v.dir * (edge - front);
            const passed = v.dir * (rear - (cw.s + v.dir * cw.half)) > 0;
            if (passed) continue;
            const a = Math.min(v.aBrake, MU * G);
            const need = (v.v * v.v) / (2 * a);
            if (dist < need) {
              out.badStarts++;
              if (out.badStartSamples.length < 5) out.badStartSamples.push({ t: +scene.state.time.toFixed(2), ped: p.id, veh: v.id, dist: +dist.toFixed(2), need: +need.toFixed(2), v: +v.v.toFixed(2) });
            }
          }
        }
        prevState.set(p.id, p.state);
      }
      // zebra cross yang sedang diseberangi: tidak boleh ada kendaraan bergerak di atasnya
      for (const cw of street.crosswalks) {
        if (!scene.occupied(cw)) continue;
        for (const v of vehicles) {
          const lo = Math.min(v.s - v.length / 2, v.s + v.length / 2), hi = Math.max(v.s - v.length / 2, v.s + v.length / 2);
          if (hi > cw.s - cw.half && lo < cw.s + cw.half && v.v > 0.01) {
            out.zebraIntrusions++;
            if (out.zebraSamples.length < 5) out.zebraSamples.push({ t: +scene.state.time.toFixed(2), cw: cw.id, veh: v.id, v: +v.v.toFixed(2) });
          }
        }
      }
      // tabrakan kendaraan dengan kendaraan
      const now = new Set();
      for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) {
        const A = vehicles[a], B = vehicles[b];
        if (Math.hypot(A.x - B.x, A.y - B.y) > 7) continue;
        if (overlap(A, B)) now.add(A.id + '|' + B.id);
      }
      for (const k of now) if (!colPairs.has(k)) { out.vehCollisions++; if (out.colSamples.length < 5) out.colSamples.push({ t: +scene.state.time.toFixed(2), pair: k }); }
      colPairs.clear(); for (const k of now) colPairs.add(k);
      for (const v of scene.traffic) if (v.mode === 'pass' && !passSeen.has(v.id)) { passSeen.add(v.id); out.passes++; }
      const stopped = scene.ego.v < 0.05;
      if (stopped && !wasStopped) out.egoStops++;
      wasStopped = stopped;
    }
    out.laps = scene.state.lap;
    out.minGapMoving = +out.minGapMoving.toFixed(3);
    const sf = scene.safety;
    out.lessonMonitor = { redLightViolations: sf.redLightViolations, pedestrianContacts: sf.pedestrianContacts, otherCollisions: sf.otherCollisions,
      shieldBrakes: sf.shieldBrakes, shieldClamps: sf.shieldClamps, vehicleClamps: sf.vehicleClamps, crossings: sf.crossings, boardings: sf.boardings, gapWaits: sf.gapWaits };
    return out;
  }

  const results = [];
  for (let k = 0; k < seeds; k++) results.push(run(11 + k * 7, 'normal'));
  results.push(run(11, 'stress'));
  results.push(run(29, 'stress'));
  results.push(run(11, 'force'));
  results.push(run(47, 'force'));
  results.push(run(13, 'resets'));
  return results;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(BASE + "js/data/")
    res = page.evaluate(JS, {"sim": SIM, "seeds": SEEDS})
    browser.close()

total = {k: sum(r[k] for r in res) for k in ("contacts", "zebraIntrusions", "badStarts", "crossStarts", "vehCollisions", "passes")}
total["boardings"] = sum(r["lessonMonitor"]["boardings"] for r in res)
total["minGapMoving"] = min(r["minGapMoving"] for r in res)
total["lessonPedContacts"] = sum(r["lessonMonitor"]["pedestrianContacts"] for r in res)
total["lessonRedLight"] = sum(r["lessonMonitor"]["redLightViolations"] for r in res)
total["simSeconds"] = round(sum(r["ticks"] for r in res) / 60)
# halaman kosong untuk menjalankan modul (daftar isi folder) meminta favicon.ico yang memang tidak ada
errors = [e for e in errors if "status of 404" not in e]
print(json.dumps({"runs": res, "total": total, "errors": errors}, indent=1, ensure_ascii=False))
ok = total["contacts"] == 0 and total["lessonPedContacts"] == 0 and total["zebraIntrusions"] == 0 and total["lessonRedLight"] == 0
print("LULUS" if ok else "GAGAL")
sys.exit(0 if ok else 1)
