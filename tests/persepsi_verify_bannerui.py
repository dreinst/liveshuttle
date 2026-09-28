"""Spanduk peringatan di UI: catat setiap perubahan teks/visibilitas (MutationObserver) selama
N detik dengan Prediksi menyala, lalu hitung episode yang tampil kurang dari 0,3 detik (kedipan).
Pemakaian: python3 tests/persepsi_verify_bannerui.py [detik] [--mobile] [--old]"""
import sys
from persepsi_verify_util import Session, dump

secs = float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else 90
mobile = "--mobile" in sys.argv
OBS = r"""
() => {
  const b = document.querySelector('.warn-banner');
  window.__bl = [];
  const rec = () => window.__bl.push({ t: performance.now(), vis: !b.hidden, text: b.hidden ? '' : b.textContent });
  new MutationObserver(rec).observe(b, { attributes: true, childList: true, subtree: true, characterData: true });
  rec();
}
"""
with Session(mobile=mobile) as S:
    if "--old" in sys.argv:
        # versi builder (tanpa histeresis) dari HEAD kerja sebelum perbaikan, untuk pembanding
        src = open("/tmp/persepsi_before.js").read()
        S.page.route("**/js/lessons/persepsi.js", lambda r: r.fulfill(body=src, content_type="text/javascript"))
    S.go()
    S.step(4)
    S.toggle("Prediksi")
    S.page.evaluate(OBS)
    S.page.wait_for_timeout(int(secs * 1000))
    log = S.page.evaluate("() => window.__bl")
    done = S.hook()["completedTasks"]
    errs = S.errors
eps = []
cur = None
for e in log:
    if cur and (not e["vis"] or e["text"] != cur["text"]):
        cur["dur"] = round((e["t"] - cur["t"]) / 1000, 2)
        eps.append(cur)
        cur = None
    if e["vis"] and not cur:
        cur = {"t": e["t"], "text": e["text"]}
short = [x for x in eps if x["dur"] < 0.3]
dump({"secs": secs, "episodes": len(eps), "short": len(short), "shortSamples": [(x["text"], x["dur"]) for x in short[:8]],
      "durations": sorted(x["dur"] for x in eps)[:20], "predictDone": "predict" in done, "errors": errs})
