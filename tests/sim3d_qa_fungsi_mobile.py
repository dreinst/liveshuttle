"""Ponsel 390x844 (sentuh): tab lembar bawah, tombol kemudi manual dengan sentuhan tahan, taruh rintangan dengan ketuk jalan."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def tab(page, name):
    page.tap(f".s3d-tab[data-tab={name}]")
    time.sleep(0.4)


def hold(cdp, x, y, secs):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    time.sleep(secs)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=True)
    cdp = ctx.new_cdp_session(page)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)
    tabs = page.evaluate("() => [...document.querySelectorAll('.s3d-tab')].map(t => t.textContent + (t.hidden ? '(tersembunyi)' : '') + ':' + t.getAttribute('aria-selected'))")
    R["tabs"] = tabs
    shot(page, "mob_bebas_start.png")
    # Tampilan: kamera dan cuaca
    tab(page, "tampilan")
    page.tap(".s3d-group[data-hl=kamera] button[data-value=atas]")
    time.sleep(0.5)
    R["cam_tap"] = snap(page)["camera"]
    shot(page, "mob_tampilan.png")
    # Uji: taruh dengan ketuk
    tab(page, "uji")
    page.tap(".s3d-obs[data-type=kerucut]")
    time.sleep(0.4)
    R["obs_tap"] = (snap(page)["traffic"]["obstacles"], toasts(page)[-1:])
    page.tap(".s3d-toggle:has-text('Taruh dengan klik')")
    time.sleep(0.3)
    R["armed"] = (snap(page)["traffic"]["clickArmed"], text(page, ".s3d-placehint span"))
    page.tap(".s3d-pause")
    time.sleep(0.3)
    res = []
    for d, lat in [(30, 3.5), (40, 0), (35, 3.5), (50, 3.5)]:
        pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * {d} - Math.sin(h) * {lat}, z = e.z + Math.sin(h) * {d} + Math.cos(h) * {lat}; return s.screenOf(x, z); }}")
        n0 = snap(page)["traffic"]["obstacles"]
        top = page.evaluate(f"() => {{ const el = document.elementFromPoint({pt['x']}, {pt['y']}); return el ? el.className : null; }}")
        page.touchscreen.tap(pt["x"], pt["y"])
        time.sleep(0.4)
        res.append((d, lat, round(pt["x"]), round(pt["y"]), top, snap(page)["traffic"]["obstacles"] - n0, toasts(page)[-1:]))
    R["tap_place"] = res
    shot(page, "mob_tap_place.png")
    page.tap(".s3d-placehint button")
    page.tap(".s3d-pause")
    time.sleep(0.3)
    # Kontrol: autopilot mati, tombol Gas ditahan
    tab(page, "kontrol")
    page.tap(".s3d-switch")
    time.sleep(0.5)
    s = snap(page)
    vis = page.evaluate("() => { const d = document.querySelector('.s3d-drive'); const r = d.getBoundingClientRect(); return { hidden: d.hidden, x: r.x, y: r.y, w: r.width, h: r.height, btns: [...d.querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(); return [b.textContent, Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; }) }; }")
    R["drive_pad"] = (s["ego"]["autopilot"], vis)
    shot(page, "mob_manual.png")
    time.sleep(3)
    v0 = snap(page)["ego"]["speedKmh"]
    gas = [b for b in vis["btns"] if b[0] == "Gas"][0]
    hold(cdp, gas[1] + gas[3] / 2, gas[2] + gas[4] / 2, 2.0)
    v1 = snap(page)["ego"]["speedKmh"]
    kiri = [b for b in vis["btns"] if b[0] == "Kiri"][0]
    h0 = snap(page)["ego"]["heading"]
    hold(cdp, kiri[1] + kiri[3] / 2, kiri[2] + kiri[4] / 2, 0.8)
    h1 = snap(page)["ego"]["heading"]
    rem = [b for b in vis["btns"] if b[0] == "Rem"][0]
    hold(cdp, rem[1] + rem[3] / 2, rem[2] + rem[4] / 2, 1.5)
    v2 = snap(page)["ego"]["speedKmh"]
    R["touch_drive"] = {"v_before": round(v0, 1), "v_after_gas": round(v1, 1), "heading_change_left": round(h1 - h0, 3), "v_after_rem": round(v2, 1), "keys": page.evaluate("() => [...document.querySelectorAll('.s3d-drive-btn')].map(b => b.classList.contains('is-down'))")}
    shot(page, "mob_manual_after.png")
    page.tap(".s3d-switch")
    time.sleep(0.5)
    R["ap_back"] = (snap(page)["ego"]["autopilot"], toasts(page)[-1:])
    # bantuan lewat tombol ?
    page.tap(".s3d-help-btn")
    time.sleep(0.4)
    R["help"] = snap(page)["helpOpen"]
    shot(page, "mob_help.png")
    page.tap(".s3d-help .s3d-primary")
    # lembar diperkecil
    page.tap(".s3d-sheet-btn")
    time.sleep(0.5)
    R["sheet_min"] = (page.evaluate("() => document.querySelector('.s3d').classList.contains('is-sheet-min')"), snap(page)["render"]["height"])
    shot(page, "mob_sheet_min.png")
    page.tap(".s3d-sheet-btn")
    time.sleep(0.5)
    R["sheet_max"] = snap(page)["render"]["height"]
    dump(R)
    print("LOG", log)
    b.close()
