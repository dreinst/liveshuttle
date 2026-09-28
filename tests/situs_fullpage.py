"""Tangkapan layar satu halaman penuh beranda (desktop dan ponsel) dan pemeriksaan teks referensi.

Pemakaian: python3 tests/situs_fullpage.py [awalan]
"""

import json
import sys

from situs_util import BASE, browser, new_page, shot

prefix = sys.argv[1] if len(sys.argv) > 1 else "full"
BANNED = [
    "Simulator Kendaraan Otonom",
    "Belajar cara mobil tanpa pengemudi melihat, berpikir, dan bergerak",
    "Mode Tutorial",
    "Mode Bebas",
    "Apa yang dilihat mobil",
    "Objek pembatas",
    "Uji skenario",
    "Kota pintar",
    "SimOtonom",
    "Simulator 3D",
    "jangkauan deteksi 60 m",
]
out = {}
with browser([]) as b:
    for mobile in (False, True):
        tag = "m" if mobile else "d"
        ctx, page, con = new_page(b, mobile)
        page.goto(BASE + "#/", wait_until="load")
        page.wait_for_timeout(2500)
        text = page.evaluate("() => document.body.innerText + ' ' + document.title + ' ' + [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ')")
        hits = [p for p in BANNED if p.lower() in text.lower()]
        shot(page, f"{prefix}-home-{tag}", full_page=True)
        # panel navigasi pelajaran terbuka
        btn = page.locator(".menu-toggle" if mobile else ".nav-lessons")
        btn.click()
        page.wait_for_timeout(300)
        shot(page, f"{prefix}-nav-{tag}")
        page.keyboard.press("Escape")
        out[tag] = {"bannedHits": hits, "title": page.title(), **con.summary()}
        ctx.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
