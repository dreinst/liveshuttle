"""Pemeriksaan kecil setelah perbaikan: langkah 3 tidak selesai seketika, jarak label = daftar = objek pembatas,
tombol langkah 9 tidak ganda, pengatur waktu toast tidak menumpuk, baris Berhenti di lampu, catatan autopilot."""
import re
import time
from sim3d_fix_common import *  # noqa

DIST = r"""() => {
  const a = window.__app;
  const labels = [...document.querySelectorAll('.s3d-label:not([hidden]):not(.s3d-label-range)')].map((l) => l.textContent);
  const list = [...document.querySelectorAll('.s3d-objs li:not([hidden])')].map((li) => li.querySelector('.s3d-obj-name').textContent + ' ' + li.querySelector('.s3d-obj-dist').textContent);
  return { labels, list, limiter: document.querySelector('.s3d-dl dd').textContent };
}"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "tutorial")
    ev(page, "() => window.__app.tutorial.go(2)")
    time.sleep(0.3)
    s = snap(page)
    print("langkah 3 segera setelah dibuka, selesai:", s["tutorial"]["done"][2])
    t0 = s["simTime"]
    s = wait_until(page, lambda s: s["tutorial"]["done"][2], timeout=30)
    print("langkah 3 selesai setelah", round(s["simTime"] - t0, 1), "detik simulasi")
    # jarak: jeda lalu bandingkan
    for i in range(4):
        time.sleep(2)
        ev(page, "() => { window.__app.paused = true; }")
        time.sleep(0.4)
        d = ev(page, DIST)
        lim = re.match(r"(.+?), (\d+) m", d["limiter"])
        agree = None
        if lim:
            name, m = lim.group(1), lim.group(2)
            agree = (f"{name} {m} m" in d["labels"] or not any(l.startswith(name) for l in d["labels"]), f"{name} {m} m" in d["list"])
        print("jarak | pembatas:", d["limiter"], "| label:", d["labels"][:4], "| daftar:", d["list"][:4], "| sama (label, daftar):", agree)
        ev(page, "() => { window.__app.paused = false; }")
    ev(page, "() => window.__app.tutorial.go(8)")
    time.sleep(0.3)
    acts = ev(page, "() => [...document.querySelectorAll('.s3d-tut-actions button')].map(b => b.textContent)")
    print("langkah 9 tombol aksi:", acts, "| tombol utama:", ev(page, "() => document.querySelector('.s3d-tut-nav .s3d-primary').textContent"))
    for i in range(60):
        ev(page, f"() => window.__app.toast('uji {i}')")
    time.sleep(4)
    print("timer toast tersisa setelah 60 toast:", ev(page, "() => window.__app.timers.size"))
    print("baris kota:", ev(page, "() => [...document.querySelectorAll('.s3d-dl-grid dt')].map(x => x.textContent)"), ev(page, "() => document.querySelectorAll('.s3d-dl-grid dd')[2].textContent"))
    ev(page, "() => window.__app.toggleAutopilot()")
    time.sleep(0.4)
    print("catatan autopilot di kartu tutorial terlihat:", ev(page, "() => !document.querySelector('.s3d-tut-note').hidden"))
    ev(page, "() => window.__app.setMode('bebas')")
    ev(page, "() => window.__app.setMode('tutorial')")
    time.sleep(0.4)
    print("setelah kembali ke tutorial: autopilot", snap(page)["ego"]["autopilot"], "catatan terlihat", ev(page, "() => !document.querySelector('.s3d-tut-note').hidden"))
    print("LOG", log)
    b.close()
