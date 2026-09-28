"""QA tunggal pelajaran Jarak Aman (desktop 1366x900 lalu ponsel 390x844).

1. Model: semua skenario (rem, rintangan, angkot) pada semua kecepatan, jarak waktu, jalan, reaksi,
   dan AEB. Calon penumpang tidak pernah bersentuhan dengan kendaraan dan naik bila mobilmu aman.
2. Perisai: pejalan kaki sengaja ditaruh di lajur mobilmu, di depan angkot, dan di lajur
   kendaraan latar, tanpa pengemudi yang mengerem. Tidak boleh ada kontak. Juga penerimaan celah.
3. UI seperti pelajar: keenam tugas diselesaikan lewat tombol, slider, dan segmen.
4. Serangan: kecepatan 2x, tombol skenario ditekan beruntun, 120 km/jam lalu angkot, jalan licin,
   AEB bolak-balik, jeda, Ulangi, ganti langkah. "Kontak dengan pejalan kaki" dan "Terobos lampu
   merah" dibaca tiap 150 ms dan harus tetap 0.
5. Kebocoran loop dan gaya setelah bolak-balik antarpelajaran, dan konsol bersih.

Pemakaian: python3 tests/serve.py 8248 & python3 tests/jarak-aman_qa.py [--port 8248]
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8248"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "jarak-aman")
os.makedirs(SHOTS, exist_ok=True)

MODEL = r"""
async () => {
  const M = await import('/js/lessons/jarak-aman/model.js');
  const S = await import('/js/lessons/jarak-aman/safety.js');
  const St = await import('/js/lessons/jarak-aman/street.js');
  const r = { runs: 0, contacts: 0, corridorIn: 0, clamps: 0, safeNotBoarded: 0, crashBoarded: 0,
              egoHits: 0, egoClampFar: 0, leadHits: 0, npcHits: 0, npcCases: 0 };
  const corridor = M.CAR_WIDTH / 2 + S.SAFETY.latMargin + S.SAFETY.pedRadius;
  const walkers = [-4.55, -5.25].flatMap((y) => [0, 25, 50, 75, 100].map((x) => ({ r: 0.35, points: [{ x, y }, { x: x + 3.6, y }] })));
  const roads = [0.8, 0.5, 0.25];
  // 1. semua kombinasi, tiap langkah diperiksa
  for (const [sc, hi] of [['rem', 120], ['rintangan', 120], ['angkot', 50]])
    for (let kmh = 20; kmh <= hi; kmh += 5)
      for (let t10 = 5; t10 <= 30; t10++)
        for (const mu of roads) for (const tr of [1.5, 0.3]) for (const aeb of [false, true]) {
          const run = M.createRun({ v: kmh / 3.6, tau: t10 / 10, mu, tr, aeb }, sc, 0);
          if (kmh <= M.CITY_MAX_KMH) run.extraPeds = walkers;
          const look = () => {
            const pc = M.passengerCircle(run);
            if (!pc) return;
            for (const b of M.runBoxes(run)) if (S.touches(b, pc)) r.contacts++;
            if (Math.abs(pc.y) < corridor) r.corridorIn++;
          };
          for (let n = 0; !run.done && n < 20000; n++) { M.stepRun(run); look(); }
          for (let i = 0; i < 600; i++) { M.stepPassenger(run); look(); }
          r.runs++;
          r.clamps += run.clamps;
          if (sc !== 'angkot') continue;
          if (!run.outcome.collided && run.ped.state !== 'dalam') r.safeNotBoarded++;
          if (run.outcome.collided && ['jalan', 'naik'].includes(run.ped.state)) r.crashBoarded++; // melangkah saat tabrakan
        }
  // 2a. mobilmu tanpa pengemudi (tr 999) menuju pejalan kaki di tengah lajurnya
  for (let kmh = 20; kmh <= 120; kmh += 10) for (const mu of roads) for (const D of [1, 3, 6, 10, 20, 35, 60, 100, 160]) {
    const v = kmh / 3.6;
    const run = M.createRun({ v, tau: 3, mu, tr: 999, aeb: false }, 'rem', 0);
    run.lead.x = 1e6;
    const ped = { x: D + 0.35, y: 0, r: 0.35 };
    run.extraPeds = [{ r: 0.35, points: [ped] }];
    for (let n = 0; run.ego.v > 0 && !run.done && n < 3600; n++) { M.stepRun(run); if (S.touches(M.runBoxes(run)[0], ped)) r.egoHits++; }
    if (D >= S.stopDistance(v, mu * M.G) + S.SAFETY.gapPed + 0.2) r.egoClampFar += run.clamps;
  }
  // 2b. angkot yang mengerem menuju pejalan kaki di lajurnya
  for (let kmh = 20; kmh <= 50; kmh += 5) for (const mu of roads) for (const D of [2, 6, 12, 25, 50]) {
    const run = M.createRun({ v: kmh / 3.6, tau: 2, mu, tr: 1.5, aeb: false }, 'angkot', 0);
    const ped = { x: run.lead.x + run.lead.length + D + 0.35, y: run.lead.lat, r: 0.35 };
    run.extraPeds = [{ r: 0.35, points: [ped] }];
    for (let n = 0; !run.done && n < 5000; n++) { M.stepRun(run); for (const b of M.runBoxes(run)) if (S.touches(b, ped)) r.leadHits++; }
  }
  // 2c. kendaraan latar (kota dan tol) menuju pejalan kaki di lajurnya selama 25 detik
  for (const place of ['kota', 'tol']) for (const mu of roads) for (const lane of [11.15, 7.65]) for (const D of [3, 10, 30, 60]) {
    const st = St.createStreet();
    st.init(place, 0, false);
    const inLane = st.npcs.filter((n) => Math.abs(n.laneY - lane) < 0.1).sort((p, q) => p.x - q.x);
    const t = inLane[Math.floor(inLane.length / 2)];
    const ped = { x: t.x - t.length / 2 - D - 0.35, y: lane, r: 0.35 };
    if (!st.npcs.every((n) => Math.abs(n.y - lane) > 3 || Math.abs(n.x - ped.x) > n.length / 2 + 2)) continue;
    r.npcCases++;
    for (let i = 0; i < 1500; i++) {
      st.update(1 / 60, { refX: 0, mu, peds: [{ r: 0.35, points: [ped] }] });
      for (const b of st.boxes()) if (S.touches(b, ped)) r.npcHits++;
    }
  }
  // 2d. penerimaan celah
  const path = [{ x: 30, y: -2 }, { x: 30, y: 0 }, { x: 30, y: 2 }];
  const car = (v, front) => ({ front, length: 4.5, y: 0, halfW: 0.9, dir: 1, v, a: 7.84 });
  r.gapOk = S.gapAccepted(path, [car(5, 0)]) && !S.gapAccepted(path, [car(22, 10)]) && S.gapAccepted(path, [car(0, 20)]);
  return r;
}
"""


def run(pw, mobile):
    tag = "m" if mobile else "d"
    R, bad, errs = {}, [], []
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    c = (b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
         if mobile else b.new_context(viewport={"width": 1366, "height": 900}))
    p = c.new_page()
    p.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") and "ReadPixels" not in m.text else None)
    p.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))

    def check(ok, what):
        if not ok:
            bad.append(what)

    hook = lambda: p.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")
    snap = lambda: p.evaluate("() => window.__lessonSafety.snapshot()")
    worst = {"pedContacts": 0, "redRuns": 0, "clamps": 0}

    def poll(ms):
        end = time.time() + ms / 1000
        while time.time() < end:
            s = snap()
            for k in worst:
                worst[k] = max(worst[k], s[k])
            p.wait_for_timeout(150)

    def tap(loc):
        loc.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        loc.tap() if mobile else loc.click()

    scn = lambda t: tap(p.locator(".ja-scn .btn", has_text=t))
    seg = lambda t: tap(p.locator(".lesson-jarak-aman .controls .seg-btn", has_text=t).first)
    aeb = lambda: tap(p.locator(".lesson-jarak-aman .ctl-toggle[role=switch]", has_text="AEB"))
    step = lambda i: p.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")

    def slider(label, target, inc):
        """Geser slider dengan tombol panah seperti pengguna keyboard."""
        inp = p.locator(".ctl-slider", has_text=label).first.locator("input[type=range]")
        inp.focus()
        for _ in range(80):
            v = float(inp.input_value())
            if abs(v - target) < inc / 2:
                break
            p.keyboard.press("ArrowRight" if v < target else "ArrowLeft")

    def done_task(task, sc):
        """Tekan skenario, tunggu banner hasil dan tugasnya."""
        scn(sc)
        p.wait_for_timeout(400)
        p.wait_for_selector(".ja-banner:not([hidden])", timeout=30000)
        for _ in range(25):
            if task in hook()["completedTasks"]:
                return True
            p.wait_for_timeout(200)
        return False

    def shot(name):
        p.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'center'})")
        p.wait_for_timeout(150)
        p.screenshot(path=f"{SHOTS}/{tag}-{name}.png")

    p.goto(BASE + "#/", wait_until="load")
    p.evaluate("() => localStorage.clear()")
    p.wait_for_timeout(500)
    loops_home = hook()["activeLoops"]
    p.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
    p.wait_for_timeout(1500)
    shot("0-awal")

    if not mobile:
        t0 = time.time()
        R["model"] = m = p.evaluate(MODEL)
        R["model_s"] = round(time.time() - t0, 1)
        for k in ("contacts", "corridorIn", "clamps", "safeNotBoarded", "crashBoarded", "egoHits", "egoClampFar", "leadHits", "npcHits"):
            check(m[k] == 0, f"model {k}={m[k]}")
        check(m["npcCases"] >= 30 and m["gapOk"], "model: kasus kendaraan latar atau penerimaan celah")

    # tugas lewat UI
    slider("Kecepatan", 80, 5)
    seg("Basah")
    p.wait_for_timeout(1600)
    check("calc" in hook()["completedTasks"], "tugas calc")
    shot("1-rumus")
    step(1)
    p.wait_for_timeout(300)
    check(done_task("crash", "rem mendadak"), "tugas crash")
    shot("2-tabrakan")
    step(2)
    slider("Jarak waktu", 2.0, 0.1)
    p.wait_for_timeout(1200)
    check(done_task("gap-fix", "rem mendadak"), "tugas gap-fix")
    step(3)
    p.wait_for_timeout(300)
    aeb()
    check(done_task("aeb", "Rintangan"), "tugas aeb")
    shot("4-aeb")
    step(4)
    p.wait_for_timeout(300)
    seg("Licin")
    check(done_task("licin", "Rintangan"), "tugas licin")
    step(5)
    p.wait_for_timeout(300)
    scn("Angkot")
    p.wait_for_timeout(1500)
    shot("6a-angkot")
    p.wait_for_selector(".ja-banner:not([hidden])", timeout=30000)
    check("angkot" not in hook()["completedTasks"], "tugas angkot selesai padahal menabrak")
    shot("6b-angkot-tabrakan")
    slider("Jarak waktu", 2.0, 0.1)
    p.wait_for_timeout(1200)
    check(done_task("angkot", "Angkot"), "tugas angkot")
    p.wait_for_timeout(2500)
    shot("6c-angkot-aman")
    R["tasks"] = hook()["completedTasks"]

    # serangan terhadap aturan keselamatan
    tap(p.locator(".speed-wrap .seg-btn", has_text="2x"))
    for tau in (0.5, 1.5, 3.0):
        slider("Jarak waktu", tau, 0.1)
        for road in ("Kering", "Licin"):
            seg(road)
            scn("Angkot")
            poll(600)
            scn("Angkot")
            poll(1800)
    slider("Kecepatan", 120, 5)
    scn("Angkot")
    poll(300)
    check(snap()["kmh"] == 50, "angkot pada 120 km/jam tidak turun ke 50 km/jam")
    aeb()
    seg("Sistem")
    for kmh in (20, 50, 55, 120):
        slider("Kecepatan", kmh, 5)
        for sc in ("rem mendadak", "Rintangan", "Angkot"):
            scn(sc)
            poll(400)
        poll(1200)
    slider("Kecepatan", 40, 5)
    scn("Angkot")
    poll(1500)
    tap(p.locator('[data-act="pause"]'))
    check(hook()["paused"], "Jeda")
    scn("Angkot")
    p.wait_for_timeout(300)
    check(not hook()["paused"], "skenario tidak melanjutkan simulasi")
    poll(2500)
    tap(p.locator('[data-act="reset"]'))
    check(p.locator(".ja-banner[hidden]").count() == 1, "banner tetap tampil setelah Ulangi")
    for i in (0, 5, 3, 5):
        step(i)
        scn("Angkot")
        poll(800)
    poll(5000)
    s = snap()
    R["safety"] = {**worst, "checks": s["checks"], "walkers": s["walkers"], "otherCollisions": s["otherCollisions"]}
    check(worst == {"pedContacts": 0, "redRuns": 0, "clamps": 0}, f"aturan keselamatan {worst}")
    check(s["walkers"] > 0 and s["checks"] > 1000, "pemantau tidak berjalan")
    shot("7-akhir")

    # kebocoran
    for _ in range(3):
        p.goto(BASE + "#/pelajaran/sensor")
        p.wait_for_timeout(600)
        p.goto(BASE + "#/pelajaran/jarak-aman")
        p.wait_for_timeout(600)
    check(hook()["activeLoops"] == 1, "loop bocor di pelajaran")
    p.goto(BASE + "#/")
    p.wait_for_timeout(600)
    check(hook()["activeLoops"] == loops_home, "loop bocor di beranda")
    check(p.evaluate("() => document.querySelectorAll('style[data-lesson=\"jarak-aman\"]').length") == 0, "gaya tertinggal")
    b.close()
    check(not errs, f"konsol {errs[:5]}")
    R["problems"] = bad
    return R


with sync_playwright() as pw:
    out = {"desktop": run(pw, False), "mobile": run(pw, True)}
print(json.dumps(out, indent=1, ensure_ascii=False))
ok = not out["desktop"]["problems"] and not out["mobile"]["problems"]
print("OK" if ok else "GAGAL")
sys.exit(0 if ok else 1)
