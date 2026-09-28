"""Jalankan ulang semua skrip QA pelajaran (lewat situs_rerun_lesson_qa.py) secara paralel, desktop dan ponsel.

Pemakaian: python3 tests/situs_rerun_all.py [--jobs 4] [--only rute,kuis] [--kind indep|qa]
Hasil lengkap tiap skrip ada di /tmp/situs_rerun/<nama>.txt.
"""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LESSONS = ["level-otomasi", "sensor", "persepsi", "lokalisasi", "rute", "kontrol", "keputusan", "jarak-aman", "shuttle", "kuis"]
jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 4
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else LESSONS
kind = sys.argv[sys.argv.index("--kind") + 1] if "--kind" in sys.argv else "indep"
os.makedirs("/tmp/situs_rerun", exist_ok=True)

items = []
for lid in only:
    script = f"{lid}_indep_qa.py" if kind == "indep" else f"{lid}_qa.py"
    if lid == "sensor" and kind == "qa":
        script = "foundation_sensor_qa.py"
    if not os.path.exists(os.path.join(HERE, script)):
        continue
    for mobile in (False, True):
        items.append((lid, script, mobile))


def run(item):
    lid, script, mobile = item
    tag = f"{script[:-3]}{'-m' if mobile else '-d'}"
    cmd = [sys.executable, os.path.join(HERE, "situs_rerun_lesson_qa.py"), script] + (["--mobile"] if mobile else [])
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=os.path.dirname(HERE))
        text = p.stdout + "\n--- stderr ---\n" + p.stderr
        code = p.returncode
    except subprocess.TimeoutExpired as e:
        text = f"TIMEOUT\n{e.stdout or ''}"
        code = "timeout"
    with open(f"/tmp/situs_rerun/{tag}.txt", "w") as f:
        f.write(text)
    return tag, code


with ThreadPoolExecutor(jobs) as ex:
    res = list(ex.map(run, items))
for tag, code in res:
    print(f"{'OK ' if code == 0 else 'BAD'} {tag} exit={code}")
print(f"{sum(1 for _, c in res if c == 0)} dari {len(res)} lolos")
