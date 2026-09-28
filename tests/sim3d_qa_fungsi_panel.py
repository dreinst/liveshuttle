"""Mode Bebas: slider, cuaca, kualitas, lampu adaptif/tetap, tab mode, lipat panel, pintasan saat fokus di kolom."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


def set_range(page, sel, val):
    page.evaluate("([s, v]) => { const e = document.querySelector(s); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }", [sel, val])


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)

    # kecepatan target: slider dengan papan ketik (Home/End) dan nilai
    page.focus("#s3d-target")
    page.keyboard.press("End")
    time.sleep(0.3)
    R["target_end"] = (snap(page)["ego"]["targetKmh"], text(page, "#s3d-target-out"))
    # pintasan tidak aktif saat fokus di slider
    j0 = snap(page)["counters"]["jaywalkers"]
    page.keyboard.press("j")
    page.keyboard.press("l")
    time.sleep(0.3)
    s = snap(page)
    R["keys_blocked_on_slider"] = (s["counters"]["jaywalkers"] == j0, s["layers"]["lidar"])
    blur(page)
    # tunggu mobil mencapai 70 di jalan lurus
    s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 60, timeout=60)
    R["reach_70"] = round(s["ego"]["speedKmh"]) if s else None
    page.focus("#s3d-target")
    page.keyboard.press("Home")
    time.sleep(0.3)
    R["target_home"] = (snap(page)["ego"]["targetKmh"], text(page, "#s3d-target-out"))
    blur(page)
    s = wait_until(page, lambda s: s["ego"]["speedKmh"] < 11 and s["ego"]["speedKmh"] > 8, timeout=30)
    R["reach_10"] = (round(s["ego"]["speedKmh"], 1), s["ego"]["limiter"]) if s else None
    set_range(page, "#s3d-target", 50)
    time.sleep(0.3)

    # kepadatan lalu lintas dan pejalan kaki
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    set_range(page, "#s3d-traf", 0)
    set_range(page, "#s3d-ped", 0)
    time.sleep(6)
    s = snap(page)
    R["density_0"] = (s["traffic"]["cars"], s["traffic"]["peds"], page.evaluate("() => [...document.querySelectorAll('.s3d-panel[data-tab=uji] output')].map(o => o.textContent)"))
    set_range(page, "#s3d-traf", 60)
    set_range(page, "#s3d-ped", 80)
    time.sleep(10)
    s = snap(page)
    R["density_max"] = (s["traffic"]["cars"], s["traffic"]["peds"], s["traffic"]["npcOverlaps"], page.evaluate("() => [...document.querySelectorAll('.s3d-panel[data-tab=uji] output')].map(o => o.textContent)"), round(s["render"]["fps"]))
    shot(page, "panel_density_max.png")
    set_range(page, "#s3d-traf", 30)
    set_range(page, "#s3d-ped", 40)

    # cuaca: semua mode lewat tombol
    wx = []
    for w in ["hujan", "kabut", "malam", "cerah"]:
        page.click(f".s3d-group[data-hl=cuaca] button[data-value={w}]")
        time.sleep(4)
        s = snap(page)
        wx.append((w, s["weather"], s["sensing"]["lidarRange"], s["sensing"]["cameraRange"], round(s["ego"]["speedKmh"]), s["ego"]["limiter"], text(page, ".s3d-panel[data-tab=persepsi] .s3d-small"), toasts(page)[-1:]))
        shot(page, f"panel_wx_{w}.png")
    R["weather"] = wx

    # kualitas
    q = []
    for v in ["hemat", "tinggi", "standar"]:
        page.select_option(".s3d-select", v)
        time.sleep(1.2)
        s = snap(page)
        q.append((v, s["quality"], s["render"]["pixelRatio"], s["render"]["calls"], round(s["render"]["fps"])))
    R["quality"] = q
    blur(page)

    # lampu: waktu tetap lalu adaptif
    page.click(".s3d-panel[data-tab=kota] .s3d-panel-head")
    time.sleep(0.3)
    page.click(".s3d-panel[data-tab=kota] button[data-value=tetap]")
    time.sleep(0.4)
    R["sig_tetap"] = (snap(page)["signalMode"], text(page, ".s3d-panel[data-tab=kota] .s3d-small"), toasts(page)[-1:])
    time.sleep(25)
    R["kota_after_25s_tetap"] = page.evaluate("() => [...document.querySelectorAll('.s3d-panel[data-tab=kota] dd')].map(d => d.textContent)")
    page.click(".s3d-panel[data-tab=kota] button[data-value=adaptif]")
    time.sleep(0.4)
    R["sig_adaptif"] = (snap(page)["signalMode"], toasts(page)[-1:])
    page.click(".s3d-toggle:has-text('Garis antrean')")
    time.sleep(0.3)
    R["queues_toggle"] = snap(page)["layers"]["queues"]
    page.click(".s3d-toggle:has-text('Garis antrean')")
    shot(page, "panel_kota.png")

    # lipat panel
    heads = page.evaluate("() => [...document.querySelectorAll('.s3d-right .s3d-panel-head')].map(h => h.textContent + ':' + h.getAttribute('aria-expanded'))")
    page.click(".s3d-panel[data-tab=persepsi] .s3d-panel-head")
    time.sleep(0.3)
    R["collapse"] = (heads, page.evaluate("() => document.querySelector('.s3d-panel[data-tab=persepsi] .s3d-panel-head').getAttribute('aria-expanded')"), page.evaluate("() => getComputedStyle(document.querySelector('#s3d-body-persepsi')).display"))
    page.click(".s3d-panel[data-tab=persepsi] .s3d-panel-head")

    # tab mode
    page.click(".s3d-modes button[data-mode=tutorial]")
    time.sleep(0.6)
    s = snap(page)
    R["tab_tutorial"] = (s["mode"], page.evaluate("location.hash"), s["camera"], page.evaluate("() => getComputedStyle(document.querySelector('.s3d-left')).display"))
    page.click(".s3d-tut-min")
    time.sleep(0.4)
    R["tut_min"] = page.evaluate("() => document.querySelector('.s3d-tut').classList.contains('is-min')")
    shot(page, "panel_tut_min.png")
    page.click(".s3d-tut-pill")
    time.sleep(0.3)
    R["tut_restore"] = page.evaluate("() => document.querySelector('.s3d-tut').classList.contains('is-min')")
    page.click(".s3d-dots button[data-step='6']")
    time.sleep(0.5)
    R["dot_jump"] = snap(page)["tutorial"]["step"]
    page.click(".s3d-modes button[data-mode=bebas]")
    time.sleep(0.6)
    s = snap(page)
    R["tab_bebas"] = (s["mode"], page.evaluate("location.hash"), page.evaluate("() => getComputedStyle(document.querySelector('.s3d-left')).display"), toasts(page)[-1:])
    dump(R)
    print("LOG", log)
    b.close()
