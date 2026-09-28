"""Uji serang aturan keselamatan Shuttle 3D dengan pemantau geometri independen.

Pemakaian: python3 tests/qa-akhir_safety3d.py [PORT] [menit_acak_per_cuaca] [seed]
Butuh server tests/serve.py di PORT (bawaan 8250). Simulasi dijeda lalu dijalankan langkah demi
langkah (1/60 detik) lewat debug.runSteps(1). Sesudah tiap langkah, pemantau di bawah ini memeriksa
sendiri (tanpa memakai penghitung simulator):
  - kotak badan setiap kendaraan vs lingkaran pejalan kaki (jari-jari 0,25 m), termasuk penumpang;
  - titik tengah bumper depan kendaraan melewati garis henti lengan lampu yang merah, di mana pun
    di lebar jalan lengan itu (juga saat melawan arah atau keluar lajur).
Serangan: kemudi manual gas penuh ke tiap lengan lampu (lajur benar dan lajur lawan), pejalan kaki
uji dipanggil terus, kemudi acak dengan mundur, menepi rapat ke trotoar, lalu lintas ramai, jalan
ditutup, di empat cuaca.
"""
import json
import random
import sys
import time

from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8250"
RAND_MIN = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 7
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
WEATHERS = ["cerah", "hujan", "kabut", "malam"]

MONITOR = r"""
(() => {
  const d = window.__sim3d.debug;
  const M = window.__mon = { red: 0, contact: 0, paxTouch: 0, steps: 0, ev: [], near: 1e9, hist: [] };
  const touching = new Set();
  const hit = (v, px, pz, r) => {
    const c = Math.cos(v[2]), s = Math.sin(v[2]);
    const rx = px - v[0], rz = pz - v[1];
    const lx = rx * c + rz * s, lz = -rx * s + rz * c;
    const qx = Math.max(-v[3], Math.min(v[3], lx)), qz = Math.max(-v[4], Math.min(v[4], lz));
    return Math.hypot(lx - qx, lz - qz) - r;
  };
  M.step = (n, each) => {
    let prev = d.geo();
    for (let k = 0; k < n; k++) {
      if (each) each(k);
      d.runSteps(1);
      M.steps++;
      const cur = d.geo();
      const now = new Set();
      const e = cur.v.find((v) => v[7]);
      for (const p of cur.p) if (e && Math.abs(p[0] - e[0]) < 8 && Math.abs(p[1] - e[1]) < 8) M.hist.push({ k: M.steps, p: p[2], px: +p[0].toFixed(2), pz: +p[1].toFixed(2), ex: +e[0].toFixed(2), ez: +e[1].toFixed(2), eh: +e[2].toFixed(3), g: +hit(e, p[0], p[1], 0.25).toFixed(3) });
      if (M.hist.length > 4000) M.hist.splice(0, 2000);
      for (const v of cur.v) {
        for (const p of cur.p) {
          if (Math.abs(p[0] - v[0]) > 6 || Math.abs(p[1] - v[1]) > 6) continue;
          const g = hit(v, p[0], p[1], 0.25);
          if (v[7] && p[2] >= 0) M.near = Math.min(M.near, g);
          if (g < 0) {
            const key = v[6] + ':' + p[2] + ':' + p[0].toFixed(0);
            if (p[2] < 0) { if (Math.abs(v[5]) > 0.05) { M.paxTouch++; M.ev.push({ t: 'pax', v: v[6], sp: v[5] }); } continue; }
            now.add(v[6] + ':' + p[2]);
            if (!touching.has(v[6] + ':' + p[2])) {
              M.contact++;
              const sh = window.__sim3d.shuttle;
              M.ev.push({ t: 'kontak', veh: v[6], ego: v[7], sp: +v[5].toFixed(2), x: +p[0].toFixed(1), z: +p[1].toFixed(1), gap: +g.toFixed(3), ped: d.pedList().find((q) => q.id === p[2]), mode: sh.mode, state: sh.state, hist: M.hist.filter((h) => h.p === p[2]).slice(-8) });
            }
          }
        }
      }
      touching.clear(); for (const x of now) touching.add(x);
      const pv = new Map(prev.v.map((v) => [v[6], v]));
      for (const v of cur.v) {
        const o = pv.get(v[6]);
        if (!o) continue;
        for (let ai = 0; ai < prev.a.length; ai++) {
          const a = prev.a[ai];
          if (a[4] !== 'red') continue;
          const ux = Math.cos(a[2]), uz = Math.sin(a[2]);
          const f = (w) => { const fx = w[0] + Math.cos(w[2]) * w[3], fz = w[1] + Math.sin(w[2]) * w[3]; return [(fx - a[0]) * ux + (fz - a[1]) * uz, -(fx - a[0]) * uz + (fz - a[1]) * ux]; };
          const [q0] = f(o), [q1, lat] = f(v);
          const dot = Math.cos(v[2]) * ux + Math.sin(v[2]) * uz;
          if (q0 < 0 && q1 >= 0 && Math.abs(lat) <= a[3] && dot > 0 && Math.hypot(v[0] - o[0], v[1] - o[1]) < 3) {
            M.red++; M.ev.push({ t: 'merah', veh: v[6], ego: v[7], arm: ai, sp: +v[5].toFixed(2), dot: +dot.toFixed(2), lat: +lat.toFixed(2) });
          }
        }
      }
      prev = cur;
    }
    return { red: M.red, contact: M.contact };
  };
  return true;
})()
"""


def main():
    rng = random.Random(SEED)
    out = {"weathers": {}}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
        page = b.new_page(viewport={"width": 1366, "height": 900})
        errs = []
        page.on("console", lambda m: m.type in ("error", "warning") and "GPU stall" not in m.text and errs.append(m.text))
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.add_init_script(f"window.__sim3dSeed = {SEED};")
        page.goto(f"http://127.0.0.1:{PORT}/tests/sim3d_harness.html?mode=jelajah")
        page.wait_for_function("() => window.__sim3d && window.__sim3d.ready", timeout=120000)
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        assert page.evaluate("() => window.__sim3d.paused"), "tidak bisa dijeda"
        page.evaluate(MONITOR)
        ev = lambda js: page.evaluate(f"() => {{ const d = window.__sim3d.debug; return ({js}); }}")
        ev("d.speedLimit(40)")
        arms = ev("d.geo().a")
        poses = [q for q in ev("d.lanePoses()") if q["len"] > 60]
        t0 = time.time()
        for w in WEATHERS:
            ev(f"d.setWeather('{w}')")
            ev("d.runSteps(60 * 16)")  # biarkan cuaca selesai memudar (gesekan ikut turun)
            ev("d.setTraffic(64)")
            st = {"armRuns": 0, "armStops": 0, "pedSpawn": 0, "closures": 0}
            # (a) gas penuh ke tiap lengan lampu saat merah, dari lajur kiri (benar) dan lajur kanan (lawan)
            ev("d.setManual(true)")
            for ai, a in enumerate(arms):
                for side in (1.6, -1.6, 0.0):
                    for back in (35, 55, 80):
                        import math
                        ux, uz = math.cos(a[2]), math.sin(a[2])
                        x = a[0] - ux * back + uz * side
                        z = a[1] - uz * back - ux * side
                        if not ev(f"d.placeShuttle({x}, {z}, {a[2]})"):
                            continue
                        # tunggu lengan ini merah (atau kuning), lalu gas penuh
                        for _ in range(240):
                            if ev(f"d.geo().a[{ai}][4]") != "green":
                                break
                            page.evaluate("() => __mon.step(30)")
                        if not ev(f"d.placeShuttle({x}, {z}, {a[2]})"):
                            continue
                        ev("d.drive({ up: 1, down: 0, left: 0, right: 0 })")
                        page.evaluate("() => __mon.step(60 * 14)")
                        ev("d.drive({ up: 0 })")
                        st["armRuns"] += 1
                        s = page.evaluate("() => window.__sim3d.shuttle")
                        st["armStops"] += 1 if abs(s["speedKmh"]) < 1 else 0
                        break
            # (b) jalan lurus panjang, gas penuh, pejalan kaki uji dipanggil terus
            for q in rng.sample(poses, min(10, len(poses))):
                if not ev(f"d.placeShuttle({q['x']}, {q['z']}, {q['h']})"):
                    continue
                ev("d.drive({ up: 1, down: 0, left: 0, right: 0 })")
                page.evaluate("() => __mon.step(60 * 3)")
                for _ in range(16):
                    r = ev("d.spawnCrossing()")
                    st["pedSpawn"] += 1 if r and r.get("ok") else 0
                    page.evaluate("() => __mon.step(30)")
                ev("d.drive({ up: 0 })")
            # (c) kemudi acak (gas, rem, mundur, belok), pejalan kaki uji, jalan ditutup
            q = rng.choice(poses)
            ev(f"d.placeShuttle({q['x']}, {q['z']}, {q['h']})")
            secs = 0.0
            while secs < RAND_MIN * 60:
                inp = {"up": rng.choice([0, 1, 1, 1]), "down": rng.choice([0, 0, 0, 1]), "left": rng.choice([0, 0, 1]), "right": rng.choice([0, 0, 1])}
                ev(f"d.drive({json.dumps(inp)})")
                n = rng.randint(30, 150)
                page.evaluate(f"() => __mon.step({n}, (k) => {{ if (k % 20 === 0) window.__sim3d.debug.requestCrossing(); }})")
                secs += n / 60
            ev("d.drive({ up: 0, down: 0, left: 0, right: 0 })")
            # (c2) menepi rapat ke trotoar kiri atau kanan, lalu diam sementara pejalan kaki lewat
            for q in rng.sample(poses, min(8, len(poses))):
                if not ev(f"d.placeShuttle({q['x']}, {q['z']}, {q['h']})"):
                    continue
                side = rng.choice(["left", "right"])
                ev(f"d.drive({{ up: 1, down: 0, left: {int(side == 'left')}, right: {int(side == 'right')} }})")
                page.evaluate("() => __mon.step(60 * 4)")
                ev("d.drive({ up: 0, down: 0, left: 0, right: 0 })")
                page.evaluate("() => __mon.step(60 * 15)")
            # (d) autopilot: jalan di rute ditutup, pejalan kaki uji terus, 3 menit simulasi
            for q in rng.sample([q for q in poses if q["routable"]], 6):
                if ev(f"d.placeShuttle({q['x']}, {q['z']}, {q['h']})") and ev("d.setManual(false)")["ok"]:
                    break
            st["handback"] = page.evaluate("() => window.__sim3d.shuttle.mode") == "otomatis"
            for k in range(18):
                if k % 6 == 0:
                    r = ev("d.closeAhead(60)")
                    st["closures"] += 1 if r and r.get("ok") else 0
                page.evaluate("() => __mon.step(600, (k) => { if (k % 30 === 0) window.__sim3d.debug.requestCrossing(); })")
            s = page.evaluate("() => ({ inv: window.__sim3d.invariants, mon: { red: __mon.red, contact: __mon.contact, paxTouch: __mon.paxTouch, near: __mon.near }, shield: window.__sim3d.shield.shuttle, other: window.__sim3d.collisions })")
            st.update(s)
            out["weathers"][w] = st
            print(w, json.dumps(st, default=str)[:600], flush=True)
        mon = page.evaluate("() => ({ red: __mon.red, contact: __mon.contact, paxTouch: __mon.paxTouch, steps: __mon.steps, ev: __mon.ev.slice(0, 30) })")
        out["monitor"] = mon
        out["overlaps"] = page.evaluate("() => window.__sim3d.debugLog.filter((e) => e.type === 'tumpang-tindih')")
        out["errors"] = errs[:10]
        out["wall_s"] = round(time.time() - t0)
        b.close()
    print(json.dumps({k: out[k] for k in ("monitor", "overlaps", "errors", "wall_s")}, indent=1))
    inv = out["weathers"][WEATHERS[-1]]["inv"]
    ok = mon["red"] == 0 and mon["contact"] == 0 and mon["paxTouch"] == 0 and inv["redLight"] == 0 and inv["pedContact"] == 0 and not errs
    print("LOLOS" if ok else "GAGAL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
