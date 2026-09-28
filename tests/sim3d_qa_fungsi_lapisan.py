"""Lapisan tampilan: LiDAR, kotak deteksi, bidang kamera, jalur rencana dimatikan semua lalu dilihat."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.keyboard.press("l")
    page.keyboard.press("k")
    page.click(".s3d-toggle:has-text('Bidang kamera')")
    page.click(".s3d-toggle:has-text('Jalur rencana')")
    page.evaluate("() => document.activeElement.blur()")
    time.sleep(1)
    print(snap(page)["layers"], page.evaluate("() => document.querySelectorAll('.s3d-labels > *:not([hidden])').length"), page.evaluate("() => [...document.querySelectorAll('.s3d-labels > *')].filter(e => e.style.display !== 'none' && !e.hidden).map(e => e.textContent).slice(0, 6)"))
    shot(page, "lapisan_mati.png")
    b.close()
