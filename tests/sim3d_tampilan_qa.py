"""QA tunggal tahap tampilan Shuttle 3D Ma Chung (port 8203, tests/sim3d_harness.html).

Pakai: python3 tests/serve.py 8203 &  lalu  python3 tests/sim3d_tampilan_qa.py [gpu|swift]
Memeriksa: 10 langkah Panduan lewat UI, alat Jelajah dan pintasan, kamera x cuaca (montase),
ponsel 390x844, ritme bingkai, mount/destroy berulang, frasa terlarang, dan tanda pisah.
"""
import glob
import os
import re
import sys
import time

os.environ.setdefault("SIM3D_BASE", "http://127.0.0.1:8203")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sim3d_shuttle_common import dbg, launch, new_page, open_harness, snap, sync_playwright  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots", "tampilan")
os.makedirs(SHOTS, exist_ok=True)
MODE = sys.argv[1] if len(sys.argv) > 1 else "gpu"
RESULTS = []


def check(name, ok, info=""):
    RESULTS.append((name, bool(ok), info))
    print(("OK   " if ok else "GAGAL"), name, info, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def done(page):
    return snap(page)["guide"]["done"]


def wait_for(page, fn, timeout, poll=0.4):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(poll)
    return None


def btn(page, text, scope=".s3d"):
    page.locator(f"{scope} button:visible", has_text=text).first.click()


def on_canvas(page, sc):
    return page.evaluate(f"(() => {{ const e = document.elementFromPoint({sc['x']}, {sc['y']}); return !!e && e.classList.contains('s3d-canvas'); }})()")


def montage(files, out, cols=4, w=480):
    ims = [Image.open(f) for f in files]
    h = int(ims[0].height * w / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    m = Image.new("RGB", (cols * w, rows * h), "white")
    for i, im in enumerate(ims):
        m.paste(im.convert("RGB").resize((w, h)), ((i % cols) * w, (i // cols) * h))
    m.save(out)


def guide_flow(page):
    """Sepuluh langkah Panduan lewat tombol dan tombol papan ketik."""
    # 1 kamera Kabin lalu Peta
    btn(page, "Kabin", ".s3d-cams")
    time.sleep(1.2)
    shot(page, "kam_kabin_awal")
    btn(page, "Peta", ".s3d-cams")
    time.sleep(1.0)
    check("langkah 1 selesai (Kabin lalu Peta)", "kenalan" in done(page))
    btn(page, "Drone", ".s3d-cams")
    btn(page, "Lanjut")
    # 2 sinar LiDAR (tombol L) dan tampilan Detail
    page.keyboard.press("l")
    btn(page, "Detail")
    time.sleep(2.5)
    shot(page, "sensor_detail_sinar")
    check("langkah 2 selesai (tombol L)", wait_for(page, lambda: "indra" in done(page), 5))
    btn(page, "Tenang")
    page.keyboard.press("l")
    btn(page, "Lanjut")
    # 3 deteksi pejalan kaki (bantu dengan tombol Y)
    page.keyboard.press("y")
    check("langkah 3 selesai (deteksi pejalan kaki)", wait_for(page, lambda: "pahami" in done(page), 40))
    btn(page, "Lanjut")
    # 4 tutup jalan di rute lewat klik di peta rute
    btn(page, "⤢", ".s3d-map")
    btn(page, "Tutup jalan")
    time.sleep(0.6)
    ok = False
    rc = page.locator(".s3d-map-canvas").bounding_box()
    why = []
    for _ in range(8):  # jalan yang punya halte tidak bisa ditutup: tunggu shuttle keluar dari ruas halte
        for d in range(40, 420, 20):
            pt = dbg(page, f"d.routeAhead({d})")
            if not pt:
                continue
            sc = dbg(page, f"d.mapScreenOf({pt['x']}, {pt['z']})")
            if not (rc["x"] + 50 < sc["x"] < rc["x"] + rc["width"] - 50 and rc["y"] + 10 < sc["y"] < rc["y"] + rc["height"] - 10):
                continue
            page.mouse.click(sc["x"], sc["y"])
            if wait_for(page, lambda: "rencana" in done(page), 1.5):
                ok = True
                time.sleep(0.5)
                shot(page, "rute_diperbarui")
                break
            why.append(page.locator(".s3d-toasts").inner_text()[-60:])
        if ok:
            break
        time.sleep(4)
    check("langkah 4 selesai (tutup jalan di peta, rute diperbarui)", ok, "" if ok else str(why[-3:]))
    # buka lagi semua jalan yang ditutup dengan klik kedua di ruas yang sama (di tampilan 3D)
    btn(page, "⤢", ".s3d-map")
    btn(page, "Peta", ".s3d-cams")
    for i in [i for i in snap(page)["nav"]["incidents"] if i["kind"] == "tutup"]:
        dbg(page, f"d.lookAt({i['x']}, {i['z']}, 160)")
        time.sleep(0.3)
        sc = dbg(page, f"d.screenOf({i['x']}, {i['z']})")
        if on_canvas(page, sc):
            page.mouse.click(sc["x"], sc["y"])
    dbg(page, "d.clearView()")
    btn(page, "Drone", ".s3d-cams")
    time.sleep(0.5)
    inc = [i["kind"] for i in snap(page)["nav"]["incidents"]]
    check("klik kedua membuka jalan lagi", "tutup" not in inc, str(inc))
    page.keyboard.press("Escape")
    btn(page, "Lanjut")
    # 5 ambil kemudi (M) dan jalan sedikit
    page.keyboard.press("m")
    time.sleep(0.3)
    page.keyboard.down("ArrowUp")
    ok5 = wait_for(page, lambda: "gerak" in done(page), 12)
    page.keyboard.up("ArrowUp")
    check("langkah 5 selesai (kemudi manual)", ok5)
    btn(page, "Lanjut")
    # 6 perisai saat manual: pejalan kaki uji di depan lalu gas penuh
    ok6 = False
    poses = sorted([q for q in dbg(page, "d.lanePoses()") if q["routable"]], key=lambda p: abs(p["x"] - 60) + abs(p["z"] + 120))
    for p in poses[:6]:
        if not dbg(page, f"d.placeShuttle({p['x']}, {p['z']}, {p['h']})"):
            continue
        page.keyboard.down("ArrowUp")
        time.sleep(1.5)
        page.keyboard.press("y")
        ok6 = wait_for(page, lambda: "perisai" in done(page), 10)
        page.keyboard.up("ArrowUp")
        if ok6:
            break
    check("langkah 6 selesai (perisai mengerem saat manual)", ok6)
    s = snap(page)
    check("log perisai berbahasa Indonesia", any(("pejalan" in t or "lampu" in t or "zebra" in t) for t in s["shield"]["log"]), str(s["shield"]["log"][-2:]))
    shot(page, "perisai_manual")
    wait_for(page, lambda: abs(snap(page)["shuttle"]["speedSigned"]) < 0.5, 15)
    page.keyboard.press("m")
    time.sleep(0.5)
    check("kemudi kembali ke autopilot", snap(page)["shuttle"]["mode"] == "otomatis", page.locator(".s3d-toasts").inner_text())
    btn(page, "Lanjut")
    # 7 pejalan kaki menyeberang, shuttle berhenti (2x)
    btn(page, "2x", ".s3d-corner")
    ok7 = None
    for _ in range(6):
        btn(page, "Pejalan kaki menyeberang")
        ok7 = wait_for(page, lambda: "menyeberang" in done(page), 20)
        if ok7:
            break
    check("langkah 7 selesai (shuttle berhenti untuk penyeberang)", ok7)
    live = page.locator(".s3d-live").inner_text()
    check("langkah 7 menampilkan hitungan jarak henti", "jarak henti" in live, live)
    shot(page, "penyeberang")
    btn(page, "Lanjut")
    # 8 cuaca (tanpa tugas)
    check("langkah 8 menjelaskan cuaca", wait_for(page, lambda: "berganti dalam" in page.locator(".s3d-live").inner_text(), 3))
    btn(page, "Lanjut")
    # 9 penumpang naik (panggil penumpang di halte tujuan, 4x)
    nxt = [i for i, st in enumerate(snap(page)["nav"]["stops"]) if st["next"]][0]
    page.select_option("#s3d-halte", str(nxt))
    btn(page, "Panggil penumpang")
    btn(page, "4x", ".s3d-corner")
    check("langkah 9 selesai (penumpang naik)", wait_for(page, lambda: "halte" in done(page), 150, 1.0))
    shot(page, "halte_penumpang")
    btn(page, "1x", ".s3d-corner")
    btn(page, "Lanjut")
    # 10 ke Jelajah
    btn(page, "Ke Jelajah")
    time.sleep(0.5)
    s = snap(page)
    check("langkah 10 membuka Jelajah", s["mode"] == "jelajah" and page.evaluate("location.hash") == "#/shuttle-3d/jelajah", page.evaluate("location.hash"))
    check("semua 8 tugas Panduan selesai", len(s["guide"]["done"]) == 8, str(s["guide"]["done"]))


def jelajah_flow(page):
    cams = []
    for k, cam in (("1", "kabin"), ("2", "drone"), ("3", "sinematik"), ("4", "peta")):
        page.keyboard.press(k)
        time.sleep(0.2)
        cams.append(snap(page)["camera"] == cam)
    check("tombol 1 sampai 4 mengganti kamera", all(cams))
    page.keyboard.press("2")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press(" ")
    time.sleep(0.3)
    t0 = snap(page)["simTime"]
    time.sleep(0.6)
    check("Spasi menjeda (waktu berhenti)", snap(page)["paused"] and snap(page)["simTime"] == t0)
    page.keyboard.press(" ")
    check("Spasi melanjutkan", not snap(page)["paused"])
    page.keyboard.press("?")
    check("? membuka bantuan", page.locator(".s3d-help").is_visible())
    shot(page, "bantuan")
    page.keyboard.press("Escape")
    check("Esc menutup bantuan", not page.locator(".s3d-help").is_visible())
    page.locator("#s3d-halte").focus()
    page.keyboard.press("4")
    check("pintasan diam saat fokus di kolom isian", snap(page)["camera"] == "drone")
    page.locator(".s3d-cams button", has_text="Drone").focus()
    # alat: kendaraan parkir di depan shuttle
    btn(page, "Kendaraan parkir di lajur")
    ok = False
    btn(page, "4x", ".s3d-corner")
    for _ in range(40):
        btn(page, "Taruh di depan shuttle")
        time.sleep(0.4)
        if any(i["kind"] == "parkir" for i in snap(page)["nav"]["incidents"]):
            ok = True
            break
        time.sleep(1)
    btn(page, "1x", ".s3d-corner")
    check("Kendaraan parkir di depan shuttle", ok, "" if ok else page.locator(".s3d-toasts").inner_text())
    # galian dengan klik jalan di tampilan 3D
    btn(page, "Galian jalan")
    ok = False
    for q in [q for q in dbg(page, "d.lanePoses()") if q["len"] > 90][:12]:
        import math
        x, z = q["x"] + math.cos(q["h"]) * q["len"] / 2, q["z"] + math.sin(q["h"]) * q["len"] / 2
        dbg(page, f"d.lookAt({x}, {z}, 120)")
        time.sleep(0.3)
        sc = dbg(page, f"d.screenOf({x}, {z})")
        if not on_canvas(page, sc):
            continue
        page.mouse.click(sc["x"], sc["y"])
        time.sleep(0.3)
        if any(i["kind"] == "galian" for i in snap(page)["nav"]["incidents"]):
            ok = True
            time.sleep(0.8)
            shot(page, "galian_klik")
            break
    dbg(page, "d.clearView()")
    btn(page, "Drone", ".s3d-cams")
    check("Galian jalan dengan klik di 3D", ok, "" if ok else page.locator(".s3d-toasts").inner_text())
    time.sleep(1.5)
    shot(page, "alat_penghalang")
    page.keyboard.press("Escape")
    btn(page, "Angkat semua penghalang")
    time.sleep(0.3)
    check("Angkat semua penghalang", not any(i["kind"] in ("parkir", "galian") for i in snap(page)["nav"]["incidents"]))
    # kepadatan, batas kecepatan, panggil penumpang, kompas
    btn(page, "Ramai")
    v0 = snap(page)["traffic"]["vehicles"]
    time.sleep(6)
    v1 = snap(page)["traffic"]["vehicles"]
    check("Kepadatan Ramai menambah kendaraan", v1 > v0, f"{v0} -> {v1}")
    btn(page, "Sedang")
    page.locator("#s3d-limit").focus()
    page.keyboard.press("ArrowLeft")
    check("Batas kecepatan lewat slider", snap(page)["shuttle"]["speedLimit"] == 25)
    stops = snap(page)["nav"]["stops"]
    i = min(range(len(stops)), key=lambda k: stops[k]["waiting"])
    page.select_option("#s3d-halte", str(i))
    btn(page, "Panggil penumpang")
    full = stops[i]["waiting"] >= 6 and "sudah penuh" in page.locator(".s3d-toasts").inner_text()
    check("Panggil penumpang di halte pilihan", full or snap(page)["nav"]["stops"][i]["waiting"] > stops[i]["waiting"], page.locator(".s3d-toasts").inner_text())
    page.locator(".s3d-map .s3d-map-btn").first.click()
    check("Kompas beralih ke utara di atas", page.locator(".s3d-map .s3d-map-btn").first.get_attribute("aria-pressed") == "false")
    page.locator(".s3d-map .s3d-map-btn").first.click()
    page.keyboard.press("m")
    time.sleep(0.3)
    check("M mengambil kemudi dan tombol kemudi tampil", snap(page)["shuttle"]["mode"] == "manual" and page.locator(".s3d-pad").is_visible())
    page.keyboard.press("m")
    btn(page, "Tentang peta")
    txt = page.locator(".s3d-about").inner_text()
    check("Tentang peta menyebut lampu simulasi dan perkiraan", "lampu simulasi" in txt and "perkirakan" in txt)
    page.keyboard.press("Escape")


def cameras_weather(page):
    files = []
    for w in ("cerah", "hujan", "kabut", "malam"):
        dbg(page, f"d.setWeather('{w}')")
        time.sleep(0.4)
        for cam in ("Kabin", "Drone", "Sinematik", "Peta"):
            btn(page, cam, ".s3d-cams")
            time.sleep(1.6)
            f = os.path.join(SHOTS, f"cam_{w}_{cam.lower()}.png")
            page.screenshot(path=f)
            files.append(f)
        if w == "hujan":  # payung pejalan kaki terbuka saat hujan
            ped = [q for q in dbg(page, "d.pedList()") if q["state"] == "walk"][0]
            dbg(page, f"d.lookAt({ped['x']}, {ped['z']}, 18)")
            time.sleep(0.6)
            shot(page, "hujan_payung")
            dbg(page, "d.clearView()")
    montage(files, os.path.join(SHOTS, "montase_kamera_cuaca.png"))
    dbg(page, "d.setWeather('cerah')")
    btn(page, "Drone", ".s3d-cams")


def frame_pacing(page, secs=6):
    r = page.evaluate(
        """(secs) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last;
        function f(now) { d.push(now - last); last = now; if (now - t0 < secs * 1000) requestAnimationFrame(f); else res(d); }
        requestAnimationFrame(f); })""",
        secs,
    )
    r = sorted(r[1:])
    mean = sum(r) / len(r)
    p95 = r[int(len(r) * 0.95)]
    slow = sum(1 for x in r if x > 25) / len(r)
    return mean, p95, r[-1], slow


def mobile(p, b):
    ctx, page, log = new_page(b, mobile=True)
    open_harness(page, "panduan")
    time.sleep(2)
    files = []
    for tab in ("Panduan", "Peta", "Otonomi", "Perisai", "Kendali"):
        page.locator(".s3d-sheet-tab", has_text=tab).tap()
        time.sleep(0.6)
        f = os.path.join(SHOTS, f"m_{tab.lower()}.png")
        page.screenshot(path=f)
        files.append(f)
    small = []
    for loc in page.locator(".s3d button:visible, .s3d select:visible").all():
        bb = loc.bounding_box()
        if bb and (bb["height"] < 39.5 or bb["width"] < 39.5):
            small.append((loc.inner_text()[:20], round(bb["width"]), round(bb["height"])))
    check("ponsel: semua tombol yang tampil minimal 40 px", not small, str(small[:6]))
    top = page.locator(".s3d-top").bounding_box()
    check("ponsel: bar atas satu baris (tinggi di bawah 60 px)", top["height"] < 60, str(round(top["height"])))
    page.locator(".s3d-sheet-tab", has_text="Kendali").tap()
    time.sleep(0.5)
    sheet = page.locator(".s3d-sheet").bounding_box()
    check("ponsel: ketuk tab aktif mengecilkan lembar", sheet["height"] < 70, str(round(sheet["height"])))
    page.locator(".s3d-cams button", has_text="Kabin").tap()
    time.sleep(1.2)
    f = os.path.join(SHOTS, "m_kabin_kecil.png")
    page.screenshot(path=f)
    files.append(f)
    page.locator(".s3d-sheet-tab", has_text="Peta").tap()
    page.locator(".s3d-map .s3d-map-btn").nth(1).tap()
    time.sleep(0.8)
    f = os.path.join(SHOTS, "m_peta_besar.png")
    page.screenshot(path=f)
    files.append(f)
    montage(files, os.path.join(SHOTS, "montase_ponsel.png"), cols=4, w=300)
    mean, p95, mx, slow = frame_pacing(page, 4)
    check("ponsel: bingkai lancar", mean < 20, f"rata {mean:.1f} ms, p95 {p95:.1f} ms")
    check("ponsel: tanpa error konsol", not log, str(log[:4]))
    ctx.close()


def leak(b):
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    counts = []
    for i in range(5):
        page.evaluate("window.__harness.destroy()")
        counts.append(page.evaluate("document.querySelectorAll('*').length"))
        left = page.evaluate("[!!document.querySelector('.s3d'), !!document.querySelector('link[data-sim3d]'), 'undefined' !== typeof window.__sim3d]")
        page.evaluate("window.__harness.mount('panduan' )")
        wait_for(page, lambda: (snap(page) or {}).get("ready"), 60)
    check("mount/destroy 5 kali: DOM kembali ke ukuran awal", len(set(counts)) == 1, str(counts))
    check("destroy membersihkan .s3d, css, dan window.__sim3d", left == [False, False, False], str(left))
    check("mount/destroy tanpa error konsol", not log, str(log[:4]))
    ctx.close()


def static_checks():
    files = glob.glob(os.path.join(ROOT, "js/sim3d/**/*.js"), recursive=True) + [os.path.join(ROOT, "css/sim3d.css"), os.path.abspath(__file__)]
    banned = ["Simulator Kendaraan Otonom", "Belajar cara mobil tanpa pengemudi", "Mode Tutorial", "Mode Bebas", "Apa yang dilihat mobil", "Objek pembatas", "Uji skenario", "Kota pintar", "lampu adaptif", "Kokpit", "Kejar", "kerucut", "kardus", "mobil mogok", "simpangan lajur", "rem darurat", "jangkauan deteksi 60", "50 km/jam", "TTC"]
    hits = []
    dash = []
    for f in files:
        s = open(f, encoding="utf-8").read()
        for w in banned if not f.endswith(".py") else []:
            if w.lower() in s.lower():
                hits.append((os.path.relpath(f, ROOT), w))
        if "\u2014" in s or "\u2013" in s or re.search(r"[A-Za-z] -- [A-Za-z]", s):
            dash.append(os.path.relpath(f, ROOT))
    check("tidak ada frasa dari situs rujukan", not hits, str(hits))
    check("tidak ada em dash, en dash, atau ' -- '", not dash, str(dash))
    labels = open(os.path.join(ROOT, "js/sim3d/cameras.js"), encoding="utf-8").read()
    check("kamera Kabin, Drone, Sinematik, Peta (tanpa Orbit/Atas)", "'Orbit'" not in labels and "'Atas'" not in labels)
    keys = open(os.path.join(ROOT, "js/sim3d/input.js"), encoding="utf-8").read()
    check("tidak ada tombol J", "'j'" not in keys and "'J'" not in keys)


def main():
    static_checks()
    t0 = time.time()
    with sync_playwright() as p:
        b = launch(p, MODE)
        ctx, page, log = new_page(b)
        open_harness(page, "panduan")
        time.sleep(1.5)
        shot(page, "d_panduan")
        guide_flow(page)
        jelajah_flow(page)
        cameras_weather(page)
        mean, p95, mx, slow = frame_pacing(page)
        s = snap(page)
        check(f"ritme bingkai desktop ({MODE})", mean < 18.5 and slow < 0.03, f"rata {mean:.1f} ms, p95 {p95:.1f} ms, maks {mx:.1f} ms, >25 ms {slow * 100:.1f}%, rasio piksel {s['render']['pixelRatio']}, draw call {s['render']['calls']}")
        check("invarian tetap 0", s["invariants"]["redLight"] == 0 and s["invariants"]["pedContact"] == 0, str(s["invariants"]))
        check("desktop: tanpa error konsol", not log, str(log[:4]))
        ctx.close()
        mobile(p, b)
        leak(b)
        b.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)} dari {len(RESULTS)} lolos, {time.time() - t0:.0f} detik")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
