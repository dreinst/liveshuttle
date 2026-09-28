"""Uji perbaikan shell dan widget di pelajaran sensor (desktop dan ponsel).

Memeriksa: ukuran target sentuh, tombol panah setelah klik segmen, lencana Dijeda, toast yang
tembus klik, navigasi panah segmen lewat papan ketik, dan kebersihan konsol.
Pemakaian: python3 tests/situs_shell_qa.py
"""

import json
import sys

from situs_util import BASE, browser, new_page, shot

results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})


with browser([]) as b:
    for mobile in (False, True):
        tag = "m" if mobile else "d"
        ctx, page, con = new_page(b, mobile)
        page.goto(BASE + "#/pelajaran/sensor", wait_until="load")
        page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
        page.wait_for_timeout(500)

        sizes = page.evaluate(
            """() => {
              const h = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
              return { seg: h('.seg-btn'), range: h('input[type=range]'), dots: h('.step-dot'), btn: h('.btn') };
            }"""
        )
        seg_min = min(hh for _, hh in sizes["seg"]) if sizes["seg"] else None
        check(f"{tag} tinggi tombol segmen >= 40", seg_min is not None and seg_min >= 40, json.dumps(sizes["seg"][:4]))
        if sizes["range"]:
            check(f"{tag} tinggi slider >= 40", min(hh for _, hh in sizes["range"]) >= 40, json.dumps(sizes["range"][:3]))
        dot_h = min(hh for _, hh in sizes["dots"])
        dot_w = min(ww for ww, _ in sizes["dots"])
        check(f"{tag} titik langkah tinggi 40", dot_h >= 40, json.dumps(sizes["dots"][:3]))
        if mobile:
            check(f"{tag} titik langkah lebar 40 di layar sentuh", dot_w >= 40, json.dumps(sizes["dots"][:3]))
        check(f"{tag} tombol >= 40", min(hh for _, hh in sizes["btn"]) >= 40, json.dumps(sorted(sizes["btn"], key=lambda x: x[1])[:3]))

        # klik segmen cuaca lalu tekan panah atas: harus menekan Maju, bukan mengganti cuaca
        kabut = page.locator(".seg-btn", has_text="Kabut").first
        if kabut.count():
            kabut.scroll_into_view_if_needed()
            if mobile:
                kabut.tap()
            else:
                kabut.click()
            page.wait_for_timeout(150)
            active = page.evaluate("() => document.activeElement && document.activeElement.className")
            check(f"{tag} fokus lepas dari segmen setelah klik", "seg-btn" not in (active or ""), str(active))
            page.keyboard.down("ArrowUp")
            page.wait_for_timeout(250)
            st = page.evaluate(
                """() => ({ held: [...document.querySelectorAll('.btn-hold')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
                  cuaca: [...document.querySelectorAll('.seg-btn.is-active')].map((b) => b.textContent.trim()) })"""
            )
            page.keyboard.up("ArrowUp")
            check(f"{tag} panah atas menekan tombol tahan", len(st["held"]) > 0 and "Kabut" in st["cuaca"], json.dumps(st, ensure_ascii=False))
        else:
            check(f"{tag} tombol Kabut ada", False)

        # papan ketik: fokus segmen lalu panah kanan tetap mengganti pilihan
        before = page.evaluate("() => document.querySelector('.speed-wrap .seg-btn.is-active').textContent")
        page.evaluate("() => document.querySelector('.speed-wrap .seg-btn.is-active').focus()")
        page.keyboard.press("ArrowRight")
        after = page.evaluate("() => document.querySelector('.speed-wrap .seg-btn.is-active').textContent")
        check(f"{tag} panah kanan di segmen berfokus", before != after, f"{before} -> {after}")

        # jeda: lencana di kanan atas panggung
        page.locator('[data-act="pause"]').click()
        page.wait_for_timeout(200)
        geo = page.evaluate(
            """() => { const s = document.querySelector('[data-el=stage]').getBoundingClientRect(); const b = document.querySelector('[data-el=badge]');
              const r = b.getBoundingClientRect(); return { hidden: b.hidden, top: r.top - s.top, right: s.right - r.right, h: r.height }; }"""
        )
        check(f"{tag} lencana Dijeda di kanan atas", not geo["hidden"] and geo["top"] < 20 and geo["right"] < 20 and geo["h"] <= 32, json.dumps(geo))
        shot(page, f"shellqa-paused-{tag}")
        page.locator('[data-act="pause"]').click()

        # toast tembus klik
        page.evaluate("() => import('/js/shell/toast.js').then((m) => m.toast('Uji toast tembus klik', { tone: 'ok', duration: 4000 }))")
        page.wait_for_timeout(400)
        hit = page.evaluate(
            """() => { const t = document.querySelector('.toast'); const r = t.getBoundingClientRect();
              const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inToast: !!e.closest('.toast'), tag: e.tagName, cls: e.className }; }"""
        )
        check(f"{tag} toast tidak menangkap klik", not hit["inToast"], json.dumps(hit))

        check(f"{tag} konsol bersih", con.clean, json.dumps(con.summary(), ensure_ascii=False)[:600])
        ctx.close()

bad = [r for r in results if not r["ok"]]
for r in results:
    print(("OK  " if r["ok"] else "BAD ") + r["name"] + ("" if r["ok"] else "  " + r["detail"]))
print(f"{len(results) - len(bad)} dari {len(results)} lolos")
sys.exit(1 if bad else 0)
