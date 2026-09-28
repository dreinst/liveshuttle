"""Mode Bebas: semua pintasan papan ketik dan tombol di layar (desktop 1366x900)."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def key(page, k, wait=0.35):
    page.keyboard.press(k)
    time.sleep(wait)
    return snap(page)


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def neutral(page):
    # pindahkan fokus dari kolom isian tanpa mengklik kanvas
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)
    neutral(page)

    # kamera 1 sampai 4 dan C
    cams = []
    for k in ["1", "2", "3", "4"]:
        cams.append(key(page, k)["camera"])
    shot(page, "bebas_kokpit.png")
    cyc = [key(page, "c")["camera"] for _ in range(4)]
    R["kamera_1_4"] = cams
    R["kamera_C"] = cyc
    R["kamera_pressed"] = page.evaluate("() => [...document.querySelectorAll('.s3d-group[data-hl=kamera] button')].map(b => b.dataset.value + ':' + b.getAttribute('aria-pressed'))")

    # jeda: Space dan P
    s0 = snap(page)
    s1 = key(page, " ", 0.2)
    t1 = s1["simTime"]
    time.sleep(1.0)
    s2 = snap(page)
    R["space_pause"] = (s1["paused"], round(s2["simTime"] - t1, 3), text(page, ".s3d-pause .s3d-pt"), page.evaluate("() => !document.querySelector('.s3d-paused').hidden"))
    s3 = key(page, " ", 0.2)
    R["space_resume"] = s3["paused"]
    s4 = key(page, "p", 0.2)
    s5 = key(page, "P", 0.2)
    R["P_toggle"] = (s4["paused"], s5["paused"])

    # kecepatan waktu
    sp = []
    for k in ["[", "[", "[", "-"]:
        s = key(page, k, 0.25)
        sp.append((k, s["timeScale"], text(page, ".s3d-speed")))
    R["slow_disabled"] = page.evaluate("() => document.querySelector('.s3d-time .s3d-icon').disabled")
    for k in ["]", "]", "]", "+", "=", "]"]:
        s = key(page, k, 0.25)
        sp.append((k, s["timeScale"], text(page, ".s3d-speed")))
    R["fast_disabled"] = page.evaluate("() => [...document.querySelectorAll('.s3d-time .s3d-icon')][1].disabled")
    # laju simTime pada 4x
    a = snap(page)["simTime"]
    time.sleep(2)
    bb = snap(page)["simTime"]
    R["rate_at_4x"] = round((bb - a) / 2, 2)
    for k in ["-", "-"]:
        s = key(page, k, 0.25)
        sp.append((k, s["timeScale"], text(page, ".s3d-speed")))
    R["speed_keys"] = sp
    # tombol di layar
    page.click(".s3d-time .s3d-icon >> nth=0")
    time.sleep(0.3)
    R["btn_slow"] = (snap(page)["timeScale"], text(page, ".s3d-speed"))
    page.click(".s3d-time .s3d-icon >> nth=1")
    time.sleep(0.3)
    R["btn_fast"] = (snap(page)["timeScale"], text(page, ".s3d-speed"))
    page.click(".s3d-pause")
    time.sleep(0.3)
    R["btn_pause"] = snap(page)["paused"]
    # Spasi saat fokus di tombol Jeda: tombol ditekan (sekali), bukan dua kali
    page.keyboard.press(" ")
    time.sleep(0.3)
    R["space_on_pausebtn"] = snap(page)["paused"]
    if snap(page)["paused"]:
        page.click(".s3d-pause")
    neutral(page)

    # bantuan H, ?, Escape
    s = key(page, "h")
    R["H_open"] = s["helpOpen"]
    shot(page, "bebas_help.png")
    s = key(page, "Escape")
    R["esc_close"] = s["helpOpen"]
    s = key(page, "?")
    R["?_open"] = s["helpOpen"]
    # tombol lain tidak bekerja saat bantuan terbuka
    j0 = s["counters"]["jaywalkers"]
    s = key(page, "j")
    R["J_blocked_in_help"] = s["counters"]["jaywalkers"] == j0
    s = key(page, "?")
    R["?_close"] = s["helpOpen"]
    page.click(".s3d-help-btn")
    time.sleep(0.3)
    R["helpbtn_open"] = snap(page)["helpOpen"]
    page.click(".s3d-help .s3d-primary")
    time.sleep(0.3)
    R["helpclose_btn"] = snap(page)["helpOpen"]
    neutral(page)

    # L dan K
    s = key(page, "l")
    s2 = key(page, "l")
    R["L"] = (s["layers"]["lidar"], s2["layers"]["lidar"])
    s = key(page, "k")
    s2 = key(page, "k")
    R["K"] = (s["layers"]["boxes"], s2["layers"]["boxes"])
    # tombol toggle di panel
    for name, sel in [("fov", "Bidang kamera"), ("path", "Jalur rencana")]:
        page.click(f".s3d-toggle:has-text('{sel}')")
        time.sleep(0.3)
        a = snap(page)["layers"][name]
        page.click(f".s3d-toggle:has-text('{sel}')")
        time.sleep(0.3)
        R["toggle_" + name] = (a, snap(page)["layers"][name])

    # B rem darurat manual
    c0 = snap(page)["counters"]
    s = key(page, "b", 0.5)
    R["B"] = (s["counters"]["aebManual"] - c0["aebManual"], s["counters"]["emergencyBrakes"] - c0["emergencyBrakes"], s["ego"]["behavior"], text(page, ".s3d-safety .s3d-safe:nth-child(5) .s3d-safe-val"))
    page.click(".s3d-danger:has-text('Rem darurat')")
    time.sleep(0.4)
    R["B_btn"] = snap(page)["counters"]["aebManual"] - c0["aebManual"]
    neutral(page)
    time.sleep(3)

    # O rintangan (pilihan terakhir), tombol per jenis, hapus
    s0 = snap(page)
    s = key(page, "o", 0.5)
    R["O"] = (s["traffic"]["obstacles"] - s0["traffic"]["obstacles"], toasts(page)[-1:])
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")  # buka panel Uji (terlipat di desktop)
    time.sleep(0.3)
    R["uji_open"] = page.evaluate("() => document.querySelector('.s3d-panel[data-tab=uji] .s3d-panel-head').getAttribute('aria-expanded')")
    placed = []
    for t in ["kerucut", "kardus", "mogok"]:
        n0 = snap(page)["traffic"]["obstacles"]
        page.click(f".s3d-obs[data-type={t}]")
        time.sleep(0.5)
        placed.append((t, snap(page)["traffic"]["obstacles"] - n0, toasts(page)[-1:]))
    R["obs_buttons"] = placed
    shot(page, "bebas_obstacles.png")
    s = key(page, "o", 0.5)
    R["O_after_mogok"] = toasts(page)[-1:]
    page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
    time.sleep(0.4)
    R["hapus"] = (snap(page)["traffic"]["obstacles"], toasts(page)[-1:])
    page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
    time.sleep(0.4)
    R["hapus_kosong"] = toasts(page)[-1:]

    # J lewat tombol
    j0 = snap(page)["counters"]["jaywalkers"]
    page.click(".s3d-warnbtn")
    time.sleep(3)
    R["J_btn"] = snap(page)["counters"]["jaywalkers"] - j0
    neutral(page)

    # klik di jalan untuk menaruh rintangan
    page.click(".s3d-obs[data-type=kerucut]")
    time.sleep(0.3)
    page.click(".s3d-obs[data-type=kerucut]")  # dua kali: kerucut kedua
    page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
    neutral(page)
    key(page, "3", 0.8)
    page.click(".s3d-toggle:has-text('Taruh dengan klik')")
    time.sleep(0.3)
    R["click_armed"] = (snap(page)["traffic"]["clickArmed"], page.evaluate("() => !document.querySelector('.s3d-placehint').hidden"), text(page, ".s3d-placehint span"))
    page.keyboard.press(" ")  # jeda supaya titik tidak bergeser
    time.sleep(0.3)
    pt = page.evaluate("() => { const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * 32, z = e.z + Math.sin(h) * 32; return s.screenOf(x, z); }")
    n0 = snap(page)["traffic"]["obstacles"]
    page.mouse.click(pt["x"], pt["y"])
    time.sleep(0.5)
    R["click_place"] = (pt, snap(page)["traffic"]["obstacles"] - n0, toasts(page)[-1:])
    # klik di atap gedung atau trotoar
    page.mouse.click(60, 400)
    time.sleep(0.4)
    R["click_offroad"] = toasts(page)[-1:]
    shot(page, "bebas_clickplace.png")
    page.keyboard.press("Escape")
    time.sleep(0.3)
    R["esc_disarm"] = snap(page)["traffic"]["clickArmed"]
    page.keyboard.press(" ")
    time.sleep(0.3)
    R["resumed"] = not snap(page)["paused"]

    dump(R)
    print("LOG", log)
    b.close()
