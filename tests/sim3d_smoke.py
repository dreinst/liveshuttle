"""Uji asap: muat harness, tunggu beberapa detik, simpan tangkapan layar dan cetak snapshot."""
import sys
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, shot, dump
from playwright.sync_api import sync_playwright

mode = sys.argv[1] if len(sys.argv) > 1 else "tutorial"
mobile = len(sys.argv) > 2 and sys.argv[2] == "mobile"
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 6

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode={mode}")
    wait_ready(page)
    time.sleep(secs)
    s = snap(page)
    shot(page, f"smoke_{mode}_{'m' if mobile else 'd'}.png")
    dump({k: s[k] for k in ("mode", "camera", "weather", "ego", "counters", "traffic", "render", "sensing", "perception")})
    print("LOG:", "\n".join(log) or "(kosong)")
    b.close()
