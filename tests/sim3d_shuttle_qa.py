"""QA tahap shuttle Shuttle 3D Ma Chung (satu skrip).

Pemakaian: python3 tests/serve.py 8202 (latar), lalu python3 tests/sim3d_shuttle_qa.py [gpu|swift]

Bagian:
1. Autopilot 20 menit simulasi (cuaca berganti sendiri): berhenti tepat di halte, penumpang naik turun.
2. Jalan ditutup di rute: rute dihitung ulang. Kendaraan parkir dan galian di depan: dilewati atau ditunggu.
3. Aturan keselamatan secara adversarial, di tiap cuaca, batas 40 km/jam:
   a. manual gas penuh lurus ke garis henti lampu (banyak percobaan di tiap lengan lampu),
   b. manual gas penuh ke pejalan kaki uji yang menyeberang,
   c. manual gas penuh dengan setir acak keliling kota,
   d. autopilot dengan pejalan kaki uji dipanggil berulang.
   Pencacah "Terobos lampu merah" dan "Kontak dengan pejalan kaki" harus tetap 0.
4. Waktu nyata 4x dengan tampilan: kemudi manual lewat papan ketik (M, panah), tombol di layar,
   tampilan sensor, tangkapan layar desktop dan ponsel, galat konsol, lalu destroy.
"""
import random
import sys
import time

from sim3d_shuttle_common import GPU, SWIFT, CHROME, dbg, open_harness, shot, snap, sync_playwright, new_page

MODE = sys.argv[1] if len(sys.argv) > 1 else "gpu"
WEATHERS = ["cerah", "hujan", "kabut", "malam"]
FAIL = []


def check(ok, what):
    print(("OK   " if ok else "GAGAL"), what)
    if not ok:
        FAIL.append(what)


def inv(s):
    return s["invariants"]["redLight"], s["invariants"]["pedContact"]


# JS: satu percobaan lampu merah per lengan, bumper depan dicatat terhadap garis henti
RED_JS = """(cfg) => {
  const S = () => window.__sim3d; const d = S().debug;
  d.setWeather(cfg.wx); d.speedLimit(40);
  for (let k = 0; k < 600 && !d.setManual(true).ok; k++) d.runSteps(30);
  const out = { placed: 0, redStops: 0, crossedGreen: 0, maxKmh: 0, minRedGap: 99 };
  const arms = d.signalArms();
  for (let t = 0; t < cfg.n; t++) {
    const a = arms[t % arms.length];
    const ux = Math.cos(a.h), uz = Math.sin(a.h);
    let ok = false;
    for (const D of [75, 55, 40]) {
      for (const lat of [0, -1.5, 1.5, -2.8]) if (!ok && d.placeShuttle(a.x - ux * D - uz * lat, a.z - uz * D + ux * lat, a.h)) ok = true;
      if (ok) break;
    }
    if (!ok) continue;
    out.placed++;
    d.drive({ up: 0, down: 0, left: 0, right: 0 });
    d.runSteps(1 + ((t * 137) % 900));
    d.drive({ up: 1 });
    let stopped = false;
    for (let k = 0; k < 900; k += 10) {
      d.runSteps(10);
      const sh = S().shuttle;
      out.maxKmh = Math.max(out.maxKmh, sh.speedKmh);
      const col = d.signalArms().find((q) => q.ctl === a.ctl && q.arm === a.arm).color;
      const q = (sh.x + Math.cos(sh.heading) * 3 - a.x) * ux + (sh.z + Math.sin(sh.heading) * 3 - a.z) * uz;
      if (col === 'red' && q < 0 && q > -15) out.minRedGap = Math.min(out.minRedGap, -q);
      if (col === 'red' && sh.speedKmh < 0.5 && q < 0 && q > -8) stopped = true;
      if (q > 3) { if (col === 'green') out.crossedGreen++; break; }
    }
    if (stopped) out.redStops++;
  }
  d.drive({ up: 0 });
  return out;
}"""

# JS: manual gas penuh di lajur lurus, pejalan kaki uji menyeberang di depan
PED_JS = """(cfg) => {
  const S = () => window.__sim3d; const d = S().debug;
  d.setWeather(cfg.wx); d.speedLimit(40);
  for (let k = 0; k < 600 && !d.setManual(true).ok; k++) d.runSteps(30);
  const poses = d.lanePoses().filter((q) => q.len > 110);
  const out = { tries: 0, spawned: 0, refused: {}, stopsForPed: 0, maxKmhAtSpawn: 0, minKmhAtSpawn: 99 };
  for (let t = 0; t < cfg.n; t++) {
    const p = poses[(t * 7 + cfg.seed) % poses.length];
    if (!d.placeShuttle(p.x, p.z, p.h)) continue;
    d.drive({ up: 1, down: 0, left: 0, right: 0 });
    out.tries++;
    // gas penuh dulu sampai cepat, baru pejalan kaki uji dipanggil tepat di depan
    for (let k = 0; k < 60 && S().shuttle.speedKmh < 36; k++) d.runSteps(10);
    let r = null;
    for (let k = 0; k < 40 && !(r && r.ok); k++) {
      d.runSteps(2 + (k % 5));
      r = d.spawnCrossing();
      if (!r.ok) out.refused[r.reason] = (out.refused[r.reason] || 0) + 1;
    }
    if (!(r && r.ok)) continue;
    out.spawned++;
    out.maxKmhAtSpawn = Math.max(out.maxKmhAtSpawn, S().shuttle.speedKmh);
    out.minKmhAtSpawn = Math.min(out.minKmhAtSpawn, S().shuttle.speedKmh);
    const i0 = S().shuttle.stats.interventions;
    for (let k = 0; k < 20; k++) {
      d.runSteps(30);
      // pejalan kaki kedua langsung sesudah yang pertama (berulang)
      if (k === 3) d.spawnCrossing();
    }
    if (S().shuttle.stats.interventions > i0) out.stopsForPed++;
  }
  d.drive({ up: 0 });
  return out;
}"""

# JS: manual gas penuh dengan setir acak
RAND_JS = """(cfg) => {
  const S = () => window.__sim3d; const d = S().debug;
  d.setWeather(cfg.wx); d.speedLimit(40);
  for (let k = 0; k < 600 && !d.setManual(true).ok; k++) d.runSteps(30);
  const poses = d.lanePoses();
  let seed = cfg.seed;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = { legs: 0, dist0: S().shuttle.stats.manualDist, curb0: S().shuttle.stats.curb, maxKmh: 0 };
  for (let t = 0; t < cfg.n; t++) {
    const p = poses[Math.floor(rnd() * poses.length)];
    if (!d.placeShuttle(p.x, p.z, p.h)) continue;
    out.legs++;
    for (let k = 0; k < 12; k++) {
      const r = rnd();
      d.drive({ up: r < 0.85 ? 1 : 0, down: r >= 0.85 ? 1 : 0, left: rnd() < 0.3 ? 1 : 0, right: rnd() < 0.3 ? 1 : 0 });
      d.runSteps(60 + Math.floor(rnd() * 60));
      out.maxKmh = Math.max(out.maxKmh, S().shuttle.speedKmh);
    }
  }
  d.drive({ up: 0, down: 0, left: 0, right: 0 });
  out.dist = S().shuttle.stats.manualDist - out.dist0;
  out.curb = S().shuttle.stats.curb - out.curb0;
  return out;
}"""


def physics_part(browser):
    ctx, page, log = new_page(browser)
    open_harness(page, "jelajah")
    page.click("button.s3d-pause")  # tampilan dijeda, fisika dijalankan lewat runSteps

    # 1. autopilot
    t0 = time.time()
    for _ in range(40):
        dbg(page, "d.runSteps(1800)")
    s = snap(page)
    sh = s["shuttle"]
    print(f"   20 menit simulasi dalam {time.time() - t0:.1f} s, cuaca berganti {s['weather']['changes']} kali, halte {sh['stats']['stops']}, galat henti {sh['stats']['stopErr']}, naik {sh['boarded']}, turun {sh['alighted']}")
    check(sh["stats"]["stops"] >= 5, "autopilot berhenti di minimal 5 halte dalam 20 menit")
    check(all(abs(e) < 0.3 for e in sh["stats"]["stopErr"]), "berhenti tepat di halte (galat < 0,3 m)")
    check(sh["boarded"] > 0 and sh["alighted"] > 0, "penumpang naik dan turun")
    check(s["weather"]["changes"] >= 4, "cuaca berganti otomatis tiap 5 menit")
    check(inv(s) == (0, 0), f"pencacah keselamatan 0 selama autopilot {inv(s)}")
    nav = s["nav"]
    check(bool(nav["next"]) and nav["etaMin"] is not None and nav["legLen"] > 0, f"navigasi: {nav['next'] and nav['next']['banner']}, ETA {nav['etaMin']} menit")

    # 2a. jalan ditutup di rute
    while not (snap(page)["shuttle"]["state"] == "melaju" and snap(page)["nav"]["remaining"] > 350):
        dbg(page, "d.runSteps(120)")
    v0 = snap(page)["nav"]["version"]
    r = dbg(page, "d.closeAhead(90)")
    s = snap(page)
    route = dbg(page, "d.egoRoute()")
    print("   tutup jalan:", r.get("name"), "versi rute", v0, "->", s["nav"]["version"], "reroute", s["shuttle"]["stats"]["reroutes"])
    check(r.get("ok") and s["nav"]["version"] > v0, "rute dihitung ulang setelah jalan di rute ditutup")
    dbg(page, "d.runSteps(3600)")
    check(snap(page)["shuttle"]["state"] in ("melaju", "di-halte"), "shuttle tetap berjalan setelah reroute")
    if r.get("ok"):
        dbg(page, f"d.openRoad({r['roadId']})")

    # 2b. kendaraan parkir dan galian di depan
    for kind in ("parkir", "galian"):
        placed = None
        for _ in range(30):
            placed = dbg(page, f"d.obstacle('{kind}')")
            if placed.get("ok"):
                break
            dbg(page, "d.runSteps(300)")
        p0 = snap(page)["shuttle"]["stats"]["passes"]
        saw_wait = False
        for _ in range(60):
            dbg(page, "d.runSteps(60)")
            sh = snap(page)["shuttle"]
            saw_wait = saw_wait or sh["reason"] == "menunggu-lawan"
            if sh["stats"]["passes"] > p0:
                break
        dbg(page, "d.runSteps(900)")
        sh = snap(page)["shuttle"]
        print(f"   {kind}: dipasang {placed.get('ok')} ({placed.get('reason')}), dilewati {sh['stats']['passes'] - p0}, sempat menunggu {saw_wait}, tabrakan {sh['stats']['collisions']}")
        check(placed.get("ok") and (sh["stats"]["passes"] > p0 or saw_wait), f"{kind}: shuttle melewati atau menunggu dengan aman")
        dbg(page, "d.clearObstacles()")
    check(snap(page)["shuttle"]["stats"]["collisions"] == 0, "autopilot tidak menabrak penghalang")

    # 3d. autopilot + pejalan kaki uji berulang, tiap cuaca
    for wx in WEATHERS:
        dbg(page, f"d.setWeather('{wx}')")
        ok = 0
        for _ in range(60):
            if dbg(page, "d.spawnCrossing()").get("ok"):
                ok += 1
            dbg(page, "d.runSteps(90)")
        s = snap(page)
        print(f"   autopilot {wx}: {ok} pejalan kaki uji, perisai {s['shield']['shuttle']}, inv {inv(s)}")
        check(inv(s) == (0, 0), f"autopilot {wx}: 0 terobos merah, 0 kontak")

    # 3a-c. manual adversarial, tiap cuaca
    ped_stops = 0
    for i, wx in enumerate(WEATHERS):
        red = page.evaluate(RED_JS, {"wx": wx, "n": 16})
        ped = page.evaluate(PED_JS, {"wx": wx, "n": 12, "seed": i * 3})
        rnd = page.evaluate(RAND_JS, {"wx": wx, "n": 8, "seed": 11 + i})
        s = snap(page)
        print(f"   manual {wx}: lampu {red}")
        print(f"      pejalan {ped}")
        print(f"      acak {rnd}")
        check(inv(s) == (0, 0), f"manual {wx}: pencacah tetap 0 {inv(s)}")
        check(red["redStops"] > 0 and red["maxKmh"] > 30, f"manual {wx}: perisai menghentikan shuttle di lampu merah")
        check(ped["spawned"] > 0 and ped["maxKmhAtSpawn"] > 35, f"manual {wx}: pejalan kaki uji menyeberang di depan shuttle yang melaju di atas 35 km/jam")
        ped_stops += ped["stopsForPed"]
    check(ped_stops > 0, f"perisai mengerem shuttle manual untuk pejalan kaki uji ({ped_stops} kali)")
    s = snap(page)
    print("   log perisai:", s["shield"]["log"])
    check(s["shield"]["shuttle"] > 0 and s["shuttle"]["stats"]["manualInterventions"] > 0, "intervensi perisai tercatat saat mengemudi manual")
    check(s["render"]["droppedSteps"] == 0, "tidak ada langkah fisika yang dibuang")
    errs = [l for l in log if "shader" not in l.lower() and "useProgram" not in l]
    check(not errs, f"tanpa galat konsol (fisika) {errs[:3]}")
    ctx.close()


def render_part(browser):
    ctx, page, log = new_page(browser)
    open_harness(page, "jelajah")
    page.wait_for_timeout(1500)
    shot(page, "desktop_drone.png")
    page.keyboard.press("1")
    page.wait_for_timeout(1500)
    shot(page, "desktop_kabin.png")
    page.keyboard.press("2")
    page.click("text=Detail")
    page.keyboard.press("l")
    page.wait_for_timeout(2500)
    s = snap(page)
    check(s["sensors"]["view"] == "detail" and s["sensors"]["rays"] and s["sensors"]["pointsPerSec"] > 0, f"tampilan sensor Detail dan sinar LiDAR ({s['sensors']['pointsPerSec']} titik/detik)")
    check(len(s["sensors"]["tracks"]) > 0 and all(t["d"] >= 0 for t in s["sensors"]["tracks"]), f"objek dilacak: {s['sensors']['tracks'][:3]}")
    print("   lapisan:", s["sensors"]["layers"])
    shot(page, "desktop_sensor_detail.png")
    page.click("text=Tenang")
    page.keyboard.press("l")
    # tunggu shuttle berhenti di halte dengan pintu terbuka
    page.click("button.s3d-speed >> text=4x")
    for _ in range(120):
        sh = snap(page)["shuttle"]
        if sh["state"] == "di-halte" and sh["door"] > 0.9:
            break
        page.wait_for_timeout(500)
    page.click("button.s3d-speed >> text=1x")
    shot(page, "desktop_halte.png")
    check(snap(page)["shuttle"]["state"] == "di-halte", "tangkapan layar di halte dengan pintu terbuka")

    # 4. waktu nyata 4x, kemudi manual lewat papan ketik, hujan
    dbg(page, "d.setWeather('hujan')")
    page.click("button.s3d-speed >> text=4x")
    for _ in range(40):
        if snap(page)["shuttle"]["state"] == "melaju":
            break
        page.wait_for_timeout(500)
    page.keyboard.press("m")
    page.wait_for_timeout(300)
    check(snap(page)["shuttle"]["mode"] == "manual", "tombol M mengambil kemudi")
    check(page.is_visible(".s3d-pad"), "tombol kemudi di layar tampil saat manual")
    random.seed(3)
    t0 = time.time()
    fps = []
    slow = 0
    while time.time() - t0 < 40:
        if slow >= 2:  # tertahan tepi jalan: mundur sebentar seperti pengemudi sungguhan
            page.keyboard.up("ArrowUp")
            page.keyboard.down("ArrowDown")
            page.wait_for_timeout(1500)
            page.keyboard.up("ArrowDown")
            slow = 0
        page.keyboard.down("ArrowUp")
        k = random.choice(["ArrowLeft", "ArrowRight", None, None])
        if k:
            page.keyboard.down(k)
        page.wait_for_timeout(700)
        if k:
            page.keyboard.up(k)
        if random.random() < 0.3:
            dbg(page, "d.requestCrossing()")
        s = snap(page)
        fps.append(s["render"]["fps"])
        slow = slow + 1 if s["shuttle"]["speedKmh"] < 1 else 0
    page.keyboard.up("ArrowUp")
    s = snap(page)
    print(f"   manual 4x waktu nyata: jarak {s['shuttle']['stats']['manualDist']:.0f} m, perisai {s['shuttle']['stats']['manualInterventions']}, fps rata-rata {sum(fps) / len(fps):.0f}, min {min(fps):.0f}")
    check(inv(s) == (0, 0), f"manual 4x waktu nyata: pencacah 0 {inv(s)}")
    shot(page, "desktop_manual_4x.png")
    page.keyboard.press("m")
    page.keyboard.press("Space")
    page.keyboard.press("Shift+?")
    page.wait_for_timeout(300)
    check(page.is_visible(".s3d-help") and "Ambil kemudi" in page.inner_text(".s3d-help"), "bantuan ? mencantumkan pintasan shuttle")
    page.keyboard.press("Escape")
    errs = [l for l in log if "shader" not in l.lower() and "useProgram" not in l]
    check(not errs, f"tanpa galat konsol (desktop) {errs[:3]}")
    page.evaluate("() => window.__harness.destroy()")
    check(page.evaluate("() => !window.__sim3d && !document.querySelector('.s3d')"), "destroy membersihkan simulator")
    ctx.close()

    ctx, page, log = new_page(browser, mobile=True)
    open_harness(page, "jelajah")
    page.click(".s3d-sheet-tab >> text=Kendali")
    page.click("text=Ambil kemudi")
    page.wait_for_timeout(1200)
    shot(page, "mobile_kendali.png")
    box = page.locator(".s3d-pad-btn[data-k='up']").bounding_box()
    check(box and box["height"] >= 40, "tombol kemudi di ponsel cukup besar")
    errs = [l for l in log if "shader" not in l.lower() and "useProgram" not in l]
    check(not errs, f"tanpa galat konsol (ponsel) {errs[:3]}")
    ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=SWIFT if MODE == "swift" else GPU)
    t0 = time.time()
    physics_part(b)
    render_part(b)
    b.close()
    print(f"\nSelesai dalam {time.time() - t0:.0f} s, jalur {MODE}. Gagal: {len(FAIL)}")
    for f in FAIL:
        print("  -", f)
    sys.exit(1 if FAIL else 0)
