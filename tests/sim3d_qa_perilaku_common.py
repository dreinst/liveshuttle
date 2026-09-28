"""Alat bantu uji perilaku otonom simulator 3D (QA, port 8103).

Skrip ini tidak mengubah berkas proyek. Untuk membaca keadaan internal simulasi, skrip init
menangkap objek App lewat setter sementara pada properti "app" (dipasang sebelum modul dimuat),
lalu memasang pemantau yang berjalan setelah tiap langkah simulasi.
"""
import json
import os
import time

from playwright.sync_api import sync_playwright  # noqa: F401 (dipakai skrip lain)

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8103")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(__file__), "shots", "sim3d_perilaku")
os.makedirs(SHOTS, exist_ok=True)
SWIFT_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

INIT_JS = r"""
(() => {
  Object.defineProperty(Object.prototype, 'app', {
    configurable: true,
    enumerable: false,
    get() { return undefined; },
    set(v) {
      try { if (v && v.constructor && v.constructor.name === 'App') window.__qaApp = v; } catch (e) {}
      Object.defineProperty(this, 'app', { value: v, writable: true, configurable: true, enumerable: true });
    },
  });
})();
"""

MONITOR_JS = r"""
async () => {
  const app = window.__qaApp;
  if (!app) return 'no-app';
  const geom = await import('/js/sim3d/geom.js');
  const rg = await import('/js/sim3d/roadgraph.js');
  const { obbOverlap, obbCircle } = geom;
  const HALF = rg.GRID.HALF;
  const roads = app.graph.roads;
  const M = {
    steps: 0, t0: app.simTime,
    nan: 0, nanEx: [],
    npcPairs: new Set(), npcOverlapEvents: 0, npcOverlapEx: [],
    npcPedPairs: new Set(), npcPedEvents: 0, npcPedEx: [],
    npcRed: 0, npcRedEx: [], npcYellow: 0, npcGreen: 0,
    egoRed: 0, egoRedEx: [], egoYellow: 0, egoGreen: 0, egoUnsignal: 0,
    offRoadCar: 0, offRoadEx: [], offRoadEgo: 0, offRoadEgoEx: [], offRoadEgoMax: 0,
    wrongSideCar: 0, wrongSideEx: [], wrongSideEgo: 0, wrongSideEgoEx: [],
    egoLatMin: 99, egoLatMax: -99, egoDevMax: 0, egoDevSum: 0, egoDevN: 0, egoDevOver: 0,
    npcLatOffMax: 0,
    greensAdaptive: 0, greensNoDemand: 0, greensNoDemandEx: [], greensFixed: 0,
    maxRedWithQueue: 0, maxRedEx: null, redWait: new Map(),
    egoStillT: 0, egoStillMax: 0, egoStillEx: null,
    stuckMax: 0, stuckEx: null,
    ttcPairs: [], ttcMaxErr: 0,
    pedMinDist: 99, pedMinEx: null,
    aebEvents: [],
    egoItemPrev: null,
    phaseHist: new Map(), longWaits: [], longWaitKeys: new Set(), stuckLogs: [], stuckKeys: new Set(), behTL: [], _behPrev: null,
  };
  window.__qaM = M;
  const prevLane = new Map();
  const prevStage = new Map();
  const inRoad = (x, z, tol) => {
    for (const r of roads) {
      const ax = r.a.x, az = r.a.z, bx = r.b.x, bz = r.b.z;
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      const ux = dx / L, uz = dz / L;
      const ex = x - ax, ez = z - az;
      const s = ex * ux + ez * uz;
      const lat = -ex * uz + ez * ux;
      if (s >= -HALF - tol && s <= L + HALF + tol && Math.abs(lat) <= HALF + tol) return true;
    }
    // aspal di lengkung kerb sudut blok (GRID.CURB_R)
    const CR = rg.GRID.CURB_R || 0;
    if (CR > 0) {
      for (const n of app.graph.nodes) {
        if (Math.abs(x - n.x) > HALF + CR + 1 || Math.abs(z - n.z) > HALF + CR + 1) continue;
        const sx = x < n.x ? -1 : 1, sz = z < n.z ? -1 : 1;
        const u = (x - (n.x + sx * HALF)) * sx, w = (z - (n.z + sz * HALF)) * sz;
        if (u < CR && w < CR && Math.hypot(CR - u, CR - w) >= CR - tol) return true;
      }
    }
    return false;
  };
  const corners = (o) => {
    const c = Math.cos(o.h), s = Math.sin(o.h);
    const out = [];
    for (const [a, b] of [[o.hl, o.hw], [o.hl, -o.hw], [-o.hl, -o.hw], [-o.hl, o.hw]]) out.push([o.x + c * a - s * b, o.z + s * a + c * b]);
    return out;
  };
  // sisi kiri garis tengah ruas (lalu lintas kiri): lat terhadap garis tengah, positif = kiri arah jalan
  const leftOfCenter = (seg, x, z) => {
    const ex = x - seg.a.x, ez = z - seg.a.z;
    // kiri = (dz, -dx) untuk arah (dx, dz)
    return ex * seg.dz - ez * seg.dx;
  };
  const origStep = app.step;
  app.step = function (dt) {
    origStep.call(app, dt);
    try { check(dt); } catch (e) { M.monErr = String(e && e.stack || e).slice(0, 300); }
  };
  function check(dt) {
    M.steps++;
    const t = Math.round(app.simTime * 10) / 10;
    const cars = app.traffic.cars;
    const e = app.ego;
    // NaN
    const bad = (v) => !Number.isFinite(v);
    if (bad(e.x) || bad(e.z) || bad(e.h) || bad(e.v)) { M.nan++; if (M.nanEx.length < 5) M.nanEx.push({ t, who: 'ego' }); }
    for (const c of cars) if (bad(c.x) || bad(c.z) || bad(c.h) || bad(c.v) || bad(c.s)) { M.nan++; if (M.nanEx.length < 5) M.nanEx.push({ t, who: 'car' + c.id }); }
    for (const p of app.peds.peds) if (bad(p.x) || bad(p.z)) { M.nan++; if (M.nanEx.length < 5) M.nanEx.push({ t, who: 'ped' + p.id }); }
    // NPC vs NPC (OBB), NPC vs ped
    const nowPairs = new Set();
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      const fa = { x: a.x, z: a.z, h: a.h, hl: a.len / 2, hw: a.wid / 2 };
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const dx = a.x - b.x, dz = a.z - b.z;
        if (dx * dx + dz * dz > 36) continue;
        if (obbOverlap(fa, { x: b.x, z: b.z, h: b.h, hl: b.len / 2, hw: b.wid / 2 })) {
          const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
          nowPairs.add(key);
          if (!M.npcPairs.has(key)) {
            M.npcOverlapEvents++;
            if (M.npcOverlapEx.length < 12) M.npcOverlapEx.push({ t, a: a.id, b: b.id, la: a.lane.type + ':' + a.lane.id + (a.lane.move ? a.lane.move : ''), lb: b.lane.type + ':' + b.lane.id + (b.lane.move ? b.lane.move : ''), va: +a.v.toFixed(1), vb: +b.v.toFixed(1), x: Math.round(a.x), z: Math.round(a.z), node: a.lane.node ? a.lane.node.id : null, oldA: a.oldLane ? a.oldLane.id : null, oldB: b.oldLane ? b.oldLane.id : null });
          }
        }
      }
    }
    M.npcPairs = nowPairs;
    const nowPed = new Set();
    for (const c of cars) {
      const fa = { x: c.x, z: c.z, h: c.h, hl: c.len / 2, hw: c.wid / 2 };
      for (const p of app.peds.peds) {
        const dx = c.x - p.x, dz = c.z - p.z;
        if (dx * dx + dz * dz > 16) continue;
        if (obbCircle(fa, p.x, p.z, 0.28)) {
          const key = c.id + ':' + p.id;
          nowPed.add(key);
          if (!M.npcPedPairs.has(key)) {
            M.npcPedEvents++;
            if (M.npcPedEx.length < 12) M.npcPedEx.push({ t, car: c.id, ped: p.id, pmode: p.mode, jay: !!p.jay, v: +c.v.toFixed(1), lane: c.lane.type, x: Math.round(c.x), z: Math.round(c.z) });
          }
        }
      }
    }
    M.npcPedPairs = nowPed;
    // NPC lintasi garis henti saat merah; sisi jalan; keluar jalan
    const live = new Set();
    for (const c of cars) {
      live.add(c.id);
      const pl = prevLane.get(c.id);
      if (pl && pl.type === 'road' && c.lane.type === 'conn' && pl.node.signalized) {
        const col = app.signals.colorAt(pl.node.id, pl.dir);
        if (col === 'red') { M.npcRed++; if (M.npcRedEx.length < 10) M.npcRedEx.push({ t, car: c.id, node: pl.node.id, dir: pl.dir, v: +c.v.toFixed(1), stage: app.signals.byNode.get(pl.node.id).stage, phase: app.signals.byNode.get(pl.node.id).phase, decision: c.decision }); }
        else if (col === 'yellow') M.npcYellow++;
        else M.npcGreen++;
      }
      prevLane.set(c.id, c.lane);
      if (Math.abs(c.latOff) > M.npcLatOffMax) M.npcLatOffMax = Math.abs(c.latOff);
      const f = { x: c.x, z: c.z, h: c.h, hl: c.len / 2, hw: c.wid / 2 };
      const off = corners(f).filter(([x, z]) => !inRoad(x, z, 0.25)).length;
      if (off) { M.offRoadCar++; if (M.offRoadEx.length < 8) M.offRoadEx.push({ t, car: c.id, lane: c.lane.type + (c.lane.move || ''), node: c.lane.node.id, x: +c.x.toFixed(1), z: +c.z.toFixed(1) }); }
      if (c.lane.type === 'road') {
        const L = leftOfCenter(c.lane.seg, c.x, c.z);
        if (L < 0.9) { M.wrongSideCar++; if (M.wrongSideEx.length < 8) M.wrongSideEx.push({ t, car: c.id, L: +L.toFixed(2) }); }
      }
      if (c.stuckT > 30 && !M.stuckKeys.has(c.id) && M.stuckLogs.length < 12) {
        M.stuckKeys.add(c.id);
        const ld = app.traffic.findLeader(c);
        const L = c.lane;
        M.stuckLogs.push({ t, car: c.id, lane: L.type + ':' + L.id + (L.move || ''), k: L.k, node: L.node.id, dStop: L.type === 'road' ? Math.round(L.len - c.s) : null, dec: c.decision,
          color: L.type === 'road' && L.node.signalized ? app.signals.colorAt(L.node.id, L.dir) : null, lead: ld ? ld.kind + ':' + Math.round(ld.gap) + (ld.item.ref && ld.item.ref.id !== undefined ? ':' + ld.item.ref.id : '') : null,
          x: Math.round(c.x), z: Math.round(c.z), egoD: Math.round(Math.hypot(c.x - app.ego.x, c.z - app.ego.z)), oldLane: c.oldLane ? c.oldLane.id : null, latOff: +c.latOff.toFixed(2) });
      }
      if (c.stuckT < 1) M.stuckKeys.delete(c.id);
      if (c.stuckT > M.stuckMax) { M.stuckMax = c.stuckT; M.stuckEx = { t, car: c.id, lane: c.lane.type, dec: c.decision, blocked: c.blockedT }; }
    }
    for (const id of prevLane.keys()) if (!live.has(id)) prevLane.delete(id);
    // ego
    const pl = app.planner;
    const r = pl.route;
    if (r) {
      const it = r.items[r.ri];
      const key = r.ri + ':' + it.type + ':' + (r.items.length);
      const prev = M.egoItemPrev;
      if (prev && prev.type === 'road' && it.type === 'conn' && prev.route === r) {
        if (prev.seg.b.signalized) {
          const col = app.signals.colorAt(prev.seg.b.id, prev.seg.k);
          if (col === 'red') { M.egoRed++; if (M.egoRedEx.length < 10) M.egoRedEx.push({ t, node: prev.seg.b.id, v: +(e.v * 3.6).toFixed(1), beh: pl.behavior, auto: app.autopilot, stage: app.signals.byNode.get(prev.seg.b.id).stage }); }
          else if (col === 'yellow') M.egoYellow++;
          else M.egoGreen++;
        } else M.egoUnsignal++;
      }
      M.egoItemPrev = { type: it.type, seg: it.seg, route: r };
      if (it.type === 'road') {
        const L = leftOfCenter(it.seg, e.x, e.z);
        if (L < M.egoLatMin) M.egoLatMin = L;
        if (L > M.egoLatMax) M.egoLatMax = L;
        if (L < 0.95) { M.wrongSideEgo++; if (M.wrongSideEgoEx.length < 8) M.wrongSideEgoEx.push({ t, L: +L.toFixed(2), beh: pl.behavior, auto: app.autopilot }); }
      }
    }
    const dev = app.lateralError || 0;
    if (app.autopilot && !pl.backup) {
      M.egoDevSum += dev; M.egoDevN++;
      if (dev > M.egoDevMax) { M.egoDevMax = dev; M.egoDevMaxEx = { t, beh: pl.behavior, v: +(e.v * 3.6).toFixed(1), item: r ? r.items[r.ri].type : null }; }
      if (dev > 0.5) M.egoDevOver++;
    }
    const ef = e.footprint();
    const offE = corners(ef).filter(([x, z]) => !inRoad(x, z, 0.25)).length;
    if (offE) { M.offRoadEgo++; if (M.offRoadEgoEx.length < 8) M.offRoadEgoEx.push({ t, x: +e.x.toFixed(1), z: +e.z.toFixed(1), beh: pl.behavior, auto: app.autopilot }); }
    const onConn = r && r.items[r.ri].type === 'conn';
    if (onConn && Math.abs(e.v) < 0.1) { M.egoBoxStillT = (M.egoBoxStillT || 0) + dt; if (M.egoBoxStillT > (M.egoBoxStillMax || 0)) { M.egoBoxStillMax = M.egoBoxStillT; M.egoBoxEx = { t, beh: pl.behavior, why: pl.reason, lim: pl.limiter }; } } else M.egoBoxStillT = 0;
    if (Math.abs(e.v) < 0.1 && app.autopilot && M.egoStillT + dt > 20 && M.egoStillT <= 20) { (M.egoLongStops = M.egoLongStops || []).push({ t, beh: pl.behavior, why: pl.reason, lim: pl.limiter, lane: pl.kNow, obs: app.scen.obstacles.length }); }
    if (Math.abs(e.v) < 0.1 && app.autopilot) { M.egoStillT += dt; if (M.egoStillT > M.egoStillMax) { M.egoStillMax = M.egoStillT; M.egoStillEx = { t, beh: pl.behavior, why: pl.reason, lim: pl.limiter }; } }
    else M.egoStillT = 0;
    // jarak minimum ego ke pejalan kaki di jalan
    for (const p of app.peds.peds) {
      if (!p.onRoad) continue;
      const c = Math.cos(e.h), s = Math.sin(e.h);
      const rx = p.x - e.x, rz = p.z - e.z;
      const lx = rx * c + rz * s, lz = -rx * s + rz * c;
      const qx = Math.max(-e.hl, Math.min(e.hl, lx)), qz = Math.max(-e.hw, Math.min(e.hw, lz));
      const d = Math.hypot(lx - qx, lz - qz) - 0.28;
      if (d < M.pedMinDist) { M.pedMinDist = d; M.pedMinEx = { t, ped: p.id, jay: !!p.jay, v: +(e.v * 3.6).toFixed(1), beh: pl.behavior }; }
    }
    // lampu: hijau adaptif hanya untuk arah yang ada antreannya; waktu merah terlama saat ada antrean
    for (const c of app.signals.list) {
      const key = c.node.id;
      const ps = prevStage.get(key);
      const cur = c.stage + ':' + c.phase;
      if (ps !== undefined && ps !== cur && c.stage === 'green') {
        if (app.signals.mode === 'adaptif') {
          M.greensAdaptive++;
          if (!(c.demand[c.phase] > 0)) { M.greensNoDemand++; if (M.greensNoDemandEx.length < 8) M.greensNoDemandEx.push({ t, node: key, phase: c.phase, demand: c.demand.slice(), q: c.queueLen.slice() }); }
        } else M.greensFixed++;
      }
      if (ps !== cur) {
        let h = M.phaseHist.get(key); if (!h) M.phaseHist.set(key, (h = []));
        h.push([t, c.stage, c.phase, c.demand.join(''), c.pedWait]); if (h.length > 40) h.shift();
      }
      prevStage.set(key, cur);
      for (const k of c.apps) {
        const rk = key * 4 + k;
        const col = c.colorFor(k);
        if (c.queueLen[k] >= 1 && col !== 'green') {
          const w = (M.redWait.get(rk) || 0) + dt;
          M.redWait.set(rk, w);
          if (w > 40 && !M.longWaitKeys.has(rk)) {
            M.longWaitKeys.add(rk);
            if (M.longWaits.length < 10) M.longWaits.push({ t, node: key, k, mode: app.signals.mode, q: c.queueLen.map((v) => Math.round(v)), demand: c.demand.slice(), pedWait: c.pedWait, pedWaitT: +c.pedWaitT.toFixed(1), sincePed: +c.sincePed.toFixed(1), hist: (M.phaseHist.get(key) || []).slice(-14) });
          }
          if (w > M.maxRedWithQueue) { M.maxRedWithQueue = w; M.maxRedEx = { t, node: key, k, mode: app.signals.mode, demand: c.demand.slice(), q: c.queueLen.map((v) => Math.round(v)), phase: c.phase, stage: c.stage, pedWait: c.pedWait }; }
        } else if (col === 'green' || c.queueLen[k] < 1) { M.redWait.set(rk, 0); M.longWaitKeys.delete(rk); }
      }
    }
    // TTC: bandingkan nilai planner dengan hitungan kebenaran dasar (jarak bumper / kecepatan mendekat)
    if (Number.isFinite(pl.ttc) && pl.objs && pl.ttc < 8) {
      let best = null, bt = Infinity;
      for (const o of pl.objs) {
        if (o.predicted) continue;
        const cl = Math.max(0, e.v) - Math.max(0, o.vAlong);
        if (cl > 0.5 && o.gap > -1) { const tt = Math.max(0, o.gap) / cl; if (tt < bt) { bt = tt; best = o; } }
      }
      if (best && best.t.ref) {
        const ref = best.t.ref;
        const fx = Math.cos(e.h), fz = Math.sin(e.h);
        const along = (ref.x - e.x) * fx + (ref.z - e.z) * fz;
        const dh = (ref.h || 0) - e.h;
        const ext = Math.abs(ref.hl * Math.cos(dh)) + Math.abs(ref.hw * Math.sin(dh));
        const gtGap = along - ext - e.hl;
        const vObj = (ref.vx || 0) * fx + (ref.vz || 0) * fz;
        const gtClose = e.v - vObj;
        if (gtClose > 0.5 && gtGap > 0.5 && M.ttcPairs.length < 4000 && M.steps % 3 === 0) {
          const gt = gtGap / gtClose;
          M.ttcPairs.push([+pl.ttc.toFixed(3), +gt.toFixed(3), best.t.cls, +gtGap.toFixed(2), +gtClose.toFixed(2), +vObj.toFixed(2)]);
        }
      }
    }
    if (pl.behavior !== M._behPrev) { M.behTL.push([t, pl.behavior, +(e.v * 3.6).toFixed(0), (pl.reason || '').slice(0, 90)]); if (M.behTL.length > 400) M.behTL.shift(); M._behPrev = pl.behavior; }
    if (pl.aeb && !M._aebPrev) M.aebEvents.push({ t, v: +(e.v * 3.6).toFixed(1), ttc: +pl.ttc.toFixed(2), cls: pl.aebObj ? pl.aebObj.t.cls : null });
    M._aebPrev = pl.aeb;
  }
  return 'ok';
}
"""

SUMMARY_JS = r"""
() => {
  const M = window.__qaM, app = window.__qaApp;
  const out = {};
  for (const [k, v] of Object.entries(M)) {
    if (v instanceof Set || v instanceof Map || k === 'ttcPairs' || k === 'egoItemPrev' || k === 'behTL') continue;
    out[k] = v;
  }
  out.simSpan = app.simTime - M.t0;
  out.egoDevMean = M.egoDevN ? M.egoDevSum / M.egoDevN : 0;
  out.respawns = app.traffic.respawns;
  out.counters = { ...app.counters };
  out.debug = app.debugLog.slice(-40);
  out.ttcN = M.ttcPairs.length;
  return out;
}
"""

COUNTS_JS = r"""
() => {
  const app = window.__qaApp;
  let sceneObjs = 0; app.scene.traverse(() => sceneObjs++);
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  return {
    t: app.simTime, cars: app.traffic.cars.length, peds: app.peds.peds.length, obstacles: app.scen.obstacles.length,
    sceneChildren: app.scene.children.length, sceneObjs,
    geos: app.renderer.info.memory.geometries, texs: app.renderer.info.memory.textures,
    progs: app.renderer.info.programs ? app.renderer.info.programs.length : null,
    tracks: app.perception.tracks.size, seen: app.sensing.seen.size, timers: app.timers.size,
    toasts: app.hud.toasts.length, dom: document.getElementsByTagName('*').length,
    idxPool: app.laneIdx.pool.length, heap: mem, fps: app.fps, calls: app.renderer.info.render.calls,
    resSize: app.res.items.size, debugLog: app.debugLog.length,
  };
}
"""


def launch(p, swift=False):
    args = ["--enable-precise-memory-info", "--js-flags=--expose-gc"]
    if swift:
        args += SWIFT_ARGS
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    ctx.add_init_script(INIT_JS)
    page = ctx.new_page()
    log = []
    page.on("console", lambda m: log.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    return ctx, page, log


def snap(page):
    return page.evaluate("() => { const s = window.__sim3d; return s ? JSON.parse(JSON.stringify(s)) : null; }")


def open_sim(page, mode="bebas", timeout=90):
    """Buka harness. Server uji kadang memutus koneksi saat banyak modul dimuat, jadi muat ulang bila perlu."""
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode={mode}")
    t0 = time.time()
    last_reload = t0
    while time.time() - t0 < timeout:
        try:
            ok = page.evaluate("() => !!(window.__sim3d && window.__sim3d.ready && window.__qaApp)")
        except Exception:
            ok = False
        if ok:
            return True
        if time.time() - last_reload > 15:
            last_reload = time.time()
            page.goto(f"{BASE}/tests/sim3d_harness.html?mode={mode}")
        time.sleep(0.2)
    raise RuntimeError("simulator tidak siap")


def install_monitor(page):
    return page.evaluate(MONITOR_JS)


def summary(page):
    return page.evaluate(SUMMARY_JS)


def counts(page):
    return page.evaluate(COUNTS_JS)


def ev(page, js, arg=None):
    return page.evaluate(js, arg) if arg is not None else page.evaluate(js)


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path)
    return path


def dump(obj):
    print(json.dumps(obj, indent=1, ensure_ascii=False, default=str))
