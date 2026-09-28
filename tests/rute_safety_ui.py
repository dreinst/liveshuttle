"""Uji keras aturan keselamatan lewat antarmuka pelajaran Perencanaan Rute.

Mobil dijalankan di beberapa rute dengan percepatan 30 kali dan kecepatan shell 2x, sementara
penguji terus-menerus menutup jalan di depan mobil (termasuk sangat dekat), menandai dan menghapus
macet, membuka semua jalan, mengganti percepatan waktu, menjeda, mengganti kamera, menekan Ulangi,
dan berpindah langkah. Setiap sekitar 80 ms penguji juga memeriksa sendiri: bumper depan tidak
boleh pindah dari sebelum ke sesudah garis henti yang sedang merah, dan mobil yang menunggu harus
berada sebelum garis henti. Penghitung "Terobos lampu merah" harus tetap 0.

Pemakaian: python3 tests/serve.py 8245 (di latar), lalu python3 tests/rute_safety_ui.py [desktop|mobile|all]
"""
import random
import sys
import time

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session  # noqa: E402

FAIL = []
HALF = 2.25
ROUTES = [("machung", "stasiun"), ("veteran", "alun-merdeka"), ("soehat", "kayutangan"), ("ijen", "alun-bundar"), ("dieng", "stasiun")]


def expect(cond, msg):
    print(("OK   " if cond else "GAGAL") + " " + msg)
    if not cond:
        FAIL.append(msg)


WATCH_JS = """() => {
  window.__ruteWatchStop = false;
  window.__ruteWatch = { polls: 0, holds: 0, crossChecks: 0, violations: [], prev: null };
  const tick = () => {
    const W = window.__ruteWatch;
    const api = window.__rute;
    if (api) {
      const s = api.snapshot();
      W.polls++;
      const front = s.car.s + 2.25;
      if (s.car.hold && s.next) {
        W.holds++;
        if (s.next.dist < 0) W.violations.push(['menunggu melewati garis', s.next.dist]);
      }
      const P = W.prev;
      // merah di dua frame yang berjarak paling lama 1 detik simulasi berarti merah sepanjang selang itu
      // (hijau dan kuning bersama jauh lebih lama dari 1 detik), jadi melewati garis di selang itu = terobos
      if (P && P.n === s.lines.length && (s.car.state === 'driving' || s.car.state === 'blocked') && s.simT > P.simT && s.simT - P.simT <= 1.0) {
        W.crossChecks++;
        for (const ln of s.lines) {
          if (P.front < ln.s && ln.s <= front && ln.state === 'red' && P.states[ln.s.toFixed(2)] === 'red') W.violations.push(['lewat saat merah', ln.s, P.front, front, s.simT]);
        }
      }
      W.prev = { front, simT: s.simT, n: s.lines.length, states: Object.fromEntries(s.lines.map((l) => [l.s.toFixed(2), l.state])) };
    }
    if (!window.__ruteWatchStop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""


def chaos_drive(S, rng, tag, label, max_seconds=40, vary_speed=True):
    p = S.page
    p.evaluate("() => { window.__ruteWatchStop = true; }")
    p.wait_for_timeout(50)
    p.evaluate(WATCH_JS)
    S.click_button("Jalankan mobil")
    p.wait_for_timeout(300)
    actions = 0
    t_end = time.time() + max_seconds
    while time.time() < t_end:
        snap = S.snap()
        if snap["car"]["state"] == "arrived":
            break
        if snap["car"]["state"] == "blocked":
            S.click_button("Buka semua jalan", required=False)
        r = rng.random()
        if r < 0.30:
            S.scroll_stage()
            pt = p.evaluate(f"() => window.__rute.aheadPoint({rng.choice([4, 12, 25, 60, 120, 250, 400, 700])})")
            if pt:
                box = S.canvas_box()
                if 0 < pt["x"] < box["width"] - 60 and 60 < pt["y"] < box["height"] - 30:
                    S.tap_canvas(pt)
                    actions += 1
        elif r < 0.40:
            S.click_button("Tutup jalan di rute", required=False)
            actions += 1
        elif r < 0.48:
            S.seg("Macet")
            S.click_button("Macet di rute", required=False)
            S.seg("Tutup jalan")
            actions += 1
        elif r < 0.53:
            S.click_button("Buka semua jalan", required=False)
            actions += 1
        elif r < 0.62 and vary_speed:
            S.seg(rng.choice(["5 kali", "15 kali", "30 kali"]))
            actions += 1
        elif r < 0.68:
            p.locator('[data-act="pause"]').first.click()
            p.wait_for_timeout(rng.choice([50, 200, 400]))
            p.locator('[data-act="pause"]').first.click()
            actions += 1
        elif r < 0.74 and vary_speed:
            p.locator(".speed-wrap .seg-btn").nth(rng.choice([0, 2])).click()
            actions += 1
        elif r < 0.80:
            which = rng.choice(['Ikuti mobil', 'Tampilkan start dan tujuan', 'Perbesar peta', 'Perkecil peta'])
            b = p.locator(f'button[aria-label="{which}"]')
            if b.is_enabled():
                b.click()
            actions += 1
        p.wait_for_timeout(80)
    snap = S.snap()
    W = p.evaluate("() => window.__ruteWatch")
    s = snap["safety"]
    print(f"   {label}: keadaan {snap['car']['state']}, aksi {actions}, frame diperiksa {W['polls']} (cek lewat garis {W['crossChecks']}), frame menunggu lampu {W['holds']}, safety {s}")
    expect(s["redRuns"] == 0, f"{tag} {label}: pemantau 0 terobos lampu merah")
    expect(s["pedContacts"] == 0, f"{tag} {label}: 0 kontak pejalan kaki")
    expect(not W["violations"], f"{tag} {label}: pemeriksa penguji tidak menemukan pelanggaran {W['violations'][:3]}")
    return snap


def run(mobile):
    tag = "mobile" if mobile else "desktop"
    rng = random.Random(5 if mobile else 3)
    with Session(mobile=mobile) as S:
        p = S.page
        S.go()
        S.goto_step(4)
        S.seg("30 kali")
        p.locator(".speed-wrap .seg-btn").nth(2).click()  # 2x
        routes = ROUTES if not mobile else ROUTES[:3]
        # satu perjalanan pelan (5 kali, 1x) supaya pemeriksa penguji bisa mengecek setiap frame
        S.seg("5 kali")
        p.locator(".speed-wrap .seg-btn").nth(1).click()
        S.select("start", "veteran")
        S.select("goal", "alun-merdeka")
        chaos_drive(S, rng, tag, "pelan veteran ke alun-merdeka", max_seconds=35, vary_speed=False)
        S.seg("30 kali")
        p.locator(".speed-wrap .seg-btn").nth(2).click()
        for start, goal in routes:
            if S.snap()["car"]["state"] in ("driving", "blocked"):
                S.click_button("Batalkan perjalanan")
            S.click_button("Buka semua jalan", required=False) if S.snap()["stretches"] else None
            S.select("start", start)
            S.select("goal", goal)
            chaos_drive(S, rng, tag, f"{start} ke {goal}")
        S.shot(f"safety-{tag}-end", selector=".stage")

        # Ulangi dan pindah langkah saat melaju
        S.click_button("Batalkan perjalanan") if S.snap()["car"]["state"] in ("driving", "blocked") else None
        S.click_button("Jalankan mobil")
        p.wait_for_timeout(1500)
        p.locator('[data-act="reset"]').first.click()
        p.wait_for_timeout(300)
        expect(S.snap()["car"]["state"] == "idle", f"{tag}: Ulangi saat melaju mengembalikan mobil ke start")
        S.click_button("Jalankan mobil")
        p.wait_for_timeout(1200)
        S.goto_step(3)
        expect(S.snap()["car"]["state"] == "idle", f"{tag}: pindah langkah saat melaju menghentikan perjalanan")
        S.goto_step(4)
        snap = chaos_drive(S, rng, tag, "setelah Ulangi", max_seconds=30)
        expect(not S.errors, f"{tag}: tanpa galat konsol {S.errors[:5]}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("desktop", "all"):
        run(False)
    if which in ("mobile", "all"):
        run(True)
    print("GAGAL:", FAIL if FAIL else "tidak ada")
    sys.exit(1 if FAIL else 0)
