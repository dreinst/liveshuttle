"""Pintasan setelah memakai kolom Kualitas dan slider dengan mouse: apakah pintasan masih bekerja?"""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    # pilih Tinggi lewat papan ketik pada select (fokus tetap di select), lalu tekan H untuk bantuan
    page.select_option(".s3d-select", "tinggi")
    page.focus(".s3d-select")
    time.sleep(0.5)
    print("sebelum H:", snap(page)["quality"], "fokus:", page.evaluate("document.activeElement.className"))
    page.keyboard.press("h")
    time.sleep(0.5)
    s = snap(page)
    print("setelah H:", "kualitas", s["quality"], "bantuan terbuka", s["helpOpen"])
    page.keyboard.press("?")
    time.sleep(0.3)
    print("setelah ?:", snap(page)["helpOpen"], snap(page)["quality"])
    # slider kecepatan target diklik dengan mouse, lalu tekan J dan L
    box = page.locator("#s3d-target").bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.8, box["y"] + box["height"] / 2)
    time.sleep(0.3)
    s0 = snap(page)
    page.keyboard.press("j")
    page.keyboard.press("l")
    page.keyboard.press("2")
    time.sleep(0.4)
    s1 = snap(page)
    print("setelah klik slider: target", s0["ego"]["targetKmh"], "| J menambah pejalan kaki?", s1["counters"]["jaywalkers"] - s0["counters"]["jaywalkers"], "| L mengubah lidar?", s0["layers"]["lidar"] != s1["layers"]["lidar"], "| kamera", s0["camera"], "->", s1["camera"], "| fokus", page.evaluate("document.activeElement.id"))
    print("LOG", log)
    b.close()
