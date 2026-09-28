#!/usr/bin/env python3
"""Uji asap (smoke test) SimOtonom dengan Playwright.

Pemakaian:
  python3 tests/smoke.py --port 8100 --route "#/pelajaran/sensor" --out tests/shots/nama/sensor
  python3 tests/smoke.py --port 8100 --route "#/" --out tests/shots/nama/home --mobile --wait-ms 2500

Yang diperiksa:
  - pesan console bertipe error dan warning, serta event pageerror (targetnya nol)
  - kanvas utama (kanvas terlihat paling besar) tidak kosong: variasi piksel harus di atas ambang
  - tangkapan layar disimpan ke <out>.png (atau persis <out> bila sudah berakhiran .png)

Keluaran: ringkasan JSON di stdout. Kode keluar 0 bila lolos, 1 bila ada masalah.
Server statis harus sudah berjalan, misalnya:
  python3 -m http.server 8100 --bind 127.0.0.1 --directory <root proyek>
"""

import argparse
import io
import json
import os
import re
import struct
import sys
import zlib

from playwright.sync_api import sync_playwright

CHROME = (
    "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
WEBGL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def png_pixels(data):
    """Kembalikan (lebar, tinggi, daftar (r, g, b)) dari PNG. Pakai Pillow bila ada."""
    try:
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = img.size
        img.thumbnail((200, 200))
        getter = getattr(img, "get_flattened_data", None) or img.getdata
        return w, h, list(getter())
    except ImportError:
        pass
    # dekoder PNG minimal (8 bit, RGB/RGBA, tanpa interlace) sebagai cadangan
    pos = 8
    chunks = []
    w = h = ctype = 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            w, h, _depth, ctype = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            chunks.append(body)
        pos += 12 + length
    raw = zlib.decompress(b"".join(chunks))
    bpp = 4 if ctype == 6 else 3
    stride = w * bpp
    prev = bytearray(stride)
    pixels = []
    i = 0
    step = max(1, h // 150)
    for y in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if y % step == 0:
            for x in range(0, w, max(1, w // 150)):
                o = x * bpp
                pixels.append((line[o], line[o + 1], line[o + 2]))
    return w, h, pixels


def variance(pixels):
    if not pixels:
        return 0.0
    lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels]
    mean = sum(lum) / len(lum)
    return sum((v - mean) ** 2 for v in lum) / len(lum)


def main():
    ap = argparse.ArgumentParser(description="Smoke test SimOtonom")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--route", default="#/", help='hash rute, misalnya "#/pelajaran/sensor"')
    ap.add_argument("--out", required=True, help="awalan path tangkapan layar (tanpa .png)")
    ap.add_argument("--mobile", action="store_true", help="viewport 390x844, sentuh, DPR 2")
    ap.add_argument("--wait-ms", type=int, default=2500, help="tunggu setelah halaman dimuat")
    ap.add_argument("--webgl", action="store_true", help="paksa WebGL perangkat lunak (SwiftShader)")
    ap.add_argument("--full-page", action="store_true", help="tangkap seluruh halaman")
    ap.add_argument("--min-variance", type=float, default=12.0, help="ambang variasi piksel kanvas")
    ap.add_argument("--ignore", action="append", default=[], help="regex pesan console yang diabaikan (boleh berulang)")
    ap.add_argument("--allow-warnings", action="store_true", help="jangan gagal karena warning")
    args = ap.parse_args()

    url = f"http://{args.host}:{args.port}/{args.route}"
    shot = args.out if args.out.endswith(".png") else args.out + ".png"
    os.makedirs(os.path.dirname(os.path.abspath(shot)), exist_ok=True)
    # pesan driver WebGL yang muncul karena uji ini sendiri membaca piksel kanvas (bukan dari aplikasi)
    builtin_ignore = [r"GPU stall due to ReadPixels"]
    ignore = [re.compile(p) for p in builtin_ignore + args.ignore]
    use_webgl = args.webgl or args.route.startswith("#/simulator")

    errors, warnings, page_errors = [], [], []
    summary = {"route": args.route, "url": url, "mobile": args.mobile, "screenshot": shot}

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=WEBGL_ARGS if use_webgl else [])
        if args.mobile:
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True
            )
        else:
            context = browser.new_context(viewport={"width": 1366, "height": 900})
        page = context.new_page()

        def on_console(msg):
            text = msg.text
            if any(r.search(text) for r in ignore):
                return
            loc = msg.location or {}
            where = f" ({loc.get('url', '')}:{loc.get('lineNumber', '')})" if loc.get("url") else ""
            if msg.type == "error":
                errors.append(text + where)
            elif msg.type == "warning":
                warnings.append(text + where)

        page.on("console", on_console)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        page.goto(url, wait_until="load")
        page.wait_for_timeout(args.wait_ms)

        # kanvas utama = kanvas terlihat dengan area terbesar
        box = page.evaluate(
            """() => {
              let best = null;
              for (const c of document.querySelectorAll('canvas')) {
                const r = c.getBoundingClientRect();
                const area = r.width * r.height;
                if (r.width < 20 || r.height < 20) continue;
                if (!best || area > best.area) best = { area, x: r.left, y: r.top, w: r.width, h: r.height };
              }
              return best;
            }"""
        )
        canvas = {"found": bool(box)}
        if box:
            page.evaluate("(y) => window.scrollTo(0, Math.max(0, window.scrollY + y - 80))", box["y"])
            page.wait_for_timeout(200)
            handle = page.evaluate_handle(
                """() => {
                  let best = null, area = 0;
                  for (const c of document.querySelectorAll('canvas')) {
                    const r = c.getBoundingClientRect();
                    if (r.width * r.height > area) { area = r.width * r.height; best = c; }
                  }
                  return best;
                }"""
            )
            data = handle.as_element().screenshot()
            w, h, px = png_pixels(data)
            var = variance(px)
            canvas.update({"width": round(box["w"]), "height": round(box["h"]), "variance": round(var, 1), "blank": var < args.min_variance})
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(150)
        summary["canvas"] = canvas

        page.screenshot(path=shot, full_page=args.full_page)
        summary["hook"] = page.evaluate("() => window.__simotonom ? JSON.parse(JSON.stringify(window.__simotonom)) : null")
        browser.close()

    summary["consoleErrors"] = errors
    summary["consoleWarnings"] = warnings
    summary["pageErrors"] = page_errors
    problems = []
    if errors:
        problems.append(f"{len(errors)} console error")
    if warnings and not args.allow_warnings:
        problems.append(f"{len(warnings)} console warning")
    if page_errors:
        problems.append(f"{len(page_errors)} page error")
    if canvas.get("blank"):
        problems.append("kanvas utama tampak kosong")
    summary["problems"] = problems
    summary["ok"] = not problems
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    sys.exit(0 if summary["ok"] else 1)


if __name__ == "__main__":
    main()
