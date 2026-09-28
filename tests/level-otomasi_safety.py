"""Uji aturan keselamatan (SPEC aturan 9) untuk pelajaran Level Otomasi, dengan usaha keras untuk
melanggarnya.

Aturannya: apa pun yang dilakukan pelajar, tidak ada kendaraan yang menerobos lampu merah atau
menabrak pejalan kaki. Pelajaran ini sengaja tidak punya lampu lalu lintas, zebra cross, atau
pejalan kaki (jalan ilustrasi tanpa persimpangan), jadi aturan terpenuhi bila pelajar juga tidak bisa
memunculkannya. Uji ini membuktikan hal itu saat berjalan, bukan hanya dengan membaca kode:

1. Modul engine dilayani dengan instrumen lewat page.route (file di disk tidak diubah). Instrumen
   menghitung pembuatan TrafficLight, SignalPlan, PathAgent pejalan kaki atau pesepeda, crosswalk(),
   stopLine(), serta panggilan drawPedestrian, drawCyclist, drawTrafficLight, drawTrafficSignal,
   drawCrosswalk, drawStopLine. Juga drawRays dan drawLidarSweep (LiDAR harus tenang: tanpa garis
   sinar dan tanpa sapuan berputar di pelajaran ini).
2. Kontrol positif: pelajaran keputusan (yang memang punya pejalan kaki dan lampu) harus menghasilkan
   hitungan lebih dari 0, bukti instrumennya bekerja.
3. Fuzz keras di pelajaran ini: tiap langkah, kecepatan 2x, keenam level lewat keyboard, gas penuh
   sambil membanting setir kiri dan kanan, tombol Gas ditahan lama, Pegang kemudi dan Ambil alih,
   Ulangi berulang, jeda, ketukan acak di kedua kanvas, lalu perjalanan panjang di level 5 dan gas
   penuh manual.
4. Setelah itu: semua hitungan untuk rute pelajaran harus 0, window.__levelOtomasi.state.safety
   harus 0, jenis pelaku tidak pernah memuat pejalan kaki, dan konsol bersih. Tabrakan antarkendaraan
   (boleh terjadi saat mengemudi manual) dicatat terpisah.

Pemakaian: python3 tests/level-otomasi_safety.py [--mobile] [--port 8241]
"""
import json
import os
import random
import re
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8241"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi-malang/"
TAG = "m" if MOBILE else "d"
ROUTE = "#/pelajaran/level-otomasi"
os.makedirs(SHOTS, exist_ok=True)

BUMP = """
;(() => {
  const A = (globalThis.__loSafety ||= { byRoute: {} });
  globalThis.__loBump ||= (k) => {
    const r = location.hash || '#/';
    const o = (A.byRoute[r] ||= {});
    o[k] = (o[k] || 0) + 1;
  };
})();
"""


def wrap_fn(name):
    return f"{{ const f = {name}; {name} = function (...a) {{ globalThis.__loBump('{name}'); return f.apply(this, a); }}; }}\n"


def wrap_class(name, cond="true"):
    return f"{{ const C = {name}; {name} = class extends C {{ constructor(...a) {{ super(...a); if ({cond}) globalThis.__loBump('new{name}'); }} }}; }}\n"


SUFFIX = {
    "draw": BUMP + "".join(wrap_fn(n) for n in ["drawPedestrian", "drawCyclist", "drawTrafficLight", "drawTrafficSignal", "drawCrosswalk", "drawStopLine", "drawRays", "drawLidarSweep"]),
    "traffic": BUMP + wrap_class("TrafficLight") + wrap_class("SignalPlan"),
    "road": BUMP + wrap_fn("crosswalk") + wrap_fn("stopLine"),
    "vehicle": BUMP + wrap_class("PathAgent", "this.kind === 'pedestrian' || this.kind === 'cyclist' || (a[0] && a[0].radius)"),
}
ENGINE_RE = re.compile(r".*/js/engine/(draw|traffic|road|vehicle)\.js(\?.*)?$")


def instrument(route):
    m = ENGINE_RE.match(route.request.url)
    resp = route.fetch()
    body = resp.text() + "\n" + SUFFIX[m.group(1)]
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in ("content-length", "content-encoding")}
    headers["content-type"] = "text/javascript; charset=utf-8"
    route.fulfill(status=resp.status, headers=headers, body=body)


def counts_for(page, prefix):
    data = page.evaluate("() => JSON.parse(JSON.stringify(globalThis.__loSafety || { byRoute: {} }))")
    total = {}
    for route, c in data["byRoute"].items():
        if route.startswith(prefix):
            for k, v in c.items():
                total[k] = total.get(k, 0) + v
    return total


def main():
    rnd = random.Random(20260928)
    rep = {"viewport": TAG, "positive": {}, "fuzz": [], "states": [], "console": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        ctx.route(ENGINE_RE, instrument)
        page = ctx.new_page()
        page.on("console", lambda m: rep["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: rep["console"].append(f"pageerror: {e}"))

        def ready():
            page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)

        # kontrol positif: pelajaran dengan pejalan kaki dan lampu
        page.goto(BASE + "#/pelajaran/keputusan", wait_until="load")
        ready()
        n = page.evaluate("() => window.__simotonom.stepCount")
        for i in range(n):
            page.locator(f'.step-dot[data-go="{i}"]').first.dispatch_event("click")
            page.wait_for_timeout(700)
        rep["positive"] = counts_for(page, "#/pelajaran/keputusan")

        page.goto(BASE + ROUTE, wait_until="load")
        ready()
        page.wait_for_timeout(600)

        def state():
            return page.evaluate("() => window.__levelOtomasi ? JSON.parse(JSON.stringify(window.__levelOtomasi.state)) : null")

        def focus_body():
            page.evaluate("() => { const a = document.activeElement; if (a && a.blur) a.blur(); }")

        def key_hold(k, ms):
            page.keyboard.down(k)
            page.wait_for_timeout(ms)
            page.keyboard.up(k)

        def hold_btn(text, ms, steer=None):
            loc = page.locator(".pad .btn-hold", has_text=text)
            loc.first.scroll_into_view_if_needed()
            box = loc.first.bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.mouse.down()
            if steer:
                page.keyboard.down(steer)
            page.wait_for_timeout(ms)
            if steer:
                page.keyboard.up(steer)
            page.mouse.up()

        def taps(sel, count):
            loc = page.locator(sel).first
            loc.scroll_into_view_if_needed()
            box = loc.bounding_box()
            for _ in range(count):
                x = box["x"] + box["width"] * rnd.uniform(0.05, 0.95)
                y = box["y"] + box["height"] * rnd.uniform(0.1, 0.9)
                if MOBILE:
                    page.touchscreen.tap(x, y)
                else:
                    page.mouse.click(x, y)
                page.wait_for_timeout(40)

        seen_kinds = set()
        worst = {"lead": 0, "motor": 0, "zone": 0}
        for step in range(6):
            page.locator(f'.step-dot[data-go="{step}"]').first.dispatch_event("click")
            page.wait_for_timeout(300)
            page.locator(".speed-wrap .seg-btn", has_text="2x").first.dispatch_event("click")
            focus_body()
            acts = []
            for lvl in "012345":
                page.keyboard.press(lvl)
                page.keyboard.down("ArrowUp")
                key_hold(rnd.choice(["ArrowRight", "ArrowLeft"]), rnd.randint(150, 700))
                page.wait_for_timeout(rnd.randint(200, 600))
                key_hold(rnd.choice(["ArrowRight", "ArrowLeft"]), rnd.randint(150, 700))
                page.keyboard.up("ArrowUp")
                page.keyboard.press("p")
                page.keyboard.press("a")
                st = state()
                seen_kinds.update(st["actors"].keys())
            acts.append("level 0 sampai 5 dengan gas penuh dan setir acak")
            page.keyboard.press("0")
            hold_btn("Gas", 2500, steer="ArrowRight")
            hold_btn("Gas", 1500, steer="ArrowLeft")
            acts.append("tombol Gas ditahan sambil membanting setir")
            for _ in range(3):
                page.locator('[data-act="reset"]').first.dispatch_event("click")
                page.wait_for_timeout(120)
            page.locator('[data-act="pause"]').first.dispatch_event("click")
            page.wait_for_timeout(150)
            page.locator('[data-act="pause"]').first.dispatch_event("click")
            acts.append("Ulangi tiga kali, jeda dan lanjutkan")
            taps(".stage .sim-canvas", 8)
            taps(".trip-map canvas", 4)
            focus_body()
            acts.append("ketuk kanvas simulasi dan peta perjalanan")
            st = state()
            seen_kinds.update(st["actors"].keys())
            for k in worst:
                worst[k] = max(worst[k], st["crashes"][k])
            rep["states"].append({"step": step, "safety": st["safety"], "crashes": st["crashes"], "trip": round(st["trip"])})
            rep["fuzz"].append({"step": step, "acts": acts})

        # perjalanan panjang level 5 (2x) dan gas penuh manual
        page.locator('.step-dot[data-go="5"]').first.dispatch_event("click")
        page.wait_for_timeout(300)
        page.locator(".speed-wrap .seg-btn", has_text="2x").first.dispatch_event("click")
        focus_body()
        page.keyboard.press("5")
        for _ in range(12):
            page.wait_for_timeout(2500)
            st = state()
            seen_kinds.update(st["actors"].keys())
        st_long = state()
        page.keyboard.press("0")
        page.keyboard.down("ArrowUp")
        for _ in range(10):
            key_hold(rnd.choice(["ArrowRight", "ArrowLeft"]), rnd.randint(100, 400))
            page.wait_for_timeout(700)
        page.keyboard.up("ArrowUp")
        st_end = state()
        seen_kinds.update(st_end["actors"].keys())
        page.evaluate("() => window.scrollTo(0, 0)")
        page.screenshot(path=SHOTS + f"safety-{TAG}.png")
        counts = counts_for(page, ROUTE)
        err_visible = page.evaluate("() => { const e = document.querySelector('.stage-error'); return !!e && !e.hidden; }")
        snap = page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")
        browser.close()

    rep["long"] = {"trip": round(st_long["trip"]), "inKawasan": st_long["inKawasan"], "level": st_long["level"], "crashes": st_long["crashes"]}
    rep["end"] = {"safety": st_end["safety"], "crashes": st_end["crashes"], "speedKmh": round(st_end["speedKmh"], 1)}
    rep["counts"] = counts
    rep["seenKinds"] = sorted(seen_kinds)
    rep["vehicleCollisions"] = {k: max(worst[k], st_end["crashes"][k]) for k in worst}
    rep["stageError"] = err_visible
    rep["lessonStatus"] = snap.get("lessonStatus")
    safety_zero = all(all(v == 0 for v in s["safety"].values()) for s in rep["states"]) and all(v == 0 for v in st_end["safety"].values())
    rep["verdict"] = {
        "instrumen_bekerja": sum(rep["positive"].values()) > 0,
        "tanpa_pejalan_kaki_lampu_zebra": all(counts.get(k, 0) == 0 for k in ["drawPedestrian", "drawCyclist", "drawTrafficLight", "drawTrafficSignal", "drawCrosswalk", "drawStopLine", "newTrafficLight", "newSignalPlan", "crosswalk", "stopLine", "newPathAgent"]),
        "lidar_tenang_tanpa_sinar_dan_sapuan": counts.get("drawRays", 0) == 0 and counts.get("drawLidarSweep", 0) == 0,
        "penghitung_keselamatan_nol": safety_zero,
        "jenis_pelaku_tanpa_pejalan_kaki": not ({"pedestrian", "cyclist"} & seen_kinds),
        "tanpa_galat_simulasi": not err_visible and rep["lessonStatus"] == "ready",
        "konsol_bersih": not rep["console"],
    }
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    sys.exit(0 if all(rep["verdict"].values()) else 1)


if __name__ == "__main__":
    main()
