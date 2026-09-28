"""Uji diam: tidak ada tugas Lokalisasi yang selesai sendiri saat pelajaran dibuka dan dibiarkan.

Tiap langkah dibuka lewat titik langkah, lalu dibiarkan 20 detik (pada kecepatan 2x, jadi sekitar
40 detik waktu simulasi) tanpa menyentuh apa pun. Juga mengambil tangkapan layar tiap langkah.
Pemakaian: python3 tests/lokalisasi_verify_idle.py [--mobile]
"""
import json
import sys

from lokalisasi_verify_util import (sync_playwright, launch, new_page, open_lesson, hook, lok, console, go_step,
                                    press, stage_shot, page_shot, chips, status, text_problems)

MOBILE = "--mobile" in sys.argv
R = {"viewport": "390x844" if MOBILE else "1366x900", "steps": []}

with sync_playwright() as pw:
    br = launch(pw)
    page = new_page(br, MOBILE)
    R["ready"] = open_lesson(page)
    R["start"] = hook(page)
    page_shot(page, "idle-0-page")
    press(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
    for i in range(5):
        if i:
            go_step(page, i)
        page.wait_for_timeout(20000)
        st = lok(page)["state"]
        R["steps"].append({"step": i, "completed": hook(page)["completedTasks"], "simT": st["simT"], "errors": st["errors"],
                           "chips": chips(page), "status": status(page)})
        stage_shot(page, f"idle-{i}")
    R["safety"] = lok(page)["safety"]
    R["textProblems"] = text_problems(page)
    R["console"] = console(page)
    br.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
ok = all(not s["completed"] for s in R["steps"]) and not R["console"]
sys.exit(0 if ok else 1)
