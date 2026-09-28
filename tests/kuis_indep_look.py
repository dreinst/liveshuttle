#!/usr/bin/env python3
"""Tangkapan layar Kuis Akhir setelah animasi selesai, untuk dinilai secara visual.

Pemakaian: python3 tests/kuis_indep_look.py --port 8140 [--mobile] [--reduced]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kuis_indep_qa import CHROME, SHOTS, Learner, new_context, attach_console  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8140)
ap.add_argument("--mobile", action="store_true")
ap.add_argument("--reduced", action="store_true")
args = ap.parse_args()
base = f"http://127.0.0.1:{args.port}/"
tag = ("m" if args.mobile else "d") + ("-rm" if args.reduced else "")
msgs = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    ctx = new_context(b, args.mobile, reduced=args.reduced)
    page = ctx.new_page()
    attach_console(page, msgs)
    L = Learner(page, args.mobile, "look-" + tag)
    page.goto(base + "#/pelajaran/kuis", wait_until="load")
    L.wait_ready()
    L.shot("a-soal-full", full=True)
    L.answer(False, "click")
    page.wait_for_timeout(700)
    L.shot("b-salah")
    L.next()
    L.answer(True, "key")
    page.wait_for_timeout(700)
    L.shot("c-benar")
    L.shot("c-benar-full", full=True)
    # sisa soal: 9 benar lagi (total 10) supaya gagal
    for i in range(2, 17):
        L.next("click")
        L.answer(i < 10, "click")
    page.wait_for_timeout(300)
    L.next("click")
    page.wait_for_timeout(1300)
    L.shot("d-hasil")
    L.shot("d-hasil-full", full=True)
    # scroll ke tengah pembahasan
    page.locator(".kz-rev").nth(3).scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    L.shot("e-pembahasan")
    b.close()
print("pesan console:", msgs)
