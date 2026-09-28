"""QA pelajaran Misi Shuttle Otonom (jalan asli sekitar Ma Chung), satu skrip untuk semuanya.

Pemakaian: python3 tests/shuttle_qa.py [--mobile]   (server: python3 tests/serve.py 8249)
Isi: kelima tugas diselesaikan lewat UI, lalu pelajar "nakal" mencoba melanggar aturan keras (pejalan
kaki uji berulang, batas 30 km/jam, 8 kali x 2x, hujan, tutup dan buka jalan). Di awal, uji model
Node (tests/shuttle_model.mjs, normal dan --blind) ikut dijalankan pada versi desktop.
"""
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8249/"
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots", "shuttle")
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)
out = {"mobile": MOBILE, "errors": [], "problems": []}

if not MOBILE:
    for extra in ([], ["--blind"]):
        r = subprocess.run(["node", os.path.join(HERE, "shuttle_model.mjs"), "20", "4", *extra], capture_output=True, text=True)
        out["model" + ("_blind" if extra else "")] = [l for l in r.stdout.splitlines() if l.startswith(("seed", "ATURAN"))]
        if r.returncode:
            out["problems"].append("uji model gagal " + " ".join(extra))


def js(expr):
    return page.evaluate(expr)


def snap():
    return js("() => window.__lessonSafety.snapshot()")


def done():
    return js("() => window.__simotonom.completedTasks")


def wait_task(task, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = snap()
        if s["redRuns"] or s["pedContacts"]:
            out["problems"].append(f"aturan keras dilanggar saat {task}: {s['events']}")
        if task in done():
            return round(time.time() - t0, 1)
        page.wait_for_timeout(500)
    out["problems"].append(f"tugas {task} tidak selesai dalam {timeout} detik")
    return None


def click(text, sel="button"):
    page.locator(sel, has_text=text).first.click()
    page.wait_for_timeout(250)


def shot(name):
    page.locator(".stage").first.screenshot(path=os.path.join(SHOTS, f"qa-{TAG}-{name}.png"))


def next_step():
    page.locator(".step-nav .btn-primary").first.click()
    page.wait_for_timeout(500)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    vp = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True) if MOBILE else dict(viewport={"width": 1366, "height": 900})
    page = browser.new_context(**vp).new_page()
    page.on("console", lambda m: m.type in ("error", "warning") and "ReadPixels" not in m.text and out["errors"].append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: out["errors"].append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    js("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
    page.wait_for_function("() => window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=30000)

    # aksesibilitas dasar dan target sentuh
    out["canvas"] = js("() => { const c = document.querySelector('.sim-canvas'); return [c.getAttribute('role'), (c.getAttribute('aria-label') || '').slice(0, 60)]; }")
    out["smallTargets"] = js("""() => [...document.querySelectorAll('.controls button, .controls input:not([type=checkbox])')]
        .filter(e => e.offsetParent).map(e => [e.textContent.trim().slice(0, 24) || e.type, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 40)""")
    shot("0-awal")

    # 1. halte pertama
    click("4 kali", ".seg-btn")
    out["t_first_stop"] = wait_task("first-stop", 120)
    shot("1-halte")
    # 2. tutup jalan: ketuk jalan di rute (tampilan Seluruh rute), lalu tombol
    next_step()
    click("Seluruh rute", ".seg-btn")
    page.locator(".sim-canvas").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    pt = js("() => { const a = window.__lessonSafety.api, v = window.__lessonSafety.view, p = a.routePoints(); const q = p[Math.min(p.length - 1, Math.floor(p.length * 0.6))]; const s = v.worldToScreen(q.x, q.y); const r = v.canvas.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; }")
    (page.touchscreen.tap if MOBILE else page.mouse.click)(pt[0], pt[1])
    page.wait_for_timeout(600)
    out["closed_by_tap"] = snap()["closed"]
    out["toasts"] = js("() => [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())")
    if not done().count("closure"):
        click("Tutup jalan di depan")
    out["t_closure"] = wait_task("closure", 60)
    shot("2-tutup")
    click("Ikuti shuttle", ".seg-btn")
    # 3. hujan (langkah ini membuka semua jalan dan menaruh angkot pelan di depan)
    next_step()
    click("Hujan", "[role=switch]")
    out["t_rain"] = wait_task("rain", 90)
    out["brain_rain"] = js("() => [...document.querySelectorAll('.sh-brain li')].map(li => li.textContent.trim())")
    shot("3-hujan")
    click("Hujan", "[role=switch]")
    # 4. antar 10 penumpang
    next_step()
    click("8 kali", ".seg-btn")
    click("2x", ".seg-btn")
    out["t_deliver"] = wait_task("deliver-10", 600)
    shot("4-antar")
    # 5. satu putaran bersih
    next_step()
    out["t_clean"] = wait_task("clean-run", 900)
    out["after_tasks"] = {k: snap()[k] for k in ("redRuns", "pedContacts", "otherCollisions", "loops", "delivered", "time")}

    # pejalan kaki uji saat shuttle berhenti di halte: menunggu dan menyebut alasannya
    page.wait_for_function("() => window.__lessonSafety.snapshot().mode === 'dwell'", timeout=120000)
    js("""() => { const b = (t) => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t).click();
        b('1 kali'); b('0,5x'); b('Pejalan kaki menyeberang'); }""")
    page.wait_for_timeout(400)
    out["pedWaitDwell"] = js("() => document.querySelector('.sh-pedwait').textContent")
    click("8 kali", ".seg-btn")
    click("2x", ".seg-btn")
    # pelajar nakal: semua tombol sekaligus, berulang
    slider = page.locator("input[type=range]").first
    slider.focus()
    page.keyboard.press("End")
    waits = set()
    for i in range(24):
        click("Pejalan kaki menyeberang")
        if i % 4 == 1:
            click("Tutup jalan di depan")
        if i % 4 == 3:
            click("Buka semua jalan")
        if i % 6 == 2:
            click("Hujan", "[role=switch]")
        page.wait_for_timeout(1200)
        w = js("() => document.querySelector('.sh-pedwait').textContent")
        if w:
            waits.add(w)
        s = snap()
        if s["redRuns"] or s["pedContacts"]:
            out["problems"].append(f"aturan keras dilanggar (nakal {i}): {s['events']}")
        if i == 10:
            shot("5-nakal")
    s = snap()
    out["abuse"] = {k: s[k] for k in ("redRuns", "pedContacts", "otherCollisions", "pedTests", "emergencies", "limitKmh", "time", "clamps")}
    out["pedWaitTexts"] = sorted(waits)
    if s["pedTests"] < 3:
        out["problems"].append("pejalan kaki uji terlalu jarang muncul")
    # tampilan pejalan kaki uji dari dekat
    click("1 kali", ".seg-btn")
    click("1x", ".seg-btn")
    for _ in range(4):
        click("Pejalan kaki menyeberang")
        try:
            page.wait_for_function("() => window.__lessonSafety.api.peds.peds.some(p => p.test)", timeout=30000)
            break
        except Exception:
            out.setdefault("pedWaitLate", []).append(js("() => document.querySelector('.sh-pedwait').textContent"))
    page.wait_for_timeout(1500)
    shot("6-pejalan-uji")
    out["status"] = js("() => document.querySelector('[role=status]').textContent.trim()")
    out["done"] = done()
    page.screenshot(path=os.path.join(SHOTS, f"qa-{TAG}-7-halaman.png"), full_page=True)
    # tinggalkan pelajaran: loop berhenti
    page.goto(BASE + "#/", wait_until="load")
    page.wait_for_timeout(600)
    out["leftHook"] = js("() => !!window.__lessonSafety")
    browser.close()

if len(out["done"]) != 5 or out["errors"] or out["smallTargets"] or out["leftHook"] or not out["pedWaitDwell"]:
    out["problems"].append("tugas, console, target sentuh, atau loop tertinggal bermasalah")
print(json.dumps(out, indent=1, ensure_ascii=False))
sys.exit(1 if out["problems"] else 0)
