"""Jalankan smoke.py untuk rute-rute milik foundation (beranda, pelajaran sensor, cadangan, simulator)."""
import json
import subprocess
import sys

PORT = sys.argv[1] if len(sys.argv) > 1 else "8100"
RUNS = [
    ("#/", "home-desktop", ["--full-page"]),
    ("#/", "home-mobile", ["--mobile", "--full-page"]),
    ("#/pelajaran/sensor", "sensor-desktop", []),
    ("#/pelajaran/sensor", "sensor-mobile", ["--mobile"]),
    ("#/pelajaran/kuis", "fallback-kuis-mobile", ["--mobile", "--ignore", "404"]),
    ("#/simulator/bebas", "sim3d-bebas", ["--wait-ms", "5000"]),
    ("#/tidak-ada", "unknown-route", []),
]
ok_all = True
for route, name, extra in RUNS:
    cmd = [sys.executable, "tests/smoke.py", "--port", PORT, "--route", route, "--out", f"tests/shots/foundation/{name}"] + extra
    out = subprocess.run(cmd, capture_output=True, text=True)
    try:
        d = json.loads(out.stdout)
        print(f"{name:22s} ok={d['ok']} problems={d['problems']} variance={d['canvas'].get('variance')} route={d['hook']['route']} status={d['hook'].get('lessonStatus') or d['hook'].get('simStatus')}")
        for e in d["consoleErrors"] + d["consoleWarnings"] + d["pageErrors"]:
            print("   ", e[:200])
        ok_all &= d["ok"]
    except Exception:
        print(name, "GAGAL", out.stderr[-500:])
        ok_all = False
sys.exit(0 if ok_all else 1)
