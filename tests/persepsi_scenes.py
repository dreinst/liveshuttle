"""Tangkapan layar momen lalu lintas Malang di pelajaran Persepsi: angkot menaikkan penumpang,
sepeda motor menyelip, penyeberang di zebra cross, dan pergantian putaran di ujung ruas.

Pemakaian: python3 tests/persepsi_scenes.py [--mobile] [--reduced]
Butuh server: python3 tests/serve.py 8243

scene.js dibungkus lewat page.route (file di disk tidak diubah) supaya skrip bisa membaca keadaan
dunia dan menunggu momen yang tepat. Simulasi dijalankan 2x supaya cepat.
"""
import json
import sys
import time

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, SHOTS  # noqa: E402

MOBILE = "--mobile" in sys.argv
REDUCED = "--reduced" in sys.argv
TAG = ("m" if MOBILE else "d") + ("-rm" if REDUCED else "")
SIG = "export function createScene({ street, seed = 11 } = {}) {"
HOOK = """
export function createScene(opts) { const s = __createScene(opts); globalThis.__persepsiScene = s; return s; }
function __createScene({ street, seed = 11 } = {}) {"""


def patch(route):
    resp = route.fetch()
    body = resp.text()
    assert SIG in body
    route.fulfill(response=resp, body=body.replace(SIG, HOOK, 1), headers={**resp.headers, "content-type": "text/javascript"})


MOMENTS = {
    "angkot": """() => { const s = globalThis.__persepsiScene; if (!s) return false;
        return s.traffic.some((v) => v.kind === 'angkot' && v.mode === 'board' && v.doorOpen && Math.abs(v.s - s.ego.s - 15) < 16); }""",
    "motor": """() => { const s = globalThis.__persepsiScene; if (!s) return false;
        return s.traffic.some((v) => v.kind === 'motor' && v.dir > 0 && v.mode === 'pass' && Math.abs(v.s - s.ego.s) < 3); }""",
    "zebra": """() => { const s = globalThis.__persepsiScene; if (!s) return false;
        return s.peds.some((p) => p.role === 'crosser' && p.state === 'cross' && p.d > -1 && Math.abs(p.s - s.ego.s - 12) < 12); }""",
    "putaran": """() => { const s = globalThis.__persepsiScene; return !!s && s.state.lap >= 1 && s.ego.s < s.street.route.start + 12; }""",
}

out = {}
with Session(mobile=MOBILE) as s:
    if REDUCED:
        s.page.emulate_media(reduced_motion="reduce")
    s.page.route("**/js/lessons/persepsi/scene.js", patch)
    s.go("#/pelajaran/persepsi", 1500)
    s.page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").first.dispatch_event("click")
    # tampilan lalu lintas saja dulu (kamera dimatikan), lalu fusi untuk momen zebra
    s.page.locator(".ctl-toggle", has_text="Kamera").first.click()
    t0 = time.time()
    for name, js in MOMENTS.items():
        if name == "zebra":
            s.page.locator(".ctl-toggle", has_text="Prediksi").first.click()
        found = None
        while time.time() - t0 < 240:
            if s.page.evaluate(js):
                found = round(time.time() - t0, 1)
                break
            s.page.wait_for_timeout(100)
        out[name] = found
        if found is not None:
            s.page.locator('[data-act="pause"]').click()
            s.page.evaluate("() => window.scrollTo(0, 0)")
            s.page.wait_for_timeout(200)
            s.shot(f"moment-{TAG}-{name}", selector=".stage")
            out[name + "-status"] = s.page.locator(".sim-status").inner_text()
            s.page.locator('[data-act="pause"]').click()
    out["safety"] = s.page.evaluate("() => { const x = window.__lessonSafety; return x && { ped: x.pedestrianContacts, red: x.redLightViolations, other: x.otherCollisions, shield: x.shieldBrakes, boardings: x.boardings, crossings: x.crossings }; }")
    out["errors"] = s.errors
print(json.dumps(out, indent=1, ensure_ascii=False))
