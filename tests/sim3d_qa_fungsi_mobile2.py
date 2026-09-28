"""Ponsel: sentuh tahan tombol Gas/Kiri saat jalan kosong, dan ketuk jalan di beberapa titik ruas."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=True)
    cdp = ctx.new_cdp_session(page)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    # jalan kosong supaya gas tidak ditahan AEB
    page.tap(".s3d-tab[data-tab=uji]")
    page.evaluate("() => { for (const [s, v] of [['#s3d-traf', 0], ['#s3d-ped', 0]]) { const e = document.querySelector(s); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); } }")
    wait_until(page, lambda s: s["traffic"]["cars"] == 0, timeout=40)
    page.tap(".s3d-tab[data-tab=kontrol]")
    page.tap(".s3d-switch")
    time.sleep(0.4)
    btns = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('.s3d-drive-btn')].map(b => { const q = b.getBoundingClientRect(); return [b.dataset.key, [q.x + q.width / 2, q.y + q.height / 2]]; }))")
    trace = []
    x, y = btns["up"]
    v0 = snap(page)["ego"]["speedKmh"]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(8):
        time.sleep(0.25)
        trace.append((round(snap(page)["ego"]["speedKmh"], 1), text(page, ".is-gas .s3d-bar-val"), page.evaluate("() => [...document.querySelectorAll('.s3d-drive-btn.is-down')].map(b => b.textContent)")))
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    time.sleep(0.3)
    after = page.evaluate("() => [...document.querySelectorAll('.s3d-drive-btn.is-down')].map(b => b.textContent)")
    R["touch_gas"] = {"v0": round(v0, 1), "trace": trace, "down_after_release": after}
    x, y = btns["left"]
    h0 = snap(page)["ego"]["heading"]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    time.sleep(0.6)
    st = text(page, ".is-steer .s3d-bar-val")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    R["touch_left"] = (round(snap(page)["ego"]["heading"] - h0, 3), st)
    # dua jari: gas dan kiri bersamaan (multi-sentuh)
    xg, yg = btns["up"]
    xl, yl = btns["left"]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": xg, "y": yg, "id": 1}, {"x": xl, "y": yl, "id": 2}]})
    time.sleep(0.6)
    multi = (text(page, ".is-gas .s3d-bar-val"), text(page, ".is-steer .s3d-bar-val"), page.evaluate("() => [...document.querySelectorAll('.s3d-drive-btn.is-down')].map(b => b.textContent)"))
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    R["touch_multi"] = multi
    shot(page, "mob2_manual.png")
    page.tap(".s3d-switch")
    time.sleep(0.5)
    R["ap_on"] = (snap(page)["ego"]["autopilot"], toasts(page)[-1:])
    # ketuk jalan: cari titik di ruas yang sama, di belakang mobil (lajur arah berlawanan)
    page.tap(".s3d-tab[data-tab=uji]")
    page.tap(".s3d-toggle:has-text('Taruh dengan klik')")
    page.tap(".s3d-pause")
    time.sleep(0.3)
    res = []
    for d in [-60, -45, -35, 35, 45, 60]:
        for lat in [0, 3.5, -3.5, 7]:
            pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * {d} - Math.sin(h) * {lat}, z = e.z + Math.sin(h) * {d} + Math.cos(h) * {lat}; const p = s.screenOf(x, z); const el = document.elementFromPoint(p.x, p.y); return {{...p, onCanvas: !!(el && el.classList.contains('s3d-canvas'))}}; }}")
            if not pt["onCanvas"]:
                continue
            n0 = snap(page)["traffic"]["obstacles"]
            page.touchscreen.tap(pt["x"], pt["y"])
            time.sleep(0.35)
            res.append((d, lat, snap(page)["traffic"]["obstacles"] - n0, (toasts(page) or [""])[-1][:50]))
    R["tap_place"] = res
    shot(page, "mob2_tap.png")
    dump(R)
    print("LOG", log)
    b.close()
