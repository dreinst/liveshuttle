#!/usr/bin/env python3
"""Cari tanda pisah terlarang (em dash, en dash, dan dua tanda hubung berspasi) di berkas teks.

Pemakaian: python3 tests/foundation_dashcheck.py <berkas atau folder> [...]
Tanpa argumen, memeriksa seluruh proyek kecuali js/vendor dan tests/shots.
Kode keluar 1 bila ada temuan. Periksa manual: sintaks kode seperti i-- tidak ikut dicari.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERNS = [chr(0x2014), chr(0x2013), " " + "-" * 2 + " "]
EXT = (".js", ".css", ".html", ".md", ".py", ".svg", ".txt")
SKIP = ("vendor", "shots", "__pycache__")


def files(paths):
    for p in paths:
        if os.path.isdir(p):
            for base, dirs, names in os.walk(p):
                dirs[:] = [d for d in dirs if d not in SKIP]
                for n in names:
                    if n.endswith(EXT):
                        yield os.path.join(base, n)
        elif os.path.exists(p):
            yield p


def main():
    targets = sys.argv[1:] or [ROOT]
    hits = 0
    for f in files(targets):
        with open(f, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                if any(pat in line for pat in PATTERNS):
                    hits += 1
                    print(f"{os.path.relpath(f, ROOT)}:{i}: {line.rstrip()[:160]}")
    print(f"{hits} temuan")
    sys.exit(1 if hits else 0)


if __name__ == "__main__":
    main()
