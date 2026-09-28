"""Kabut dilihat dari kamera jauh (Atas 95 m, langkah 4 dan 8 tutorial, Orbit jauh) dan dari kokpit.
Ukur simpangan baku kecerahan di area panggung: nilai kecil berarti layar abu-abu datar."""
import io
import time
from sim3d_fix_common import *  # noqa

STD = r"""async () => {
  const cv = document.querySelector('.s3d-canvas');
  const r = cv.getBoundingClientRect();
  return { w: r.width, h: r.height, x: r.left, y: r.top };
}"""


def lum_std(page, clip):
    from PIL import Image
    import statistics
    png = page.screenshot(clip=clip)
    im = Image.open(io.BytesIO(png)).convert("L").resize((200, 120))
    px = list(im.getdata())
    return round(statistics.pstdev(px), 1)


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    time.sleep(1)
    r = ev(page, STD)
    # daerah tengah panggung di antara panel
    clip = {"x": r["x"] + 360, "y": r["y"] + 120, "width": r["w"] - 720, "height": r["h"] - 220}
    for wx in ("cerah", "kabut"):
        ev(page, f"() => window.__app.setWeather('{wx}')")
        for cam, opts in (("atas", {}), ("atas", {"height": 150}), ("orbit", {"dist": 110}), ("kokpit", {}), ("kejar", {})):
            ev(page, "([m, o]) => window.__app.setCamera(m, Object.assign({ reset: true }, o))", [cam, opts])
            time.sleep(1.5)
            name = f"kabut_{wx}_{cam}_{opts.get('height', opts.get('dist', ''))}.png"
            shot(page, name)
            print(wx, cam, opts, "std kecerahan", lum_std(page, clip), name)
    # tutorial: langkah 7 pilih kabut, lalu langkah 8
    ctx2, page2, log2 = new_page(b)
    open_sim(page2, "tutorial")
    ev(page2, "() => window.__app.tutorial.go(6)")
    ev(page2, "() => window.__app.setWeather('kabut')")
    ev(page2, "() => window.__app.tutorial.go(3)")
    time.sleep(1.5)
    shot(page2, "kabut_tut_step4.png")
    print("langkah 4 cuaca", snap(page2)["weather"], "std", lum_std(page2, clip))
    ev(page2, "() => window.__app.tutorial.go(7)")
    time.sleep(1.5)
    shot(page2, "kabut_tut_step8.png")
    toasts = ev(page2, "() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")
    print("langkah 8 cuaca", snap(page2)["weather"], "std", lum_std(page2, clip), toasts)
    print("LOG", log, log2)
    b.close()
