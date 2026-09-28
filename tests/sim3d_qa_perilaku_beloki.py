"""Bukti visual dan angka: saat belok kiri, badan mobil melewati sudut trotoar."""
import time
from sim3d_qa_perilaku_common import *  # noqa

PEN = r"""async () => {
  const a = window.__qaApp, H = 7;
  const R = (await import('/js/sim3d/roadgraph.js')).GRID.CURB_R || 0;
  // titik-titik kerb di sekitar sudut blok (lengkung jari-jari R lalu tepi lurus sampai 12 m)
  if (!window.__curbPts) {
    const pts = [];
    for (const n of a.graph.nodes) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = n.x + sx * H, cz = n.z + sz * H;
      for (let i = 0; i <= 12; i++) { const t = (i / 12) * Math.PI / 2; pts.push([cx + sx * (R - R * Math.cos(t)), cz + sz * (R - R * Math.sin(t))]); }
      for (let d = R; d <= 12; d += 0.25) { pts.push([cx + sx * d, cz]); pts.push([cx, cz + sz * d]); }
    }
    window.__curbPts = pts;
  }
  const P = window.__curbPts;
  // kedalaman maksimum kerb masuk ke dalam kotak mobil (ego dan NPC)
  const depth = (o, cx, cz) => { const c = Math.cos(o.h), s = Math.sin(o.h); const rx = cx - o.x, rz = cz - o.z; const lx = rx * c + rz * s, lz = -rx * s + rz * c;
    if (Math.abs(lx) > o.hl || Math.abs(lz) > o.hw) return 0; return Math.min(o.hl - Math.abs(lx), o.hw - Math.abs(lz)); };
  const test = (o) => { let best = 0; for (const [cx, cz] of P) { if (Math.abs(cx - o.x) > 4 || Math.abs(cz - o.z) > 4) continue; best = Math.max(best, depth(o, cx, cz)); } return best; };
  const e = a.ego;
  const eg = test({ x: e.x, z: e.z, h: e.h, hl: e.hl, hw: e.hw });
  let npc = 0, npcN = 0;
  for (const c of a.traffic.cars) { const d = test({ x: c.x, z: c.z, h: c.h, hl: c.len / 2, hw: c.wid / 2 }); if (d > 0.05) npcN++; npc = Math.max(npc, d); }
  const r = a.planner.route, it = r.items[r.ri];
  return { ego: eg, npc, npcN, item: it.type, move: it.type === 'conn' ? it.lane.move : null, t: a.simTime };
}"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    page.keyboard.press("]")
    egoMax = 0
    npcMax = 0
    npcHits = 0
    shot_npc = False
    shot_ego = False
    t0 = time.time()
    while time.time() - t0 < 120 and not (shot_ego and shot_npc):
        r = ev(page, PEN)
        egoMax = max(egoMax, r["ego"])
        npcMax = max(npcMax, r["npc"])
        npcHits += r["npcN"]
        if not shot_ego and r["move"] == "L" and (r["ego"] > 0.3 or time.time() - t0 > 20):
            page.keyboard.press("2")
            ev(page, "() => { window.__qaApp.togglePause(); }")
            time.sleep(0.6)
            shot(page, "beloki_ego_kejar.png")
            page.keyboard.press("3")
            time.sleep(0.8)
            shot(page, "beloki_ego_atas.png")
            ev(page, "() => { window.__qaApp.togglePause(); }")
            page.keyboard.press("2")
            shot_ego = True
            print("ego belok kiri, kedalaman sudut trotoar di dalam badan mobil:", round(r["ego"], 2), "m")
        time.sleep(0.05)
    print("maks kedalaman sudut trotoar di badan ego:", round(egoMax, 2), "m; NPC:", round(npcMax, 2), "m; sampel NPC di atas sudut:", npcHits)
    b.close()
