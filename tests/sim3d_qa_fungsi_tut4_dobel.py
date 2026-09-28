"""Langkah 4 Tutorial: tombol 'Taruh mobil mogok' ditekan dua kali (wajar bagi pemula). Apakah tugas menyalip tetap selesai?"""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/tutorial")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-dots button[data-step='3']")
    time.sleep(0.5)
    for trial in range(2):
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["traffic"]["obstacles"] == 0 and s["ego"]["lane"] == "kiri", timeout=60)
        page.click(".s3d-tut-actions button:has-text('mobil mogok')")
        time.sleep(0.4)
        page.click(".s3d-tut-actions button:has-text('mobil mogok')")
        tx = toasts(page)[-2:]
        t0 = time.time()
        s = wait_until(page, lambda s: s["tutorial"]["done"][3], timeout=75)
        last = snap(page)
        print("uji", trial + 1, tx, "| tugas selesai:", bool(s), "setelah", round(time.time() - t0), "s nyata | perilaku", last["ego"]["behavior"], "|", last["ego"]["reason"], "| kecepatan", round(last["ego"]["speedKmh"]))
        shot(page, f"tut4_dobel_{trial + 1}.png")
        if s:
            break
        # reset: hapus rintangan lewat panel Uji, ulangi langkah
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        page.click(".s3d-dots button[data-step='3']")
        time.sleep(3)
    print("LOG", log)
    b.close()
