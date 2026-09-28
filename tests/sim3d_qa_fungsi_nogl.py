"""Tanpa WebGL: pesan ramah dan tautan; plus kualitas di layar DPR 2 dan kualitas bawaan ponsel."""
import time
from sim3d_qa_fungsi_util import BASE, CHROME, launch, new_page, snap, wait_ready, shot, text, sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--disable-3d-apis", "--disable-webgl", "--disable-webgl2"])
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/tutorial")
    ok = False
    for i in range(40):
        time.sleep(0.5)
        t = page.evaluate("() => document.querySelector('.s3d-fail, .sim3d-fallback')?.innerText")
        if t:
            ok = True
            break
        if i in (12, 24):
            page.reload()
    print("fallback:", ok, repr(t))
    shot(page, "nogl.png")
    if ok:
        links = page.evaluate("() => [...document.querySelectorAll('.s3d-fail a, .sim3d-fallback a')].map(a => a.textContent + ' -> ' + a.getAttribute('href'))")
        print("links", links)
        page.click(".s3d-fail a >> nth=0")
        time.sleep(1.5)
        print("setelah klik:", page.evaluate("location.hash"), page.evaluate("() => document.querySelectorAll('.s3d').length"), page.evaluate("() => document.querySelectorAll('link[data-sim3d]').length"))
    print("LOG", log)
    b.close()

    b = launch(p)
    ctx = b.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    page.logs = []
    page.resets = []
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    for v in ["hemat", "standar", "tinggi"]:
        page.select_option(".s3d-select", v)
        time.sleep(1)
        s = snap(page)
        cw = page.evaluate("() => { const c = document.querySelector('canvas.s3d-canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight]; }")
        print("DPR2", v, s["render"]["pixelRatio"], cw, s["render"]["calls"])
    b.close()

    b = launch(p)
    ctx, page, log = new_page(b, mobile=True)
    page.goto(f"{BASE}/#/simulator/bebas")
    s = wait_ready(page)
    time.sleep(1)
    s = snap(page)
    print("ponsel: kualitas", s["quality"], "pixelRatio", s["render"]["pixelRatio"], "size", s["render"]["width"], s["render"]["height"])
    b.close()
