#!/usr/bin/env python3
"""QA independen untuk Kuis Akhir (#/pelajaran/kuis), dijalankan seperti pelajar sungguhan.

Pemakaian: python3 tests/kuis_indep_qa.py --port 8140 [--mobile]

Yang diperiksa:
  - Saat dimuat tidak ada tugas yang selesai dengan sendirinya, juga setelah menunggu.
  - Percobaan 1 gagal (11 benar, skor 64): "selesai" tercatat di langkah 1, "lulus" belum,
    juga setelah Lanjut ke langkah 2.
  - Ulangi kuis mengacak ulang soal dan pilihan. Percobaan 2 lulus tepat di ambang (12 benar, 70).
  - Tombol 5 diabaikan, jawaban tidak bisa diganti, angka tidak berlaku di halaman hasil.
  - Maju mundur semua langkah (tombol, titik langkah, ringkasan) tidak mengulang kuis.
  - Keluar masuk pelajaran 5 kali: tidak ada loop aktif, tag style hanya satu, jumlah pendengar
    keydown di window tidak bertambah.
  - Kasus tepi: Lanjut sebelum menjawab lalu gagal, dan menyelesaikan kuis di layar ringkasan.
  - Nol pesan error/warning console dan pageerror.
Tangkapan layar disimpan di tests/shots/kuis-indep/.
"""

import argparse
import os
import sys

from playwright.sync_api import sync_playwright

CHROME = (
    "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots", "kuis-indep")
os.makedirs(SHOTS, exist_ok=True)

fails = []


def check(cond, msg):
    print(("  ok    " if cond else "  GAGAL ") + msg, flush=True)
    if not cond:
        fails.append(msg)


class Learner:
    def __init__(self, page, mobile, tag):
        self.page = page
        self.mobile = mobile
        self.tag = tag
        self.answers = None

    # ---------- dasar ----------
    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def wait_ready(self):
        self.page.wait_for_function(
            "() => window.__simotonom && window.__simotonom.lessonId === 'kuis' && window.__simotonom.lessonStatus === 'ready'",
            timeout=20000,
        )
        self.page.wait_for_timeout(300)

    def shot(self, name, full=False, selector=None):
        path = os.path.join(SHOTS, f"{self.tag}-{name}.png")
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    def press(self, loc):
        """Klik di desktop, ketuk di ponsel."""
        loc.scroll_into_view_if_needed()
        if self.mobile:
            loc.tap()
        else:
            loc.click()

    def bank(self):
        if self.answers is None:
            self.answers = self.page.evaluate(
                """async () => {
                  const m = await import('/js/lessons/kuis/questions.js');
                  return Object.fromEntries(m.QUESTIONS.map(q => [q.id, q.answer]));
                }"""
            )
        return self.answers

    def qid(self):
        return self.page.get_attribute(".kz-play", "data-qid")

    def slots(self):
        return self.page.eval_on_selector_all(
            ".kz-opts .kz-opt", "els => els.map(e => [Number(e.dataset.slot), Number(e.dataset.opt)])"
        )

    def slot_for(self, want_correct):
        ans = self.bank()[self.qid()]
        for slot, key in self.slots():
            if (key == ans) == want_correct:
                return slot
        raise RuntimeError("slot tidak ditemukan")

    def answer(self, correct, via):
        slot = self.slot_for(correct)
        if via == "key":
            self.page.keyboard.press(str(slot + 1))
        else:
            self.press(self.page.locator(f".kz-opts .kz-opt[data-slot='{slot}']"))
        self.page.wait_for_selector(".kz-feedback:not([hidden])", timeout=3000)
        return slot

    def next(self, via="click"):
        btn = self.page.locator(".kz-next")
        if via == "enter":
            self.page.keyboard.press("Enter")
        else:
            self.press(btn)
        self.page.wait_for_timeout(60)

    def run_attempt(self, n_correct, shots_prefix=None, stop_before_last=False):
        """Jawab semua soal; n_correct soal pertama benar. Campur tombol angka dan klik/ketuk."""
        total = self.page.locator(".kz-track .kz-seg").count()
        order = []
        for i in range(total):
            order.append((self.qid(), tuple(k for _, k in self.slots())))
            if stop_before_last and i == total - 1:
                return order
            via = "key" if i % 3 == 0 else "click"
            self.answer(i < n_correct, via)
            if shots_prefix and i == 0:
                self.shot(f"{shots_prefix}-feedback-{'benar' if n_correct > 0 else 'salah'}")
            if i < total - 1:
                self.next("enter" if i % 2 == 0 else "click")
        return order

    def step_go(self, i):
        self.page.locator(f".step-card [data-go='{i}']").first.dispatch_event("click")
        self.page.wait_for_timeout(120)

    def lanjut(self):
        self.page.locator(".step-nav .btn-primary").first.dispatch_event("click")
        self.page.wait_for_timeout(120)


def listener_count(page, cdp):
    """Jumlah pendengar keydown pada window (lewat DevTools Protocol)."""
    res = cdp.send("Runtime.evaluate", {"expression": "window", "objectGroup": "kz"})
    oid = res["result"]["objectId"]
    ls = cdp.send("DOMDebugger.getEventListeners", {"objectId": oid})["listeners"]
    cdp.send("Runtime.releaseObjectGroup", {"objectGroup": "kz"})
    return sum(1 for l in ls if l["type"] == "keydown")


def new_context(browser, mobile, reduced=False):
    opts = dict(reduced_motion="reduce" if reduced else "no-preference")
    if mobile:
        return browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, **opts)
    return browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1, **opts)


def attach_console(page, sink):
    page.on("console", lambda m: sink.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: sink.append(f"pageerror: {e}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8140)
    ap.add_argument("--mobile", action="store_true")
    args = ap.parse_args()
    base = f"http://127.0.0.1:{args.port}/"
    tag = "m" if args.mobile else "d"
    msgs = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)

        # ================= alur utama =================
        print(f"== Alur utama ({'mobile' if args.mobile else 'desktop'}) ==")
        ctx = new_context(browser, args.mobile)
        page = ctx.new_page()
        attach_console(page, msgs)
        L = Learner(page, args.mobile, tag)
        page.goto(base + "#/", wait_until="load")
        page.evaluate("() => localStorage.clear()")
        page.goto(base + "#/pelajaran/kuis", wait_until="load")
        L.wait_ready()
        h = L.hook()
        check(h["completedTasks"] == [], f"tidak ada tugas selesai saat dimuat ({h['completedTasks']})")
        check(h["stepIndex"] == 0 and h["stepCount"] == 2, f"langkah 1 dari 2 (stepIndex {h['stepIndex']}, stepCount {h['stepCount']})")
        check(h["activeLoops"] == 0, f"tidak ada loop (activeLoops {h['activeLoops']})")
        check(page.locator("[data-act='pause']").count() == 0, "layout full: tidak ada tombol Jeda/Ulangi/kecepatan shell")
        page.wait_for_timeout(2500)
        check(L.hook()["completedTasks"] == [], "tetap tidak ada tugas selesai setelah menunggu 2,5 detik")
        check(page.locator(".kz-opts .kz-opt").count() == 4, "soal pertama punya 4 pilihan")
        check(page.inner_text(".kz-count").strip().lower() == "soal 1 dari 17", f"penunjuk kemajuan: {page.inner_text('.kz-count')!r}")
        check(page.locator(".kz-feedback").is_hidden(), "umpan balik belum tampil sebelum menjawab")
        L.shot("01-soal")

        # tombol 5 dan Enter tanpa jawaban tidak berbuat apa-apa
        page.keyboard.press("5")
        page.wait_for_timeout(80)
        check(page.locator(".kz-opt.is-locked").count() == 0, "tombol 5 diabaikan")
        first_q = L.qid()

        # jawab salah lewat klik/ketuk, lalu coba ganti dengan angka lain
        wrong_slot = L.answer(False, "click")
        fb = page.inner_text(".kz-feedback")
        check("Kurang tepat" in fb and "Jawaban yang benar" in fb, "umpan balik salah menyebut jawaban yang benar")
        check(page.locator(".kz-opt.is-correct").count() == 1 and page.locator(".kz-opt.is-wrong").count() == 1, "pilihan benar dan salah ditandai")
        L.shot("02-salah")
        other = L.slot_for(True)
        page.keyboard.press(str(other + 1))
        page.wait_for_timeout(80)
        check(page.locator(f".kz-opt[data-slot='{wrong_slot}'].is-wrong").count() == 1, "jawaban tidak bisa diganti dengan tombol angka")
        check("0" in page.inner_text(".kz-tally") and "1" in page.inner_text(".kz-tally"), f"penghitung benar/salah: {page.inner_text('.kz-tally')!r}")
        focused = page.evaluate("() => document.activeElement && document.activeElement.classList.contains('kz-next')")
        check(focused, "fokus pindah ke tombol Soal berikutnya")
        L.next("enter")
        check(L.qid() != first_q, "Enter membuka soal berikutnya")

        # sisa percobaan 1: total 11 benar (soal pertama salah, jadi 11 benar dari 16 sisa)
        total = 17
        for i in range(1, total):
            via = "key" if i % 2 else "click"
            L.answer(i <= 11, via)
            if i == 1:
                L.shot("03-benar")
            if i < total - 1:
                L.next("enter" if i % 3 == 0 else "click")
        check(page.inner_text(".kz-next").strip() == "Lihat hasil", "tombol terakhir berbunyi Lihat hasil")
        h = L.hook()
        check(h["completedTasks"] == ["selesai"], f"setelah soal terakhir: selesai tercatat, lulus belum ({h['completedTasks']})")
        L.next("click")
        page.wait_for_selector(".kz-result:not([hidden])")
        focused = page.evaluate("() => document.activeElement && document.activeElement.classList.contains('kz-res-title')")
        check(focused, "fokus di judul hasil setelah Lihat hasil")
        num = page.inner_text(".kz-ring-num").strip()
        check(num == "64", f"skor 11 dari 17 = 64 (tampil {num})")
        check("Belum lulus" in page.inner_text(".kz-res-title"), "judul hasil: belum lulus")
        check("12 jawaban benar" in page.inner_text(".kz-res-detail"), "detail menyebut butuh 12 jawaban benar")
        check(page.locator(".kz-rev").count() == 17, "pembahasan berisi 17 soal")
        check(page.locator(".kz-trow").count() == 10, f"hasil per topik 10 baris ({page.locator('.kz-trow').count()})")
        page.keyboard.press("1")
        page.wait_for_timeout(80)
        check(page.locator(".kz-result:not([hidden])").count() == 1, "tombol angka tidak berlaku di halaman hasil")
        L.shot("04-hasil-gagal")
        L.shot("04-hasil-gagal-full", full=True)
        # saringan
        L.press(page.locator(".kz-rev-head .seg-btn").nth(1))
        page.wait_for_timeout(80)
        vis = page.eval_on_selector_all(".kz-rev", "els => els.filter(e => !e.hidden).length")
        vis_bad = page.eval_on_selector_all(".kz-rev.is-bad", "els => els.filter(e => !e.hidden).length")
        check(vis == 6 and vis_bad == 6, f"saringan Yang salah menampilkan 6 soal salah ({vis}, {vis_bad})")
        L.shot("05-saringan", full=True)
        L.press(page.locator(".kz-rev-head .seg-btn").nth(0))
        page.wait_for_timeout(80)
        check(page.eval_on_selector_all(".kz-rev", "els => els.filter(e => !e.hidden).length") == 17, "saringan Semua kembali 17")
        hrefs = page.eval_on_selector_all(".kz-rev-link", "els => [...new Set(els.map(e => e.getAttribute('href')))]")
        check(all(x.startswith("#/pelajaran/") or x == "#/simulator/tutorial" for x in hrefs), f"tautan pembahasan valid ({sorted(hrefs)})")

        # Lihat hasil memindahkan kartu ke langkah 2, tugas lulus tetap belum
        h = L.hook()
        check(h["stepIndex"] == 1 and h["completedTasks"] == ["selesai"], f"hasil gagal: kartu pindah ke langkah 2, lulus belum (step {h['stepIndex']}, {h['completedTasks']})")
        check("Raih skor minimal" in page.inner_text(".step-card"), "kartu langkah menampilkan Raih skor minimal 70")
        check(page.locator(".kz-result:not([hidden])").count() == 1, "hasil tetap tampil setelah pindah langkah")
        L.shot("06-langkah2-gagal", full=True)

        # Ulangi kuis
        seq1 = [L.bank()]  # memuat bank
        order_before = page.eval_on_selector_all(".kz-rev", "els => els.map(e => e.dataset.qid)")
        L.press(page.locator("[data-act='ulangi']").first)
        page.wait_for_selector(".kz-play:not([hidden])")
        check(page.inner_text(".kz-count").strip().lower() == "soal 1 dari 17", "Ulangi kuis kembali ke soal 1")
        check(page.locator(".kz-seg.is-ok, .kz-seg.is-bad").count() == 0, "jalur kemajuan kosong lagi")
        order2 = L.run_attempt(12)
        q_order2 = [q for q, _ in order2]
        check(q_order2 != order_before, "urutan soal percobaan 2 berbeda dari percobaan 1")
        opt_orders = [o for _, o in order2]
        check(any(o != (0, 1, 2, 3) for o in opt_orders), "pilihan jawaban ikut diacak")
        h = L.hook()
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"], f"12 benar di langkah 2: lulus tercatat ({h['completedTasks']})")
        L.next("click")
        page.wait_for_selector(".kz-result:not([hidden])")
        num = page.inner_text(".kz-ring-num").strip()
        check(num == "70", f"skor 12 dari 17 = 70 (tampil {num})")
        check("lulus" in page.inner_text(".kz-res-title").lower() and "Belum" not in page.inner_text(".kz-res-title"), "judul hasil: lulus")
        check("percobaan ke-2" in page.inner_text(".kz-result").lower(), "hasil menyebut percobaan ke-2")
        ptxt = page.inner_text(".lesson-progress-text")
        check(ptxt.strip() == "2 dari 2 tugas selesai", f"header: {ptxt!r}")
        L.shot("07-hasil-lulus")
        L.shot("07-hasil-lulus-full", full=True)

        # maju mundur langkah dan ringkasan
        for i in (0, 1, 2, 1, 0, 2):
            L.step_go(i)
            h = L.hook()
            check(h["stepIndex"] == i, f"pindah ke langkah {i}")
        check(page.locator(".kz-result:not([hidden])").count() == 1, "hasil tetap setelah maju mundur")
        L.shot("08-ringkasan", full=True)
        L.step_go(1)

        # percobaan 3 sempurna (untuk melihat tampilan tanpa jawaban salah)
        L.press(page.locator("[data-act='ulangi']").first)
        page.wait_for_selector(".kz-play:not([hidden])")
        L.run_attempt(17)
        L.next("click")
        page.wait_for_selector(".kz-result:not([hidden])")
        check(page.inner_text(".kz-ring-num").strip() == "100", "skor sempurna 100")
        check(page.locator(".kz-rev-head .seg-btn").count() == 0, "tanpa jawaban salah, saringan tidak tampil")
        L.shot("09-sempurna")

        # keluar masuk 5 kali
        cdp = ctx.new_cdp_session(page)
        page.goto(base + "#/", wait_until="load")
        page.wait_for_timeout(500)
        home_loops = L.hook()["activeLoops"]  # beranda punya kanvas ambient sendiri
        home_listeners = listener_count(page, cdp)
        out_counts, in_counts = [], []
        for k in range(5):
            page.evaluate("() => { location.hash = '#/pelajaran/kuis'; }")
            L.wait_ready()
            styles = page.evaluate("() => document.querySelectorAll('style[data-lesson=\"kuis\"]').length")
            check(styles == 1, f"masuk ke-{k + 1}: tag style kuis tepat satu ({styles})")
            in_counts.append(listener_count(page, cdp))
            check(L.hook()["activeLoops"] == 0, f"masuk ke-{k + 1}: activeLoops 0 di halaman kuis")
            L.answer(True, "key")  # satu jawaban lewat tombol angka
            locked = page.locator(".kz-opt.is-locked").count()
            check(locked == 4, f"masuk ke-{k + 1}: satu tombol angka menjawab satu soal")
            page.evaluate("() => { location.hash = '#/'; }")
            page.wait_for_timeout(400)
            h = L.hook()
            styles = page.evaluate("() => document.querySelectorAll('style[data-lesson=\"kuis\"]').length")
            out_counts.append(listener_count(page, cdp))
            check(h["activeLoops"] == home_loops and styles == 0, f"keluar ke-{k + 1}: activeLoops {h['activeLoops']} (beranda {home_loops}), style {styles}")
        print(f"     pendengar keydown window: beranda {home_listeners}, di kuis {in_counts}, setelah keluar {out_counts}")
        check(len(set(in_counts)) == 1 and in_counts[0] > home_listeners, "pendengar keydown di halaman kuis sama setiap kali masuk")
        check(all(c == home_listeners for c in out_counts), "pendengar keydown kembali ke jumlah beranda setelah keluar")
        prog = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1') || '{}')")
        check("kuis" in str(prog) and "lulus" in str(prog), "kemajuan tersimpan di localStorage")
        ctx.close()

        # ================= kasus tepi 1: Lanjut sebelum menjawab, lalu gagal =================
        print("== Kasus tepi: Lanjut lebih dulu, lalu gagal ==")
        ctx = new_context(browser, args.mobile)
        page = ctx.new_page()
        attach_console(page, msgs)
        L = Learner(page, args.mobile, tag)
        page.goto(base + "#/", wait_until="load")
        page.evaluate("() => localStorage.clear()")
        page.goto(base + "#/pelajaran/kuis", wait_until="load")
        L.wait_ready()
        L.lanjut()
        check(L.hook()["stepIndex"] == 1, "Lanjut ke langkah 2 sebelum menjawab")
        L.run_attempt(5)
        h = L.hook()
        check(h["completedTasks"] == ["selesai"], f"gagal di langkah 2: selesai tercatat, lulus belum ({h['completedTasks']})")
        check(h["stepIndex"] == 1, f"pelajar tetap di langkah 2 ({h['stepIndex']})")
        focused = page.evaluate("() => document.activeElement && document.activeElement.classList.contains('kz-next')")
        check(focused, "fokus tetap di tombol Lihat hasil")
        L.next("click")
        page.wait_for_selector(".kz-result:not([hidden])")
        check(L.hook()["stepIndex"] == 1, "Lihat hasil di langkah 2 tidak memindahkan langkah")
        ctx.close()

        # ================= kasus tepi 3: lulus pada percobaan pertama di langkah 1 =================
        print("== Kasus tepi: lulus di langkah 1, lalu langsung pergi ==")
        ctx = new_context(browser, args.mobile)
        page = ctx.new_page()
        attach_console(page, msgs)
        L = Learner(page, args.mobile, tag)
        page.goto(base + "#/pelajaran/kuis", wait_until="load")
        L.wait_ready()
        L.run_attempt(13)
        h = L.hook()
        check(h["completedTasks"] == ["selesai"] and h["stepIndex"] == 0, f"soal terakhir terjawab di langkah 1: selesai saja ({h['completedTasks']})")
        L.next("click")
        page.wait_for_selector(".kz-result:not([hidden])")
        h = L.hook()
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"] and h["stepIndex"] == 1, f"Lihat hasil: kartu ke langkah 2 dan lulus tercatat ({h['stepIndex']}, {h['completedTasks']})")
        page.wait_for_timeout(700)
        toasts = page.eval_on_selector_all("#toasts .toast-text", "els => els.map(e => e.textContent)")
        print("     toast:", toasts)
        check(bool(toasts) and toasts[-1].startswith("Semua tugas selesai"), "toast terakhir: Semua tugas selesai")
        L.shot("10-lulus-langkah1")
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(500)
        prog = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1') || '{}')")
        rec = prog.get("lessons", {}).get("kuis", {})
        check(rec.get("complete") is True, f"pelajaran kuis tuntas di penyimpanan ({rec})")
        ctx.close()

        # ================= kasus tepi 4: gagal di layar ringkasan =================
        print("== Kasus tepi: gagal di layar ringkasan ==")
        ctx = new_context(browser, args.mobile)
        page = ctx.new_page()
        attach_console(page, msgs)
        L = Learner(page, args.mobile, tag)
        page.goto(base + "#/pelajaran/kuis", wait_until="load")
        L.wait_ready()
        L.lanjut()
        L.lanjut()
        L.run_attempt(3)
        h = L.hook()
        check(h["completedTasks"] == ["selesai"] and h["stepIndex"] == 2, f"gagal di ringkasan: selesai tercatat, tetap di ringkasan ({h['stepIndex']}, {h['completedTasks']})")
        prog = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1') || '{}')")
        last = prog.get("lessons", {}).get("kuis", {}).get("lastStep")
        check(last == 1, f"langkah terakhir yang diingat langkah 2 (lastStep {last})")
        ctx.close()

        # ================= kasus tepi 2: selesai di layar ringkasan =================
        print("== Kasus tepi: menyelesaikan kuis di ringkasan ==")
        ctx = new_context(browser, args.mobile)
        page = ctx.new_page()
        attach_console(page, msgs)
        L = Learner(page, args.mobile, tag)
        page.goto(base + "#/", wait_until="load")
        page.evaluate("() => localStorage.clear()")
        page.goto(base + "#/pelajaran/kuis", wait_until="load")
        L.wait_ready()
        L.lanjut()
        L.lanjut()
        check(L.hook()["stepIndex"] == 2, "layar ringkasan terbuka")
        L.run_attempt(15)
        h = L.hook()
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"], f"di ringkasan: kedua tugas tercatat ({h['completedTasks']})")
        check(h["stepIndex"] == 2, f"pelajar tetap di ringkasan ({h['stepIndex']})")
        check("Semua tugas selesai" in page.inner_text(".step-card"), "daftar tugas di ringkasan diperbarui")
        prog = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1') || '{}')")
        last = prog.get("lessons", prog).get("kuis", {}).get("lastStep") if isinstance(prog, dict) else None
        print("     lastStep tersimpan:", last)
        check(last == 1, f"langkah terakhir yang diingat tetap langkah 2 (lastStep {last})")
        ctx.close()

        browser.close()

    print("== Pesan console ==")
    for m in msgs:
        print("   ", m)
    check(not msgs, f"nol error/warning console ({len(msgs)})")
    print(f"\n{len(fails)} gagal")
    for f in fails:
        print("  -", f)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
