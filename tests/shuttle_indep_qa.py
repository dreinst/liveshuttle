"""QA independen pelajaran Misi Shuttle Otonom lewat UI seperti pelajar.

Pemakaian: python3 tests/shuttle_indep_qa.py [--mobile]
Butuh server statis di port 8139.

Isi: tidak ada tugas yang selesai sendiri saat dimuat, kelima tugas lewat klik, ketuk dan tombol,
rute dicari di kanvas dari warna garisnya lalu diketuk, perbandingan jarak dan kecepatan
sebelum dan sesudah hujan, maju mundur semua langkah, Jeda, Ulangi, kecepatan 0,5x dan 2x,
dan uji kebocoran (loop dan listener) setelah keluar masuk pelajaran lima kali.
"""
import io
import json
import re
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8139/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/shuttle-qa/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
MAP = {"minX": -14, "minY": -9, "maxX": 134, "maxY": 109}
PAD = 10

errors = []
log = {}

LANES_JS = """
async () => {
  const C = await import('/js/lessons/shuttle/campus.js');
  return C.LINK_LIST.map((L) => {
    const out = [];
    for (let k = 1; k < 12; k++) { const p = L.lane.sample(L.length * k / 12); out.push([p.x, p.y]); }
    const c = L.road.path.sample(L.road.length / 2);
    return { id: L.id, road: L.road.id, name: L.road.name, pts: out, mid: [c.x, c.y] };
  });
}
"""

def pixel_errors(page, pts):
    """Selisih warna tiap titik layar dari warna rute toska (#2dd4bf), dari tangkapan layar kanvas."""
    loc = page.locator(".sim-canvas")
    box = loc.bounding_box()
    img = Image.open(io.BytesIO(loc.screenshot())).convert("RGB")
    k = img.width / box["width"]
    out = []
    for (x, y) in pts:
        cx, cy = round((x - box["x"]) * k), round((y - box["y"]) * k)
        best = 1e9
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                px, py = cx + dx, cy + dy
                if 0 <= px < img.width and 0 <= py < img.height:
                    r, g, b = img.getpixel((px, py))
                    best = min(best, abs(r - 45) + abs(g - 212) + abs(b - 191))
        out.append(best)
    return out



def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def wait_task(page, task, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(200)
    return None


def next_step(page):
    page.locator(".step-nav .btn-primary").dispatch_event("click")
    page.wait_for_timeout(400)


def prev_step(page):
    page.locator(".step-nav .btn-secondary, .step-nav .btn-ghost").first.dispatch_event("click")
    page.wait_for_timeout(300)


def stage_shot(page, name):
    page.locator(".stage").screenshot(path=f"{SHOTS}{TAG}-{name}.png")


def shot(page, name, full=False):
    page.screenshot(path=f"{SHOTS}{TAG}-{name}.png", full_page=full)


def to_screen(page, x, y):
    box = page.locator(".sim-canvas").bounding_box()
    w, h = box["width"], box["height"]
    bw, bh = MAP["maxX"] - MAP["minX"], MAP["maxY"] - MAP["minY"]
    scale = min((w - 2 * PAD) / bw, (h - 2 * PAD) / bh)
    cx, cy = (MAP["minX"] + MAP["maxX"]) / 2, (MAP["minY"] + MAP["maxY"]) / 2
    return box["x"] + (x - cx) * scale + w / 2, box["y"] + (y - cy) * scale + h / 2


def tap_screen(page, sx, sy):
    if MOBILE:
        page.touchscreen.tap(sx, sy)
    else:
        page.mouse.click(sx, sy)
    page.wait_for_timeout(300)


def canvas_into_view(page):
    page.locator(".sim-canvas").scroll_into_view_if_needed()
    page.wait_for_timeout(150)


def tap_world(page, x, y):
    canvas_into_view(page)
    sx, sy = to_screen(page, x, y)
    tap_screen(page, sx, sy)


def seg(page, text):
    page.locator(".seg-btn", has_text=text).first.click()
    page.wait_for_timeout(200)


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())")


def readout(page, label):
    return page.evaluate(
        """(label) => { const r = [...document.querySelectorAll('.readout')].find(e => e.querySelector('.readout-label')?.textContent === label);
        return r ? r.querySelector('.readout-value').textContent : null; }""", label)


def brain(page):
    return page.evaluate("() => Object.fromEntries([...document.querySelectorAll('.sh-brain li')].map(li => [li.children[0].textContent, li.children[1].textContent]))")


def chip(page, label):
    return page.evaluate(
        """(label) => { const c = [...document.querySelectorAll('.hud-chip')].find(e => e.textContent.startsWith(label) && e.offsetParent);
        return c ? c.querySelector('.hud-value')?.textContent ?? c.textContent : null; }""", label)


def status(page):
    return page.locator(".sim-status").inner_text()


def num(text):
    if text is None:
        return None
    m = re.search(r"-?[\d.]*\d(,\d+)?", text)
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def route_links(page, lanes):
    """Link yang dilalui garis rute toska: cek piksel di tiga titik lajur (tampilan Seluruh kampus)."""
    canvas_into_view(page)
    pts = []
    for L in lanes:
        for (x, y) in L["pts"]:
            pts.append(to_screen(page, x, y))
    errs = pixel_errors(page, pts)
    out = []
    n = len(lanes[0]["pts"])
    for i, L in enumerate(lanes):
        e = errs[i * n:(i + 1) * n]
        hits = [L["pts"][j] for j, v in enumerate(e) if v < 60]
        if len(hits) >= 2:
            out.append({**L, "hits": hits})
    return out


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
    page.wait_for_timeout(1200)
    lanes = page.evaluate(LANES_JS)

    # ---- 0. tidak ada tugas yang selesai sendiri: klik cepat semua langkah lalu kembali ----
    for _ in range(5):
        next_step(page)
    page.wait_for_timeout(600)
    log["after-quick-skip"] = hook(page)["completedTasks"]
    page.locator('.step-dot[data-go="0"]').dispatch_event("click")
    page.wait_for_timeout(500)
    log["start"] = {"step": hook(page)["stepIndex"], "tasks": hook(page)["completedTasks"]}
    stage_shot(page, "00-awal")

    # ---- 1. halte pertama ----
    t1 = time.time()
    dwell_seen = None
    while time.time() - t1 < 60:
        b = brain(page)
        if dwell_seen is None and b.get("Keputusan", "").startswith("Berhenti di halte"):
            dwell_seen = {"t": round(time.time() - t1, 1), "brain": b, "status": status(page)}
            stage_shot(page, "01-dwell")
        if "first-stop" in hook(page)["completedTasks"]:
            break
        page.wait_for_timeout(200)
    log["first-stop"] = round(time.time() - t1, 1) if "first-stop" in hook(page)["completedTasks"] else None
    log["dwell-seen"] = dwell_seen
    page.wait_for_timeout(800)
    stage_shot(page, "01-naik")
    next_step(page)

    # ---- 2. tutup jalan ----
    seg(page, "Seluruh kampus")
    page.wait_for_timeout(1500)
    log["closure-idle-5s"] = wait_task(page, "closure", 5)
    # ruas di luar rute: tidak boleh menyelesaikan tugas
    on_route = route_links(page, lanes)
    on_ids = {L["road"] for L in on_route}
    loc = brain(page)["Lokalisasi"]
    off = [L for L in lanes if L["road"] not in on_ids]
    log["route-roads-seen"] = sorted(on_ids)
    if off:
        tap_world(page, *off[0]["mid"])
        log["off-route-toast"] = toasts(page)[-1:] if toasts(page) else []
        log["off-route-done"] = wait_task(page, "closure", 2.5)
        tap_world(page, *off[0]["mid"])  # buka lagi
        page.wait_for_timeout(600)
    # ruas di rute: cari lagi garis toska, pilih ruas yang bukan ruas tempat shuttle sekarang
    tries = []
    waited = 0
    t_wait = time.time()
    for attempt in range(40):
        on_route = route_links(page, lanes)
        loc = brain(page)["Lokalisasi"]
        cands = [L for L in on_route if L["name"] not in loc]
        if not cands:
            if waited == 0:
                stage_shot(page, "02-belum-ada-ruas")
                log["closure-nothing-yet"] = {"rute": brain(page)["Rute"], "lokalisasi": loc, "status": status(page)}
            waited += 1
            page.wait_for_timeout(1500)
            continue
        L = cands[-1]
        rute_before = brain(page)["Rute"]
        tap_world(page, *L["hits"][len(L["hits"]) // 2])
        page.wait_for_timeout(250)
        after = brain(page)["Rute"]
        tries.append({"road": L["name"], "rute-before": rute_before, "rute-after": after, "toasts": toasts(page)[-1:]})
        stage_shot(page, f"02-tutup-{attempt}")
        done = wait_task(page, "closure", 3)
        if done is not None:
            log["closure"] = {"road": L["name"], "after-s": done, "waited-s": round(time.time() - t_wait, 1)}
            stage_shot(page, "02-rute-baru")
            break
        page.locator("button", has_text="Buka semua jalan").click()
        page.wait_for_timeout(1500)
    log["closure-tries"] = tries
    # batas dua ruas dan penolakan jalan buntu
    closed_now = hook(page)
    seen_roads = set()
    extra = []
    for L in lanes:
        if L["road"] in ("EF", "BE", "DE", "EH", "BD") and L["road"] not in seen_roads:
            seen_roads.add(L["road"])
            extra.append(L)
    msgs = []
    for L in extra[:3]:
        tap_world(page, *L["mid"])
        page.wait_for_timeout(250)
        msgs.append(toasts(page)[-1] if toasts(page) else "")
    log["limit-msgs"] = msgs
    stage_shot(page, "02-dua-ditutup")
    page.locator("button", has_text="Buka semua jalan").click()
    page.wait_for_timeout(500)
    log["open-all-toast"] = toasts(page)[-1:]
    page.locator("button", has_text="Tutup ruas di depan").click()
    page.wait_for_timeout(400)
    log["close-ahead"] = {"toast": toasts(page)[-1:], "rute": brain(page)["Rute"]}
    stage_shot(page, "02-tutup-di-depan")
    page.locator("button", has_text="Buka semua jalan").click()
    page.wait_for_timeout(400)
    next_step(page)

    # ---- 3. hujan ----
    if MOBILE:
        seg(page, "Ikuti shuttle")
    page.wait_for_timeout(1500)
    log["rain-idle-6s"] = wait_task(page, "rain", 6)
    dry = []
    for _ in range(40):
        dry.append((chip(page, "Shuttle"), chip(page, "Jarak ke depan"), brain(page)["Keputusan"]))
        page.wait_for_timeout(250)
    stage_shot(page, "03-kering")
    canvas_into_view(page)
    page.locator(".ctl-toggle", has_text="Hujan").click()
    log["rain"] = wait_task(page, "rain", 40)
    wet = []
    for _ in range(60):
        wet.append((chip(page, "Shuttle"), chip(page, "Jarak ke depan"), brain(page)["Keputusan"]))
        page.wait_for_timeout(250)
    stage_shot(page, "03-hujan")
    gd = [num(g) for _, g, _ in dry if g]
    gw = [num(g) for _, g, _ in wet[20:] if g]
    vd = [num(v) for v, _, _ in dry]
    vw = [num(v) for v, _, _ in wet[20:]]
    log["rain-compare"] = {
        "gap-dry": [min(gd), max(gd)] if gd else None, "gap-wet": [min(gw), max(gw)] if gw else None,
        "speed-dry-max": max(vd), "speed-wet-max": max(vw),
        "follow-texts-wet": sorted({k for _, _, k in wet if k.startswith("Mengikuti")})[:3],
    }
    next_step(page)

    # ---- 4. antar 10 penumpang ----
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    seg(page, "Seluruh kampus")
    log["tool-step4"] = page.locator(".seg-btn[aria-checked='true'], .seg-btn.is-active").all_inner_texts()
    tap_world(page, 27.5, 5.0)
    log["rektorat-off"] = page.locator(".ctl-toggle", has_text="Rektorat").get_attribute("aria-checked")
    stage_shot(page, "04-rektorat-off")
    tap_world(page, 27.5, 5.0)
    log["rektorat-on"] = page.locator(".ctl-toggle", has_text="Rektorat").get_attribute("aria-checked")
    # ketuk nama halte (label) Perpustakaan, bukan gedung haltenya
    canvas_into_view(page)
    ax, ay = to_screen(page, 113.8, 21.5)
    tap_screen(page, ax - 40, ay)
    log["perpus-label-off"] = page.locator(".ctl-toggle", has_text="Perpustakaan").get_attribute("aria-checked")
    stage_shot(page, "04-perpus-off")
    tap_screen(page, ax - 40, ay)
    log["perpus-label-on"] = page.locator(".ctl-toggle", has_text="Perpustakaan").get_attribute("aria-checked")
    log["deliver-10"] = wait_task(page, "deliver-10", 200)
    log["delivered"] = readout(page, "Penumpang diantar")
    stage_shot(page, "04-antar")
    next_step(page)

    # ---- 5. satu putaran bersih, dengan pejalan kaki mendadak ----
    log["loop-now-start"] = readout(page, "Putaran sekarang")
    page.wait_for_timeout(1500)
    canvas_into_view(page)
    page.keyboard.press("j")
    page.wait_for_timeout(1200)
    log["ped-status"] = status(page)
    stage_shot(page, "05-pejalan")
    page.locator("button", has_text="Tambah pejalan kaki").click()
    page.wait_for_timeout(400)
    log["ped-toast"] = toasts(page)[-1:]
    log["clean-run"] = wait_task(page, "clean-run", 260)
    log["stats-end"] = {k: readout(page, k) for k in ["Penumpang diantar", "Pelanggaran lampu merah", "Pengereman darurat", "Putaran selesai", "Putaran sekarang", "Rata-rata waktu tunggu", "Jarak tempuh"]}
    stage_shot(page, "05-putaran")
    shot(page, "05-halaman", full=True)
    next_step(page)
    shot(page, "06-ringkasan")
    log["summary-title"] = page.locator(".summary-tasks-title").text_content() if page.locator(".summary-tasks-title").count() else None

    # ---- maju mundur semua langkah ----
    page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    for i in [0, 1, 2, 3, 4, 3, 2, 1, 0, 4, 2, 0]:
        page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        page.wait_for_timeout(350)
    for _ in range(4):
        next_step(page)
    for _ in range(4):
        prev_step(page)
    log["after-stepping"] = hook(page)["stepIndex"]

    # ---- Jeda, kecepatan, Ulangi ----
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    t_a = num(readout(page, "Waktu misi"))
    page.wait_for_timeout(2000)
    t_b = num(readout(page, "Waktu misi"))
    log["pause"] = {"paused": hook(page)["paused"], "time-frozen": t_a == t_b}
    page.locator('[data-act="pause"]').click()
    rates = {}
    for sp in ["0,5x", "2x", "1x"]:
        page.locator(".speed-wrap .seg-btn", has_text=sp).click()
        page.wait_for_timeout(300)
        a = num(readout(page, "Waktu misi"))
        page.wait_for_timeout(4000)
        b = num(readout(page, "Waktu misi"))
        rates[sp] = round((b - a) / 4.0, 2)
    log["speed-rates"] = rates
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(500)
    log["after-reset"] = {"delivered": readout(page, "Penumpang diantar"), "time": readout(page, "Waktu misi"),
                          "paused": hook(page)["paused"], "rain-kept": page.locator(".ctl-toggle", has_text="Hujan").get_attribute("aria-checked")}

    # ---- kebocoran: keluar masuk lima kali ----
    cdp = ctx.new_cdp_session(page)

    def listener_counts():
        out = {}
        for expr in ["window", "document"]:
            obj = cdp.send("Runtime.evaluate", {"expression": expr})["result"]["objectId"]
            ls = cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"]
            out[expr] = len(ls)
        return out

    base = listener_counts()
    loops = []
    for _ in range(5):
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(700)
        home_loops = hook(page)["activeLoops"]
        page.evaluate("() => { location.hash = '#/pelajaran/shuttle'; }")
        page.wait_for_timeout(1200)
        loops.append((home_loops, hook(page)["activeLoops"]))
    after = listener_counts()
    log["leak"] = {
        "listeners-before": base, "listeners-after": after, "loops(home,lesson)": loops,
        "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
        "lesson-styles": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
    }
    page.evaluate("() => { location.hash = '#/'; }")
    page.wait_for_timeout(600)
    page.keyboard.press("j")
    page.wait_for_timeout(300)
    log["final-tasks"] = hook(page)["completedTasks"]
    browser.close()

log["errors"] = errors
print(json.dumps(log, indent=1, ensure_ascii=False))
