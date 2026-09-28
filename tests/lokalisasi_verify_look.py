"""Tangkapan layar pemeriksaan visual pelajaran Lokalisasi (QA akhir).

1. Lompatan multipath di zona gedung tinggi: titik "pantulan" harus di dinding gedung.
2. LiDAR di langkah pencocokan peta: urutan 6 bingkai berjarak 150 ms (harus tenang).
3. Saat dijeda, dua bingkai berjarak 700 ms harus identik (tidak ada animasi terpisah).
4. Zebra cross: penyeberang ditambah lewat kait uji, mobil menunggu.
5. prefers-reduced-motion: tanpa sapuan, tanpa galat.
Pemakaian: python3 tests/lokalisasi_verify_look.py [--mobile]
"""
import json
import sys

from lokalisasi_verify_util import (sync_playwright, launch, new_page, open_lesson, lok, console, go_step, press, toggle,
                                    stage_shot, status, chips, SHOTS)

MOBILE = "--mobile" in sys.argv
R = {"viewport": "390x844" if MOBILE else "1366x900"}
TAG = "m" if MOBILE else "d"


def same(page, a, b):
    return page.evaluate("""([a, b]) => new Promise(async (res) => {
        const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
        const [x, y] = await Promise.all([load(a), load(b)]);
        const c = document.createElement('canvas'); c.width = x.width; c.height = x.height;
        const g = c.getContext('2d'); g.drawImage(x, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
        g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i+1] - d2[i+1]) + Math.abs(d1[i+2] - d2[i+2]) > 12) n++;
        res(n);
    })""", [a, b])


def canvas_url(page):
    return page.evaluate("() => document.querySelector('.stage canvas.sim-canvas').toDataURL('image/png')")


with sync_playwright() as pw:
    br = launch(pw)
    page = new_page(br, MOBILE)
    open_lesson(page)

    # 1. multipath
    go_step(page, 1)
    toggle(page, "GPS")
    got = 0
    for _ in range(150):
        st = status(page)
        if "memantul" in st:
            page.wait_for_timeout(250)
            stage_shot(page, f"look-multipath-{got}")
            got += 1
            if got >= 3:
                break
            page.wait_for_timeout(1800)
        page.wait_for_timeout(150)
    R["multipathShots"] = got

    # zona dengan label tinggi gedung
    page.wait_for_timeout(500)
    stage_shot(page, "look-zona")

    # 2. LiDAR
    go_step(page, 4)
    toggle(page, "GPS")
    toggle(page, "Fusi (filter Kalman)")
    toggle(page, "Pencocokan peta (LiDAR)")
    page.wait_for_timeout(9000)
    for k in range(6):
        stage_shot(page, f"look-lidar-{k}")
        page.wait_for_timeout(150)
    R["lidarPoints"] = lok(page)["state"]["lidarPoints"]

    # 3. jeda: dua bingkai harus sama
    press(page, page.locator('[data-act="pause"]'))
    page.wait_for_timeout(400)
    a = canvas_url(page)
    page.wait_for_timeout(700)
    b = canvas_url(page)
    R["pausedDiffPixels"] = same(page, a, b)
    press(page, page.locator('[data-act="pause"]'))

    # 4. zebra cross: tunggu sampai mobil dekat zebra lalu tambah penyeberang
    waited = None
    for _ in range(400):
        st = lok(page)["state"]
        cw = page.evaluate("() => window.__lokalisasi.route.crossing")
        ahead = (cw["s0"] - st["s"]) % 557.1
        if 25 < ahead < 45:
            page.evaluate("() => { window.__lokalisasi.spawnPedestrian(true); window.__lokalisasi.spawnPedestrian(false); }")
        st = lok(page)["state"]
        if st["yielding"] and st["speed"] < 0.2:
            waited = st
            page.wait_for_timeout(600)
            stage_shot(page, "look-zebra")
            R["zebraChips"] = chips(page)
            R["zebraStatus"] = status(page)
            break
        page.wait_for_timeout(100)
    R["zebraWait"] = waited
    R["safety"] = lok(page)["safety"]
    R["console"] = console(page)

    # 5. prefers-reduced-motion
    p2 = new_page(br, MOBILE, reduced=True)
    open_lesson(p2)
    go_step(p2, 4)
    toggle(p2, "Pencocokan peta (LiDAR)")
    p2.wait_for_timeout(6000)
    stage_shot(p2, "look-reduced")
    R["reducedConsole"] = console(p2)
    br.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
