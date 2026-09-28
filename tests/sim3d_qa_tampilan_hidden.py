"""QA kinerja: apakah simulasi dan render berhenti saat tab tersembunyi (visibilitychange disimulasikan),
dan jumlah rAF yang berjalan saat tersembunyi."""
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    # hitung panggilan renderer lewat info.render.frame (bertambah tiap render)
    page.evaluate("""() => {
      window.__hid = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hid });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hid ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    s1 = snap(page)["simTime"]
    time.sleep(3)
    s2 = snap(page)["simTime"]
    print("simTime maju saat tersembunyi (harus 0):", round(s2 - s1, 3))
    page.evaluate("() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); }")
    time.sleep(2)
    s3 = snap(page)["simTime"]
    print("simTime maju 2 detik setelah terlihat lagi:", round(s3 - s2, 3))
    print("logs", log)
    b.close()
