"""Uji logika lampu adaptif memakai kelas Controller asli (salinan objek, simulasi kota tidak diubah).
Skenario: permintaan kendaraan tetap ada di beberapa arah, pejalan kaki terus datang.
Ukur waktu merah terlama tiap arah yang punya antrean, dan urutan fase."""
import json
from sim3d_qa_perilaku_common import *  # noqa

MODEL = r"""(cfg) => {
  const app = window.__qaApp;
  const src = app.signals.list.find((c) => c.apps.length === 4);
  const run = (demandOn, pedMode, mode, secs) => {
    const c = Object.create(Object.getPrototypeOf(src));
    Object.assign(c, JSON.parse(JSON.stringify({ apps: src.apps, order: src.order })));
    c.node = src.node; c.cursor = 0; c.phase = 'rest'; c.stage = 'rest'; c.t = 0; c.demand = [0, 0, 0, 0]; c.queue = [0, 0, 0, 0]; c.queueLen = [0, 0, 0, 0];
    c.noDemandT = 0; c.pedWait = 0; c.pedWaitT = 0; c.sincePed = 0;
    const dt = 1 / 60;
    const wait = [0, 0, 0, 0], maxWait = [0, 0, 0, 0], greens = [0, 0, 0, 0];
    let peds = 0, pedPhases = 0, prev = '';
    const seq = [];
    for (let i = 0; i < secs * 60; i++) {
      const t = i * dt;
      for (const k of c.apps) c.demand[k] = demandOn[k] ? 1 : 0;
      // pejalan kaki: pola 'terus' = selalu ada yang menunggu kecuali saat walk; 'jarang' = datang tiap 60 detik
      if (pedMode === 'terus') c.pedWait = c.pedWalk() ? 0 : 1;
      else if (pedMode === 'jarang') { if (Math.floor(t) % 60 === 0 && !c.pedWalk()) peds = 1; if (c.pedWalk()) peds = 0; c.pedWait = peds; }
      else c.pedWait = 0;
      c.step(dt, mode);
      const cur = c.stage + ':' + c.phase;
      if (cur !== prev) { if (c.stage === 'green') { greens[c.phase]++; if (seq.length < 40) seq.push(`${t.toFixed(0)}:G${c.phase}`); } if (c.stage === 'walk') { pedPhases++; if (seq.length < 40) seq.push(`${t.toFixed(0)}:P`); } prev = cur; }
      for (const k of c.apps) {
        if (demandOn[k] && c.colorFor(k) !== 'green') { wait[k] += dt; if (wait[k] > maxWait[k]) maxWait[k] = wait[k]; }
        else wait[k] = 0;
      }
    }
    return { maxWait: maxWait.map((v) => +v.toFixed(1)), greens, pedPhases, seq: seq.join(' ') };
  };
  const out = {};
  for (const sc of cfg) out[sc.name] = run(sc.demand, sc.ped, sc.mode, sc.secs);
  return out;
}"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    cfg = [
        {"name": "adaptif, 4 arah, tanpa pejalan", "demand": [1, 1, 1, 1], "ped": "none", "mode": "adaptif", "secs": 600},
        {"name": "adaptif, 4 arah, pejalan terus", "demand": [1, 1, 1, 1], "ped": "terus", "mode": "adaptif", "secs": 600},
        {"name": "adaptif, 4 arah, pejalan tiap 60 s", "demand": [1, 1, 1, 1], "ped": "jarang", "mode": "adaptif", "secs": 600},
        {"name": "adaptif, arah 0,1,3, pejalan terus", "demand": [1, 1, 0, 1], "ped": "terus", "mode": "adaptif", "secs": 600},
        {"name": "tetap, 4 arah, pejalan terus", "demand": [1, 1, 1, 1], "ped": "terus", "mode": "tetap", "secs": 600},
    ]
    res = ev(page, MODEL, cfg)
    for k, v in res.items():
        print(k)
        print("   waktu merah terlama per arah (0 barat, 1 utara, 2 timur, 3 selatan):", v["maxWait"], "| jumlah hijau:", v["greens"], "| fase pejalan:", v["pedPhases"])
        print("   urutan:", v["seq"][:260])
    b.close()
