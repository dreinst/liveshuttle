"""Serangan lewat antarmuka pada pelajaran Persepsi (SPEC aturan 9), dengan pemeriksa mandiri.

Pelajar tidak menyetir di pelajaran ini. Yang bisa ia ubah: kecepatan simulasi (0,5x, 1x, 2x),
Jeda, Ulangi, pindah langkah, sakelar tampilan, slider derau dan ambang, dan tombol pantulan
palsu. Skrip ini menekan semuanya berulang kali secara acak sambil memeriksa SETIAP langkah
fisika secara geometris dan mandiri:
  - lingkaran pejalan kaki tidak boleh beririsan dengan kotak kendaraan mana pun (termasuk parkir);
  - tidak ada kendaraan yang bergerak di atas zebra cross yang sedang diseberangi.
Separuh waktu, mode uji beban dinyalakan (lalu lintas padat, penyeberang terus-menerus).
Pemeriksa disisipkan lewat page.route ke scene.js yang dilayani (file di disk tidak diubah).
Penghitung milik pelajaran (window.__lessonSafety) juga dibaca dan dibandingkan.

Pemakaian: python3 tests/persepsi_attack.py [detik_nyata] [--mobile] [--gpu]
Butuh server: python3 tests/serve.py 8243
"""
import json
import os
import random
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8243/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/persepsi-malang/"
os.makedirs(SHOTS, exist_ok=True)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
REAL = float(args[0]) if args else 90
MOBILE = "--mobile" in sys.argv
GPU = "--gpu" in sys.argv
TAG = ("mobile" if MOBILE else "desktop") + ("-gpu" if GPU else "")

SIG = "export function createScene({ street, seed = 11 } = {}) {"
HOOK = r"""
export function createScene(opts) {
  const s = __createScene(opts);
  const mon = (globalThis.__indepPersepsi = { ticks: 0, contacts: 0, contactSamples: [], zebra: 0, zebraSamples: [], minGapMoving: Infinity, maxEgo: 0, stressTicks: 0 });
  globalThis.__persepsiScene = s;
  const circleBox = (px, py, r, b) => {
    const c = Math.cos(b.heading || 0), sn = Math.sin(b.heading || 0);
    const dx = px - b.x, dy = py - b.y;
    const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
    const qx = Math.max(-b.length / 2, Math.min(b.length / 2, lx));
    const qy = Math.max(-b.width / 2, Math.min(b.width / 2, ly));
    return Math.hypot(lx - qx, ly - qy) - r;
  };
  const up = s.update;
  s.update = (dt) => {
    s.state.stress = !!globalThis.__persepsiStress;
    up(dt);
    mon.ticks++;
    if (s.state.stress) mon.stressTicks++;
    const vehicles = [s.ego, ...s.traffic];
    const all = [...vehicles, ...s.street.parked];
    mon.maxEgo = Math.max(mon.maxEgo, s.ego.v);
    for (const p of s.peds) {
      if (p.gone) continue;
      for (const v of all) {
        if (Math.hypot(v.x - p.x, v.y - p.y) > 8) continue;
        const g = circleBox(p.x, p.y, p.radius, v);
        if (g < 0) { mon.contacts++; if (mon.contactSamples.length < 6) mon.contactSamples.push({ t: +s.state.time.toFixed(2), ped: p.id, veh: v.id, g: +g.toFixed(3) }); }
        if (v.role !== 'parked' && (v.v || 0) > 0.05) mon.minGapMoving = Math.min(mon.minGapMoving, g);
      }
    }
    for (const cw of s.street.crosswalks) {
      if (!s.occupied(cw)) continue;
      for (const v of vehicles) {
        const lo = Math.min(v.s - v.length / 2, v.s + v.length / 2), hi = Math.max(v.s - v.length / 2, v.s + v.length / 2);
        if (hi > cw.s - cw.half && lo < cw.s + cw.half && v.v > 0.01) { mon.zebra++; if (mon.zebraSamples.length < 6) mon.zebraSamples.push({ t: +s.state.time.toFixed(2), cw: cw.id, veh: v.id }); }
      }
    }
  };
  return s;
}
function __createScene({ street, seed = 11 } = {}) {"""


def patch(route):
    resp = route.fetch()
    body = resp.text()
    assert SIG in body, "tanda tangan createScene berubah"
    body = body.replace(SIG, HOOK, 1)
    route.fulfill(response=resp, body=body, headers={**resp.headers, "content-type": "text/javascript"})


READ = """() => ({ indep: globalThis.__indepPersepsi ? JSON.parse(JSON.stringify(globalThis.__indepPersepsi)) : null,
  lesson: globalThis.__lessonSafety ? JSON.parse(JSON.stringify(globalThis.__lessonSafety)) : null,
  status: document.querySelector('.sim-status')?.textContent || '', snap: window.__simotonom })"""

errors = []
launch_args = ["--use-angle=metal", "--enable-gpu"] if GPU else []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=launch_args)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.route("**/js/lessons/persepsi/scene.js", patch)
    page.goto(BASE + "#/pelajaran/persepsi", wait_until="load")
    page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    page.wait_for_timeout(800)
    rnd = random.Random(5)
    page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
    t0 = time.time()
    actions = {}
    shot_n = 0
    while time.time() - t0 < REAL:
        stress = (time.time() - t0) > REAL / 2
        page.evaluate(f"() => {{ globalThis.__persepsiStress = {str(stress).lower()} }}")
        act = rnd.choice(["step", "toggle", "slider", "ghost", "reset", "speed", "pause", "wait", "wait", "wait", "wait"])
        try:
            if act == "step":
                page.locator(f'.step-dot[data-go="{rnd.randint(0, 5)}"]').first.dispatch_event("click")
            elif act == "toggle":
                toggles = page.locator(".ctl-toggle input")
                n = toggles.count()
                if n:
                    toggles.nth(rnd.randrange(n)).dispatch_event("click")
            elif act == "slider":
                sliders = page.locator(".controls input[type=range]")
                n = sliders.count()
                if n:
                    el = sliders.nth(rnd.randrange(n)).element_handle()
                    which = rnd.choice(["min", "max", "mid"])
                    page.evaluate("""([el, which]) => { const v = which === 'min' ? el.min : which === 'max' ? el.max : (Number(el.min) + Number(el.max)) / 2;
                      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }""", [el, which])
            elif act == "ghost":
                if page.locator(".ghost-btn").count():
                    page.locator(".ghost-btn").first.dispatch_event("click")
            elif act == "reset":
                page.locator('[data-act="reset"]').dispatch_event("click")
            elif act == "speed":
                page.locator(".speed-wrap .seg-btn", has_text=rnd.choice(["0,5x", "1x", "2x", "2x", "2x"])).dispatch_event("click")
            elif act == "pause":
                page.locator('[data-act="pause"]').dispatch_event("click")
                page.wait_for_timeout(150)
                page.locator('[data-act="pause"]').dispatch_event("click")
            actions[act] = actions.get(act, 0) + 1
        except Exception as e:  # noqa: BLE001
            errors.append(f"aksi {act} gagal: {e}")
        page.wait_for_timeout(rnd.randint(150, 900) if act != "wait" else 2500)
        if shot_n < 4 and time.time() - t0 > (shot_n + 1) * REAL / 5:
            page.evaluate("() => window.scrollTo(0, 0)")
            page.locator(".stage").screenshot(path=f"{SHOTS}attack-{TAG}-{shot_n}.png")
            shot_n += 1
    # pastikan simulasi tidak sedang dijeda di akhir, lalu baca hasil
    if page.evaluate("() => window.__simotonom.paused"):
        page.locator('[data-act="pause"]').dispatch_event("click")
    page.wait_for_timeout(1500)
    res = page.evaluate(READ)
    browser.close()

ind = res["indep"]
ind["minGapMoving"] = round(ind["minGapMoving"], 3) if ind["minGapMoving"] is not None else None
lesson = res["lesson"] or {}
lesson.pop("log", None)
lesson.pop("clampLog", None)
ignored = [e for e in errors if "GPU stall due to ReadPixels" in e]
real_errors = [e for e in errors if e not in ignored]
ok = ind["contacts"] == 0 and ind["zebra"] == 0 and lesson.get("pedestrianContacts", 1) == 0 and lesson.get("redLightViolations", 1) == 0 and not real_errors
print(json.dumps({"tag": TAG, "actions": actions, "simSeconds": round(ind["ticks"] / 60, 1), "stressSeconds": round(ind["stressTicks"] / 60, 1),
                  "indep": ind, "lessonMonitor": lesson, "errors": real_errors, "ignoredGpuStall": len(ignored), "result": "LULUS" if ok else "GAGAL"},
                 indent=1, ensure_ascii=False))
sys.exit(0 if ok else 1)
