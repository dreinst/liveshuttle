#!/usr/bin/env python3
"""Jalankan tests/smoke.py untuk semua rute pelajaran (dan beranda serta rute 3D) di desktop dan ponsel.

Pemakaian: python3 tests/situs_smoke_all.py [awalan] [--only home,sensor] [--no-3d] [--jobs 4]
Server harus sudah berjalan di port 8221 atau env PORT (python3 tests/serve.py PORT).
"""

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = os.environ.get("PORT", "8221")
LESSONS = ["level-otomasi", "sensor", "persepsi", "lokalisasi", "rute", "kontrol", "keputusan", "jarak-aman", "shuttle", "kuis"]

prefix = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "smoke"
jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 4
routes = [("home", "#/")] + [(l, f"#/pelajaran/{l}") for l in LESSONS]
if "--no-3d" not in sys.argv:
    routes += [("shuttle3d-panduan", "#/shuttle-3d/panduan"), ("shuttle3d-jelajah", "#/shuttle-3d/jelajah"), ("shuttle3d", "#/shuttle-3d"),
               ("simulator", "#/simulator"), ("simulator-tutorial", "#/simulator/tutorial"), ("simulator-bebas", "#/simulator/bebas")]
if "--only" in sys.argv:
    only = sys.argv[sys.argv.index("--only") + 1].split(",")
    routes = [r for r in routes if r[0] in only]


def run(item):
    (name, route), mobile = item
    tag = "m" if mobile else "d"
    out = os.path.join(HERE, "shots", "situs", f"{prefix}-{name}-{tag}")
    cmd = [sys.executable, os.path.join(HERE, "smoke.py"), "--port", PORT, "--route", route, "--out", out, "--wait-ms", "3000"]
    if mobile:
        cmd.append("--mobile")
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    try:
        s = json.loads(p.stdout)
    except Exception:
        return f"{name}-{tag}", {"ok": False, "raw": p.stdout[-600:] + p.stderr[-600:]}
    hook = s.get("hook") or {}
    return f"{name}-{tag}", {
        "ok": s["ok"],
        "problems": s["problems"],
        "errors": s["consoleErrors"][:4],
        "warnings": s["consoleWarnings"][:4],
        "pageErrors": s["pageErrors"][:4],
        "variance": s.get("canvas", {}).get("variance"),
        "status": hook.get("lessonStatus") or hook.get("simStatus") or hook.get("routeName"),
        "route": hook.get("route"),
    }


items = [(r, m) for r in routes for m in (False, True)]
with ThreadPoolExecutor(jobs) as ex:
    results = dict(ex.map(run, items))
bad = {k: v for k, v in results.items() if not v["ok"]}
for k, v in results.items():
    print(f"{'OK ' if v['ok'] else 'BAD'} {k:28s} status={v.get('status')} var={v.get('variance')} {'' if v['ok'] else json.dumps(v, ensure_ascii=False)}")
print(f"\n{len(results) - len(bad)} dari {len(results)} lolos")
sys.exit(1 if bad else 0)
