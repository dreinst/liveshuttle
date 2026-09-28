"""Uji pintasan papan ketik, tombol di layar, penjaga saat mengetik, dan menaruh rintangan dengan klik."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

checks = []


def ok(name, cond):
    checks.append((name, bool(cond)))


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    time.sleep(1)
    kb = page.keyboard
    for k, cam in (("1", "orbit"), ("2", "kejar"), ("3", "atas"), ("4", "kokpit")):
        kb.press(k)
        time.sleep(0.15)
        ok(f"tombol {k} kamera {cam}", snap(page)["camera"] == cam)
    kb.press("c")
    time.sleep(0.15)
    ok("C ganti kamera", snap(page)["camera"] == "orbit")
    kb.press(" ")
    time.sleep(0.15)
    ok("Spasi jeda", snap(page)["paused"] is True)
    t1 = snap(page)["simTime"]
    time.sleep(0.6)
    ok("waktu berhenti saat jeda", abs(snap(page)["simTime"] - t1) < 1e-6)
    kb.press("p")
    time.sleep(0.15)
    ok("P lanjutkan", snap(page)["paused"] is False)
    kb.press("]")
    kb.press("]")
    time.sleep(0.1)
    ok("] dua kali = 4x", snap(page)["timeScale"] == 4)
    kb.press("]")
    ok("batas atas 4x", snap(page)["timeScale"] == 4)
    kb.press("[")
    time.sleep(0.1)
    ok("[ = 2x", snap(page)["timeScale"] == 2)
    kb.press("-")
    kb.press("-")
    kb.press("-")
    time.sleep(0.1)
    ok("- sampai 0,25x", snap(page)["timeScale"] == 0.25)
    kb.press("+")
    kb.press("+")
    time.sleep(0.1)
    ok("+ = 1x", snap(page)["timeScale"] == 1)
    kb.press("h")
    time.sleep(0.2)
    ok("H buka bantuan", snap(page)["helpOpen"] is True)
    shot(page, "keys_help.png")
    kb.press("Escape")
    time.sleep(0.2)
    ok("Esc tutup bantuan", snap(page)["helpOpen"] is False)
    kb.press("?")
    time.sleep(0.2)
    ok("? buka bantuan", snap(page)["helpOpen"] is True)
    kb.press("h")
    time.sleep(0.2)
    ok("H tutup bantuan", snap(page)["helpOpen"] is False)
    lid = snap(page)["layers"]["lidar"]
    kb.press("l")
    time.sleep(0.1)
    ok("L tampilan LiDAR", snap(page)["layers"]["lidar"] != lid)
    kb.press("l")
    box = snap(page)["layers"]["boxes"]
    kb.press("k")
    time.sleep(0.1)
    ok("K kotak deteksi", snap(page)["layers"]["boxes"] != box)
    kb.press("k")
    c0 = snap(page)["counters"]
    kb.press("b")
    time.sleep(0.3)
    s = snap(page)
    ok("B rem darurat", s["counters"]["aebManual"] == c0["aebManual"] + 1 and s["ego"]["behavior"] == "Rem darurat")
    time.sleep(2.5)
    kb.press("m")
    time.sleep(0.2)
    ok("M autopilot mati", snap(page)["ego"]["autopilot"] is False)
    shot(page, "keys_manual.png")
    v0 = snap(page)["ego"]["speedKmh"]
    kb.down("ArrowUp")
    time.sleep(1.5)
    kb.up("ArrowUp")
    ok("panah atas menambah kecepatan (manual)", snap(page)["ego"]["speedKmh"] > v0 + 1 or snap(page)["ego"]["speedKmh"] > 20)
    kb.down("KeyS")
    time.sleep(1.0)
    kb.up("KeyS")
    ok("S mengerem (manual)", snap(page)["ego"]["speedKmh"] < 40)
    kb.press("m")
    time.sleep(0.3)
    ok("M autopilot nyala", snap(page)["ego"]["autopilot"] is True)
    o0 = snap(page)["traffic"]["obstacles"]
    wait_until(page, lambda s: s["ego"]["speedKmh"] > 15, 30)
    kb.press("o")
    time.sleep(0.3)
    ok("O taruh rintangan", snap(page)["traffic"]["obstacles"] == o0 + 1)
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    page.click("button:has-text('Hapus rintangan')")
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    j0 = snap(page)["counters"]["jaywalkers"]
    kb.press("j")
    s = wait_until(page, lambda s: s["counters"]["jaywalkers"] > j0, 15)
    ok("J pejalan kaki", s is not None)
    # penjaga saat mengetik
    page.evaluate("() => { const i = document.createElement('input'); i.id = 'tmpin'; document.body.append(i); }")
    page.focus("#tmpin")
    cam0 = snap(page)["camera"]
    lid0 = snap(page)["layers"]["lidar"]
    kb.type("l3 p")
    time.sleep(0.2)
    s = snap(page)
    ok("tidak aktif saat mengetik", s["camera"] == cam0 and s["layers"]["lidar"] == lid0 and s["paused"] is False)
    page.evaluate("() => document.getElementById('tmpin').remove()")
    # tombol di layar
    page.click(".s3d-seg-btn[data-value='atas']")
    ok("tombol kamera Atas", snap(page)["camera"] == "atas")
    page.click(".s3d-pause")
    ok("tombol Jeda", snap(page)["paused"] is True)
    page.click(".s3d-pause")
    page.click(".s3d-help-btn")
    ok("tombol bantuan", snap(page)["helpOpen"] is True)
    page.click(".s3d-help .s3d-primary")
    ok("tombol Tutup bantuan", snap(page)["helpOpen"] is False)
    page.click(".s3d-switch")
    ok("tombol autopilot", snap(page)["ego"]["autopilot"] is False)
    page.click(".s3d-switch")
    # klik di jalan (Mode Bebas)
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    page.click(".s3d-obs[data-type='kerucut']")
    time.sleep(0.3)
    page.click("text=Taruh dengan klik di jalan")
    ok("mode klik aktif", snap(page)["traffic"]["clickArmed"] is True)
    n0 = snap(page)["traffic"]["obstacles"]
    placed = False
    for attempt in range(6):
        pr = page.evaluate("() => { const s = window.__sim3d; const p = s.probe; return p ? s.screenOf(p.x, p.z) : null; }")
        if pr and pr["visible"]:
            page.mouse.click(pr["x"], pr["y"])
            time.sleep(0.3)
            if snap(page)["traffic"]["obstacles"] > n0:
                placed = True
                break
        time.sleep(1.0)
    ok("klik di jalan menaruh kerucut", placed)
    shot(page, "keys_click_place.png")
    kb.press("Escape")
    ok("Esc matikan mode klik", snap(page)["traffic"]["clickArmed"] is False)
    # tab tersembunyi: loop berhenti, lalu jalan lagi
    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }")
    time.sleep(0.2)
    t1 = snap(page)["simTime"]
    f1 = snap(page)["render"]["fps"]
    time.sleep(1.0)
    ok("tab tersembunyi: simulasi berhenti", abs(snap(page)["simTime"] - t1) < 1e-6)
    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }")
    time.sleep(0.6)
    ok("tab terlihat lagi: simulasi jalan", snap(page)["simTime"] > t1)
    for name, res in checks:
        print("OK " if res else "GAGAL", name)
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
