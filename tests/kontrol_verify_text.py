"""Tangkapan layar kartu langkah 2 dan panel Kecepatan (teks yang diubah saat QA), desktop dan ponsel."""
import sys
import time

from kontrol_verify_util import Session

for mobile in (False, True):
    T = "m" if mobile else "d"
    with Session(mobile=mobile) as s:
        s.open_lesson()
        s.go_step(1)
        card = s.page.locator(".step-card").first
        card.scroll_into_view_if_needed()
        card.screenshot(path=f"/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol-verify/text-{T}-step2.png")
        grp = s.page.locator(".lesson-kontrol .grp-speed").first
        grp.scroll_into_view_if_needed()
        grp.screenshot(path=f"/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol-verify/text-{T}-speed.png")
        hint = s.page.locator(".lesson-kontrol .toggle-hint").first.text_content()
        print(T, repr(hint), "msgs", s.msgs)
