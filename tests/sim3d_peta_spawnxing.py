"""Uji tombol pejalan kaki menyeberang di depan shuttle (debug.spawnCrossing): dipanggil berulang
kali saat shuttle melaju; pejalan kaki hanya muncul bila shuttle masih bisa berhenti, dan
penghitung kontak harus tetap 0."""
import collections
import json

from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright

with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.keyboard.press("Space")
    res = collections.Counter()
    for i in range(240):
        page.evaluate("() => window.__sim3d.debug.runSteps(30)")
        r = page.evaluate("() => window.__sim3d.debug.spawnCrossing()")
        res["ok" if r["ok"] else r["reason"]] += 1
        if i % 10 == 0:
            page.evaluate("() => window.__sim3d.debug.runSteps(240)")
    page.evaluate("() => window.__sim3d.debug.runSteps(3600)")
    s = snap(page)
    print(dict(res))
    print(json.dumps({"inv": s["invariants"], "shield": s["shield"]["shuttle"], "log": s["shield"]["log"], "clamps": s["shield"]["clamps"], "peds": s["traffic"]["peds"]}, ensure_ascii=False))
    print("LOG", log)
    print("LULUS" if s["invariants"]["pedContact"] == 0 and s["invariants"]["redLight"] == 0 and not log else "GAGAL")
    b.close()
