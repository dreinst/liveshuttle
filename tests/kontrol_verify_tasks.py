"""QA mandiri: kelima tugas pelajaran Kendali lewat UI sungguhan, tanpa selesai sendiri.

Tiap langkah dibiarkan dulu tanpa disentuh (2x) untuk memastikan tugasnya tidak selesai sendiri,
lalu dikerjakan lewat slider dan tombol seperti pelajar. Juga: loncat langsung ke langkah
tertentu lewat titik langkah, dan masuk ulang (langkah terakhir diingat).

Pemakaian: python3 tests/kontrol_verify_tasks.py [--mobile]
"""
import json
import sys
import time

from kontrol_verify_util import Session

MOBILE = "--mobile" in sys.argv
T = "m" if MOBILE else "d"
FAIL = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        FAIL.append(msg)


def idle(s, seconds, label):
    before = s.done()
    time.sleep(seconds)
    after = s.done()
    check(after == before, f"{label}: tidak ada tugas selesai sendiri selama {seconds} detik (sebelum {before}, sesudah {after})")


with Session(mobile=MOBILE) as s:
    s.open_lesson()
    s.speed("2x")
    # ---------- langkah 1 ----------
    check(s.hook()["stepIndex"] == 0, "mulai di langkah 1")
    idle(s, 20, "langkah 1 (Ld 8, 40 km/jam, 2x)")
    v = s.set_slider("Lookahead Ld", 3)
    check(abs(v - 3) < 0.01, f"Ld diset ke 3 lewat slider (={v})")
    t = s.wait_for(lambda: "lookahead-small" in s.done(), 40)
    check(t is not None, f"lookahead-small selesai ({t} detik)")
    print("  status:", s.status())
    s.stage_shot(f"tasks-{T}-1")

    # ---------- langkah 2 ----------
    s.next_step()
    check(s.hook()["stepIndex"] == 1, "Lanjut ke langkah 2")
    check(abs(s.slider_value("Lookahead Ld") - 8) < 0.01, "preset langkah 2 mengembalikan Ld 8")
    idle(s, 25, "langkah 2 (Ld 8)")
    # Ld 14,5: belum cukup
    s.set_slider("Lookahead Ld", 14.5)
    idle(s, 30, "langkah 2 dengan Ld 14,5 (di bawah ambang)")
    v = s.set_slider("Lookahead Ld", 15)
    t = s.wait_for(lambda: "lookahead-large" in s.done(), 90)
    check(t is not None, f"lookahead-large selesai dengan Ld 15 ({t} detik)")
    print("  status:", s.status(), "| hud:", s.hud())
    s.stage_shot(f"tasks-{T}-2")

    # ---------- langkah 3 ----------
    s.next_step()
    check(s.hook()["stepIndex"] == 2, "Lanjut ke langkah 3")
    ld = s.slider_value("Lookahead Ld")
    print("  preset Ld langkah 3:", ld)
    # biarkan satu putaran penuh lebih (sekitar 103 detik simulasi, 52 detik nyata pada 2x) + cadangan
    idle(s, 70, "langkah 3 (preset Ld 18, satu putaran penuh)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False))
    # target di bawah 40: tugas tidak boleh selesai walau RMS kecil
    s.set_slider("Lookahead Ld", 8)
    s.set_slider("Kecepatan target", 35)
    idle(s, 65, "langkah 3 dengan Ld 8 tapi target 35 km/jam")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False))
    s.set_slider("Kecepatan target", 40)
    t = s.wait_for(lambda: "tuned" in s.done(), 90)
    check(t is not None, f"tuned selesai dengan Ld 8 dan 40 km/jam ({t} detik)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False))
    s.stage_shot(f"tasks-{T}-3")

    # ---------- langkah 4 ----------
    s.next_step()
    check(s.hook()["stepIndex"] == 3, "Lanjut ke langkah 4")
    check(abs(s.slider_value("Ki") - 0.2) < 0.01 and abs(s.slider_value("Kp") - 0.8) < 0.01, "preset langkah 4: Kp 0,8 dan Ki 0,2")
    idle(s, 25, "langkah 4 (PID bawaan, uji dari diam otomatis)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False), "| note:", s.note())
    s.set_slider("Ki", 1)
    idle(s, 3, "langkah 4 sesudah Ki 1 tanpa Uji dari diam")
    s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
    t = s.wait_for(lambda: "pid-overshoot" in s.done(), 30)
    check(t is not None, f"pid-overshoot selesai ({t} detik)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False))
    s.stage_shot(f"tasks-{T}-4")

    # ---------- langkah 5 ----------
    s.next_step()
    check(s.hook()["stepIndex"] == 4, "Lanjut ke langkah 5")
    check(abs(s.slider_value("Ki") - 1) < 0.01, "preset langkah 5: Ki 1")
    idle(s, 25, "langkah 5 (Ki 1, uji dari diam otomatis)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False), "| note:", s.note())
    s.set_slider("Ki", 0.3)
    s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
    t = s.wait_for(lambda: "pid-tuned" in s.done(), 40)
    check(t is not None, f"pid-tuned selesai dengan Ki 0,3 ({t} detik)")
    print("  readouts:", json.dumps(s.readouts(), ensure_ascii=False), "| note:", s.note())
    s.stage_shot(f"tasks-{T}-5")
    h = s.hook()
    check(sorted(h["completedTasks"]) == sorted(["lookahead-small", "lookahead-large", "tuned", "pid-overshoot", "pid-tuned"]),
          f"kelima tugas tercatat di __simotonom: {h['completedTasks']}")
    store = s.page.evaluate("() => localStorage.getItem('liveshuttle.progress.v1')")
    check(store is not None and all(k in store for k in ["lookahead-small", "pid-tuned"]), "progres tersimpan di localStorage")
    print("  progress text:", s.page.locator(".lesson-progress-text").first.inner_text())
    # ringkasan
    s.next_step()
    time.sleep(0.5)
    s.shot(f"tasks-{T}-summary", full=True)
    check(len(s.msgs) == 0, f"pesan konsol: {s.msgs}")

# ---------- loncat langsung ke langkah, tanpa progres ----------
for step in (1, 2, 3, 4):
    with Session(mobile=MOBILE) as s:
        s.open_lesson()
        s.speed("2x")
        s.go_step(step)
        idle(s, 60 if step == 2 else 25, f"loncat langsung ke langkah {step + 1}")
        check(len(s.msgs) == 0, f"pesan konsol (loncat {step + 1}): {s.msgs}")

print("\nHASIL:", "LULUS" if not FAIL else f"{len(FAIL)} GAGAL")
for f in FAIL:
    print(" -", f)
