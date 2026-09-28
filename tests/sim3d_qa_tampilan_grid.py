"""QA tampilan: 4 kamera x 4 cuaca di desktop 1366x900 lewat rute asli #/simulator/bebas.
Juga mencatat draw call dan segitiga (renderer.info) per kombinasi."""
import sys
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, shot, dump

MODE = sys.argv[1] if len(sys.argv) > 1 else "bebas"
CAMS = ["orbit", "kejar", "atas", "kokpit"]
WX = ["cerah", "hujan", "kabut", "malam"]

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/{MODE}")
    s = wait_ready(page)
    print("ready", s["mode"], s["camera"], s["weather"], s["quality"], s["render"])
    time.sleep(3)
    rows = []
    for wx in WX:
        page.click(f".s3d-top [aria-label='Cuaca'] [data-value='{wx}']")
        time.sleep(0.8)
        for i, cam in enumerate(CAMS):
            page.keyboard.press(str(i + 1))
            time.sleep(2.2)
            s = snap(page)
            r = s["render"]
            rows.append((wx, cam, r["calls"], r["triangles"], round(r["fps"], 1), s["perception"]["count"], s["sensing"]["points"]))
            shot(page, f"desk_{MODE}_{wx}_{cam}.png")
    for r in rows:
        print(r)
    print("logs", log)
    b.close()
