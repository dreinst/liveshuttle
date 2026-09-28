"""Uji aturan keselamatan pelajaran Sensor: coba sekeras mungkin membuat kendaraan menerobos lampu merah
atau menyentuh pejalan kaki.

Bagian A (model, di browser): memuat peta 'machung' dan js/lessons/sensor/scene.js langsung, lalu menjalankan
simulasi dengan langkah tetap 1/60 detik selama ratusan detik simulasi per skenario: tahan Maju terus,
maju mundur acak, cuaca berganti terus (gesekan jalan berubah), titik mulai siklus lampu berbeda, lalu lintas
padat, pejalan kaki yang mencoba menyeberang kapan saja, perencana kendaraan latar yang "buta" (mengabaikan
lampu, zebra cross, dan pejalan kaki, sehingga hanya perisai keselamatan yang menjaga), serta mobil otonom
yang boleh melewati garis henti dan zebra cross dengan kecepatan 30 km/jam.
Pemeriksa di sini dibuat terpisah dari pemantau milik scene (geometri kotak kendaraan lawan lingkaran
pejalan kaki, dan bemper depan yang melewati garis henti saat merah), lalu dibandingkan.

Bagian B (UI): buka pelajaran, pilih 2x, tahan panah atas lama sambil mengganti cuaca, tahan Mundur,
tekan Maju dan Mundur bergantian dengan cepat, jeda dan lanjutkan, Ulangi. Penghitung window.__lessonSafety
harus tetap 0 dan bemper depan mobil otonom tidak pernah melewati garis henti.

Pemakaian: python3 tests/sensor_safety.py [detik_simulasi_per_skenario] [--ui-seconds N]
Butuh server di port 8242.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
ORIGIN = "http://127.0.0.1:8242"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
SIM_SECONDS = float(args[0]) if args else 400
UI_SECONDS = 60
if "--ui-seconds" in sys.argv:
    UI_SECONDS = float(sys.argv[sys.argv.index("--ui-seconds") + 1])

MODEL_JS = r"""
async ({ simSeconds }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { createScene } = await import('/js/lessons/sensor/scene.js');
  const map = await loadMap('machung');
  const DT = 1 / 60;
  const W = ['cerah', 'hujan', 'kabut', 'malam'];
  function boxCircle(b, cx, cy) {
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    const dx = cx - b.x, dy = cy - b.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    return Math.hypot(Math.max(Math.abs(lx) - b.length / 2, 0), Math.max(Math.abs(ly) - b.width / 2, 0));
  }
  function run(name, { seconds = simSeconds, offset = 0, driver, weatherEvery = 0, opts = {} }) {
    const sc = createScene(map, opts);
    const F = sc.frame;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const res = { name, redRuns: 0, contacts: 0, minGap: Infinity, minAt: null, maxEgoFront: -Infinity, pedCrossings: 0, redApproaches: 0 };
    const prev = new Map();
    const st = {};
    let t = offset, wi = 0, walking = new Set();
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      driver(sc, i, rnd, st);
      if (weatherEvery && i % Math.round(weatherEvery / DT) === 0) { wi = (wi + 1) % 4; sc.setWeather(W[wi]); }
      sc.update(DT, t);
      t += DT;
      const vehicles = [sc.ego, ...sc.npcs.filter((a) => a.active)];
      for (const v of vehicles) for (const p of sc.peds) {
        const g = boxCircle(v, p.x, p.y) - p.radius;
        if (g < res.minGap) { res.minGap = g; res.minAt = { t: +t.toFixed(2), vehicle: v.id, ped: p.id, pedState: p.state }; }
        if (g <= 0) res.contacts++;
      }
      for (const p of sc.peds) if (p.state === 'walk' && !walking.has(p.id)) res.pedCrossings++;
      walking = new Set(sc.peds.filter((p) => p.state === 'walk').map((p) => p.id));
      for (const v of vehicles) {
        const fx = v.x + Math.cos(v.heading) * v.length / 2, fy = v.y + Math.sin(v.heading) * v.length / 2;
        for (const L of sc.stopLines) {
          const al = (fx - L.x) * Math.cos(L.heading) + (fy - L.y) * Math.sin(L.heading);
          const lat = -(fx - L.x) * Math.sin(L.heading) + (fy - L.y) * Math.cos(L.heading);
          const key = v.id + L.id;
          const inLane = Math.cos(v.heading - L.heading) > 0.6 && Math.abs(lat) < L.halfWidth + 0.8;
          const pv = prev.get(key);
          if (inLane && pv != null && pv < 0 && al >= 0 && L.light.state === 'red') res.redRuns++;
          if (inLane && pv != null && pv < -3 && al >= -3 && L.light.state === 'red') res.redApproaches++;
          prev.set(key, inLane ? al : null);
        }
      }
      const f = F.toFrame(sc.ego.x, sc.ego.y);
      res.maxEgoFront = Math.max(res.maxEgoFront, f.s + sc.ego.length / 2);
    }
    const m = sc.safety.snapshot();
    res.monitor = { redRuns: m.redRuns, pedContacts: m.pedContacts, otherCollisions: m.otherCollisions, clamps: m.clamps, interventions: m.interventions, egoInterventions: m.egoInterventions };
    res.events = m.events.slice(0, 4);
    res.minGap = +res.minGap.toFixed(3);
    res.maxEgoFront = +res.maxEgoFront.toFixed(2);
    return res;
  }
  const hold = (s) => { s.drive.forward = true; s.drive.back = false; };
  const random = (s, i, r) => { if (i % 15 === 0) { const x = r(); s.drive.forward = x < 0.6; s.drive.back = x > 0.8; } };
  // mobil otonom yang boleh lewat: kembali ke awal setelah tertahan 1,5 detik di batas
  const loopStop = (s, st) => { if (Math.abs(s.ego.speed) < 0.01 && s.drive.forward) { st.n = (st.n || 0) + 1; if (st.n > 90) { s.egoToStart(); st.n = 0; } } else st.n = 0; };
  const out = [];
  out.push(run('tahan-maju', { driver: hold }));
  out.push(run('acak-cuaca', { driver: random, weatherEvery: 7.3 }));
  for (const off of [5.5, 13, 21.7, 29.9]) out.push(run('tahan-maju-mulai-' + off, { seconds: simSeconds / 2, offset: off, driver: hold, weatherEvery: 11 }));
  out.push(run('padat-6', { driver: random, weatherEvery: 9.1, opts: { extraTraffic: 6 } }));
  out.push(run('padat-12-pejalan-kapan-saja', { driver: hold, weatherEvery: 5.3, opts: { extraTraffic: 12, pedAnytime: true } }));
  out.push(run('pejalan-kapan-saja', { driver: random, weatherEvery: 3.1, opts: { pedAnytime: true } }));
  out.push(run('perencana-buta', { driver: random, weatherEvery: 4.7, opts: { plannerBlind: true, extraTraffic: 8, pedAnytime: true } }));
  out.push(run('mobil-lewat-zebra-30kmj', { driver: (s, i, r, st) => { hold(s); loopStop(s, st); }, weatherEvery: 6.1, opts: { egoLimit: 79.5, egoSpeed: 8.3, pedAnytime: true } }));
  out.push(run('mobil-lewat-zebra-perencana-buta', { driver: (s, i, r, st) => { loopStop(s, st); if (i % 50 === 0) { const x = r(); s.drive.forward = x < 0.85; s.drive.back = x > 0.95; } }, weatherEvery: 3.7, opts: { egoLimit: 79.5, egoSpeed: 8.3, plannerBlind: true, extraTraffic: 8, pedAnytime: true } }));
  return out;
}
"""


def model_part(browser):
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.route(ORIGIN + "/__uji_sensor.html", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>uji</title>"))
    page.goto(ORIGIN + "/__uji_sensor.html")
    t0 = time.time()
    out = page.evaluate(MODEL_JS, {"simSeconds": SIM_SECONDS})
    page.close()
    return {"seconds": round(time.time() - t0, 1), "scenarios": out, "errors": errors}


FRONT_JS = """() => { const h = window.__lessonSafety; const e = h.scene.ego; const f = h.scene.frame.toFrame(e.x, e.y);
  return { front: f.s + e.length / 2, rear: f.s - e.length / 2, light: h.scene.light.state, speed: e.speed, blocked: h.scene.state.blocked }; }"""


def ui_part(browser, mobile):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(ORIGIN + "/#/pelajaran/sensor")
    page.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    stop_line = 73.8
    zebra_start = 74.8
    samples = {"maxFront": -1e9, "minRear": 1e9, "overLine": 0, "blockedSeen": set()}

    def sample():
        s = page.evaluate(FRONT_JS)
        samples["maxFront"] = max(samples["maxFront"], s["front"])
        samples["minRear"] = min(samples["minRear"], s["rear"])
        if s["front"] > stop_line:
            samples["overLine"] += 1
        if s["blocked"]:
            samples["blockedSeen"].add(s["blocked"])

    # semua sensor menyala supaya beban realistis
    for n in ["Kamera", "LiDAR", "Radar", "Ultrasonik"]:
        t = page.locator(".ctl-toggle", has_text=n).first
        if t.get_attribute("aria-checked") != "true":
            t.click()
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    fwd = page.locator(".btn-hold", has_text="Maju")
    back = page.locator(".btn-hold", has_text="Mundur")

    def hold(btn, seconds, weather_cycle=False):
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        t0 = time.time()
        k = 0
        while time.time() - t0 < seconds:
            if weather_cycle and int((time.time() - t0) / 5) != k:
                k = int((time.time() - t0) / 5)
                w = ["Hujan", "Kabut", "Malam", "Cerah"][k % 4]
                page.mouse.up()
                page.locator(".seg-btn", has_text=w).first.click()
                box2 = btn.bounding_box()
                page.mouse.move(box2["x"] + box2["width"] / 2, box2["y"] + box2["height"] / 2)
                page.mouse.down()
            sample()
            page.wait_for_timeout(100)
        page.mouse.up()

    # 1) tahan Maju lama di 2x sambil mengganti cuaca
    hold(fwd, UI_SECONDS, weather_cycle=True)
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}safety-{'m' if mobile else 'd'}-tahan-maju.png")
    # 2) keyboard (desktop): panah atas ditahan
    if not mobile:
        page.locator(".sim-canvas").first.click(position={"x": 5, "y": 5})
        page.keyboard.down("ArrowUp")
        for _ in range(60):
            sample()
            page.wait_for_timeout(100)
        page.keyboard.up("ArrowUp")
    # 3) tahan Mundur sampai angkot ngetem
    hold(back, 15)
    # 4) Maju dan Mundur bergantian cepat, jeda dan lanjutkan di tengahnya
    for i in range(40):
        hold(fwd if i % 2 == 0 else back, 0.35)
        if i % 13 == 0:
            page.locator('[data-act="pause"]').click()
            page.wait_for_timeout(150)
            page.locator('[data-act="pause"]').click()
    # 5) Ulangi lalu langsung tahan Maju lagi
    page.locator('[data-act="reset"]').click()
    hold(fwd, 20)
    snap = page.evaluate("() => { const s = window.__lessonSafety.snapshot(); return s; }")
    ctx.close()
    samples["blockedSeen"] = sorted(samples["blockedSeen"])
    samples["maxFront"] = round(samples["maxFront"], 3)
    samples["minRear"] = round(samples["minRear"], 3)
    return {
        "mode": "mobile" if mobile else "desktop",
        "safety": {k: snap[k] for k in ["redRuns", "pedContacts", "otherCollisions", "clamps", "interventions", "egoInterventions", "minPedGap", "ticks"]},
        "events": snap["events"][:5],
        "egoSamples": samples,
        "stopLine": stop_line,
        "zebraStart": zebra_start,
        "errors": errors,
    }


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    model = model_part(browser)
    ui = [ui_part(browser, False), ui_part(browser, True)]
    browser.close()

bad = []
for r in model["scenarios"]:
    if r["redRuns"] or r["contacts"] or r["monitor"]["redRuns"] or r["monitor"]["pedContacts"]:
        bad.append(r["name"])
for u in ui:
    s = u["safety"]
    if s["redRuns"] or s["pedContacts"] or u["egoSamples"]["overLine"] or u["errors"]:
        bad.append("ui-" + u["mode"])
if model["errors"]:
    bad.append("model-errors")
summary = {
    "simSecondsPerScenario": SIM_SECONDS,
    "totalSimSeconds": sum(SIM_SECONDS / 2 if "mulai" in r["name"] else SIM_SECONDS for r in model["scenarios"]),
    "totalRedRuns": sum(r["redRuns"] + r["monitor"]["redRuns"] for r in model["scenarios"]),
    "totalPedContacts": sum(r["contacts"] + r["monitor"]["pedContacts"] for r in model["scenarios"]),
    "totalClamps": sum(r["monitor"]["clamps"] for r in model["scenarios"]),
    "totalOtherCollisions": sum(r["monitor"]["otherCollisions"] for r in model["scenarios"]),
    "failing": bad,
}
print(json.dumps({"summary": summary, "model": model, "ui": ui}, indent=1, ensure_ascii=False))
sys.exit(1 if bad else 0)
