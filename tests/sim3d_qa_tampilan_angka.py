"""QA angka yang tampil di panel: kecepatan relatif objek (masuk akal terhadap kecepatan mobil),
nilai Simpangan lajur, dan format angka Indonesia di seluruh teks HUD."""
import re
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready

ROWS_JS = r"""
() => {
  const rows = [...document.querySelectorAll('.s3d-objs li')].filter((li) => !li.hidden).map((li) => [li.querySelector('.s3d-obj-name').textContent, li.querySelector('.s3d-obj-dist').textContent, li.querySelector('.s3d-obj-rel').textContent]);
  const s = window.__sim3d;
  return { rows, v: s.ego.speedKmh, dev: s.ego.deviation, sim: s.simTime, text: document.querySelector('.s3d').innerText };
}
"""


def num(t):
    m = re.search(r"([0-9]+(?:,[0-9]+)?) m/s", t)
    return float(m.group(1).replace(",", ".")) if m else 0.0


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    page.keyboard.press("]")  # 2x
    bad = []
    devs = []
    samples = 0
    peds = 0
    badfmt = set()
    t0 = time.time()
    while time.time() - t0 < 60:
        r = page.evaluate(ROWS_JS)
        samples += 1
        devs.append(abs(r["dev"]))
        ego_ms = r["v"] / 3.6
        for name, dist, rel in r["rows"]:
            if name == "Pejalan kaki":
                peds += 1
                if num(rel) > ego_ms + 3.0:
                    bad.append((round(r["sim"], 1), name, dist, rel, f"ego {r['v']:.0f} km/jam = {ego_ms:.1f} m/s"))
        for m in re.findall(r"\b\d+\.\d+\b", r["text"]):
            badfmt.add(m)
        time.sleep(0.25)
    print("sampel", samples, "baris pejalan kaki", peds)
    print("kecepatan relatif pejalan kaki > kecepatan mobil + 3 m/s:", len(bad))
    for x in bad[:12]:
        print("  ", x)
    devs.sort()
    print("simpangan lajur: maks", round(devs[-1], 3), "p95", round(devs[int(0.95 * len(devs))], 3), "median", round(devs[len(devs) // 2], 3))
    print("angka berformat titik desimal di HUD:", sorted(badfmt)[:20])
    print("logs", log)
    b.close()
