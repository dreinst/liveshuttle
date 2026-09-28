"""Mode Bebas: kamera Atas saat Kabut."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-group[data-hl=cuaca] button[data-value=kabut]")
    page.click(".s3d-group[data-hl=kamera] button[data-value=atas]")
    time.sleep(4)
    shot(page, "bebas_kabut_atas.png")
    b.close()
