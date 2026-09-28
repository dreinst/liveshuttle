"""Waktu bingkai pelajaran Persepsi pada keadaan terberat (tiga sensor mentah + fusi, lalu
pelacakan + prediksi), 1x dan 2x. Pemakaian: python3 tests/persepsi_verify_perf.py [--mobile] [--gpu]"""
import sys
from persepsi_verify_util import Session, dump

mobile = "--mobile" in sys.argv
gpu = "--gpu" in sys.argv
RAF = r"""
async (n) => {
  const t = [];
  for (let i = 0; i < n; i++) t.push(await new Promise((r) => requestAnimationFrame(r)));
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  return { median: +d[Math.floor(d.length / 2)].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2), over20: d.filter((x) => x > 20).length, n: d.length };
}
"""


def measure(S, label):
    cdp = S.ctx.new_cdp_session(S.page)
    cdp.send("Performance.enable")
    m0 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
    r = S.page.evaluate(RAF, 300)
    m1 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
    r["scriptMsPerFrame"] = round((m1["ScriptDuration"] - m0["ScriptDuration"]) * 1000 / r["n"], 2)
    r["taskMsPerFrame"] = round((m1["TaskDuration"] - m0["TaskDuration"]) * 1000 / r["n"], 2)
    return {label: r}


out = {"mobile": mobile, "gpu": gpu}
with Session(mobile=mobile, gpu=gpu) as S:
    S.go()
    S.step(2)
    S.page.wait_for_timeout(1500)
    out.update(measure(S, "raw3+fusion@1x"))
    S.page.locator(".speed-wrap .seg-btn", has_text="2x").first.click()
    out.update(measure(S, "raw3+fusion@2x"))
    S.page.locator(".speed-wrap .seg-btn", has_text="1x").first.click()
    S.step(4)
    S.toggle("Prediksi")
    S.toggle("LiDAR")
    S.toggle("Kamera")
    S.toggle("Radar")
    S.page.wait_for_timeout(1500)
    out.update(measure(S, "all+prediction@1x"))
    S.page.locator(".speed-wrap .seg-btn", has_text="2x").first.click()
    out.update(measure(S, "all+prediction@2x"))
    out["gl"] = S.page.evaluate("() => { const c = document.createElement('canvas'); const g = c.getContext('webgl'); if (!g) return null; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl'; }")
    out["errors"] = S.errors
dump(out)
