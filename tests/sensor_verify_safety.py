"""QA independen aturan keselamatan pelajaran Sensor.

Bagian A (model di browser): js/lessons/sensor/scene.js dijalankan langsung dengan langkah tetap 1/60 detik.
Pemeriksa di sini ditulis ulang dari nol (tidak memakai safety.js): kotak kendaraan lawan lingkaran pejalan
kaki, dan bemper depan yang melewati garis henti saat lampunya merah (garis diturunkan sendiri dari
ukuran di street.js). Serangan: tahan Maju terus, maju mundur acak, cuaca berganti terus, lalu lintas padat,
pejalan kaki boleh mulai kapan saja, perencana kendaraan latar yang buta, mobil otonom yang boleh masuk
persimpangan pada 30 km/jam, dan lampu yang dipaksa melompat (offset siklus diacak, tanpa kuning).

Bagian B (UI): 2x, tahan Maju dan panah atas sambil mengganti cuaca, tahan Mundur, tekan bergantian cepat,
jeda di tengah pengereman, Ulangi lalu tahan lagi.

Pemakaian: python3 tests/sensor_verify_safety.py [detik_per_skenario] [--mobile] [--skip-ui] [--skip-model] [--only=a,b]
(port 8262)
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sensor_verify_util import BASE, SHOTS, launch, new_page, open_lesson, go_step, weather, sim_speed, hold, safety, ego_s  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SIM = float(args[0]) if args else 300
MOBILE = "--mobile" in sys.argv

MODEL = r"""
async ({ sim, sc }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { createScene } = await import('/js/lessons/sensor/scene.js');
  const ST = await import('/js/lessons/sensor/street.js');
  const map = await loadMap('machung');
  const scene = createScene(map, sc.opts || {});
  const F = scene.frame;
  const H = F.headings;
  const dt = 1 / 60;
  let seed = sc.seed || 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  // garis henti versi pemeriksa (dari ukuran street.js, bukan dari scene.stopLines)
  const lines = [
    { id: 'E', light: scene.lights['lampu'], axis: 's', at: ST.STOP_EAST, dir: +1, lo: -0.3, hi: ST.ROAD_HALF + 0.3, head: H.east, span: 'd' },
    { id: 'N', light: scene.lights['lampu-utara'], axis: 'd', at: ST.STOP_NORTH, dir: -1, lo: ST.nArmS(ST.STOP_NORTH) - 0.3, hi: ST.nArmS(ST.STOP_NORTH) + ST.N_ARM.half + 0.3, head: H.south, span: 's' },
    { id: 'S', light: scene.lights['lampu-selatan'], axis: 'd', at: ST.STOP_SOUTH, dir: +1, lo: ST.S_ARM.s - ST.S_ARM.half - 0.3, hi: ST.S_ARM.s + 0.3, head: H.north, span: 's' },
  ];
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const obbCircle = (v, p) => {
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const dx = p.x - v.x, dy = p.y - v.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const qx = Math.max(0, Math.abs(lx) - v.length / 2), qy = Math.max(0, Math.abs(ly) - v.width / 2);
    return Math.hypot(qx, qy) - p.radius;
  };
  const corners = (v) => { const c = Math.cos(v.heading), s = Math.sin(v.heading); const L = v.length / 2, W = v.width / 2;
    return [[L, W], [L, -W], [-L, -W], [-L, W]].map(([a, b]) => ({ x: v.x + a * c - b * s, y: v.y + a * s + b * c })); };
  const sat = (A, B) => { const pa = corners(A), pb = corners(B);
    for (const h of [A.heading, A.heading + Math.PI / 2, B.heading, B.heading + Math.PI / 2]) {
      const ax = Math.cos(h), ay = Math.sin(h);
      const pr = (ps) => ps.map((q) => q.x * ax + q.y * ay);
      const a = pr(pa), b = pr(pb);
      if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return false;
    }
    return true; };
  const parked = scene.objects.find((o) => o.id === 'angkot-ngetem');
  const prev = new Map();
  const R = { redRuns: 0, pedContacts: 0, vehCollisions: 0, minPedGap: Infinity, maxSpeed: 0, egoMaxFront: -Infinity, events: [], ticks: 0,
              pedCrossings: 0, redTicksAtLine: 0 };
  const touching = new Set(); const crashing = new Set();
  let t = 0;
  let nextDrive = 0, nextWx = 0, nextJump = sc.jumpEvery || Infinity;
  const WX = ['cerah', 'hujan', 'kabut', 'malam'];
  let pedState = scene.peds.map((p) => p.state);
  const n = Math.round(sim / dt);
  for (let k = 0; k < n; k++) {
    // serangan pengemudi
    if (sc.drive === 'hold') { scene.drive.forward = true; scene.drive.back = false; }
    else if (sc.drive === 'random' && t >= nextDrive) {
      const r = rnd(); scene.drive.forward = r < 0.55; scene.drive.back = r >= 0.55 && r < 0.85; nextDrive = t + 0.2 + rnd() * 3;
    } else if (sc.drive === 'mash' && t >= nextDrive) {
      scene.drive.forward = !scene.drive.forward; scene.drive.back = !scene.drive.forward; nextDrive = t + 0.15;
    }
    if (sc.weather && t >= nextWx) { scene.setWeather(WX[Math.floor(rnd() * 4)]); nextWx = t + (sc.weather === 'fast' ? 1 : 5); }
    if (t >= nextJump) { scene.plan.offset = rnd() * scene.plan.cycle; nextJump = t + sc.jumpEvery * (0.5 + rnd()); }
    scene.update(dt, t);
    t += dt;
    R.ticks++;
    const vehicles = [scene.ego, parked, ...scene.npcs.filter((a) => a.active)];
    // pejalan kaki
    scene.peds.forEach((p, i) => { if (pedState[i] !== 'walk' && p.state === 'walk') R.pedCrossings++; pedState[i] = p.state; });
    for (const v of vehicles) {
      R.maxSpeed = Math.max(R.maxSpeed, Math.abs(v.speed || 0));
      for (const p of scene.peds) {
        const g = obbCircle(v, p);
        if (g < R.minPedGap) R.minPedGap = g;
        const key = v.id + '|' + p.id;
        if (g <= 0) { if (!touching.has(key)) { touching.add(key); R.pedContacts++; if (R.events.length < 20) R.events.push({ t: +t.toFixed(2), type: 'kontak', v: v.id, p: p.id }); } }
        else touching.delete(key);
      }
    }
    // tabrakan kendaraan
    for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
      const key = vehicles[i].id + '|' + vehicles[j].id;
      if (sat(vehicles[i], vehicles[j])) { if (!crashing.has(key)) { crashing.add(key); R.vehCollisions++; if (R.events.length < 20) R.events.push({ t: +t.toFixed(2), type: 'tabrakan', a: vehicles[i].id, b: vehicles[j].id }); } }
      else crashing.delete(key);
    }
    // lampu merah
    for (const v of vehicles) {
      if (v === parked) continue;
      const fx = v.x + Math.cos(v.heading) * v.length / 2, fy = v.y + Math.sin(v.heading) * v.length / 2;
      const f = F.toFrame(fx, fy);
      if (v === scene.ego) R.egoMaxFront = Math.max(R.egoMaxFront, f.s);
      for (const L of lines) {
        const key = v.id + '|' + L.id;
        const along = (f[L.axis] - L.at) * L.dir; // > 0 = sudah lewat garis
        const lat = f[L.span];
        const ok = lat >= L.lo && lat <= L.hi && angDiff(v.heading, L.head) < 0.9;
        const p0 = prev.get(key);
        if (ok && p0 != null && p0 <= 0 && along > 0 && L.light.state === 'red') {
          R.redRuns++; if (R.events.length < 20) R.events.push({ t: +t.toFixed(2), type: 'merah', v: v.id, line: L.id, speed: +v.speed.toFixed(2) });
        }
        prev.set(key, ok ? along : null);
      }
    }
  }
  const snap = scene.safety.snapshot();
  return { name: sc.name, simSeconds: sim, checker: { ...R, minPedGap: +R.minPedGap.toFixed(3), maxSpeed: +R.maxSpeed.toFixed(2), egoMaxFront: +R.egoMaxFront.toFixed(2) },
           monitor: { redRuns: snap.redRuns, pedContacts: snap.pedContacts, otherCollisions: snap.otherCollisions, clamps: snap.clamps, interventions: snap.interventions },
           yellow: scene.plan.yellow, allRed: scene.plan.allRed };
}
"""

SCENARIOS = [
    {"name": "tahan-maju", "drive": "hold"},
    {"name": "acak-cuaca", "drive": "random", "weather": "slow", "seed": 11},
    {"name": "tekan-cepat-cuaca-cepat", "drive": "mash", "weather": "fast", "seed": 3},
    {"name": "padat-12-pejalan-kapan-saja", "drive": "random", "weather": "slow", "opts": {"extraTraffic": 12, "pedAnytime": True}, "seed": 5},
    {"name": "perencana-buta-padat", "drive": "random", "weather": "fast", "opts": {"plannerBlind": True, "extraTraffic": 8, "pedAnytime": True}, "seed": 9},
    {"name": "ego-masuk-simpang-30kmj-buta", "drive": "hold", "weather": "slow", "opts": {"plannerBlind": True, "egoLimit": 1e9, "egoSpeed": 8.3, "pedAnytime": True, "extraTraffic": 4}, "seed": 13},
    {"name": "lampu-melompat", "drive": "random", "weather": "slow", "jumpEvery": 7, "opts": {"extraTraffic": 6}, "seed": 17},
    {"name": "lampu-melompat-buta", "drive": "hold", "weather": "fast", "jumpEvery": 5, "opts": {"plannerBlind": True, "extraTraffic": 8, "pedAnytime": True, "egoLimit": 1e9, "egoSpeed": 8.3}, "seed": 19},
]

out = {"model": [], "ui": None}
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=MOBILE)
    page.goto(BASE + "tests/sensor_mapview.html")
    only = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")), None)
    for sc in SCENARIOS:
        if "--skip-model" in sys.argv:
            break
        if only and sc["name"] not in only:
            continue
        t0 = time.time()
        r = page.evaluate(MODEL, {"sim": SIM, "sc": sc})
        r["wall"] = round(time.time() - t0, 1)
        c, m = r["checker"], r["monitor"]
        print(json.dumps(r, ensure_ascii=False))
        out["model"].append(r)

    if "--skip-ui" not in sys.argv:
        open_lesson(page)
        go_step(page, 5)
        sim_speed(page, "2x")
        fwd = page.locator(".btn-hold", has_text="Maju").first
        back = page.locator(".btn-hold", has_text="Mundur").first
        fwd.scroll_into_view_if_needed()
        maxfront = -1e9
        for w in ["Hujan", "Kabut", "Malam", "Cerah", "Hujan"]:
            hold(page, fwd, 5000, mobile=MOBILE)
            maxfront = max(maxfront, ego_s(page)["front"])
            weather(page, w)
        page.locator("body").click(position={"x": 5, "y": 5}) if not MOBILE else None
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(8000)
        maxfront = max(maxfront, ego_s(page)["front"])
        page.keyboard.up("ArrowUp")
        hold(page, back, 15000, mobile=MOBILE)
        e_back = ego_s(page)
        for k in range(40):
            hold(page, fwd if k % 2 == 0 else back, 120, mobile=MOBILE)
        hold(page, fwd, 4000, mobile=MOBILE)
        # jeda di tengah pengereman lalu lanjut
        page.locator("[data-act=pause]").click()
        page.wait_for_timeout(500)
        page.locator("[data-act=pause]").click()
        page.locator("[data-act=reset]").click()
        page.wait_for_timeout(300)
        hold(page, fwd, 20000, mobile=MOBILE)
        maxfront = max(maxfront, ego_s(page)["front"])
        s = safety(page)
        page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}safety-{'m' if MOBILE else 'd'}-ujung.png")
        out["ui"] = {"safety": s, "egoMaxFront": round(maxfront, 2), "afterBack": e_back, "errors": log}
        print(json.dumps(out["ui"], ensure_ascii=False))
    b.close()

bad = [r["name"] for r in out["model"] if r["checker"]["redRuns"] or r["checker"]["pedContacts"] or r["monitor"]["redRuns"] or r["monitor"]["pedContacts"]]
ui_bad = out["ui"] and (out["ui"]["safety"]["redRuns"] or out["ui"]["safety"]["pedContacts"] or out["ui"]["egoMaxFront"] > 73.8 or out["ui"]["errors"])
print("PELANGGARAN:", bad, "UI:", bool(ui_bad))
sys.exit(1 if bad or ui_bad else 0)
