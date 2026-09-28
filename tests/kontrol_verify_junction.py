"""Gambar dekat mobil di sudut simpang bundaran (tempat jalur acuan paling dekat ke tepi aspal).

Simulasi dijeda, lalu dimajukan langsung lewat window.__kvSim (hanya di uji) sampai mobil di s
tertentu, lalu tangkapan layar diambil.
Pemakaian: python3 tests/kontrol_verify_junction.py [--mobile] [--ld 8]
"""
import sys
import time

from kontrol_verify_util import Session, expose_sim

MOBILE = "--mobile" in sys.argv
LD = float(sys.argv[sys.argv.index("--ld") + 1]) if "--ld" in sys.argv else 8
T = "m" if MOBILE else "d"
TARGETS = [float(x) for x in (sys.argv[sys.argv.index("--at") + 1].split(",") if "--at" in sys.argv else ["316", "388", "747", "848"])]

with Session(mobile=MOBILE) as s:
    expose_sim(s.page)
    s.open_lesson()
    s.pause_btn()
    s.set_slider("Lookahead Ld", LD)
    s.page.evaluate("() => { __kvSim.reset(); }")
    for tgt in TARGETS:
        info = s.page.evaluate("""(tgt) => { const sim = __kvSim; let n = 0; let worst = 0;
            while (n < 60 * 400) { sim.step(1/60); n++; const d = ((tgt - sim.state.s) % sim.track.length + sim.track.length) % sim.track.length; if (d < 0.3 || d > sim.track.length - 0.3) break; }
            return { s: sim.state.s, cte: sim.state.cte, kmh: sim.ego.speed * 3.6, t: sim.state.time, takeover: !!sim.state.takeover }; }""", tgt)
        time.sleep(0.5)
        print(tgt, info)
        s.stage_shot(f"junction-{T}-ld{int(LD)}-s{int(tgt)}")
    print("msgs", s.msgs)
