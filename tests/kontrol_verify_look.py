"""Tangkapan layar pelajaran Kendali untuk diperiksa dengan mata (desktop dan ponsel).

Pemakaian: python3 tests/kontrol_verify_look.py [--mobile]
"""
import sys
import time

from kontrol_verify_util import Session

MOBILE = "--mobile" in sys.argv
T = "m" if MOBILE else "d"

with Session(mobile=MOBILE) as s:
    s.open_lesson()
    time.sleep(3)
    s.shot(f"look-{T}-load")
    s.shot(f"look-{T}-load-full", full=True)
    print("status:", s.status())
    print("hud:", s.hud())
    # jalan cepat ke bundaran timur (sekitar 300 m dari start)
    s.speed("2x")
    t = s.wait_for(lambda: "bundaran" in s.status(), 60)
    print("reach roundabout status after", t, s.status())
    time.sleep(1.5)
    s.stage_shot(f"look-{T}-roundabout")
    # tampilan seluruh lintasan
    s.click_text(".lesson-kontrol .seg-btn", "Seluruh lintasan")
    time.sleep(1)
    s.stage_shot(f"look-{T}-overview")
    s.click_text(".lesson-kontrol .seg-btn", "Ikuti mobil")
    # langkah 2: Ld 18
    s.go_step(1)
    s.set_slider("Lookahead Ld", 18)
    t = s.wait_for(lambda: "kontrol" in str(s.done()) or "lookahead-large" in s.done(), 90)
    time.sleep(0.3)
    print("lookahead-large after", t, s.done())
    s.stage_shot(f"look-{T}-cut")
    print("status:", s.status())
    print("msgs:", s.msgs)
