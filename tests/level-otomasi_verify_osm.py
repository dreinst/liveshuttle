"""Pemeriksaan independen data peta pelajaran Level Otomasi terhadap OSM mentah.

Membaca js/lessons/level-otomasi/data/trip.js dan data/osm/malang_roads_raw.json (tag asli), lalu:
- mencocokkan tiap titik sampel rute (setiap 4 m) dengan ruas jalan OSM terdekat;
- memeriksa arah jalan satu arah (oneway=yes / -1) terhadap arah perjalanan;
- membandingkan nama jalan di data pelajaran dengan tag name OSM;
- memeriksa poligon Villa Puncak Tidar (way 1377423415) dan titik keluar ODD;
- memeriksa titik tujuan dekat Alun-alun Merdeka di data OSM.

Pemakaian: python3 tests/level-otomasi_verify_osm.py
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def check(ok, msg):
    print(("OK   " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


src = open(os.path.join(ROOT, "js/lessons/level-otomasi/data/trip.js"), encoding="utf-8").read()
TRIP = json.loads(re.search(r"Object\.freeze\((\{.*\})\);", src, re.S).group(1))
roads = json.load(open(os.path.join(ROOT, "js/data/malang-roads.json"), encoding="utf-8"))
proj = roads["meta"]["projection"]
lat0, lon0, mlat, mlon = proj["lat0"], proj["lon0"], proj["mPerDegLat"], proj["mPerDegLon"]


def P(n):
    return ((n["lon"] - lon0) * mlon, (lat0 - n["lat"]) * mlat)


raw = json.load(open(os.path.join(ROOT, "data/osm/malang_roads_raw.json"), encoding="utf-8"))
nodes = {e["id"]: e for e in raw["elements"] if e["type"] == "node"}
DRIVE = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
         "unclassified", "residential", "living_street", "service", "road"}
segs = []  # (ax, ay, bx, by, way)
for e in raw["elements"]:
    if e["type"] != "way":
        continue
    hw = e.get("tags", {}).get("highway")
    if hw not in DRIVE:
        continue
    pts = [P(nodes[n]) for n in e["nodes"] if n in nodes]
    for i in range(len(pts) - 1):
        segs.append((pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], e))

# grid index
CELL = 50
grid = {}
for k, (ax, ay, bx, by, _) in enumerate(segs):
    for gx in range(int(math.floor(min(ax, bx) / CELL)), int(math.floor(max(ax, bx) / CELL)) + 1):
        for gy in range(int(math.floor(min(ay, by) / CELL)), int(math.floor(max(ay, by) / CELL)) + 1):
            grid.setdefault((gx, gy), []).append(k)


def nearest(x, y, hx, hy):
    best = None
    gx, gy = int(math.floor(x / CELL)), int(math.floor(y / CELL))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for k in grid.get((gx + dx, gy + dy), []):
                ax, ay, bx, by, w = segs[k]
                vx, vy = bx - ax, by - ay
                L2 = vx * vx + vy * vy
                t = 0 if L2 == 0 else max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / L2))
                d = math.hypot(ax + t * vx - x, ay + t * vy - y)
                L = math.sqrt(L2) or 1
                align = (vx * hx + vy * hy) / L
                # utamakan ruas yang searah garis rute (menghindari ruas melintang di simpang)
                score = d + (0 if abs(align) > 0.8 else 8)
                if best is None or score < best[0]:
                    best = (score, d, align, w)
    return best


route = TRIP["route"]
cum = [0.0]
for i in range(1, len(route)):
    cum.append(cum[-1] + math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]))
K = cum[-1] / TRIP["length"]
print(f"route vertices {len(route)}, polyline {cum[-1]:.0f} m, stated length {TRIP['length']} m")


def at(u):
    i = 1
    while i < len(cum) - 1 and cum[i] < u:
        i += 1
    a, b = route[i - 1], route[i]
    f = (u - cum[i - 1]) / max(1e-9, cum[i] - cum[i - 1])
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, (b[0] - a[0]) / L, (b[1] - a[1]) / L


wrong_way = []
far = []
names_by_t = []
u = 2.0
while u < cum[-1] - 2:
    x, y, hx, hy = at(u)
    nb = nearest(x, y, hx, hy)
    t = u / K
    if nb is None or nb[1] > 6:
        far.append((round(t), None if nb is None else round(nb[1], 1)))
    else:
        _, d, align, w = nb
        tags = w.get("tags", {})
        ow = tags.get("oneway")
        if tags.get("junction") == "roundabout" and ow is None:
            ow = "yes"
        if (ow == "yes" and align < -0.5) or (ow == "-1" and align > 0.5):
            wrong_way.append((round(t), tags.get("name"), w["id"], ow, round(align, 2)))
        names_by_t.append((t, tags.get("name", ""), tags.get("highway")))
    u += 4.0

check(not far, f"every route sample lies within 6 m of an OSM drivable way (far samples: {far[:8]})")
check(not wrong_way, f"no route sample travels against a oneway way (hits: {wrong_way[:8]})")

# nama jalan: bandingkan data pelajaran dengan tag OSM di tengah tiap ruas bernama
for s in TRIP["streets"]:
    if not s["name"]:
        continue
    mids = [n for (t, n, h) in names_by_t if s["from"] + 10 < t < s["to"] - 10]
    if not mids:
        mids = [n for (t, n, h) in names_by_t if s["from"] <= t <= s["to"]]
    share = sum(1 for n in mids if n == s["name"]) / max(1, len(mids))
    check(share >= 0.6, f"street '{s['name']}' {s['from']:.0f}..{s['to']:.0f} m matches OSM name tag in {share:.0%} of samples")

# ODD: poligon Villa Puncak Tidar
mraw = json.load(open(os.path.join(ROOT, "data/osm/machung_raw.json"), encoding="utf-8"))
mnodes = {e["id"]: e for e in mraw["elements"] if e["type"] == "node"}
way = next(e for e in mraw["elements"] if e["type"] == "way" and e["id"] == 1377423415)
print("VPT way tags:", way.get("tags"))
check(way.get("tags", {}).get("name") == "Villa Puncak Tidar", "way 1377423415 is named Villa Puncak Tidar in OSM")
vpt = [P(mnodes[n]) for n in way["nodes"]]
lesson_v = TRIP["villa"]["points"]
print(f"villa polygon: {len(lesson_v)} vertices in lesson data, {len(vpt) - 1} OSM nodes (simplified)")


def seg_dist(px, py, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vy * vy
    t = 0 if L2 == 0 else max(0, min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / L2))
    return math.hypot(a[0] + t * vx - px, a[1] + t * vy - py)


simp = max(min(seg_dist(x, y, lesson_v[i], lesson_v[(i + 1) % len(lesson_v)]) for i in range(len(lesson_v))) for (x, y) in vpt)
check(simp < 3, f"dropped OSM nodes lie within {simp:.2f} m of the simplified villa outline")
maxdev = 0
for (x, y) in lesson_v:
    maxdev = max(maxdev, min(math.hypot(x - a, y - b) for (a, b) in vpt))
check(maxdev < 1.5, f"villa polygon vertices match OSM nodes (max deviation {maxdev:.2f} m)")


def inside(x, y, pts):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


campus = TRIP["campus"]["points"]
# titik keluar: rute di jarak oddExit harus ada di tepi (sedikit sebelum di dalam, sedikit sesudah di luar)
ex = TRIP["oddExit"]
xa, ya, _, _ = at((ex - 8) * K)
xb, yb, _, _ = at((ex + 8) * K)
in_a = inside(xa, ya, vpt) or inside(xa, ya, campus)
in_b = inside(xb, yb, vpt) or inside(xb, yb, campus)
check(in_a and not in_b, f"route is inside the ODD 8 m before oddExit ({in_a}) and outside 8 m after ({in_b})")
# setelah oddExit rute tidak masuk lagi ke ODD
back_in = []
u = (ex + 10) * K
while u < cum[-1]:
    x, y, _, _ = at(u)
    if inside(x, y, vpt) or inside(x, y, campus):
        back_in.append(round(u / K))
    u += 10
check(not back_in, f"route never re-enters the ODD after oddExit (samples inside: {back_in[:6]})")
# jalan tempat oddExit berada
st = [s for s in TRIP["streets"] if s["from"] <= ex <= s["to"]]
print("street at oddExit:", st)
# awal rute di dalam kampus atau dekat
sx, sy = route[0]
check(inside(sx, sy, campus) or min(math.hypot(sx - a, sy - b) for a, b in campus) < 60, f"route starts at/inside the Ma Chung campus ({sx}, {sy})")

# tujuan: Alun-alun Merdeka di OSM (malang_center_raw)
craw = json.load(open(os.path.join(ROOT, "data/osm/malang_center_raw.json"), encoding="utf-8"))
cands = []
for e in craw["elements"]:
    n = e.get("tags", {}).get("name", "")
    if "alun" in n.lower():
        cands.append((e["type"], e["id"], n, e.get("tags", {}).get("leisure") or e.get("tags", {}).get("place")))
print("alun-alun candidates:", cands[:10])
cnodes = {e["id"]: e for e in craw["elements"] if e["type"] == "node"}
gx, gy = route[-1]
best = None
for e in craw["elements"]:
    n = e.get("tags", {}).get("name", "")
    if n.lower().startswith("alun-alun merdeka") or n.lower() == "alun-alun kota malang" or n.lower() == "alun-alun malang":
        if e["type"] == "way":
            pts = [P(cnodes[k]) for k in e["nodes"] if k in cnodes]
            if not pts:
                continue
            d = min(math.hypot(gx - a, gy - b) for a, b in pts)
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            best = (d, n, e["id"], cx, cy) if best is None or d < best[0] else best
        elif e["type"] == "node":
            x, y = P(e)
            d = math.hypot(gx - x, gy - y)
            best = (d, n, e["id"], x, y) if best is None or d < best[0] else best
print("goal", (gx, gy), "nearest Alun-alun feature:", best)
check(best is not None and best[0] < 120, "route ends within 120 m of the Alun-alun Merdeka feature in OSM")

print()
print("FAILS:", len(fails))
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
