"""Foto dekat kanvas pelajaran Perencanaan Rute untuk memeriksa detail gambar.

Pemakaian: python3 tests/rute_closeups.py   (server di port 8115)
"""
import json
import sys

from PIL import Image

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session, SHOTS  # noqa: E402

out = {}


def crop(name, cells_box, s, scale=2):
    """Potong area sel (c0, r0, c1, r1) dari foto kanvas lalu perbesar."""
    t = s.map_transform()
    img = Image.open(SHOTS + name + ".png")
    box = t["box"]
    c0, r0, c1, r1 = cells_box
    x0 = t["x"] - box["x"] + c0 * 25 * t["s"]
    y0 = t["y"] - box["y"] + r0 * 25 * t["s"]
    x1 = t["x"] - box["x"] + (c1 + 1) * 25 * t["s"]
    y1 = t["y"] - box["y"] + (r1 + 1) * 25 * t["s"]
    part = img.crop((int(x0), int(y0), int(x1), int(y1)))
    part = part.resize((part.width * scale, part.height * scale), Image.LANCZOS)
    part.save(SHOTS + name + "-zoom.png")


with Session() as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/rute", 1500)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    # langkah 3: rute sudah ada; tutup dan macet di peta
    s.page.locator(".step-dot[data-go='2']").dispatch_event("click")
    s.page.wait_for_timeout(400)
    route = s.route_cells()
    out["route3"] = route
    s.page.evaluate("() => window.scrollTo(0, 0)")
    # hover di sel jalan
    x, y = s.cell_xy(5, 10)
    s.page.mouse.move(x, y)
    s.tap_cell(9, 12)  # tutup sel jalan (mungkin bukan di rute)
    s.page.locator(".seg-btn", has_text="Macet").first.click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.drag_cells([(14, 12), (14, 13), (14, 14)])
    s.page.mouse.move(*s.cell_xy(18, 12))
    s.page.wait_for_timeout(300)
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + "cu-edit.png")
    crop("cu-edit", (6, 9, 20, 15), s)
    out["status_edit"] = s.status()
    # pindah: seret tujuan
    s.page.locator(".seg-btn", has_text="Pindah").first.click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    gx, gy = s.cell_xy(22, 1)
    s.page.mouse.move(gx, gy)
    s.page.mouse.down()
    tx, ty = s.cell_xy(18, 4)
    s.page.mouse.move(tx, ty, steps=8)
    s.page.wait_for_timeout(200)
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + "cu-drag.png")
    crop("cu-drag", (15, 0, 23, 6), s)
    s.page.mouse.up()
    s.page.wait_for_timeout(200)
    out["status_drag"] = s.status()
    s.click_text(".btn", "Cari rute")
    s.page.wait_for_timeout(4000)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + "cu-after-move.png")
    out["status_after_move"] = s.status()

    # langkah 5: mobil melaju lalu jalan buntu memaksa putar balik
    s.page.locator(".step-dot[data-go='4']").dispatch_event("click")
    s.page.wait_for_timeout(400)
    out["route5"] = s.route_cells()
    s.click_text(".btn", "Jalankan mobil")
    s.page.wait_for_timeout(600)
    s.page.locator('[data-act="pause"]').click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(200)
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + "cu-drive.png")
    out["status_drive"] = s.status()
    out["hook"] = s.hook()
    out["errors"] = s.errors
print(json.dumps(out, ensure_ascii=False))
