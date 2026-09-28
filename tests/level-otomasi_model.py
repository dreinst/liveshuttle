"""Uji model pelajaran Level Otomasi tanpa UI: modul scene diimpor di browser lalu dijalankan langsung.

Memeriksa: pengemudi sederhana (tombol kiri/kanan saja) bisa mengikuti tikungan, galat lajur
sistem level 2 sampai 5, jarak ACC dan tanpa tabrakan, titik henti level 3 dan 4, serta rebase.
Pemakaian: python3 tests/level-otomasi_model.py [--port 8111]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8111"

JS = r"""
async () => {
  const m = await import('/js/lessons/level-otomasi/scene.js');
  const R = {};
  const dt = 1 / 60;
  const kmh = (v) => v / 3.6;

  // 1. level 0: pengemudi bang-bang hanya dengan tombol kiri dan kanan, gas dijaga sekitar 60 km/jam
  {
    const sc = m.createScene();
    sc.applyPreset({ level: 0, egoAt: 300, speed: kmh(60), lead: null });
    const st = sc.st;
    let maxErr = 0, offroad = 0, steps = 0;
    for (let i = 0; i < 60 * 90; i++) {
      const e = st.egoD - 1.75 + st.headErr * -8; // d positif = kiri; headErr positif = mengarah ke kanan
      // tahan kanan bila terlalu ke kiri, kiri bila terlalu ke kanan (dengan pita mati)
      sc.setInput('right', e > 0.25);
      sc.setInput('left', e < -0.25);
      sc.setInput('gas', sc.ego.speed < kmh(60));
      sc.update(dt);
      maxErr = Math.max(maxErr, Math.abs(st.egoD - 1.75));
      if (st.events.includes('offroad')) offroad++;
      st.events.length = 0;
      steps++;
    }
    R.manual = { maxLaneErr: +maxErr.toFixed(2), offroad, dist: Math.round(st.counters.manualDist) };
  }

  // 2. level 2 sampai 5: galat lajur saat sistem menyetir melewati satu periode penuh
  for (const L of [2, 3, 5]) {
    const sc = m.createScene();
    sc.applyPreset({ level: L, egoAt: 300, speed: kmh(60), lead: null });
    const st = sc.st;
    let maxErr = 0;
    for (let i = 0; i < 60 * 85; i++) {
      if (L === 2 && st.attention.stage !== 'ok') sc.pressHold();
      sc.update(dt);
      if (i > 60 * 3) maxErr = Math.max(maxErr, Math.abs(st.egoD - 1.75));
      st.events.length = 0;
    }
    R['laneKeep' + L] = { maxLaneErr: +maxErr.toFixed(3), engaged: st.engaged, speedKmh: Math.round(sc.ego.speed * 3.6) };
  }

  // 3. level 1: ACC di belakang mobil depan yang kecepatannya berubah, pengemudi menyetir bang-bang
  {
    const sc = m.createScene();
    sc.applyPreset({ level: 1, egoAt: 10, speed: 0, lead: { gap: 24, speed: 0, wait: true } });
    const st = sc.st;
    let minGap = Infinity, aeb = 0, crash = 0, fcw = 0, follow = 0, maxGapErr = 0;
    for (let i = 0; i < 60 * 150; i++) {
      const e = st.egoD - 1.75 + st.headErr * -8;
      sc.setInput('right', e > 0.25);
      sc.setInput('left', e < -0.25);
      sc.update(dt);
      if (st.acc.mode === 'follow') {
        follow += dt;
        if (sc.ego.speed > 3 && i > 60 * 20) maxGapErr = Math.max(maxGapErr, Math.abs(st.acc.gap - st.acc.want));
        minGap = Math.min(minGap, st.acc.gap);
      }
      if (st.fcw) fcw++;
      for (const ev of st.events) { if (ev === 'aeb') aeb++; if (ev === 'crash') crash++; }
      st.events.length = 0;
    }
    R.acc = { minGap: +minGap.toFixed(1), maxGapErrAfter20s: +maxGapErr.toFixed(1), aeb, crash, fcwFrames: fcw, followSec: Math.round(follow), engaged: st.engaged };
  }

  // 4. level 3 tanpa respons: berhenti di lajur sebelum zona
  {
    const sc = m.createScene();
    sc.applyPreset({ level: 3, egoAt: 650, speed: kmh(60), lead: null, zone: 300 });
    const st = sc.st;
    let torAt = null, mrcAt = null, maxDecel = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const v0 = sc.ego.speed;
      sc.update(dt);
      maxDecel = Math.max(maxDecel, (v0 - sc.ego.speed) / dt);
      if (st.events.includes('tor') && torAt == null) torAt = +(i * dt).toFixed(1);
      if (st.events.includes('l3-mrc')) mrcAt = +(i * dt).toFixed(1);
      st.events.length = 0;
    }
    const front = st.egoS + sc.EGO_HL;
    R.l3 = { torAt, mrcAt, stopBeforeZone: +(st.zone.s0 - front).toFixed(1), lane: +st.egoD.toFixed(2), maxDecel: +maxDecel.toFixed(2), hazard: st.signal.hazard, aebUsed: st.aeb.active };
  }

  // 5. level 4: menepi dan berhenti di bahu jalan sebelum batas ODD
  {
    const sc = m.createScene();
    sc.applyPreset({ level: 4, egoAt: 650, speed: kmh(60), lead: null, boundary: 230 });
    const st = sc.st;
    let mrmAt = null, mrcAt = null, maxDecel = 0, maxSteer = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const v0 = sc.ego.speed;
      sc.update(dt);
      maxDecel = Math.max(maxDecel, (v0 - sc.ego.speed) / dt);
      maxSteer = Math.max(maxSteer, Math.abs(sc.ego.steer));
      if (st.events.includes('l4-mrm')) mrmAt = +(i * dt).toFixed(1);
      if (st.events.includes('l4-mrc')) mrcAt = +(i * dt).toFixed(1);
      st.events.length = 0;
    }
    const front = st.egoS + sc.EGO_HL;
    R.l4 = { mrmAt, mrcAt, stopBeforeBoundary: +(st.boundary.s - front).toFixed(1), d: +st.egoD.toFixed(2), maxDecel: +maxDecel.toFixed(2), maxSteerRad: +maxSteer.toFixed(3), hazard: st.signal.hazard };
  }

  // 6. level 4 dan 5 melewati zona konstruksi lewat lajur kanan
  for (const L of [4, 5]) {
    const sc = m.createScene();
    sc.applyPreset({ level: L, egoAt: 650, speed: kmh(60), lead: null, zone: 300 });
    const st = sc.st;
    let minD = Infinity, crash = 0, aeb = 0, passed = false;
    for (let i = 0; i < 60 * 40; i++) {
      sc.update(dt);
      minD = Math.min(minD, st.egoD);
      for (const ev of st.events) { if (ev === 'crash') crash++; if (ev === 'aeb') aeb++; }
      st.events.length = 0;
      if (st.zone && st.egoS > st.zone.s1 + 20) passed = true;
    }
    R['zone' + L] = { minD: +minD.toFixed(2), crash, aeb, passed, endD: +st.egoD.toFixed(2) };
  }

  // 7. rebase: posisi di jalan tetap kontinu
  {
    const sc = m.createScene();
    sc.applyPreset({ level: 5, egoAt: 1250, speed: kmh(60), lead: null });
    const st = sc.st;
    let jumps = 0, rebased = 0, prevS = st.egoS, maxErr = 0;
    for (let i = 0; i < 60 * 20; i++) {
      sc.update(dt);
      const ds = st.egoS - prevS;
      if (ds < -1000) rebased++;
      else if (Math.abs(ds - sc.ego.speed * dt) > 0.05) jumps++;
      prevS = st.egoS;
      maxErr = Math.max(maxErr, Math.abs(st.egoD - 1.75));
      st.events.length = 0;
    }
    R.rebase = { rebased, jumps, maxLaneErr: +maxErr.toFixed(3) };
  }
  return R;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
    out = page.evaluate(JS)
    out["errors"] = errors
    print(json.dumps(out, indent=1))
    browser.close()
