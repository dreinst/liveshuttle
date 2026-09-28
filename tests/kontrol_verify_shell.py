"""QA mandiri: tombol shell (Jeda, Ulangi, 0,5x/1x/2x), langkah maju mundur, keluar masuk 5 kali.

Waktu simulasi dibaca dari window.__kvSim (dipasang hanya saat uji, lihat expose_sim).
Kebocoran: jumlah loop, kanvas, style pelajaran, listener window dan document (lewat CDP), dan
ukuran heap JS sesudah GC.
Pemakaian: python3 tests/kontrol_verify_shell.py [--mobile]
"""
import sys
import time

from kontrol_verify_util import Session, expose_sim, BASE

MOBILE = "--mobile" in sys.argv
T = "m" if MOBILE else "d"
FAIL = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        FAIL.append(msg)


def sim_time(s):
    return s.page.evaluate("() => window.__kvSim ? window.__kvSim.state.time : null")


def listeners(s, cdp):
    out = {}
    for name in ("window", "document"):
        obj = cdp.send("Runtime.evaluate", {"expression": name})["result"]["objectId"]
        ls = cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"]
        out[name] = len(ls)
    return out


def heap(cdp):
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.collectGarbage")
    return cdp.send("Runtime.getHeapUsage")["usedSize"] / 1e6


with Session(mobile=MOBILE) as s:
    expose_sim(s.page)
    cdp = s.ctx.new_cdp_session(s.page)
    s.open_lesson()
    time.sleep(1.0)
    # ---------- kecepatan ----------
    rates = {}
    for label, factor in (("1x", 1), ("0,5x", 0.5), ("2x", 2), ("1x", 1)):
        s.speed(label)
        time.sleep(0.3)
        t0 = sim_time(s)
        w0 = time.time()
        time.sleep(3)
        rates[label] = (sim_time(s) - t0) / (time.time() - w0)
        check(abs(rates[label] - factor) < 0.12 * factor + 0.05, f"kecepatan {label}: waktu simulasi {rates[label]:.2f} detik per detik nyata")
    print("  hook speed:", s.hook()["speed"])
    # ---------- jeda ----------
    s.pause_btn()
    time.sleep(0.3)
    h = s.hook()
    check(h["paused"] is True, "Jeda: __simotonom.paused = true")
    t0 = sim_time(s)
    st0 = s.status()
    ro0 = s.readouts()
    time.sleep(2.5)
    check(sim_time(s) == t0, f"Jeda: waktu simulasi berhenti ({t0:.2f})")
    check(s.status() == st0, "Jeda: baris status tidak berubah")
    check(s.readouts() == ro0, "Jeda: panel angka tidak berubah")
    badge = s.page.locator(".stage-badge").first
    check(badge.is_visible(), "Jeda: lencana Dijeda terlihat")
    s.stage_shot(f"shell-{T}-paused")
    # slider saat dijeda: nilai berubah, sim tetap diam
    s.set_slider("Lookahead Ld", 12)
    time.sleep(0.5)
    check(sim_time(s) == t0, "Jeda: menggeser slider tidak memajukan simulasi")
    lbl = s.page.locator('[data-act="pause"]').first.inner_text()
    print("  tombol saat dijeda:", lbl)
    s.pause_btn()
    time.sleep(1)
    check(s.hook()["paused"] is False and sim_time(s) > t0, "Lanjutkan: simulasi berjalan lagi")
    # ---------- ulangi ----------
    time.sleep(2)
    s.reset_btn()
    time.sleep(0.25)
    st = s.page.evaluate("() => ({ t: __kvSim.state.time, s: __kvSim.state.s, v: __kvSim.ego.speed, trail: __kvSim.state.trail.length, lap: __kvSim.state.lastLap })")
    print("  sesudah Ulangi:", st, "| status:", s.status())
    check(st["t"] < 0.5 and st["s"] < 3 and st["trail"] < 10, "Ulangi: mobil kembali ke garis start, jejak bersih")
    check(abs(s.slider_value("Lookahead Ld") - 12) < 0.01, "Ulangi: pengaturan pelajar (Ld 12) tetap")
    # ---------- langkah maju mundur ----------
    for i in range(1, 5):
        s.next_step()
        time.sleep(0.6)
        check(s.hook()["stepIndex"] == i, f"Lanjut ke langkah {i + 1}")
    back = s.page.locator(".step-nav .btn", has_text="Kembali").first
    for i in range(3, -1, -1):
        back.click()
        time.sleep(0.6)
        check(s.hook()["stepIndex"] == i, f"Kembali ke langkah {i + 1}")
    check(s.hook()["completedTasks"] == [], f"tidak ada tugas selesai saat maju mundur ({s.hook()['completedTasks']})")
    # ---------- keluar masuk ----------
    base = {"loops": s.hook()["activeLoops"], "lst": listeners(s, cdp)}
    heap0 = heap(cdp)
    print("  awal:", base, f"heap {heap0:.1f} MB")
    for k in range(5):
        s.page.goto(BASE + "#/")
        time.sleep(0.8)
        home_loops = s.hook()["activeLoops"]
        styles = s.page.evaluate("() => document.querySelectorAll('style[data-lesson=\"kontrol\"]').length")
        check(styles == 0, f"putaran {k + 1}: style pelajaran dilepas di beranda")
        s.page.goto(BASE + "#/pelajaran/kontrol")
        s.wait_ready()
        time.sleep(1.2)
        h = s.hook()
        canv = s.page.evaluate("() => document.querySelectorAll('.stage canvas').length")
        styles = s.page.evaluate("() => document.querySelectorAll('style[data-lesson=\"kontrol\"]').length")
        lst = listeners(s, cdp)
        print(f"  putaran {k + 1}: loop beranda {home_loops}, loop pelajaran {h['activeLoops']}, kanvas {canv}, style {styles}, listener {lst}")
        check(h["activeLoops"] == base["loops"] and canv == 1 and styles == 1, f"putaran {k + 1}: tidak ada loop/kanvas/style ganda")
        check(lst == base["lst"], f"putaran {k + 1}: listener window/document tetap {base['lst']} (sekarang {lst})")
    heap1 = heap(cdp)
    print(f"  heap sesudah 5 putaran {heap1:.1f} MB (awal {heap0:.1f} MB)")
    check(heap1 - heap0 < 8, "heap tidak tumbuh lebih dari 8 MB setelah 5 kali keluar masuk")
    # keluar saat peta masih dimuat (async mount dibatalkan)
    for k in range(3):
        s.page.goto(BASE + "#/")
        s.page.goto(BASE + "#/pelajaran/kontrol")
        time.sleep(0.02)
        s.page.goto(BASE + "#/pelajaran/sensor")
        time.sleep(0.5)
        s.page.goto(BASE + "#/pelajaran/kontrol")
        s.wait_ready()
        time.sleep(0.5)
    check(s.hook()["activeLoops"] == base["loops"], f"keluar saat peta dimuat: loop tetap {s.hook()['activeLoops']}")
    s.stage_shot(f"shell-{T}-reentry")
    check(len(s.msgs) == 0, f"pesan konsol: {s.msgs}")

print("\nHASIL:", "LULUS" if not FAIL else f"{len(FAIL)} GAGAL")
for f in FAIL:
    print(" -", f)
