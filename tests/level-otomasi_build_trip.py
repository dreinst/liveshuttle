"""Bangun data perjalanan pelajaran Level Otomasi: js/lessons/level-otomasi/data/trip.js.

Isi file hasil:
- rute nyata dari kampus Universitas Ma Chung ke Alun-alun Merdeka (RoadGraph di atas
  js/data/malang-roads.json, biaya waktu, arah jalan satu arah dihormati);
- nama jalan di sepanjang rute beserta jaraknya dari awal rute;
- poligon area operasi (ODD) level 4 di pelajaran ini: kampus Ma Chung (js/data/machung-2d.json) dan
  kawasan Villa Puncak Tidar (way 1377423415, landuse=residential di data/osm/machung_raw.json);
- jarak di rute tempat rute keluar dari area itu (batas ODD).

Semua koordinat memakai proyeksi lokal file machung/malang-roads (x timur, y selatan, meter).
Sumber data: © Kontributor OpenStreetMap (ODbL), diambil 28 September 2026.

Pemakaian: python3 tests/level-otomasi_build_trip.py [--check]
Butuh node (skrip ESM dijalankan dengan node --input-type=module).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "js/lessons/level-otomasi/data/trip.js")
VPT_WAY = 1377423415

NODE_JS = r"""
import { parseMap } from '__ROOT__/js/engine/osm2d.js';
import fs from 'fs';
const R = parseMap(JSON.parse(fs.readFileSync('__ROOT__/js/data/malang-roads.json', 'utf8')));
const M = parseMap(JSON.parse(fs.readFileSync('__ROOT__/js/data/machung-2d.json', 'utf8')));
const g = R.graph({ cost: 'time' });
const start = g.nearestNode(M.campus.x, M.campus.y);
const goal = g.nearestNode(4562, 2801);
const res = g.findRoute(start.id, goal.id);
const rr = g.routeRoads(res.path);
// titik rute mentah per ruas, dengan nama dan kelas ruas
const segs = rr.map((e) => {
  const pts = e.forward ? e.road.points : [...e.road.points].reverse();
  return { name: e.road.name || '', cls: e.road.cls, classLabel: e.road.classLabel, pts: pts.map((p) => [p.x, p.y]) };
});
const villa = M.places.find((p) => p.name === 'Villa Puncak Tidar');
process.stdout.write(JSON.stringify({
  start: { x: start.node.x, y: start.node.y },
  goal: { x: goal.node.x, y: goal.node.y },
  cost: res.cost,
  expanded: res.expanded,
  graphLength: g.routeLength(res.path),
  segs,
  campus: { name: M.campus.name, x: M.campus.x, y: M.campus.y, points: M.campus.points.map((p) => [p.x, p.y]) },
  villa: villa ? { name: villa.name, x: villa.x, y: villa.y } : null,
  projection: R.projection,
}));
"""


def node_data():
    js = NODE_JS.replace("__ROOT__", ROOT)
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def vpt_polygon(proj):
    raw = json.load(open(os.path.join(ROOT, "data/osm/machung_raw.json"), encoding="utf-8"))
    nodes = {e["id"]: e for e in raw["elements"] if e["type"] == "node"}
    way = next(e for e in raw["elements"] if e["type"] == "way" and e["id"] == VPT_WAY)
    lat0, lon0 = proj["lat0"], proj["lon0"]
    mlat, mlon = proj["mPerDegLat"], proj["mPerDegLon"]
    pts = []
    for nid in way["nodes"]:
        n = nodes[nid]
        pts.append(((n["lon"] - lon0) * mlon, (lat0 - n["lat"]) * mlat))
    if pts[0] == pts[-1]:
        pts.pop()
    return pts


def signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def point_in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dp_simplify(pts, tol):
    """Douglas-Peucker untuk polyline (titik awal dan akhir dipertahankan)."""
    if len(pts) < 3:
        return pts[:]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def main():
    d = node_data()
    proj = d["projection"]
    vpt = vpt_polygon(proj)
    campus = [tuple(p) for p in d["campus"]["points"]]
    # samakan arah putaran kedua poligon supaya isian gabungan (nonzero) tidak berlubang
    if signed_area(vpt) < 0:
        vpt.reverse()
    if signed_area(campus) < 0:
        campus.reverse()

    # rute: gabungkan titik semua ruas, catat jarak awal tiap ruas
    route = []
    streets = []
    acc = 0.0
    for seg in d["segs"]:
        pts = [tuple(p) for p in seg["pts"]]
        if route and route[-1] == pts[0]:
            pts = pts[1:]
        start_acc = acc
        for p in pts:
            if route:
                acc += ((p[0] - route[-1][0]) ** 2 + (p[1] - route[-1][1]) ** 2) ** 0.5
            route.append(p)
        name = seg["name"]
        if streets and streets[-1]["name"] == name and streets[-1]["cls"] == seg["cls"]:
            streets[-1]["to"] = acc
        else:
            streets.append({"from": start_acc, "to": acc, "name": name, "cls": seg["cls"], "classLabel": seg["classLabel"]})
    total = acc

    # jarak tiap titik rute
    cum = [0.0]
    for i in range(1, len(route)):
        cum.append(cum[-1] + ((route[i][0] - route[i - 1][0]) ** 2 + (route[i][1] - route[i - 1][1]) ** 2) ** 0.5)

    def at(s):
        for i in range(1, len(route)):
            if cum[i] >= s:
                t = (s - cum[i - 1]) / max(1e-9, cum[i] - cum[i - 1])
                return (route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t)
        return route[-1]

    def in_odd(p):
        return point_in_poly(p[0], p[1], vpt) or point_in_poly(p[0], p[1], campus)

    # batas ODD: titik terakhir rute yang masih di dalam area (sampel tiap 0,5 m)
    s = 0.0
    last_inside = None
    while s <= total:
        if in_odd(at(s)):
            last_inside = s
        s += 0.5
    odd_exit = last_inside
    assert odd_exit is not None and odd_exit > 100, "rute tidak keluar dari area ODD"
    exit_pt = at(odd_exit)

    route_s = dp_simplify(route, 1.0)
    vpt_s = dp_simplify(vpt + [vpt[0]], 1.5)[:-1]

    def r1(v):
        return round(v, 1)

    xs = [p[0] for p in route_s] + [p[0] for p in vpt_s]
    ys = [p[1] for p in route_s] + [p[1] for p in vpt_s]
    info = {
        "length": round(total, 1),
        "graphLength": round(d["graphLength"], 1),
        "oddExit": round(odd_exit, 1),
        "exitPoint": [r1(exit_pt[0]), r1(exit_pt[1])],
        "routePoints": len(route_s),
        "vptPoints": len(vpt_s),
        "expanded": d["expanded"],
        "streets": [(round(st["from"]), st["name"] or "(" + st["classLabel"] + ")") for st in streets],
    }
    print(json.dumps(info, indent=1, ensure_ascii=False))
    if "--check" in sys.argv:
        return

    trip = {
        "source": "© Kontributor OpenStreetMap (ODbL), diambil 28 September 2026",
        "length": round(total, 1),
        "oddExit": round(odd_exit, 1),
        "exitPoint": [r1(exit_pt[0]), r1(exit_pt[1])],
        "start": {"name": "Universitas Ma Chung", "x": r1(route[0][0]), "y": r1(route[0][1])},
        "goal": {"name": "Alun-alun Merdeka", "x": r1(route[-1][0]), "y": r1(route[-1][1])},
        "campus": {"name": d["campus"]["name"], "x": r1(d["campus"]["x"]), "y": r1(d["campus"]["y"]), "points": [[r1(x), r1(y)] for x, y in campus]},
        "villa": {"name": "Villa Puncak Tidar", "x": r1(d["villa"]["x"]), "y": r1(d["villa"]["y"]), "points": [[r1(x), r1(y)] for x, y in vpt_s]},
        "route": [[r1(x), r1(y)] for x, y in route_s],
        "streets": [{"from": round(st["from"], 1), "to": round(st["to"], 1), "name": st["name"], "cls": st["cls"], "classLabel": st["classLabel"]} for st in streets],
        "bounds": {"minX": round(min(xs)), "minY": round(min(ys)), "maxX": round(max(xs)), "maxY": round(max(ys))},
    }
    body = json.dumps(trip, ensure_ascii=False, separators=(",", ":"))
    header = (
        "// Data perjalanan pelajaran Level Otomasi. Dibuat oleh tests/level-otomasi_build_trip.py, jangan diedit manual.\n"
        "// Rute nyata kampus Universitas Ma Chung ke Alun-alun Merdeka (RoadGraph, biaya waktu) di atas\n"
        "// js/data/malang-roads.json, poligon kampus dari js/data/machung-2d.json, dan poligon kawasan Villa Puncak Tidar\n"
        "// (landuse=residential) dari data/osm/machung_raw.json. Koordinat dalam meter, proyeksi lokal file machung\n"
        "// (x timur, y selatan). Sumber: © Kontributor OpenStreetMap (ODbL), diambil 28 September 2026.\n"
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.write("export const TRIP = Object.freeze(" + body + ");\n")
    print("ditulis:", os.path.relpath(OUT, ROOT), os.path.getsize(OUT), "byte")


if __name__ == "__main__":
    main()
