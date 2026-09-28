#!/usr/bin/env python3
"""Uji Kuis Akhir lewat antarmuka, seperti pelajar sungguhan.

Pemakaian: python3 tests/kuis_qa.py --port 8120 [--mobile]

Alur utama:
  1. Percobaan pertama sengaja gagal (sebagian dijawab lewat keyboard 1 sampai 4, sebagian diklik).
     Tugas "selesai" harus tercatat di langkah 1, tugas "lulus" belum.
  2. Halaman hasil memindahkan kartu ke langkah 2, tugas "lulus" tetap belum selesai.
  3. Ulangi kuis: urutan soal dan pilihan harus berubah. Jawab tepat di ambang lulus.
     Tugas "lulus" tercatat.
  4. Ringkasan pelajaran.
Kasus tepi (konteks baru): pelajar menekan Lanjut sebelum menjawab, dan pelajar berada di layar
ringkasan saat menjawab soal terakhir. Keduanya harus mencatat kedua tugas tanpa memindahkan langkah.
Juga diperiksa: jawaban tidak bisa diganti, tombol 5 diabaikan, saringan pembahasan, pesan console.
"""

import argparse
import json
import math
import os
import sys

from playwright.sync_api import sync_playwright

CHROME = (
    "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots", "kuis")

failures = []


def check(cond, msg):
    print(("  ok   " if cond else "  GAGAL ") + msg)
    if not cond:
        failures.append(msg)


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def bank(page):
    return page.evaluate(
        """async () => {
          const m = await import('/js/lessons/kuis/questions.js');
          return Object.fromEntries(m.QUESTIONS.map(q => [q.id, q.answer]));
        }"""
    )


def current_qid(page):
    return page.get_attribute(".kz-play", "data-qid")


def option_slots(page):
    """[(slot, key)] untuk soal yang tampil."""
    return page.evaluate(
        "() => [...document.querySelectorAll('.kz-opt')].map(b => [Number(b.dataset.slot), Number(b.dataset.opt)])"
    )


def answer_current(page, answers, correct, how, mobile):
    qid = current_qid(page)
    right = answers[qid]
    slots = option_slots(page)
    slot = next(s for s, k in slots if (k == right) == correct)
    if how == "key":
        page.keyboard.press(str(slot + 1))
    elif mobile:
        page.locator(f'.kz-opt[data-slot="{slot}"]').tap()
    else:
        page.locator(f'.kz-opt[data-slot="{slot}"]').click()
    page.wait_for_selector(".kz-feedback:not([hidden])")
    return qid, slot


def go_next(page, mobile):
    btn = page.locator('.kz-next')
    if mobile:
        btn.tap()
    else:
        btn.click()


def run_attempt(page, answers, pattern, mobile, shots_prefix=None, use_keys=True):
    """pattern: daftar bool benar/salah per soal. Mengembalikan urutan id soal."""
    order = []
    for i, ok in enumerate(pattern):
        how = "key" if (use_keys and i % 3 == 0) else "click"
        qid, slot = answer_current(page, answers, ok, how, mobile)
        order.append(qid)
        if shots_prefix and i == 0:
            page.screenshot(path=f"{shots_prefix}-feedback-{'benar' if ok else 'salah'}.png")
        if i == len(pattern) - 1:
            label = page.inner_text(".kz-next").strip()
            check(label == "Lihat hasil", f"tombol soal terakhir berlabel 'Lihat hasil' (dapat '{label}')")
        # fokus harus pindah ke tombol lanjut supaya Enter langsung bisa dipakai
        focused = page.evaluate("() => document.activeElement?.classList.contains('kz-next')")
        if i < 2:
            check(focused, f"fokus pindah ke tombol lanjut setelah menjawab (soal {i + 1})")
        if i == 1:
            # Enter pada tombol yang terfokus melanjutkan ke soal berikutnya
            page.keyboard.press("Enter")
        else:
            go_next(page, mobile)
        page.wait_for_timeout(60)
    page.wait_for_selector(".kz-result:not([hidden])")
    return order


def fresh_context(browser, mobile):
    if mobile:
        return browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    return browser.new_context(viewport={"width": 1366, "height": 900})


def attach_console(page, errors):
    def on_console(msg):
        if msg.type in ("error", "warning"):
            errors.append(f"{msg.type}: {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))


def open_quiz(page, port):
    page.goto(f"http://127.0.0.1:{port}/#/pelajaran/kuis", wait_until="load")
    try:
        page.wait_for_function("() => window.__simotonom?.lessonStatus === 'ready'", timeout=15000)
    except Exception:
        # python -m http.server kadang tersendat saat banyak modul dimuat bersamaan: muat ulang sekali
        print("  (muat ulang: server tersendat)")
        page.reload(wait_until="load")
        page.wait_for_function("() => window.__simotonom?.lessonStatus === 'ready'")
    page.wait_for_selector(".kz-opt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8120)
    ap.add_argument("--mobile", action="store_true")
    args = ap.parse_args()
    mobile = args.mobile
    tag = "m" if mobile else "d"
    os.makedirs(SHOTS, exist_ok=True)
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)

        # ---------- alur utama ----------
        ctx = fresh_context(browser, mobile)
        page = ctx.new_page()
        attach_console(page, errors)
        open_quiz(page, args.port)
        answers = bank(page)
        total = len(answers)
        need = math.ceil(0.7 * total - 1e-9)
        print(f"[{tag}] {total} soal, lulus butuh {need} benar")
        check(total >= 12, "minimal 12 soal")
        # model: bank soal valid dan posisi jawaban benar tersebar rata setelah diacak
        dist = page.evaluate(
            """async () => {
              const q = await import('/js/lessons/kuis/questions.js');
              const m = await import('/js/lessons/kuis/model.js');
              const { Rng } = await import('/js/engine/math.js');
              const bad = q.QUESTIONS.filter(x => x.options.length !== 4 || new Set(x.options).size !== 4 || !q.TOPICS[x.topic]);
              const quiz = m.createQuiz(q.QUESTIONS, new Rng(99));
              const c = [0, 0, 0, 0];
              for (let a = 0; a < 2000; a++) { if (a) quiz.start(); for (const it of quiz.items) c[quiz.correctSlot(it)]++; }
              const tot = c.reduce((s, v) => s + v, 0);
              const topics = Object.keys(q.TOPICS).filter(t => !q.QUESTIONS.some(x => x.topic === t));
              return { bad: bad.map(x => x.id), share: c.map(v => v / tot), missing: topics };
            }"""
        )
        check(not dist["bad"], f"setiap soal punya 4 pilihan berbeda dan topik yang dikenal {dist['bad']}")
        check(not dist["missing"], f"setiap topik punya soal {dist['missing']}")
        check(all(0.23 < s < 0.27 for s in dist["share"]), f"posisi jawaban benar tersebar rata {[round(s, 3) for s in dist['share']]}")
        h = hook(page)
        check(h["stepIndex"] == 0 and h["completedTasks"] == [], "mulai di langkah 1 tanpa tugas selesai")
        check(page.inner_text(".kz-count").strip().lower().startswith("soal 1 dari"), "penanda soal 1")
        n_opts = page.locator(".kz-opt").count()
        check(n_opts == 4, "empat pilihan per soal")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-1-soal.png")

        # tombol 5 diabaikan, jawaban tidak bisa diganti
        page.keyboard.press("5")
        page.wait_for_timeout(50)
        check(page.locator(".kz-feedback:not([hidden])").count() == 0, "tombol 5 tidak memilih apa pun")

        # percobaan 1: 5 benar, sisanya salah (gagal). Soal pertama dijawab benar.
        pattern1 = [i < 5 for i in range(total)]
        # soal pertama: periksa bahwa jawaban tidak bisa diganti
        qid, slot = answer_current(page, answers, True, "key", mobile)
        page.wait_for_timeout(400)  # animasi masuk umpan balik 0,25 detik
        page.screenshot(path=f"{SHOTS}/qa-{tag}-2-benar.png")
        other = (slot + 1) % 4
        page.keyboard.press(str(other + 1))
        page.wait_for_timeout(50)
        chosen = page.evaluate("() => [...document.querySelectorAll('.kz-opt')].filter(b => b.classList.contains('is-wrong')).length")
        check(chosen == 0, "jawaban tidak berubah setelah menekan angka lain")
        check(page.locator(".kz-opt.is-correct").count() == 1, "satu pilihan ditandai benar")
        status = page.evaluate("() => document.querySelector('[data-el=status]').textContent")
        check(status.startswith("Benar."), "status untuk pembaca layar mengumumkan jawaban benar")
        order1 = [qid]
        go_next(page, mobile)
        page.wait_for_timeout(60)
        # soal kedua: salah, simpan tangkapan layar umpan balik salah
        qid, slot = answer_current(page, answers, False, "click", mobile)
        order1.append(qid)
        page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOTS}/qa-{tag}-3-salah.png")
        check(page.locator(".kz-opt.is-wrong").count() == 1 and page.locator(".kz-opt.is-correct").count() == 1, "pilihan salah dan jawaban benar sama-sama ditandai")
        status = page.evaluate("() => document.querySelector('[data-el=status]').textContent")
        check(status.startswith("Kurang tepat. Jawaban yang benar:"), "status mengumumkan jawaban yang benar")
        check("1 benar" in page.inner_text(".kz-tally") and "1 salah" in page.inner_text(".kz-tally"), "penghitung benar dan salah")
        check(page.locator(".kz-seg.is-ok").count() == 1 and page.locator(".kz-seg.is-bad").count() == 1, "segmen progres berwarna")
        go_next(page, mobile)
        page.wait_for_timeout(60)
        order1 += run_attempt(page, answers, [True] * 3 + [False] * (total - 5), mobile)
        check(len(set(order1)) == total, "setiap soal muncul tepat sekali")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/qa-{tag}-4-hasil-gagal.png")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-4-hasil-gagal-full.png", full_page=True)
        score_txt = page.inner_text(".kz-ring-num").strip()
        exp_score = math.floor(100 * 4 / total + 1e-9)
        # 4 benar: soal 1, lalu 3 dari pola run_attempt (soal 2 sengaja salah)
        check(score_txt == str(exp_score), f"skor gagal {score_txt} sama dengan {exp_score}")
        check("Belum lulus" in page.inner_text(".kz-res-title"), "judul hasil: belum lulus")
        h = hook(page)
        check(h["completedTasks"] == ["selesai"], f"tugas 'selesai' tercatat di langkah 1 (dapat {h['completedTasks']})")
        check(h["stepIndex"] == 1, "halaman hasil memindahkan kartu ke langkah 2")
        focused = page.evaluate("() => document.activeElement?.classList.contains('kz-res-title')")
        check(focused, "fokus pindah ke judul hasil")

        # tombol angka di halaman hasil tidak berbuat apa pun
        page.keyboard.press("1")
        page.wait_for_timeout(50)
        check(page.locator(".kz-result:not([hidden])").count() == 1, "angka di halaman hasil diabaikan")

        # saringan pembahasan
        wrong = total - 4
        seg = page.locator('.kz-rev-head .seg-btn[data-value="salah"]')
        if mobile:
            seg.tap()
        else:
            seg.click()
        page.wait_for_timeout(50)
        vis = page.evaluate("() => [...document.querySelectorAll('.kz-rev')].filter(li => !li.hidden).length")
        check(vis == wrong, f"saringan 'Yang salah' menampilkan {wrong} soal (dapat {vis})")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-5-saringan.png", full_page=True)
        page.locator('.kz-rev-head .seg-btn[data-value="semua"]').click()
        vis = page.evaluate("() => [...document.querySelectorAll('.kz-rev')].filter(li => !li.hidden).length")
        check(vis == total, "saringan 'Semua' menampilkan semua soal")
        links = page.evaluate("() => [...document.querySelectorAll('.kz-rev-link')].map(a => a.getAttribute('href'))")
        check(all(l.startswith("#/pelajaran/") or l.startswith("#/shuttle-3d/") for l in links), "tautan pelajaran di pembahasan")

        # langkah 2 (sudah terbuka bersama halaman hasil): belum lulus
        h = hook(page)
        check(h["stepIndex"] == 1 and "lulus" not in h["completedTasks"], "langkah 2 dibuka, tugas lulus belum selesai")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-6-langkah2-gagal.png")

        # ulangi kuis: urutan harus berubah
        opts_before = None
        btn = page.locator('.kz-actions [data-act="ulangi"]')
        if mobile:
            btn.tap()
        else:
            btn.click()
        page.wait_for_selector(".kz-play:not([hidden]) .kz-opt")
        check(page.inner_text(".kz-count").strip().lower().startswith("soal 1 dari"), "percobaan baru mulai dari soal 1")
        check(page.locator(".kz-seg.is-ok, .kz-seg.is-bad").count() == 0, "progres percobaan baru kosong")
        focused = page.evaluate("() => document.activeElement?.classList.contains('kz-q')")
        check(focused, "fokus pindah ke soal pertama percobaan baru")
        first_opts = option_slots(page)
        # percobaan 2 tepat di ambang lulus
        pattern2 = [i < need for i in range(total)]
        order2 = run_attempt(page, answers, pattern2, mobile)
        check(order2 != order1, "urutan soal diacak ulang")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/qa-{tag}-7-hasil-lulus.png")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-7-hasil-lulus-full.png", full_page=True)
        score2 = int(page.inner_text(".kz-ring-num").strip())
        check(score2 >= 70, f"skor percobaan 2 ({score2}) minimal 70")
        check("lulus" in page.inner_text(".kz-res-title").lower(), "judul hasil: lulus")
        check("percobaan ke-2" in page.inner_text(".kz-result").lower(), "hasil menyebut percobaan ke-2")
        h = hook(page)
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"], f"kedua tugas selesai (dapat {h['completedTasks']})")
        check(h["stepIndex"] == 1, "tetap di langkah 2")
        ptext = page.inner_text(".lesson-progress-text")
        check("2 dari 2" in ptext, f"progres pelajaran '{ptext}'")

        # skor ambang bawah: satu soal lebih sedikit tidak lulus (diperiksa dengan model)
        below = page.evaluate(
            "async (n) => { const m = await import('/js/lessons/kuis/model.js'); return [m.scoreOf(n - 1, %d), m.scoreOf(n, %d)]; }" % (total, total),
            need,
        )
        check(below[0] < 70 <= below[1], f"ambang lulus tepat: {need - 1} benar = {below[0]}, {need} benar = {below[1]}")

        # ringkasan
        page.locator(".step-nav .btn-primary").dispatch_event("click")
        page.wait_for_timeout(150)
        check(hook(page)["stepIndex"] == 2, "layar ringkasan")
        page.screenshot(path=f"{SHOTS}/qa-{tag}-8-ringkasan.png", full_page=True)

        # pindah halaman dan kembali: tidak ada loop yang tersisa
        page.goto(f"http://127.0.0.1:{args.port}/#/")
        page.wait_for_timeout(300)
        page.goto(f"http://127.0.0.1:{args.port}/#/pelajaran/kuis")
        page.wait_for_function("() => window.__simotonom?.lessonStatus === 'ready'")
        page.wait_for_timeout(200)
        h = hook(page)
        check(h["activeLoops"] == 0, "tidak ada loop aktif")
        styles = page.evaluate("() => document.querySelectorAll('style[data-lesson=kuis]').length")
        check(styles == 1, "gaya pelajaran hanya disisipkan sekali")
        ctx.close()

        # ---------- kasus tepi: Lanjut dulu, baru menjawab ----------
        ctx = fresh_context(browser, mobile)
        page = ctx.new_page()
        attach_console(page, errors)
        open_quiz(page, args.port)
        page.locator(".step-nav .btn-primary").dispatch_event("click")
        page.wait_for_timeout(100)
        check(hook(page)["stepIndex"] == 1, "[tepi] langsung ke langkah 2")
        run_attempt(page, answers, [True] * total, mobile, use_keys=True)
        h = hook(page)
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"], f"[tepi] kedua tugas tercatat dari langkah 2 (dapat {h['completedTasks']})")
        check(h["stepIndex"] == 1, "[tepi] tetap di langkah 2")
        check(page.inner_text(".kz-ring-num").strip() == "100", "[tepi] skor 100")
        check(page.locator(".kz-allgood").count() == 1 and page.locator(".kz-rev-head .seg").count() == 0, "[tepi] tanpa saringan saat semua benar")
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOTS}/qa-{tag}-9-sempurna.png")
        ctx.close()

        # ---------- kasus tepi: menjawab dari layar ringkasan ----------
        ctx = fresh_context(browser, mobile)
        page = ctx.new_page()
        attach_console(page, errors)
        open_quiz(page, args.port)
        page.locator('.step-dot[data-go="2"]').dispatch_event("click")
        page.wait_for_timeout(100)
        check(hook(page)["stepIndex"] == 2, "[ringkasan] layar ringkasan dibuka")
        run_attempt(page, answers, [i < need for i in range(total)], mobile, use_keys=False)
        h = hook(page)
        check(sorted(h["completedTasks"]) == ["lulus", "selesai"], f"[ringkasan] kedua tugas tercatat (dapat {h['completedTasks']})")
        check(h["stepIndex"] == 2, "[ringkasan] tetap di layar ringkasan")
        done_items = page.locator(".summary-tasks li.is-done").count()
        check(done_items == 2, "[ringkasan] daftar tugas ringkasan diperbarui")
        ctx.close()

        browser.close()

    check(not errors, f"tanpa pesan console ({len(errors)}): {errors[:5]}")
    print(json.dumps({"mobile": mobile, "failures": failures}, ensure_ascii=False))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
