"""Uji model pelajaran Level Otomasi tanpa UI (penguji independen).

Modul scene.js diimpor di halaman lalu dijalankan langkah demi langkah dengan dt 1/60 detik.
Disesuaikan dengan versi perjalanan Ma Chung: level 4 hanya aktif di dalam kawasan (trip < batas),
batas kecepatan 40 km/jam di kota dan 30 km/jam di kawasan.
Pemakaian: python3 tests/level-otomasi_indep_model.py [--port 8131]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8131"

JS = r"""
async () => {
  const M = await import('/js/lessons/level-otomasi/scene.js');
  const R = await import('/js/lessons/level-otomasi/road.js');
  const { kmhToMs } = await import('/js/engine/math.js');
  const dt = 1 / 60;
  const out = {};
  const mk = () => M.createScene();

  // ---------- L3 tanpa respons ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 3, egoAt: 650, speed: M.V_SET, lead: null, zone: 300 });
    const zoneS0 = st.zone.s0;
    let t = 0, tTor = null, tMrm = null, tMrc = null, vPrev = sc.ego.speed, maxDecel = 0, minD = 9, maxD = -9, torDist = null;
    while (t < 60 && st.ads.phase !== 'mrc') {
      sc.update(dt); t += dt;
      const a = (vPrev - sc.ego.speed) / dt; vPrev = sc.ego.speed; if (a > maxDecel) maxDecel = a;
      if (st.ads.phase === 'tor' && tTor == null) { tTor = t; torDist = st.zone.s0 - (st.egoS + sc.EGO_HL); }
      if (st.ads.phase === 'mrm' && tMrm == null) tMrm = t;
      minD = Math.min(minD, st.egoD); maxD = Math.max(maxD, st.egoD);
    }
    for (let k = 0; k < 60; k++) sc.update(dt);
    out.l3 = { tTor: +tTor?.toFixed(2), torDistToZone: +torDist?.toFixed(1), countdown: +(tMrm - tTor).toFixed(2),
      tMrc: +t.toFixed(2), stopGapToZone: +(st.zone.s0 - (st.egoS + sc.EGO_HL)).toFixed(1), egoD: +st.egoD.toFixed(2),
      maxDecel: +maxDecel.toFixed(2), hazard: st.signal.hazard, speed: sc.ego.speed, crashes: st.crashes, lane: [minD.toFixed(2), maxD.toFixed(2)] };
  }

  // ---------- L4 di batas ODD ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 4, egoAt: 650, speed: M.V_SET, lead: null, boundary: 230 });
    let t = 0, tMrm = null, vPrev = sc.ego.speed, maxDecel = 0, maxLat = 0, sigLeft = 0, sigRight = 0;
    while (t < 80 && !(st.ads.phase === 'mrc' && st.counters.mrcHold > 1)) {
      sc.update(dt); t += dt;
      const a = (vPrev - sc.ego.speed) / dt; vPrev = sc.ego.speed; if (a > maxDecel) maxDecel = a;
      const lat = sc.ego.speed * sc.ego.speed * Math.abs(Math.tan(sc.ego.steer) / sc.ego.wheelbase);
      if (lat > maxLat) maxLat = lat;
      if (st.ads.phase === 'mrm' && tMrm == null) tMrm = t;
      if (st.signal.left && !st.signal.hazard) sigLeft++;
      if (st.signal.right) sigRight++;
    }
    out.l4 = { tMrm: +tMrm?.toFixed(2), tDone: +t.toFixed(2), egoD: +st.egoD.toFixed(2), shoulder: [R.EDGE_LEFT, R.SHOULDER_OUT],
      gapToBoundary: +(st.boundary.s - (st.egoS + sc.EGO_HL)).toFixed(1), maxDecel: +maxDecel.toFixed(2), maxLatAccel: +maxLat.toFixed(2),
      leftSignalFrames: sigLeft, rightSignalFrames: sigRight, hazard: st.signal.hazard, mrcHold: +st.counters.mrcHold.toFixed(2),
      carInsideShoulder: st.egoD - sc.ego.width / 2 > R.EDGE_LEFT && st.egoD + sc.ego.width / 2 < R.SHOULDER_OUT };
  }

  // ---------- L5 melewati batas, L4 dan L5 melewati zona ----------
  for (const [name, p] of [
    ['l5boundary', { level: 5, egoAt: 650, speed: M.V_SET, lead: null, boundary: 200 }],
    ['l4zone', { level: 4, egoAt: 650, trip: 100, speed: M.V_KAWASAN, lead: null, zone: 300 }],
    ['l5zone', { level: 5, egoAt: 200, speed: M.V_SET, lead: null, zone: 250 }],
  ]) {
    const sc = mk(); const st = sc.st;
    sc.applyPreset(p);
    let aeb = 0, minV = 99, minD = 9, maxD = -9, dist = 0, off = 0;
    for (let k = 0; k < 60 * 40; k++) {
      const s0 = st.egoS;
      sc.update(dt);
      dist += Math.max(0, st.egoS - s0 > -500 ? st.egoS - s0 : st.egoS - s0 + R.PERIOD);
      if (st.aeb.active) aeb++;
      minV = Math.min(minV, sc.ego.speed); minD = Math.min(minD, st.egoD); maxD = Math.max(maxD, st.egoD);
      if (st.flash && st.flash.key === 'offroad') off++;
    }
    out[name] = { crashes: st.crashes, aebFrames: aeb, minKmh: +(minV * 3.6).toFixed(1), d: [+minD.toFixed(2), +maxD.toFixed(2)], dist: Math.round(dist), phase: st.ads.phase, engaged: st.engaged, offroad: off };
  }

  // ---------- L2 dengan tangan di setir: ACC dan penjaga lajur ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 2, egoAt: 250, speed: kmhToMs(55), lead: { gap: 34, speed: kmhToMs(50) } });
    let minGap = 1e9, errSum = 0, errN = 0, maxLane = 0, fcw = 0, aeb = 0, t = 0;
    for (let k = 0; k < 60 * 150; k++) {
      sc.update(dt); t += dt;
      if (st.attention.stage !== 'ok') sc.pressHold();
      const gap = sc.lead.s - sc.lead.length / 2 - (st.egoS + sc.EGO_HL);
      if (t > 20) { minGap = Math.min(minGap, gap); if (st.acc.mode === 'follow') { errSum += Math.abs(gap - st.acc.want); errN++; } }
      maxLane = Math.max(maxLane, Math.abs(st.egoD - R.LEFT_LANE));
      if (st.fcw) fcw++; if (st.aeb.active) aeb++;
    }
    out.l2acc = { engaged: st.engaged, minGap: +minGap.toFixed(1), meanGapErr: +(errSum / Math.max(1, errN)).toFixed(2), followShare: +(errN / (130 * 60)).toFixed(2), maxLaneDev: +maxLane.toFixed(3), fcw, aeb, crashes: st.crashes };
  }

  // ---------- L2 diabaikan: urutan pesan ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 2, egoAt: 250, speed: kmhToMs(55), lead: { gap: 34, speed: kmhToMs(50) } });
    let t = 0; const times = {}; let vAtWarn = null;
    while (t < 20 && st.engaged) {
      sc.update(dt); t += dt;
      const s = st.attention.stage;
      if (!times[s]) { times[s] = +t.toFixed(2); if (s === 'warn') vAtWarn = sc.ego.speed * 3.6; }
    }
    out.l2ignored = { times, handbackAt: +t.toFixed(2), kmhAtWarn: +(vAtWarn || 0).toFixed(1), kmhAtHandback: +(sc.ego.speed * 3.6).toFixed(1), flash: st.flash && st.flash.key };
  }

  // ---------- L1: ACC dari berhenti di belakang mobil yang menunggu ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 0, egoAt: 10, speed: 0, lead: { gap: 24, speed: 0, wait: true } });
    sc.setLevel(1);
    let t = 0, tDone = null, minGap = 1e9;
    for (let k = 0; k < 60 * 20; k++) {
      sc.update(dt); t += dt;
      // pengemudi menyetir sederhana (bang-bang) supaya tetap di lajur
      const e = st.egoD - R.LEFT_LANE + 4 * st.headErr * -1;
      sc.setInput('left', false); sc.setInput('right', false);
      if (st.egoD - R.LEFT_LANE > 0.15 || -st.headErr > 0.01) sc.setInput('right', true);
      else if (st.egoD - R.LEFT_LANE < -0.15 || -st.headErr < -0.01) sc.setInput('left', true);
      const gap = sc.lead.s - sc.lead.length / 2 - (st.egoS + sc.EGO_HL); minGap = Math.min(minGap, gap);
      if (tDone == null && st.counters.accFollow >= 5) tDone = t;
    }
    out.l1 = { tDone: +tDone?.toFixed(2), minGap: +minGap.toFixed(1), want: +st.acc.want.toFixed(1), gap: +st.acc.gap.toFixed(1), kmh: +(sc.ego.speed * 3.6).toFixed(1), crashes: st.crashes };
  }

  // ---------- L0: gas terus ke arah mobil depan (FCW dan AEB) ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 0, egoAt: 10, speed: 0, lead: { gap: 24, speed: 0, wait: true } });
    sc.setInput('gas', true);
    let fcwFirst = null, aebFirst = null, t = 0;
    for (let k = 0; k < 60 * 25; k++) {
      sc.update(dt); t += dt;
      if (st.fcw && fcwFirst == null) fcwFirst = +t.toFixed(2);
      if (st.aeb.active && aebFirst == null) aebFirst = +t.toFixed(2);
    }
    out.l0gas = { fcwFirst, aebFirst, crashes: st.crashes, manualDist: Math.round(st.counters.manualDist) };
  }

  // ---------- rebase: posisi mulus melewati beberapa periode ----------
  {
    const sc = mk(); const st = sc.st;
    sc.applyPreset({ level: 5, egoAt: 1200, speed: M.V_SET, lead: null });
    let maxJump = 0, px = sc.ego.x, py = sc.ego.y, rebases = 0, maxLane = 0;
    const S = sc.road.SHIFT;
    for (let k = 0; k < 60 * 200; k++) {
      const before = st.egoS;
      sc.update(dt);
      let dx = sc.ego.x - px, dy = sc.ego.y - py;
      if (st.egoS < before - 100) { rebases++; dx += S.x; dy += S.y; }
      maxJump = Math.max(maxJump, Math.hypot(dx, dy));
      px = sc.ego.x; py = sc.ego.y;
      maxLane = Math.max(maxLane, Math.abs(st.egoD - R.LEFT_LANE));
    }
    out.rebase = { rebases, maxStepMove: +maxJump.toFixed(3), expected: +(M.V_SET * dt).toFixed(3), maxLaneDev: +maxLane.toFixed(3), crashes: st.crashes };
  }

  // ---------- geometri: radius terkecil dan pola berulang ----------
  {
    let kmax = 0;
    for (let s = 0; s < R.PERIOD; s += 0.5) kmax = Math.max(kmax, Math.abs(R.curvatureAt(s)));
    out.road = { minRadius: Math.round(1 / kmax), headingAtPeriod: R.headingAt(R.PERIOD - 0.001), headingMid: +R.headingAt(650).toFixed(4), maxHeadingDeg: +(Math.max(...Array.from({ length: 1300 }, (_, i) => Math.abs(R.headingAt(i)))) * 180 / Math.PI).toFixed(1) };
  }
  return out;
}
"""

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page()
    errs = []
    p.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    p.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
    res = p.evaluate(JS)
    res["errors"] = errs
    print(json.dumps(res, indent=1))
    b.close()
