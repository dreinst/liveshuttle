#!/usr/bin/env python3
"""Ubah data mentah OpenStreetMap (JSON Overpass) menjadi berkas ringkas untuk pelajaran 2D.

Pemakaian (dari akar proyek):
  python3 tools/osm_to_2d.py            # tulis ketiga berkas ke js/data/
  python3 tools/osm_to_2d.py --check    # hanya hitung dan cetak ringkasan

Masukan (data/osm/, ODbL, diambil 28 September 2026):
  machung_raw.json       sekitar Universitas Ma Chung
  malang_roads_raw.json  jaringan jalan Malang dari Ma Chung sampai pusat kota
  malang_center_raw.json sekitar Alun-alun Merdeka Malang

Keluaran (js/data/, dibaca oleh js/engine/osm2d.js):
  machung-2d.json     jalan (kelas, satu arah, nama, perkiraan lebar), bundaran, gedung,
                      area hijau, air, poligon kampus, nama tempat, graf rute. Ditambah jalan
                      penyambung dari malang_roads_raw.json di tepi area supaya jaringan utara
                      dan selatan kampus tersambung (lihat add_connectors)
  malang-roads.json   graf rute jaringan jalan Malang (simpang, ruas, panjang, kelas, satu arah,
                      nama, perkiraan kecepatan per kelas, geometri yang disederhanakan) dan
                      69 posisi lampu lalu lintas asli
  malang-center.json  jalan, gedung dengan perkiraan tinggi, lampu lalu lintas dan
                      penyeberangan asli, nama tempat

Proyeksi: ekuirektangular lokal di sekitar titik asal (lat0, lon0) tiap berkas.
  x = (lon - lon0) * mPerDegLon      (ke timur positif)
  y = (lat0 - lat) * mPerDegLat      (ke selatan positif, sama dengan konvensi layar engine)
mPerDegLat dan mPerDegLon dihitung dari rumus deret WGS84 pada lat0. Galat di area sebesar
ini (sekitar 7 km) di bawah 0,1 persen. machung-2d.json dan malang-roads.json memakai titik
asal yang sama (pusat kampus Ma Chung) sehingga bisa ditumpuk langsung.

Format kolom (lihat docs/ENGINE.md bagian osm2d): koordinat disimpan sebagai larik datar
[x0, y0, x1, y1, ...] dan atribut per objek disimpan per kolom supaya berkas kecil.
Lebar jalan, jumlah lajur, kecepatan, dan tinggi gedung sebagian besar PERKIRAAN dari kelas
jalan atau jenis gedung, karena tag OSM untuk itu jarang diisi. Flag per ruas mencatat nilai
mana yang benar-benar berasal dari tag OSM.
"""

import json
import math
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "osm")
OUT = os.path.join(ROOT, "js", "data")

ATTRIBUTION = "© Kontributor OpenStreetMap"
LICENSE = "ODbL 1.0 (opendatacommons.org/licenses/odbl)"
SOURCE = "OpenStreetMap lewat Overpass API, diambil 28 September 2026"

# ---------- kelas jalan ----------

# urutan = tingkat kepentingan (indeks kecil = jalan besar)
CLASSES = [
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "track",
    "pedestrian",
    "footway",
    "path",
    "steps",
    "cycleway",
]
DRIVABLE = {
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
}

# perkiraan lebar badan jalan (m) bila tag width dan lanes kosong
WIDTH_EST = {
    "trunk": 14.0,
    "trunk_link": 6.0,
    "primary": 10.0,
    "primary_link": 6.0,
    "secondary": 8.0,
    "secondary_link": 5.5,
    "tertiary": 7.0,
    "tertiary_link": 5.0,
    "unclassified": 5.5,
    "residential": 5.0,
    "living_street": 3.5,
    "service": 3.5,
    "track": 3.0,
    "pedestrian": 4.0,
    "footway": 2.0,
    "path": 1.6,
    "steps": 2.0,
    "cycleway": 2.0,
}
ONEWAY_WIDTH_EST = {
    "trunk": 8.0,
    "primary": 7.5,
    "secondary": 6.5,
    "tertiary": 6.0,
    "unclassified": 5.0,
    "residential": 5.0,
}

# perkiraan kecepatan rata-rata lalu lintas kota Malang (km/jam), bukan batas resmi
SPEED_KMH = {
    "trunk": 40,
    "trunk_link": 30,
    "primary": 35,
    "primary_link": 25,
    "secondary": 30,
    "secondary_link": 25,
    "tertiary": 25,
    "tertiary_link": 20,
    "unclassified": 20,
    "residential": 20,
    "living_street": 10,
    "service": 10,
    "track": 10,
    "pedestrian": 5,
    "footway": 5,
    "path": 5,
    "steps": 3,
    "cycleway": 12,
}

FLAG_ONEWAY = 1
FLAG_ROUNDABOUT = 2
FLAG_WIDTH_OSM = 4
FLAG_LANES_OSM = 8
FLAG_BRIDGE = 16
FLAG_MAXSPEED_OSM = 32

GREEN_KIND = {
    ("leisure", "park"): "park",
    ("leisure", "garden"): "park",
    ("leisure", "playground"): "park",
    ("landuse", "village_green"): "park",
    ("landuse", "recreation_ground"): "park",
    ("leisure", "pitch"): "pitch",
    ("leisure", "sports_centre"): "pitch",
    ("leisure", "golf_course"): "grass",
    ("landuse", "grass"): "grass",
    ("landuse", "flowerbed"): "grass",
    ("landuse", "meadow"): "grass",
    ("natural", "grassland"): "grass",
    ("natural", "wood"): "wood",
    ("landuse", "forest"): "wood",
    ("natural", "scrub"): "wood",
    ("landuse", "orchard"): "farm",
    ("landuse", "farmland"): "farm",
    ("landuse", "cemetery"): "cemetery",
}

PLACE_KEYS = ("amenity", "leisure", "landuse", "tourism", "shop", "office", "building", "railway", "historic")


# ---------- proyeksi ----------


def meters_per_degree(lat0):
    p = math.radians(lat0)
    m_lat = 111132.954 - 559.822 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
    m_lon = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p) + 0.118 * math.cos(5 * p)
    return m_lat, m_lon


class Projection:
    def __init__(self, lat0, lon0, precision):
        self.lat0 = lat0
        self.lon0 = lon0
        self.m_lat, self.m_lon = meters_per_degree(lat0)
        self.precision = precision  # 1 = 0,1 m, 0 = 1 m

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.m_lon, (self.lat0 - lat) * self.m_lat)

    def r(self, v):
        v = round(v, self.precision)
        if self.precision == 0:
            return int(v)
        return 0.0 if v == 0 else v

    def meta(self):
        return {
            "type": "equirectangular-local",
            "lat0": self.lat0,
            "lon0": self.lon0,
            "mPerDegLat": round(self.m_lat, 4),
            "mPerDegLon": round(self.m_lon, 4),
            "formula": "x = (lon - lon0) * mPerDegLon; y = (lat0 - lat) * mPerDegLat (y ke selatan)",
            "units": "meter",
            "precision": "0,1 m" if self.precision == 1 else "1 m",
        }


# ---------- geometri ----------


def dp_simplify(pts, tol):
    """Douglas-Peucker untuk daftar (x, y). Titik pertama dan terakhir selalu dipertahankan."""
    n = len(pts)
    if n <= 2 or tol <= 0:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        ax, ay = pts[i0]
        bx, by = pts[i1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / L2
                t = 0 if t < 0 else 1 if t > 1 else t
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, bi = d, i
        if best > tol and bi > 0:
            keep[bi] = True
            stack.append((i0, bi))
            stack.append((bi, i1))
    return [p for p, k in zip(pts, keep) if k]


def poly_length(pts):
    return sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))


def poly_area_centroid(pts):
    """Luas (m2, positif) dan titik berat poligon."""
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-9:
        mx = sum(p[0] for p in pts) / n
        my = sum(p[1] for p in pts) / n
        return 0.0, (mx, my)
    a *= 0.5
    return abs(a), (cx / (6 * a), cy / (6 * a))


def parse_float(v):
    if v is None:
        return None
    try:
        s = str(v).strip().lower().replace(",", ".").replace("m", "").strip()
        return float(s.split(";")[0])
    except ValueError:
        return None


# ---------- memuat data mentah ----------


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        data = json.load(f)
    nodes = {}
    ways = []
    for e in data["elements"]:
        if e["type"] == "node":
            # Overpass bisa mengirim node yang sama dua kali (sekali dengan tag, sekali tanpa)
            old = nodes.get(e["id"])
            if old and old.get("tags") and not e.get("tags"):
                continue
            nodes[e["id"]] = e
        elif e["type"] == "way":
            ways.append(e)
    return nodes, ways


class Strings:
    """Tabel string (indeks 0 = kosong)."""

    def __init__(self):
        self.items = [""]
        self.index = {"": 0}

    def get(self, s):
        s = s or ""
        if s not in self.index:
            self.index[s] = len(self.items)
            self.items.append(s)
        return self.index[s]


# ---------- graf jalan ----------


def road_attrs(tags):
    cls = tags.get("highway")
    ow = tags.get("oneway")
    roundabout = tags.get("junction") in ("roundabout", "circular")
    oneway = 0
    if ow in ("yes", "true", "1"):
        oneway = 1
    elif ow == "-1":
        oneway = -1
    elif roundabout and ow != "no":
        oneway = 1
    lanes_tag = parse_float(tags.get("lanes"))
    width_tag = parse_float(tags.get("width"))
    flags = 0
    if lanes_tag and 1 <= lanes_tag <= 8:
        lanes = int(lanes_tag)
        flags |= FLAG_LANES_OSM
    else:
        lanes = None
    if width_tag and 1.5 <= width_tag <= 40:
        width = width_tag
        flags |= FLAG_WIDTH_OSM
    elif lanes:
        width = lanes * 3.25
    else:
        width = (ONEWAY_WIDTH_EST.get(cls) if oneway else None) or WIDTH_EST.get(cls, 4.0)
    if lanes is None:
        if cls in ("footway", "path", "steps", "cycleway", "pedestrian", "track"):
            lanes = 1
        elif oneway:
            lanes = 2 if width >= 7 else 1
        else:
            lanes = 4 if width >= 12 else 2
    maxspeed = parse_float(tags.get("maxspeed"))
    if maxspeed and 5 <= maxspeed <= 120:
        flags |= FLAG_MAXSPEED_OSM
    else:
        maxspeed = 0
    if roundabout:
        flags |= FLAG_ROUNDABOUT
    if oneway:
        flags |= FLAG_ONEWAY
    if tags.get("bridge") in ("yes", "viaduct"):
        flags |= FLAG_BRIDGE
    return cls, oneway, lanes, width, maxspeed, flags


def build_graph(nodes, ways, proj, names, classes, tol, keep_largest=False):
    """Pecah jalan di simpang menjadi ruas. Hasil: (node_ids, edges, way_count)."""
    road_ways = []
    for w in ways:
        t = w.get("tags", {})
        cls = t.get("highway")
        if cls not in classes:
            continue
        if t.get("area") == "yes":
            continue
        ids = [n for n in w["nodes"] if n in nodes]
        if len(ids) < 2:
            continue
        road_ways.append((w, ids))

    use = Counter()
    for w, ids in road_ways:
        for n in ids:
            use[n] += 1
    split = set()
    for w, ids in road_ways:
        split.add(ids[0])
        split.add(ids[-1])
        seen = set()
        for n in ids:
            if use[n] > 1 or n in seen:
                split.add(n)
            seen.add(n)
        if ids[0] == ids[-1] and len(ids) > 3:
            # jalan melingkar (bundaran) tanpa simpang di tengah: pecah di titik tengah
            inner = [i for i in range(1, len(ids) - 1) if ids[i] in split]
            if not inner:
                split.add(ids[len(ids) // 2])

    raw_edges = []
    for w, ids in road_ways:
        t = w["tags"]
        cls, oneway, lanes, width, maxspeed, flags = road_attrs(t)
        name = t.get("name") or t.get("ref") or ""
        start = 0
        for i in range(1, len(ids)):
            if ids[i] in split:
                seg = ids[start : i + 1]
                start = i
                if len(seg) < 2 or seg[0] == seg[-1] and len(seg) <= 2:
                    continue
                if oneway == -1:
                    seg = seg[::-1]
                pts = [proj.xy(nodes[n]["lat"], nodes[n]["lon"]) for n in seg]
                length = poly_length(pts)
                if length < 0.05:
                    continue
                raw_edges.append(
                    {
                        "a": seg[0],
                        "b": seg[-1],
                        "pts": pts,
                        "cls": cls,
                        "name": name,
                        "flags": flags,
                        "width": width,
                        "lanes": lanes,
                        "maxspeed": maxspeed,
                        "length": length,
                        "way": w["id"],
                        "ids": seg,
                    }
                )

    if keep_largest:
        parent = {}

        def find(x):
            while parent.get(x, x) != x:
                parent[x] = parent.get(parent[x], parent[x])
                x = parent[x]
            return x

        for e in raw_edges:
            ra, rb = find(e["a"]), find(e["b"])
            if ra != rb:
                parent[ra] = rb
        comp = Counter(find(e["a"]) for e in raw_edges)
        main = comp.most_common(1)[0][0]
        before = len(raw_edges)
        raw_edges = [e for e in raw_edges if find(e["a"]) == main]
        print(f"  komponen terbesar: {len(raw_edges)} dari {before} ruas", file=sys.stderr)

    node_index = {}
    node_ids = []
    for e in raw_edges:
        for k in ("a", "b"):
            if e[k] not in node_index:
                node_index[e[k]] = len(node_ids)
                node_ids.append(e[k])
    for e in raw_edges:
        e["ai"] = node_index[e["a"]]
        e["bi"] = node_index[e["b"]]
        e["simple"] = dp_simplify(e["pts"], tol)
    return node_ids, node_index, raw_edges, len(road_ways)


def pack_graph(nodes, node_ids, edges, proj, names, with_way=False):
    r = proj.r
    flat_nodes = []
    for nid in node_ids:
        x, y = proj.xy(nodes[nid]["lat"], nodes[nid]["lon"])
        flat_nodes += [r(x), r(y)]
    cols = {k: [] for k in ("a", "b", "cls", "name", "flags", "width", "lanes", "maxspeed", "length", "geomStart")}
    if with_way:
        cols["osm"] = []
    geom = []
    for e in edges:
        cols["a"].append(e["ai"])
        cols["b"].append(e["bi"])
        cols["cls"].append(CLASSES.index(e["cls"]))
        cols["name"].append(names.get(e["name"]))
        cols["flags"].append(e["flags"])
        cols["width"].append(round(e["width"], 1))
        cols["lanes"].append(e["lanes"])
        cols["maxspeed"].append(int(e["maxspeed"]))
        cols["length"].append(round(e["length"], 1))
        cols["geomStart"].append(len(geom) // 2)
        for x, y in e["simple"][1:-1]:
            geom += [r(x), r(y)]
        if with_way:
            cols["osm"].append(e["way"])
    cols["geomStart"].append(len(geom) // 2)
    return flat_nodes, cols, geom


# ---------- poligon (gedung, hijau, kampus) ----------


def way_polygon(w, nodes, proj, tol):
    ids = [n for n in w["nodes"] if n in nodes]
    if len(ids) < 4 or ids[0] != ids[-1]:
        return None
    pts = [proj.xy(nodes[n]["lat"], nodes[n]["lon"]) for n in ids[:-1]]
    simple = dp_simplify(pts + [pts[0]], tol)[:-1]
    if len(simple) < 3:
        simple = pts
    return pts, simple


def estimate_height(tags, area):
    """Tinggi gedung (m) dan sumbernya: 'osm' bila dari tag height/building:levels."""
    h = parse_float(tags.get("height"))
    if h and 2 <= h <= 200:
        return round(h, 1), "osm", None
    lv = parse_float(tags.get("building:levels"))
    if lv and 1 <= lv <= 60:
        return round(lv * 3.5 + (1.0 if lv >= 1 else 0), 1), "osm", int(lv)
    b = tags.get("building", "yes")
    by_type = {
        "house": 2,
        "residential": 2,
        "detached": 2,
        "shophouse": 3,
        "commercial": 3,
        "retail": 3,
        "office": 4,
        "hotel": 5,
        "school": 2,
        "university": 3,
        "hospital": 3,
        "government": 3,
        "village_office": 2,
        "train_station": 2,
        "industrial": 2,
        "warehouse": 2,
    }
    if tags.get("amenity") == "place_of_worship" or b in ("mosque", "church", "chapel", "temple", "cathedral"):
        return 12.0, "estimate", None
    if b in ("roof", "carport"):
        return 4.0, "estimate", 1
    if b == "ruins":
        return 3.0, "estimate", 1
    if tags.get("tourism") in ("hotel", "hostel"):
        levels = 5 if area > 600 else 3
    elif b in by_type:
        levels = by_type[b]
    elif area < 80:
        levels = 1
    elif area < 800:
        levels = 2
    elif area < 2500:
        levels = 3
    else:
        levels = 4
    return round(levels * 3.5 + 1.0, 1), "estimate", levels


def pack_polygons(items, proj):
    """items: daftar dict dengan 'pts' (sudah disederhanakan). Kembalikan (start, coords)."""
    r = proj.r
    start = []
    coords = []
    for it in items:
        start.append(len(coords) // 2)
        for x, y in it["pts"]:
            coords += [r(x), r(y)]
    start.append(len(coords) // 2)
    return start, coords


def place_kind(tags):
    for k in PLACE_KEYS:
        if k in tags:
            v = tags[k]
            if k == "building" and v == "yes":
                continue
            return f"{k}:{v}"
    return "building:yes" if "building" in tags else "lainnya"


# ---------- bangun tiap berkas ----------


def centroid_of_way(nodes, ways, pred, proj=None):
    for w in ways:
        if pred(w.get("tags", {})):
            ids = [n for n in w["nodes"] if n in nodes]
            lat = sum(nodes[n]["lat"] for n in ids[:-1]) / (len(ids) - 1)
            lon = sum(nodes[n]["lon"] for n in ids[:-1]) / (len(ids) - 1)
            return lat, lon
    raise SystemExit("titik asal tidak ditemukan")


def base_meta(file_id, title, raw_name, bbox, proj, extra=None):
    meta = {
        "format": "liveshuttle-osm2d/1",
        "id": file_id,
        "title": title,
        "attribution": ATTRIBUTION,
        "license": LICENSE,
        "source": SOURCE,
        "rawFile": f"data/osm/{raw_name}",
        "bboxLatLon": bbox,
        "projection": proj.meta(),
        "classes": CLASSES,
        "speedKmh": SPEED_KMH,
        "flagBits": {
            "oneway": FLAG_ONEWAY,
            "roundabout": FLAG_ROUNDABOUT,
            "widthFromOsm": FLAG_WIDTH_OSM,
            "lanesFromOsm": FLAG_LANES_OSM,
            "bridge": FLAG_BRIDGE,
            "maxspeedFromOsm": FLAG_MAXSPEED_OSM,
        },
        "notes": [
            "Lebar jalan, jumlah lajur, dan kecepatan adalah perkiraan dari kelas jalan kecuali flag menyatakan nilainya dari tag OSM.",
            "Kecepatan speedKmh adalah perkiraan kecepatan rata-rata lalu lintas kota, bukan batas kecepatan resmi.",
            "Ruas satu arah selalu disimpan searah arah lalu lintas (a ke b).",
        ],
    }
    if extra:
        meta.update(extra)
    return meta


def bounds_of(flat):
    xs = flat[0::2]
    ys = flat[1::2]
    return {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)}


def bbox_bounds(bbox, proj):
    s, w, n, e = bbox
    x0, y0 = proj.xy(n, w)
    x1, y1 = proj.xy(s, e)
    return {"minX": proj.r(x0), "minY": proj.r(y0), "maxX": proj.r(x1), "maxY": proj.r(y1)}


def collect_areas(nodes, ways, proj, names, tol_building, want_height):
    buildings = []
    green = []
    water = []
    places = []
    campus = None
    for w in ways:
        t = w.get("tags", {})
        if "highway" in t:
            continue
        if "waterway" in t:
            ids = [n for n in w["nodes"] if n in nodes]
            if len(ids) >= 2 and t["waterway"] in ("stream", "river", "canal", "drain", "ditch"):
                pts = dp_simplify([proj.xy(nodes[n]["lat"], nodes[n]["lon"]) for n in ids], 0.8)
                water.append({"pts": pts, "kind": t["waterway"], "name": t.get("name", "")})
            continue
        poly = way_polygon(w, nodes, proj, tol_building)
        if not poly:
            continue
        full, simple = poly
        area, (cx, cy) = poly_area_centroid(full)
        name = t.get("name", "")
        if "building" in t:
            b = {"pts": simple, "type": t["building"], "name": name, "area": area}
            h, src, _lv = estimate_height(t, area)
            b["height"] = h
            b["heightSource"] = src
            buildings.append(b)
        kind = None
        for (k, v), gk in GREEN_KIND.items():
            if t.get(k) == v:
                kind = gk
                break
        if kind and "building" not in t:
            green.append({"pts": dp_simplify(full + [full[0]], 0.6)[:-1], "kind": kind, "name": name})
        if t.get("amenity") == "university" and campus is None:
            campus = {"name": name, "pts": dp_simplify(full + [full[0]], 0.3)[:-1], "x": cx, "y": cy, "area": area}
        if name and t.get("amenity") != "university":
            places.append({"name": name, "kind": place_kind(t), "x": cx, "y": cy, "area": area})
    return buildings, green, water, places, campus


def pack_areas(out, proj, names, buildings, green, water, places, campus, with_height):
    r = proj.r
    start, coords = pack_polygons(buildings, proj)
    btypes = Strings()
    out["buildings"] = {
        "count": len(buildings),
        "start": start,
        "type": [btypes.get(b["type"]) for b in buildings],
        "name": [names.get(b["name"]) for b in buildings],
    }
    if with_height:
        out["buildings"]["height"] = [b["height"] for b in buildings]
        out["buildings"]["heightFromOsm"] = [1 if b["heightSource"] == "osm" else 0 for b in buildings]
    out["buildings"]["coords"] = coords
    out["buildingTypes"] = btypes.items
    gstart, gcoords = pack_polygons(green, proj)
    out["green"] = {
        "count": len(green),
        "start": gstart,
        "kind": [g["kind"] for g in green],
        "name": [names.get(g["name"]) for g in green],
        "coords": gcoords,
    }
    wstart, wcoords = pack_polygons(water, proj)
    out["water"] = {
        "count": len(water),
        "start": wstart,
        "kind": [w["kind"] for w in water],
        "name": [names.get(w["name"]) for w in water],
        "coords": wcoords,
    }
    places.sort(key=lambda p: -p["area"])
    # Satu tempat sering dipetakan dua kali di OSM (halaman sebagai landuse dan gedungnya sebagai
    # amenity). Gabungkan nama sama yang berjarak kurang dari 100 m: simpan garis luar yang lebih
    # besar, tetapi pakai jenis yang lebih spesifik (bukan landuse) bila ada. Cabang yang benar-benar
    # berbeda (misalnya dua kantor bank yang berjauhan) tetap terpisah.
    merged = []
    for p in places:
        twin = next((q for q in merged if q["name"] == p["name"] and math.hypot(q["x"] - p["x"], q["y"] - p["y"]) < 100), None)
        if twin is None:
            merged.append(dict(p))
        elif twin["kind"].startswith("landuse:") and not p["kind"].startswith("landuse:"):
            twin["kind"] = p["kind"]
    places = merged
    out["places"] = [
        {"name": p["name"], "kind": p["kind"], "x": r(p["x"]), "y": r(p["y"]), "area": round(p["area"])} for p in places
    ]
    if campus:
        flat = []
        for x, y in campus["pts"]:
            flat += [r(x), r(y)]
        out["campus"] = {"name": campus["name"], "x": r(campus["x"]), "y": r(campus["y"]), "area": round(campus["area"]), "coords": flat}


def roundabouts(edges, flat_nodes, proj):
    """Kelompokkan ruas bundaran yang tersambung menjadi lingkaran (pusat dan jari-jari)."""
    ring = [i for i, e in enumerate(edges) if e["flags"] & FLAG_ROUNDABOUT]
    adj = defaultdict(set)
    for i in ring:
        adj[edges[i]["ai"]].add(i)
        adj[edges[i]["bi"]].add(i)
    seen = set()
    out = []
    for i in ring:
        if i in seen:
            continue
        group = []
        stack = [i]
        while stack:
            j = stack.pop()
            if j in seen:
                continue
            seen.add(j)
            group.append(j)
            for k in (edges[j]["ai"], edges[j]["bi"]):
                stack.extend(adj[k] - seen)
        pts = [p for j in group for p in edges[j]["pts"]]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        rad = sum(math.hypot(p[0] - cx, p[1] - cy) for p in pts) / len(pts)
        closed = all(len([j for j in adj[n] if j in group]) >= 2 for j in group for n in (edges[j]["ai"], edges[j]["bi"]))
        name = next((edges[j]["name"] for j in group if edges[j]["name"]), "")
        out.append({"x": proj.r(cx), "y": proj.r(cy), "radius": round(rad, 1), "closed": closed, "edges": sorted(group), "name": name})
    return out


def nearest_node(flat_nodes, x, y):
    best, bi = float("inf"), -1
    for i in range(0, len(flat_nodes), 2):
        d = (flat_nodes[i] - x) ** 2 + (flat_nodes[i + 1] - y) ** 2
        if d < best:
            best, bi = d, i // 2
    return bi, math.sqrt(best)


def point_features(nodes, node_index, flat_nodes, proj, kind, edges):
    """Titik bertag (lampu lalu lintas, penyeberangan) beserta simpang atau ruas tempatnya."""
    on_edge = {}
    for ei, e in enumerate(edges):
        acc = 0.0
        for i, nid in enumerate(e["ids"]):
            if i:
                acc += math.hypot(e["pts"][i][0] - e["pts"][i - 1][0], e["pts"][i][1] - e["pts"][i - 1][1])
            if 0 < i < len(e["ids"]) - 1:
                on_edge.setdefault(nid, (ei, acc))
    out = []
    for nid, n in nodes.items():
        t = n.get("tags") or {}
        if t.get("highway") != kind:
            continue
        x, y = proj.xy(n["lat"], n["lon"])
        item = {"x": proj.r(x), "y": proj.r(y)}
        if nid in node_index:
            item["node"] = node_index[nid]
            item["edge"] = -1
            item["s"] = 0
        elif nid in on_edge:
            ei, s_along = on_edge[nid]
            e = edges[ei]
            # simpang terdekat di ujung ruas
            item["node"] = e["ai"] if s_along <= e["length"] / 2 else e["bi"]
            item["edge"] = ei
            item["s"] = round(s_along, 1)
        else:
            ni, d = nearest_node(flat_nodes, x, y)
            item["node"] = ni
            item["edge"] = -1
            item["s"] = 0
            item["offGraph"] = round(d, 1)
        if kind == "crossing":
            item["type"] = t.get("crossing", "")
        item["osm"] = nid
        out.append(item)
    out.sort(key=lambda s: (s["y"], s["x"]))
    return out


def add_connectors(nodes, ways, bbox, margin):
    """Tambahkan jalan kendaraan dari malang_roads_raw.json yang menyentuh bbox yang diperluas.

    Data sekitar Ma Chung diambil per bbox, sehingga jaringan jalannya terbelah dua (utara dan
    Villa Puncak Tidar di selatan) karena jalan penyambungnya ada sedikit di luar bbox. Jalan dari
    berkas jaringan Malang yang lebih luas menyambungkannya lagi. Id node OSM berlaku global, jadi
    simpangnya langsung cocok. Hasil: jumlah jalan yang ditambahkan.
    """
    rn, rw = load("malang_roads_raw.json")
    s, w, n, e = bbox
    s, w, n, e = s - margin, w - margin, n + margin, e + margin
    have = {x["id"] for x in ways}
    added = 0
    for way in rw:
        if way["id"] in have or way.get("tags", {}).get("highway") not in DRIVABLE:
            continue
        pts = [rn[i] for i in way["nodes"] if i in rn]
        if not any(s <= p["lat"] <= n and w <= p["lon"] <= e for p in pts):
            continue
        for i in way["nodes"]:
            if i in rn and i not in nodes:
                nodes[i] = rn[i]
        ways.append(way)
        added += 1
    return added


def build_machung():
    print("machung-2d.json", file=sys.stderr)
    nodes, ways = load("machung_raw.json")
    lat0, lon0 = centroid_of_way(nodes, ways, lambda t: t.get("amenity") == "university")
    proj = Projection(round(lat0, 5), round(lon0, 5), 1)
    names = Strings()
    bbox = [-7.9625, 112.5840, -7.9510, 112.5960]
    connectors = add_connectors(nodes, ways, bbox, 0.0015)
    print(f"  jalan penyambung dari jaringan Malang: {connectors}", file=sys.stderr)
    node_ids, node_index, edges, nways = build_graph(nodes, ways, proj, names, set(CLASSES), 0.35)
    flat_nodes, cols, geom = pack_graph(nodes, node_ids, edges, proj, names, with_way=True)
    out = {
        "meta": base_meta(
            "machung",
            "Sekitar Universitas Ma Chung",
            "machung_raw.json",
            bbox,
            proj,
            {
                "origin": "titik berat poligon Universitas Ma Chung",
                "sameOriginAs": ["malang-roads"],
                "connectorNote": f"Ditambah {connectors} jalan kendaraan dari malang_roads_raw.json yang menyentuh bbox diperluas 0,0015 derajat (sekitar 165 m), supaya jaringan utara (Jalan Karangampel Timur) dan selatan (Villa Puncak Tidar) tersambung seperti aslinya.",
            },
        ),
        "bounds": bbox_bounds(bbox, proj),
    }
    out["nodes"] = flat_nodes
    out["edges"] = {"count": len(edges), **cols}
    out["edgeGeom"] = geom
    out["roundabouts"] = roundabouts(edges, flat_nodes, proj)
    for rb in out["roundabouts"]:
        rb["name"] = names.get(rb["name"])
    b, g, w, p, campus = collect_areas(nodes, ways, proj, names, 0.25, True)
    pack_areas(out, proj, names, b, g, w, p, campus, True)
    out["signals"] = []
    out["meta"]["notes"].append("Tidak ada lampu lalu lintas di data OSM area ini. Lampu yang tampil di simulasi sekitar kampus adalah lampu simulasi dan harus diberi label begitu.")
    out["meta"]["notes"].append("Tinggi gedung adalah perkiraan dari jenis dan luas gedung (heightFromOsm = 0), kecuali bila tag OSM tersedia.")
    out["names"] = names.items
    out["meta"]["stats"] = {
        "roadWays": nways,
        "connectorWays": connectors,
        "edges": len(edges),
        "nodes": len(node_ids),
        "buildings": len(b),
        "green": len(g),
        "water": len(w),
        "places": len(out["places"]),
        "roundabouts": len(out["roundabouts"]),
    }
    return out


def build_malang_roads(origin):
    print("malang-roads.json", file=sys.stderr)
    nodes, ways = load("malang_roads_raw.json")
    proj = Projection(origin[0], origin[1], 0)
    names = Strings()
    node_ids, node_index, edges, nways = build_graph(nodes, ways, proj, names, DRIVABLE, 1.5, keep_largest=True)
    flat_nodes, cols, geom = pack_graph(nodes, node_ids, edges, proj, names)
    bbox = [-7.995, 112.580, -7.940, 112.640]
    out = {
        "meta": base_meta(
            "malang-roads",
            "Jaringan jalan Malang, dari Ma Chung sampai pusat kota",
            "malang_roads_raw.json",
            bbox,
            proj,
            {
                "origin": "sama dengan machung-2d.json (titik berat poligon Universitas Ma Chung)",
                "sameOriginAs": ["machung"],
                "graphNote": "Hanya komponen terhubung terbesar. Geometri disederhanakan (Douglas-Peucker 1,5 m), koordinat dibulatkan ke 1 m. Panjang ruas dihitung dari geometri asli.",
            },
        ),
        "bounds": bbox_bounds(bbox, proj),
    }
    out["nodes"] = flat_nodes
    out["edges"] = {"count": len(edges), **cols}
    out["edgeGeom"] = geom
    out["signals"] = point_features(nodes, node_index, flat_nodes, proj, "traffic_signals", edges)
    out["names"] = names.items
    cls_count = Counter(e["cls"] for e in edges)
    out["meta"]["stats"] = {
        "roadWays": nways,
        "edges": len(edges),
        "nodes": len(node_ids),
        "signals": len(out["signals"]),
        "edgesPerClass": dict(sorted(cls_count.items(), key=lambda kv: CLASSES.index(kv[0]))),
        "totalKm": round(sum(e["length"] for e in edges) / 1000, 1),
    }
    return out


def build_malang_center():
    print("malang-center.json", file=sys.stderr)
    nodes, ways = load("malang_center_raw.json")
    lat0, lon0 = centroid_of_way(nodes, ways, lambda t: t.get("name") == "Alun-Alun Merdeka")
    proj = Projection(round(lat0, 5), round(lon0, 5), 1)
    names = Strings()
    node_ids, node_index, edges, nways = build_graph(nodes, ways, proj, names, set(CLASSES), 0.35)
    flat_nodes, cols, geom = pack_graph(nodes, node_ids, edges, proj, names, with_way=True)
    bbox = [-7.9880, 112.6250, -7.9770, 112.6370]
    out = {
        "meta": base_meta(
            "malang-center",
            "Sekitar Alun-alun Merdeka Malang",
            "malang_center_raw.json",
            bbox,
            proj,
            {"origin": "titik berat taman Alun-Alun Merdeka"},
        ),
        "bounds": bbox_bounds(bbox, proj),
    }
    out["nodes"] = flat_nodes
    out["edges"] = {"count": len(edges), **cols}
    out["edgeGeom"] = geom
    out["roundabouts"] = roundabouts(edges, flat_nodes, proj)
    for rb in out["roundabouts"]:
        rb["name"] = names.get(rb["name"])
    b, g, w, p, campus = collect_areas(nodes, ways, proj, names, 0.25, True)
    pack_areas(out, proj, names, b, g, w, p, campus, True)
    out["signals"] = point_features(nodes, node_index, flat_nodes, proj, "traffic_signals", edges)
    out["crossings"] = point_features(nodes, node_index, flat_nodes, proj, "crossing", edges)
    osm_h = sum(1 for x in b if x["heightSource"] == "osm")
    out["meta"]["notes"].append(
        f"Hanya {osm_h} dari {len(b)} gedung punya tag tinggi atau jumlah lantai di OSM. Tinggi gedung lainnya adalah PERKIRAAN (3,5 m per lantai ditambah 1 m, jumlah lantai ditebak dari jenis dan luas gedung). Sebut perkiraan ini apa adanya di teks pelajaran."
    )
    out["names"] = names.items
    out["meta"]["stats"] = {
        "roadWays": nways,
        "edges": len(edges),
        "nodes": len(node_ids),
        "buildings": len(b),
        "buildingsWithOsmHeight": osm_h,
        "green": len(g),
        "places": len(out["places"]),
        "signals": len(out["signals"]),
        "crossings": len(out["crossings"]),
        "roundabouts": len(out["roundabouts"]),
    }
    return out


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def main():
    check = "--check" in sys.argv
    machung = build_machung()
    origin = (machung["meta"]["projection"]["lat0"], machung["meta"]["projection"]["lon0"])
    files = {
        "machung-2d.json": machung,
        "malang-roads.json": build_malang_roads(origin),
        "malang-center.json": build_malang_center(),
    }
    os.makedirs(OUT, exist_ok=True)
    import gzip

    for name, obj in files.items():
        text = dump(obj)
        size = len(text.encode("utf-8"))
        gz = len(gzip.compress(text.encode("utf-8"), 9))
        obj["meta"]["stats"]["fileBytes"] = size
        obj["meta"]["stats"]["gzipBytes"] = gz
        text = dump(obj)
        print(f"{name}: {size / 1024:.0f} KB, gzip {gz / 1024:.0f} KB, {json.dumps(obj['meta']['stats'], ensure_ascii=False)}")
        if not check:
            with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
                f.write(text)


if __name__ == "__main__":
    main()
