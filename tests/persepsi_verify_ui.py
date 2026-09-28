"""QA mandiri UI pelajaran Persepsi.

Pemakaian: python3 tests/persepsi_verify_ui.py [--mobile] [--gpu]
1. Tidak diam-diam tuntas: diam di tiap langkah tanpa menyentuh simulasi, tidak ada tugas selesai.
2. Semua tugas diselesaikan lewat interaksi UI sungguhan dan tercatat di window.__simotonom.
3. Jeda (kanvas diam), kecepatan 0,5x/1x/2x, Ulangi.
4. Keluar dan masuk lagi 5 kali: loop, kanvas, gaya, listener window/document tidak bocor.
Semua galat konsol, peringatan, dan pageerror dikumpulkan.
"""
import sys
import time
from io import BytesIO

from PIL import Image, ImageChops
from persepsi_verify_util import Session, dump, BASE, ROUTE

mobile = "--mobile" in sys.argv
tag = "m" if mobile else "d"
INIT = r"""
(() => {
  const count = { win: 0, doc: 0 };
  const keyOf = new WeakMap();
  const live = new Set();
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (this === window || this === document) {
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const k = (this === window ? 'w' : 'd') + '|' + type + '|' + cap;
      let m = keyOf.get(fn); if (!m) { m = new Set(); keyOf.set(fn, m); }
      if (!m.has(k)) { m.add(k); count[this === window ? 'win' : 'doc']++; live.add(fn);
        if (opts && typeof opts === 'object' && opts.signal) opts.signal.addEventListener('abort', () => { if (m.delete(k)) count[k[0] === 'w' ? 'win' : 'doc']--; });
      }
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (this === window || this === document) {
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const k = (this === window ? 'w' : 'd') + '|' + type + '|' + cap;
      const m = keyOf.get(fn); if (m && m.delete(k)) count[this === window ? 'win' : 'doc']--;
    }
    return rem.call(this, type, fn, opts);
  };
  window.__lc = count;
})();
"""

report = {"mobile": mobile, "idle": {}, "tasks": {}, "controls": {}, "leak": [], "problems": []}


def done(S):
    return S.hook()["completedTasks"]


def canvas_png(S):
    return Image.open(BytesIO(S.page.locator(".sim-canvas").first.screenshot())).convert("RGB")


def wait_task(S, tid, limit):
    t0 = time.time()
    while time.time() - t0 < limit:
        if tid in done(S):
            return round(time.time() - t0, 1)
        S.page.wait_for_timeout(250)
    return None


with Session(mobile=mobile, gpu="--gpu" in sys.argv, init_script=INIT) as S:
    S.go()
    S.page.wait_for_timeout(1000)
    # ---------- 1. diam di tiap langkah ----------
    for i, secs in [(0, 8), (1, 8), (2, 10), (3, 8), (4, 25)]:
        S.step(i)
        S.page.wait_for_timeout(secs * 1000)
        report["idle"][i] = list(done(S))
    # idle di 2x pada langkah prediksi
    S.page.locator(".speed-wrap .seg-btn", has_text="2x").first.click()
    S.page.wait_for_timeout(15000)
    report["idle"]["4@2x"] = list(done(S))
    S.page.locator(".speed-wrap .seg-btn", has_text="1x").first.click()
    if any(report["idle"][k] for k in report["idle"]):
        report["problems"].append("tugas tuntas tanpa interaksi")

    # ---------- 2. tugas lewat UI ----------
    S.step(0)
    S.toggle("LiDAR")
    S.toggle("Radar")
    report["tasks"]["raw-view"] = wait_task(S, "raw-view", 20)
    S.page.locator(".step-nav .btn-primary").first.click()
    S.page.wait_for_timeout(300)
    report["tasks"]["step-after-lanjut"] = S.hook()["stepIndex"]
    S.toggle("Fusi")
    report["tasks"]["fusion-on"] = wait_task(S, "fusion-on", 20)
    S.page.locator(".step-nav .btn-primary").first.click()
    S.page.wait_for_timeout(300)
    tries = 0
    got = None
    while got is None and tries < 6:
        tries += 1
        S.page.locator("button", has_text="Munculkan pantulan palsu").first.click()
        got = wait_task(S, "ghost-rejected", 5)
    report["tasks"]["ghost-rejected"] = got
    report["tasks"]["ghost-tries"] = tries
    S.page.locator(".step-nav .btn-primary").first.click()
    S.page.wait_for_timeout(300)
    rng = S.page.locator(".ctl-slider", has_text="Ambang keyakinan").locator("input[type=range]").first
    rng.scroll_into_view_if_needed()
    rng.focus()
    for _ in range(45):
        rng.press("ArrowRight")
    report["tasks"]["threshold-value"] = rng.input_value()
    report["tasks"]["threshold"] = wait_task(S, "threshold", 40)
    S.page.locator(".step-nav .btn-primary").first.click()
    S.page.wait_for_timeout(300)
    S.toggle("Prediksi")
    report["tasks"]["predict"] = wait_task(S, "predict", 150)
    S.page.evaluate("() => window.scrollTo(0, 0)")
    S.page.wait_for_timeout(200)
    S.shot(f"{tag}-ui-after-predict", selector=".stage")
    report["tasks"]["completed"] = list(done(S))
    report["tasks"]["progressText"] = S.page.evaluate("() => (document.querySelector('.lesson-progress, .progress-text, [data-el=progress]') || {}).textContent || ''")
    if sorted(report["tasks"]["completed"]) != sorted(["raw-view", "fusion-on", "ghost-rejected", "threshold", "predict"]):
        report["problems"].append("tidak semua tugas tuntas lewat UI")

    # ---------- 3. kontrol shell ----------
    S.page.evaluate("() => window.scrollTo(0, 0)")
    S.page.click('[data-act="pause"]')
    S.page.wait_for_timeout(400)
    a = canvas_png(S)
    S.page.wait_for_timeout(900)
    b = canvas_png(S)
    diff = ImageChops.difference(a, b).getbbox()
    report["controls"]["paused"] = S.hook()["paused"]
    report["controls"]["pausedCanvasChanged"] = diff
    t_before = S.page.evaluate("() => window.__lessonSafety.ticks")
    S.page.wait_for_timeout(600)
    t_after = S.page.evaluate("() => window.__lessonSafety.ticks")
    report["controls"]["ticksWhilePaused"] = t_after - t_before
    # tombol hantu saat jeda tetap boleh
    S.page.locator("button", has_text="Munculkan pantulan palsu").first.click()
    S.page.wait_for_timeout(300)
    S.page.click('[data-act="pause"]')
    S.page.wait_for_timeout(300)
    report["controls"]["resumed"] = not S.hook()["paused"]
    for lab, want in [("0,5x", 0.5), ("2x", 2), ("1x", 1)]:
        S.page.locator(".speed-wrap .seg-btn", has_text=lab).first.click()
        t0 = S.page.evaluate("() => window.__lessonSafety.ticks")
        S.page.wait_for_timeout(2000)
        t1 = S.page.evaluate("() => window.__lessonSafety.ticks")
        report["controls"][lab] = {"hook": S.hook()["speed"], "ticksPerSec": round((t1 - t0) / 2)}
    tm = S.page.evaluate("() => window.__lessonSafety.ticks")
    S.page.click('[data-act="reset"]')
    S.page.wait_for_timeout(500)
    report["controls"]["status_after_reset"] = S.page.evaluate("() => document.querySelector('.stage-status, [data-el=status]')?.textContent || ''")
    report["controls"]["completedAfterReset"] = list(done(S))
    S.shot(f"{tag}-ui-after-reset", selector=".stage")

    # ---------- 4. keluar masuk ----------
    def census():
        return S.page.evaluate("""() => ({
          loops: window.__simotonom.activeLoops,
          canvases: document.querySelectorAll('canvas').length,
          styles: [...document.querySelectorAll('style')].filter(s => s.textContent.includes('.lesson-persepsi')).length,
          banners: document.querySelectorAll('.warn-banner').length,
          safety: !!window.__lessonSafety,
          lc: { ...window.__lc },
        })""")
    report["leak"].append({"at": "lesson", **census()})
    for k in range(5):
        S.page.evaluate("() => { location.hash = '#/'; }")
        S.page.wait_for_timeout(900)
        home = census()
        S.page.evaluate("() => { location.hash = '#/pelajaran/persepsi'; }")
        S.page.wait_for_timeout(1800)
        back = census()
        report["leak"].append({"k": k, "home": home, "lesson": back})
    first = report["leak"][1]["lesson"]
    last = report["leak"][-1]["lesson"]
    if last["lc"] != first["lc"] or last["loops"] != 1 or last["canvases"] != first["canvases"] or last["styles"] != 1:
        report["problems"].append("kebocoran saat keluar masuk")
    if any(r["home"]["safety"] for r in report["leak"][1:]):
        report["problems"].append("__lessonSafety tertinggal di beranda")
    report["errors"] = S.errors
    report["hook"] = S.hook()
dump(report)
print("LULUS" if not report["problems"] and not report["errors"] else "GAGAL")
