"""QA mandiri: uji tekanan lewat UI (pengaturan ekstrem dan acak, 2x, tombol diketuk bertubi-tubi).

Selama uji, posisi mobil dipantau lewat window.__kvSim (hanya di uji): simpangan sumbu belakang,
sudut bodi yang masuk ke pulau bundaran, angka tidak valid (NaN), dan waktu simulasi terus maju.
Pemakaian: python3 tests/kontrol_verify_stress.py [--mobile] [--seconds 90]
"""
import json
import random
import sys
import time

from kontrol_verify_util import Session, expose_sim

MOBILE = "--mobile" in sys.argv
SECONDS = float(sys.argv[sys.argv.index("--seconds") + 1]) if "--seconds" in sys.argv else 90
T = "m" if MOBILE else "d"
FAIL = []
rng = random.Random(11)


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        FAIL.append(msg)


MONITOR = """() => {
  const sim = window.__kvSim, tr = window.__kvTrack;
  if (!sim) return null;
  const m = window.__kvMon || (window.__kvMon = { maxCte: 0, island: -9, nan: 0, samples: 0, takeovers: 0 });
  if (!window.__kvMonTimer) {
    window.__kvMonTimer = setInterval(() => {
      const e = sim.ego, st = sim.state;
      m.samples++;
      if (![e.x, e.y, e.heading, e.speed, st.cte].every(Number.isFinite)) m.nan++;
      m.maxCte = Math.max(m.maxCte, Math.abs(st.cte));
      for (const rb of tr.roundabouts) {
        const r = rb.radius - Math.max(...rb.roads.map((q) => q.width)) / 2 - 0.4;
        for (const c of e.corners()) m.island = Math.max(m.island, r - Math.hypot(c.x - rb.x, c.y - rb.y));
      }
      m.takeovers = Math.max(m.takeovers, st.takeovers);
    }, 50);
  }
  return m;
}"""

with Session(mobile=MOBILE) as s:
    expose_sim(s.page)
    s.open_lesson()
    s.page.evaluate(MONITOR)
    s.speed("2x")
    # 1) kombinasi ekstrem, masing-masing dibiarkan berjalan
    combos = [
        {"Lookahead Ld": 2, "Kecepatan target": 50, "Kp": 5, "Ki": 2, "Kd": 1},
        {"Lookahead Ld": 20, "Kecepatan target": 50, "Kp": 0, "Ki": 2, "Kd": 0},
        {"Lookahead Ld": 2, "Kecepatan target": 20, "Kp": 0.8, "Ki": 0.2, "Kd": 0},
        {"Lookahead Ld": 2.5, "Kecepatan target": 50, "Kp": 5, "Ki": 0, "Kd": 1},
    ]
    for c in combos:
        for k, v in c.items():
            s.set_slider(k, v)
        s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
        time.sleep(12)
        print("  kombinasi", c, "->", s.hud(), "|", s.status())
    # adaptif dengan k terkecil, tanpa Pelan di tikungan, 50 km/jam
    s.click_text(".lesson-kontrol .seg-btn", "Adaptif")
    for k, v in {"Faktor k": 0.2, "Kecepatan target": 50, "Kp": 0.8, "Ki": 0.2, "Kd": 0}.items():
        s.set_slider(k, v)
    s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
    time.sleep(40)
    s.stage_shot(f"stress-{T}-adaptive-k02")
    print("  adaptif k 0,2 @50:", s.hud(), "|", s.status())
    s.set_slider("Faktor k", 0.3)
    s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
    time.sleep(40)
    print("  adaptif k 0,3 @50:", s.hud(), "|", s.status())
    s.click_text(".lesson-kontrol .seg-btn", "Tetap")
    # 2) acak bertubi-tubi
    labels = ["Lookahead Ld", "Kecepatan target", "Kp", "Ki", "Kd"]
    ranges = {"Lookahead Ld": (2, 20), "Kecepatan target": (10, 50), "Kp": (0, 5), "Ki": (0, 2), "Kd": (0, 1)}
    t_end = time.time() + SECONDS
    n = 0
    while time.time() < t_end:
        r = rng.random()
        if r < 0.45:
            lab = rng.choice(labels)
            lo, hi = ranges[lab]
            inp = s.slider(lab)
            inp.scroll_into_view_if_needed()
            if not inp.is_disabled():
                inp.press(rng.choice(["Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowRight"]))
        elif r < 0.55:
            s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
        elif r < 0.62:
            s.click_text(".lesson-kontrol .seg-btn", rng.choice(["Tetap", "Adaptif", "Ikuti mobil", "Seluruh lintasan"]))
        elif r < 0.68:
            s.page.locator(".lesson-kontrol .ctl-toggle").first.scroll_into_view_if_needed()
            s.page.locator(".lesson-kontrol .ctl-toggle").first.click()
        elif r < 0.76:
            s.pause_btn()
        elif r < 0.82:
            s.speed(rng.choice(["0,5x", "1x", "2x"]))
        elif r < 0.86:
            s.reset_btn()
        elif r < 0.92:
            s.go_step(rng.randrange(0, 5))
        else:
            time.sleep(rng.random() * 1.5)
        n += 1
    print("  aksi acak:", n)
    # pastikan tetap berjalan
    if s.hook()["paused"]:
        s.pause_btn()
    s.speed("1x")
    t0 = s.page.evaluate("() => __kvSim.state.time")
    time.sleep(1.5)
    t1 = s.page.evaluate("() => __kvSim.state.time")
    h = s.hook()
    check(t1 > t0 and h["lessonStatus"] == "ready" and h["activeLoops"] == 1, f"sesudah uji tekanan simulasi tetap berjalan (loop {h['activeLoops']}, status {h['lessonStatus']})")
    mon = s.page.evaluate(MONITOR)
    print("  pemantau:", json.dumps(mon))
    check(mon["nan"] == 0, "tidak ada angka tidak valid (NaN) pada mobil")
    check(mon["island"] <= 0.05, f"bodi mobil tidak masuk pulau bundaran (paling dalam {mon['island']:.2f} m)")
    check(mon["maxCte"] < 1.6, f"simpangan sumbu belakang terbesar {mon['maxCte']:.2f} m (pengemudi cadangan bekerja)")
    stage_err = s.page.locator(".stage-error").first
    check(not stage_err.is_visible(), "tidak ada pesan galat di panggung")
    s.stage_shot(f"stress-{T}-end")
    check(len(s.msgs) == 0, f"pesan konsol: {s.msgs}")

print("\nHASIL:", "LULUS" if not FAIL else f"{len(FAIL)} GAGAL")
for f in FAIL:
    print(" -", f)
