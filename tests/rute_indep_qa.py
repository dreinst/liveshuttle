"""QA independen pelajaran Perencanaan Rute: semua tugas lewat UI, uji negatif, tombol shell.

Pemakaian: python3 tests/rute_indep_qa.py [--mobile]   (server di port 8135)
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_indep_util import Session, log  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
out = {"mobile": MOBILE, "checks": {}, "fail": []}


def check(name, ok, info=None):
    out["checks"][name] = {"ok": bool(ok), "info": info}
    if not ok:
        out["fail"].append(name)
    log(("OK  " if ok else "FAIL"), name, info if info is not None else "")


with Session(mobile=MOBILE) as S:
    p = S.page
    S.go("#/pelajaran/rute", 1500)
    h = S.hook()
    check("load-ready", h["lessonStatus"] == "ready" and h["stepIndex"] == 0, h)

    # ---------- tidak ada tugas yang selesai sendiri ----------
    for i in range(5):
        S.goto_step(i)
        p.wait_for_timeout(1500)
    S.goto_step(0)
    check("no-accidental-tasks-idle", S.hook()["completedTasks"] == [], S.hook()["completedTasks"])

    # ---------- langkah 1: A* ----------
    S.stage_into_view() if MOBILE else None
    check("step1-astar-selected", "is-active" in (S.seg("A*").get_attribute("class") or "") or S.seg("A*").get_attribute("aria-checked") == "true",
          S.seg("A*").get_attribute("aria-checked"))
    S.button("Cari rute").click()
    p.wait_for_timeout(900)
    mid_status = S.status()
    check("search-animates", "sedang mencari" in mid_status, mid_status)
    S.shot(f"{TAG}-s1-searching")
    t = S.wait_task("first-route", 40)
    check("task-first-route", t is not None, t)
    st = S.status()
    check("s1-status-route", "menemukan rute" in st, st)
    S.shot(f"{TAG}-s1-found")

    # ---------- langkah 2: bandingkan ----------
    S.next_step()
    check("s2-preset-dijkstra", S.seg("Dijkstra").get_attribute("aria-checked") == "true", S.seg("Dijkstra").get_attribute("aria-checked"))
    # hanya satu algoritma tidak cukup
    S.button("Cari rute").click()
    p.wait_for_timeout(300)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(1200)
    check("compare-not-done-with-one", "compare" not in S.hook()["completedTasks"])
    S.seg("A*").click()
    S.button("Cari rute").click()
    t = S.wait_task("compare", 40)
    check("task-compare", t is not None, t)
    rows = p.locator(".grp-compare tbody tr").all_inner_texts()
    note = p.locator(".compare-note").inner_text()
    check("compare-table", len(rows) == 2 and "35" in rows[0] and "137" in rows[1], {"rows": rows, "note": note})
    S.shot(f"{TAG}-s2-compare", full=MOBILE)

    # ---------- langkah 3: jalan ditutup ----------
    S.next_step()
    base = S.route()
    cells = base["cells"]
    check("s3-preset-route", S.status().startswith("A* menemukan rute"), S.status())
    # negatif: tutup sel di luar rute lalu cari rute
    S.stage_into_view() if MOBILE else None
    off_route = (22, 14) if (22, 14) not in [tuple(c) for c in cells] else (1, 1)
    S.tap_cell(*off_route)
    S.button("Cari rute").click()
    p.wait_for_timeout(300)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(1200)
    check("closure-not-done-off-route", "closure" not in S.hook()["completedTasks"], S.status())
    # buka lagi, lalu tutup sel di rute
    S.stage_into_view() if MOBILE else None
    S.tap_cell(*off_route)
    base = S.route()
    cells = [tuple(c) for c in base["cells"]]
    target = cells[len(cells) // 2]
    S.tap_cell(*target)
    p.wait_for_timeout(300)
    stale_status = S.status()
    check("closure-stale-status", "Peta berubah" in stale_status, stale_status)
    S.shot(f"{TAG}-s3-closed")
    S.button("Cari rute").click()
    t = S.wait_task("closure", 40)
    check("task-closure", t is not None, t)
    new = S.route(closed=[list(target)])
    check("closure-new-route-avoids", tuple(target) not in [tuple(c) for c in new["cells"]], new["cells"][:5])
    S.shot(f"{TAG}-s3-replanned")

    # ---------- langkah 4: macet ----------
    S.next_step()
    check("s4-preset-tool-macet", S.seg("Macet").get_attribute("aria-checked") == "true")
    base = S.route()
    cells = [tuple(c) for c in base["cells"]]
    # negatif: macet di luar rute
    S.stage_into_view() if MOBILE else None
    off4 = next(c for c in [(1, 1), (5, 1), (9, 1)] if c not in cells)
    S.tap_cell(*off4)
    S.button("Cari rute").click()
    p.wait_for_timeout(300)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(1200)
    check("traffic-not-done-off-route", "traffic" not in S.hook()["completedTasks"], S.status())
    S.stage_into_view() if MOBILE else None
    S.tap_cell(*off4)  # hapus lagi
    # tandai tiga sel lurus di tengah rute
    k = len(cells) // 2
    seg = cells[k - 1:k + 2]
    if MOBILE:
        for c in seg:
            S.tap_cell(*c)
    else:
        S.drag_cells(list(seg))
    p.wait_for_timeout(300)
    S.shot(f"{TAG}-s4-jam")
    S.button("Cari rute").click()
    t = S.wait_task("traffic", 40)
    check("task-traffic", t is not None, {"t": t, "seg": seg, "status": S.status()})
    new = S.route(jams=[list(c) for c in seg])
    check("traffic-new-route-avoids", not any(c in [tuple(x) for x in new["cells"]] for c in seg), new["cells"])
    S.shot(f"{TAG}-s4-avoid")

    # ---------- langkah 5: hitung ulang saat melaju ----------
    S.next_step()
    base = S.route()
    cells = [tuple(c) for c in base["cells"]]
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(1200)
    check("s5-not-done-without-closure", "replan-live" not in S.hook()["completedTasks"])
    S.stage_into_view() if MOBILE else None
    target = cells[len(cells) - 8]
    S.tap_cell(*target)
    p.wait_for_timeout(250)
    st = S.status()
    check("replan-status-message", "Rute dihitung ulang" in st, st)
    S.shot(f"{TAG}-s5-replan")
    t = S.wait_task("replan-live", 20)
    check("task-replan-live", t is not None, t)
    # tunggu sampai mobil tiba
    for _ in range(80):
        if "sampai di tujuan" in S.status():
            break
        p.wait_for_timeout(250)
    check("car-arrives", "sampai di tujuan" in S.status(), S.status())
    S.shot(f"{TAG}-s5-arrived")

    # ---------- ringkasan ----------
    S.next_step()
    h = S.hook()
    check("summary", h["stepIndex"] == 5 and len(h["completedTasks"]) == 5, h)
    prog = p.evaluate("() => localStorage.getItem('simotonom.progress.v1')")
    check("progress-saved", prog and '"rute"' in prog, prog[:300] if prog else None)
    S.shot(f"{TAG}-summary", full=MOBILE)

    # ---------- tombol shell ----------
    S.goto_step(4)
    p.locator('[data-act="pause"]').click()
    p.wait_for_timeout(200)
    check("pause", S.hook()["paused"] is True)
    p.locator('[data-act="pause"]').click()
    p.wait_for_timeout(200)
    check("resume", S.hook()["paused"] is False)
    p.locator(".speed-wrap .seg-btn", has_text="2x").click()
    p.wait_for_timeout(200)
    check("speed-2x", S.hook()["speed"] == 2)
    p.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    p.wait_for_timeout(200)
    check("speed-half", S.hook()["speed"] == 0.5)
    p.locator(".speed-wrap .seg-btn", has_text="1x").click()
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(800)
    p.locator('[data-act="reset"]').click()
    p.wait_for_timeout(500)
    h = S.hook()
    check("reset", h["lessonStatus"] == "ready" and h["paused"] is False and h["activeLoops"] == 1, {"hook": h, "status": S.status()})

    # ---------- maju mundur semua langkah ----------
    for i in [0, 1, 2, 3, 4, 3, 2, 1, 0, 5, 4]:
        S.goto_step(i)
        p.wait_for_timeout(250)

    # ---------- kebocoran ----------
    for _ in range(5):
        S.go("#/", 500)
        S.go("#/pelajaran/rute", 900)
    info = p.evaluate("""() => ({
        loops: window.__simotonom.activeLoops,
        canvases: document.querySelectorAll('.stage canvas').length,
        styles: document.querySelectorAll('style[data-lesson]').length,
    })""")
    check("leak", info == {"loops": 1, "canvases": 1, "styles": 1}, info)
    S.go("#/", 600)
    info = p.evaluate("() => ({ loops: window.__simotonom.activeLoops, styles: document.querySelectorAll('style[data-lesson]').length })")
    check("leak-home", info["styles"] == 0, info)

    check("console-clean", not S.errors, S.errors)

print(json.dumps(out, indent=1, ensure_ascii=False))
sys.exit(1 if out["fail"] else 0)
