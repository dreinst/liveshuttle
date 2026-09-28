"""Skenario tambahan pelajaran Level Otomasi lewat UI (penguji independen), dengan tangkapan layar.

Pemakaian: python3 tests/level-otomasi_indep_extra.py [--mobile] [--port 8131]
Memakai kelas S dari tests/level-otomasi_indep_qa.py.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "level-otomasi_indep_qa.py"), encoding="utf-8").read().split("R = {}")[0]
exec(_src)

X = {}
with S() as s:
    s.fresh()

    # L0: gas terus sampai peringatan tabrakan depan dan rem darurat
    s.go_step(1)
    if MOBILE:
        s.press_hold("Gas")
    else:
        s.page.keyboard.down("ArrowUp")
    X["fcw_after"] = s.wait_alert("Awas tabrakan depan", 15)
    s.stage_shot("30-fcw")
    X["aeb_after"] = s.wait_alert("Rem darurat otomatis", 8)
    s.stage_shot("31-aeb")
    if MOBILE:
        s.release_hold()
    else:
        s.page.keyboard.up("ArrowUp")
    X["fcw_aeb_status"] = s.status()

    # L0: keluar lajur (setir kanan sebentar di atas 30 km/jam)
    s.go_step(0)
    if MOBILE:
        s.press_hold("Gas")
    else:
        s.page.keyboard.down("ArrowUp")
    s.page.wait_for_timeout(4500)
    if MOBILE:
        s.release_hold()
        s.press_hold("Kanan")
    else:
        s.page.keyboard.up("ArrowUp")
        s.page.keyboard.down("ArrowRight")
    s.page.wait_for_timeout(1100)
    if MOBILE:
        s.release_hold()
    else:
        s.page.keyboard.up("ArrowRight")
    X["ldw"] = s.wait_alert("Keluar lajur", 4)
    s.stage_shot("32-ldw")

    # L1: rem mematikan ACC, lalu aktifkan lagi
    s.go_step(1)
    s.level(1)
    s.page.wait_for_timeout(2500)
    s.press_hold("Rem")
    s.page.wait_for_timeout(300)
    s.release_hold()
    X["l1_brake"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text(), "btn": s.page.locator(".lv-sys .btn").inner_text()}
    s.stage_shot("33-l1-brake-cancel")
    s.click(".lv-sys .btn")
    X["l1_reengage"] = s.page.locator(".lv-sys-text").inner_text()

    # L2: pesan diabaikan, peringatan keras, lalu kemudi diserahkan
    s.go_step(2)
    s.wait_alert("Pegang kemudi sekarang", 14)
    s.page.wait_for_timeout(600)
    X["l2_warn"] = {"alert": s.alert(), "count": s.page.locator(".lvl-alert-count").inner_text(), "status": s.status(), "chips": s.chips()}
    s.stage_shot("34-l2-warn")
    X["l2_handback"] = s.wait_alert("Sistem level 2 mati", 8)
    X["l2_handback_state"] = {"status": s.status(), "btn": s.page.locator('[data-act="alert-action"]').inner_text(), "task": "l2-attention" in s.done()}
    s.stage_shot("35-l2-handback")
    s.click('[data-act="alert-action"]')
    X["l2_reengaged"] = s.page.locator(".lv-sys-text").inner_text()

    # L3: diam saja sampai berhenti di lajur
    s.go_step(3)
    s.speed("2x")
    s.wait_alert("Ambil alih kemudi", 15)
    if not MOBILE:
        s.page.keyboard.press("3")  # level yang sama: tidak boleh mengubah apa pun
        s.page.wait_for_timeout(300)
        X["same_key_during_tor"] = s.alert()
    X["l3_mrm"] = s.wait_alert("Tidak ada respons", 15)
    s.page.wait_for_timeout(800)
    s.stage_shot("36-l3-mrm")
    X["l3_mrc"] = s.wait_alert("Mobil berhenti di lajur", 20)
    s.speed("1x")
    s.page.wait_for_timeout(700)
    X["l3_mrc_state"] = {"status": s.status(), "chips": s.chips(), "task": "l3-takeover" in s.done()}
    s.stage_shot("37-l3-mrc")
    s.shot("38-l3-mrc-page")
    # Ambil alih setelah berhenti: tugas tidak boleh selesai
    s.click('[data-act="ambil-alih"]')
    s.page.wait_for_timeout(400)
    X["l3_late_takeover_task"] = "l3-takeover" in s.done()
    # aktifkan lagi saat zona terlalu dekat: ditolak
    s.click(".lv-sys .btn")
    s.page.wait_for_timeout(300)
    X["l3_refuse"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}
    s.stage_shot("39-l3-refuse")

    # L3: ambil alih saat diminta, lalu lewati zona di lajur kanan sendiri
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(300)
    s.wait_alert("Ambil alih kemudi", 15)
    s.click('[data-act="ambil-alih"]')
    X["l3_task"] = s.wait_task("l3-takeover", 4)
    if MOBILE:
        s.press_hold("Kanan")
    else:
        s.page.keyboard.down("ArrowRight")
    s.page.wait_for_timeout(1300)
    if MOBILE:
        s.release_hold()
        s.press_hold("Kiri")
    else:
        s.page.keyboard.up("ArrowRight")
        s.page.keyboard.down("ArrowLeft")
    s.page.wait_for_timeout(1250)
    if MOBILE:
        s.release_hold()
    else:
        s.page.keyboard.up("ArrowLeft")
    s.page.wait_for_timeout(300)
    X["l3_lane"] = s.readouts()[3]
    # tunggu sampai zona terlihat
    s.wait(lambda: any(c.startswith("Zona konstruksi") and int("".join(ch for ch in c if ch.isdigit()) or 999) < 60 for c in s.chips()), 25)
    s.stage_shot("40-l3-manual-zone")
    s.page.wait_for_timeout(5000)
    X["l3_manual_after_zone"] = {"alert": s.alert(), "status": s.status(), "readouts": s.readouts()}

    # L4 dan L5 melewati zona konstruksi sendiri
    s.go_step(3)
    s.level(4)
    s.speed("2x")
    s.wait_alert("Sistem melewati zona konstruksi", 20)
    s.speed("1x")
    s.wait(lambda: any(c.startswith("Zona konstruksi") and int("".join(ch for ch in c if ch.isdigit()) or 999) < 40 for c in s.chips()), 20)
    s.stage_shot("41-l4-zone")
    X["l4_zone"] = {"alert": s.alert(), "readouts": s.readouts()}

    # L4: lampu hazard setelah berhenti (cek ukuran lampu)
    s.go_step(4)
    s.speed("2x")
    s.wait_task("l4-mrm", 30)
    s.speed("1x")
    s.page.wait_for_timeout(500)
    for k in range(6):
        s.stage_shot(f"42-l4-hazard-{k}")
        s.page.wait_for_timeout(190)
    # L5 setelah berhenti: melanjutkan perjalanan
    s.level(5)
    s.page.wait_for_timeout(4000)
    X["l5_from_shoulder"] = {"readouts": s.readouts(), "status": s.status()}
    s.stage_shot("43-l5-from-shoulder")
    X["errors"] = s.errors

print(json.dumps(X, indent=1, ensure_ascii=False))
