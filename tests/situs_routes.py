"""Uji rute shell LiveShuttle: pengalihan rute lama, rute 3D, judul, navigasi, migrasi progres.

Pemakaian: python3 tests/situs_routes.py [--gpu]
Server harus berjalan di port 8221.
"""

import json
import sys

from situs_util import BASE, GPU, SWIFTSHADER, browser, hook, new_page, shot

args = GPU if "--gpu" in sys.argv else SWIFTSHADER
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})


def wait_sim(page, status=("ready", "error", "missing"), timeout=30000):
    page.wait_for_function(
        "(s) => window.__simotonom && s.includes(window.__simotonom.simStatus)", arg=list(status), timeout=timeout
    )


with browser(args) as b:
    ctx, page, con = new_page(b)

    # migrasi progres dari kunci lama
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate(
        """() => { localStorage.removeItem('liveshuttle.progress.v1');
        localStorage.setItem('simotonom.progress.v1', JSON.stringify({ version: 1, lessons: { sensor: { done: ['lidar-on'], tasks: null, lastStep: 2, complete: false, visited: true } } })); }"""
    )
    page.reload(wait_until="load")
    page.wait_for_timeout(800)
    mig = page.evaluate("() => ({ nu: localStorage.getItem('liveshuttle.progress.v1'), old: localStorage.getItem('simotonom.progress.v1') })")
    check("migrasi progres", mig["nu"] and "lidar-on" in mig["nu"] and mig["old"] is None, json.dumps(mig))
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="load")

    # teks kepala halaman
    nav = page.evaluate("() => [...document.querySelectorAll('.main-nav .nav-link')].map((a) => a.textContent.trim())")
    check("navigasi Beranda / Shuttle 3D / Pelajaran", nav == ["Beranda", "Shuttle 3D", "Pelajaran"], json.dumps(nav))
    brand = page.inner_text(".brand-name")
    check("nama LiveShuttle", brand == "LiveShuttle", brand)

    # pengalihan
    for src, dst in [
        ("#/simulator", "#/shuttle-3d/panduan"),
        ("#/simulator/tutorial", "#/shuttle-3d/panduan"),
        ("#/simulator/bebas", "#/shuttle-3d/jelajah"),
        ("#/shuttle-3d", "#/shuttle-3d/panduan"),
        ("#/shuttle-3d/aneh", "#/shuttle-3d/panduan"),
    ]:
        page.goto(BASE + "#/", wait_until="load")
        page.wait_for_timeout(300)
        page.evaluate("(h) => { location.hash = h; }", src)
        page.wait_for_timeout(400)
        h = page.evaluate("() => location.hash")
        check(f"alih {src}", h == dst, h)

    # rute 3D panduan
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => { location.hash = '#/shuttle-3d/panduan'; }")
    wait_sim(page)
    hk = hook(page)
    check("3D panduan terpasang", hk["simStatus"] == "ready" and hk["simMode"] == "panduan", json.dumps({k: hk[k] for k in ("simStatus", "simMode", "route")}))
    check("judul 3D panduan", page.title() == "Shuttle 3D Ma Chung, Panduan · LiveShuttle", page.title())
    ctxt = page.inner_text(".header-context")
    check("konteks kepala 3D", "Shuttle 3D Ma Chung" in ctxt and "Panduan" in ctxt, ctxt)
    shot(page, "routes-3d-panduan")

    # ganti ke jelajah lewat hash: shell tidak memuat ulang halaman, mode ikut berubah
    page.evaluate("() => { const c = document.querySelector('.sim3d-host canvas'); if (c) c.dataset.penanda = 'sama'; }")
    page.evaluate("() => { location.hash = '#/shuttle-3d/jelajah'; }")
    page.wait_for_timeout(500)
    wait_sim(page)
    page.wait_for_timeout(500)
    hk = hook(page)
    check("3D ganti ke jelajah", hk["simMode"] == "jelajah" and hk["simStatus"] == "ready", json.dumps({k: hk[k] for k in ("simStatus", "simMode", "route")}))
    check("judul 3D jelajah", page.title() == "Shuttle 3D Ma Chung, Jelajah · LiveShuttle", page.title())
    canvases = page.evaluate("() => document.querySelectorAll('.sim3d-host canvas:not(.s3d-map-canvas)').length")
    check("satu kanvas 3D setelah ganti mode", canvases <= 1, str(canvases))
    same = page.evaluate("() => document.querySelector('.sim3d-host canvas')?.dataset.penanda || null")
    check("ganti mode tanpa memasang ulang", same == "sama", str(same))
    # modul berganti mode sendiri lewat replaceState: judul menyusul lewat pemeriksaan hash
    page.evaluate("() => history.replaceState(null, '', '#/shuttle-3d/panduan')")
    page.wait_for_timeout(800)
    check("judul ikut replaceState", page.title() == "Shuttle 3D Ma Chung, Panduan · LiveShuttle" and hook(page)["simMode"] == "panduan", page.title())
    shot(page, "routes-3d-jelajah")

    # tinggalkan 3D: bersih
    page.evaluate("() => { location.hash = '#/'; }")
    page.wait_for_timeout(800)
    left = page.evaluate("() => ({ canv: document.querySelectorAll('.sim3d-host').length, css: document.querySelectorAll('link[href*=sim3d]').length, loops: window.__simotonom.activeLoops })")
    check("3D dibersihkan", left["canv"] == 0 and left["css"] == 0, json.dumps(left))

    # rute tidak dikenal
    page.evaluate("() => { location.hash = '#/tidak-ada'; }")
    page.wait_for_timeout(400)
    check("rute asing ke beranda", page.evaluate("() => location.hash") == "#/", page.evaluate("() => location.hash"))

    # judul pelajaran
    page.evaluate("() => { location.hash = '#/pelajaran/rute'; }")
    page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    check("judul pelajaran", page.title() == "Perencanaan Rute · LiveShuttle", page.title())

    check("konsol bersih", con.clean, json.dumps(con.summary(), ensure_ascii=False)[:800])
    ctx.close()

bad = [r for r in results if not r["ok"]]
for r in results:
    print(("OK  " if r["ok"] else "BAD ") + r["name"] + ("" if r["ok"] else "  " + r["detail"]))
print(f"{len(results) - len(bad)} dari {len(results)} lolos")
sys.exit(1 if bad else 0)
