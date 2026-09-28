"""Kamera Atas dan Orbit jauh saat Kabut, Hujan, Malam: apakah kota masih terlihat (langkah 4 dan 8, Mode Bebas)."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, sync_playwright

STAT = """() => { const c = document.querySelector('canvas.s3d-canvas'); const g = document.createElement('canvas'); g.width = 120; g.height = 80;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0, 120, 80); const d = x.getImageData(0, 0, 120, 80).data; let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; s += l; s2 += l * l; n++; }
  const m = s / n; return { mean: Math.round(m), std: Math.round(Math.sqrt(s2 / n - m * m)) }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/tutorial")
    wait_ready(page)
    time.sleep(1)
    out = []
    for w in ["cerah", "hujan", "kabut", "malam"]:
        page.evaluate(f"() => document.querySelector('.s3d-group[data-hl=cuaca] button[data-value={w}]').click()")
        for step in (4, 8):
            page.click(f".s3d-dots button[data-step='{step - 1}']")
            time.sleep(1.5)
            page.evaluate("() => { const c = document.querySelector('canvas.s3d-canvas'); }")
            # preserveDrawingBuffer mati, jadi pakai tangkapan layar untuk dilihat; statistik dari screenshot
            path = shot(page, f"fog_step{step}_{w}.png")
            out.append((w, step, snap(page)["camera"], path.split('/')[-1]))
    for x in out:
        print(x)
    print("LOG", log)
    b.close()
