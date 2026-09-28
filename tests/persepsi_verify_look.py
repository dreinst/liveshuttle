"""Lihat pelajaran Persepsi: tangkapan layar panggung tiap langkah (desktop atau --mobile)."""
import sys
from persepsi_verify_util import Session, dump

mobile = "--mobile" in sys.argv
tag = "m" if mobile else "d"
with Session(mobile=mobile) as S:
    S.go()
    S.page.wait_for_timeout(1500)
    S.shot(f"{tag}-page0")
    S.shot(f"{tag}-page0-full", full=True)
    S.toggle("LiDAR")
    S.toggle("Radar")
    S.page.wait_for_timeout(2500)
    S.shot(f"{tag}-stage0-all3", selector=".stage")
    for i in range(1, 5):
        S.step(i)
        if i == 1:
            S.toggle("Fusi")
        if i == 2:
            S.page.locator("button", has_text="Munculkan pantulan palsu").first.click()
            S.page.wait_for_timeout(600)
            S.shot(f"{tag}-stage2-ghost", selector=".stage")
        if i == 4:
            S.toggle("Prediksi")
        S.page.wait_for_timeout(3000)
        S.shot(f"{tag}-stage{i}", selector=".stage")
    dump({"errors": S.errors, "hook": S.hook(), "safety": S.safety()})
