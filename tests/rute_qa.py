"""QA pelajaran Perencanaan Rute lewat UI, seperti pelajar sungguhan.

Isi uji:
  1. Kebenaran algoritma (dijalankan di peramban dengan modul pelajaran): A* dan Dijkstra
     selalu sama biayanya, A* dengan h = 0 sama persis dengan Dijkstra, heuristik tidak pernah
     melebihi biaya sebenarnya, rute sah, dan waktu rute sama dengan biaya / kecepatan.
  2. Kelima tugas diselesaikan lewat tombol dan klik/ketuk di kanvas.
  3. Tombol Jeda, kecepatan, dan Ulangi dari shell.
  4. Ringkasan, progres tersimpan, dan uji kebocoran saat berpindah halaman berulang kali.

Pemakaian: python3 tests/rute_qa.py [--mobile]   (server di port 8115)
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session, SHOTS  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"

ALGO_CHECK = """
async () => {
  const { createCity, FREE_SPEED } = await import('/js/lessons/rute/city.js');
  const { findPath } = await import('/js/engine/planning.js');
  const city = createCity();
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const TIE = 1e-4;
  const r = { trials: 0, foundMismatch: 0, costMismatch: 0, unreachable: 0, aFewer: 0, aEqual: 0, aMore: 0,
              h0SameAsDijkstra: 0, invalidPath: 0, timeMismatch: 0, admissibleChecks: 0, admissibleViolations: 0,
              sumA: 0, sumD: 0 };
  const roads = city.roadCells;
  const validPath = (p, s, g) => {
    if (p[0] !== s || p[p.length - 1] !== g) return false;
    for (let k = 1; k < p.length; k++) {
      if (city.closed[p[k]] || !city.isRoad(p[k])) return false;
      if (!city.roadNeighbors(p[k - 1]).includes(p[k])) return false;
    }
    return true;
  };
  for (let t = 0; t < 300; t++) {
    city.clear();
    const nClose = Math.floor(rnd() * 14);
    const nJam = Math.floor(rnd() * 40);
    for (let k = 0; k < nClose; k++) city.setClosed(roads[Math.floor(rnd() * roads.length)], true);
    for (let k = 0; k < nJam; k++) {
      const c = roads[Math.floor(rnd() * roads.length)];
      if (!city.closed[c]) city.setJam(c, true);
    }
    const open = roads.filter((i) => !city.closed[i]);
    const s = open[Math.floor(rnd() * open.length)];
    const g = open[Math.floor(rnd() * open.length)];
    if (s === g) continue;
    const m = city.minCost();
    const A = findPath(city.grid, s, g, { algorithm: 'astar', heuristic: (a, b) => city.grid.heuristic(a, b) * m * (1 + TIE) });
    const D = findPath(city.grid, s, g, { algorithm: 'dijkstra' });
    const Z = findPath(city.grid, s, g, { algorithm: 'astar', heuristic: () => 0 });
    r.trials++;
    if (A.found !== D.found) { r.foundMismatch++; continue; }
    if (Z.expanded === D.expanded) r.h0SameAsDijkstra++;
    if (!D.found) { r.unreachable++; continue; }
    if (Math.abs(A.cost - D.cost) > 1e-6) r.costMismatch++;
    if (!validPath(A.path, s, g) || !validPath(D.path, s, g)) r.invalidPath++;
    if (Math.abs(city.measure(A.path).time - A.cost / FREE_SPEED) > 1e-6) r.timeMismatch++;
    if (A.expanded < D.expanded) r.aFewer++; else if (A.expanded === D.expanded) r.aEqual++; else r.aMore++;
    r.sumA += A.expanded; r.sumD += D.expanded;
    // heuristik (tanpa pemecah seri) tidak boleh melebihi biaya sebenarnya dari node mana pun
    if (t % 25 === 0) {
      for (const n of open) {
        const truth = findPath(city.grid, n, g, { algorithm: 'dijkstra' });
        if (!truth.found) continue;
        r.admissibleChecks++;
        if (city.grid.heuristic(n, g) * m > truth.cost + 1e-9) r.admissibleViolations++;
      }
    }
  }
  r.roadCells = roads.length;
  return r;
}
"""


def order_route(cells, first_hint):
    """Urutkan sel rute (dari piksel) menjadi rantai, mulai dari sel yang bersebelahan dengan start."""
    cells = set(cells)
    sc, sr = first_hint
    cur = None
    for c, r in cells:
        if abs(c - sc) + abs(r - sr) == 1:
            cur = (c, r)
            break
    if cur is None:
        return []
    chain = [cur]
    seen = {cur}
    while True:
        c, r = chain[-1]
        nxt = [p for p in [(c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)] if p in cells and p not in seen]
        if not nxt:
            break
        chain.append(nxt[0])
        seen.add(nxt[0])
    return chain


def wait_status(s, text, timeout=15000):
    t = 0
    while t < timeout:
        if text in s.status():
            return True
        s.page.wait_for_timeout(200)
        t += 200
    return False


def show_stage(s):
    s.page.evaluate("() => document.querySelector('.stage').scrollIntoView({ block: 'center', behavior: 'instant' })")
    s.page.wait_for_timeout(120)


def seg(s, text):
    s.page.locator(".controls .seg-btn", has_text=text).first.click()
    s.page.wait_for_timeout(120)


res = {"mobile": MOBILE}
with Session(mobile=MOBILE) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/rute", 1500)
    res["algo"] = s.page.evaluate(ALGO_CHECK)
    h = s.hook()
    res["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}

    # ---------- langkah 1: A* ----------
    s.click_text(".btn", "Cari rute")
    res["first-route"] = s.wait_task("first-route", 15)
    res["status1"] = s.status()
    show_stage(s)
    s.shot(f"qa-{TAG}-1-astar")
    s.next_step()

    # ---------- langkah 2: Dijkstra lalu A* ----------
    res["step2_algo_preset"] = s.page.locator(".controls .ctl-group").nth(0).locator(".seg-btn.is-active").inner_text()
    s.click_text(".btn", "Cari rute")
    res["dijkstra_done"] = wait_status(s, "Dijkstra menemukan rute", 20000)
    seg(s, "A*")
    s.click_text(".btn", "Cari rute")
    res["compare"] = s.wait_task("compare", 15)
    res["compare_note"] = s.page.locator(".compare-note").inner_text()
    res["compare_rows"] = s.page.locator(".grp-compare tbody").inner_text()
    show_stage(s)
    s.shot(f"qa-{TAG}-2-compare", full=True)
    s.next_step()

    # ---------- langkah 3: tutup jalan di rute ----------
    show_stage(s)
    s.page.wait_for_timeout(300)
    chain = order_route(s.route_cells(), (1, 14))
    res["route3_len"] = len(chain)
    target = chain[len(chain) // 2]
    res["closure_cell"] = target
    s.tap_cell(*target)
    res["status3_after_close"] = s.status()
    s.click_text(".btn", "Cari rute")
    res["closure"] = s.wait_task("closure", 15)
    show_stage(s)
    after = order_route(s.route_cells(), (1, 14))
    res["closure_avoided"] = tuple(target) not in set(after) and len(after) > 0
    s.shot(f"qa-{TAG}-3-closure")
    s.next_step()

    # ---------- langkah 4: macet di rute ----------
    res["step4_tool_preset"] = s.page.locator(".controls .ctl-group").nth(1).locator(".seg-btn.is-active").first.inner_text()
    show_stage(s)
    s.page.wait_for_timeout(300)
    chain = order_route(s.route_cells(), (1, 14))
    # tiga sel berurutan di tengah rute
    mid = len(chain) // 2 - 1
    jam_cells = chain[mid:mid + 3]
    res["jam_cells"] = jam_cells
    if MOBILE:
        for c in jam_cells:
            s.tap_cell(*c)
    else:
        s.drag_cells(jam_cells)
    res["status4_after_jam"] = s.status()
    s.click_text(".btn", "Cari rute")
    res["traffic"] = s.wait_task("traffic", 15)
    show_stage(s)
    after = order_route(s.route_cells(), (1, 14))
    res["jam_avoided"] = not any(tuple(c) in set(after) for c in jam_cells) and len(after) > 0
    res["status4"] = s.status()
    s.shot(f"qa-{TAG}-4-traffic")
    s.next_step()

    # ---------- langkah 5: tutup jalan saat mobil melaju ----------
    show_stage(s)
    s.page.wait_for_timeout(300)
    chain5 = order_route(s.route_cells(), (1, 14))
    res["route5_len"] = len(chain5)
    s.click_text(".btn", "Jalankan mobil")
    s.page.wait_for_timeout(900)
    show_stage(s)
    ahead = chain5[int(len(chain5) * 0.6)]
    res["live_cell"] = ahead
    s.tap_cell(*ahead)
    s.page.wait_for_timeout(150)
    res["status5_replan"] = s.status()
    s.shot(f"qa-{TAG}-5-replan")
    res["replan-live"] = s.wait_task("replan-live", 15)
    res["arrived"] = wait_status(s, "sampai di tujuan", 40000)
    res["status5_end"] = s.status()
    show_stage(s)
    s.shot(f"qa-{TAG}-5-arrived")

    # ---------- alat Pindah dengan ketukan ----------
    seg(s, "Pindah")
    seg(s, "Tujuan")
    show_stage(s)
    s.tap_cell(9, 5)
    res["move_goal"] = s.status()
    s.click_text(".btn", "Cari rute")
    res["after_move_found"] = wait_status(s, "menemukan rute", 15000)

    # ---------- tombol shell ----------
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    res["paused"] = s.hook()["paused"]
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    res["resumed"] = not s.hook()["paused"]
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    res["speed2"] = s.hook()["speed"]
    s.page.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    res["speed05"] = s.hook()["speed"]
    s.page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(400)
    res["after_reset"] = {k: s.hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}
    res["status_after_reset"] = s.status()

    # ---------- ringkasan ----------
    s.next_step()
    res["summary_step"] = s.hook()["stepIndex"]
    res["completed"] = s.hook()["completedTasks"]
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot(f"qa-{TAG}-6-summary", full=True)
    res["progress"] = s.page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1')).lessons.rute")

    # ---------- navigasi berulang ----------
    for _ in range(6):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate("() => { location.hash = '#/pelajaran/rute' }")
        s.page.wait_for_timeout(400)
    res["after_nav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('.stage canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "step": s.hook()["stepIndex"],
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(400)
    res["home"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    res["errors"] = s.errors

print(json.dumps(res, indent=1, ensure_ascii=False))
