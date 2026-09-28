#!/usr/bin/env python3
"""Ubah data OpenStreetMap mentah di sekitar Universitas Ma Chung menjadi peta kota ringkas
untuk Shuttle 3D Ma Chung (dan pelajaran 2D yang memakai halte yang sama).

Pemakaian (dari akar proyek):
  python3 tools/osm_to_city.py                 # tulis js/sim3d/data/machung-city.json
  python3 tools/osm_to_city.py --png BERKAS    # juga gambar pratinjau (butuh Pillow)

Masukan: data/osm/machung_raw.json (Overpass, ODbL, diambil 28 September 2026).
Keluaran: js/sim3d/data/machung-city.json. Format lengkap ada di docs/MAPDATA.md.

Proyeksi sama dengan tools/osm_to_2d.py (supaya data 2D dan 3D bisa ditumpuk langsung):
titik asal = titik berat poligon Universitas Ma Chung (dibulatkan 5 desimal),
  x = (lon - lon0) * mPerDegLon   (ke timur positif)
  z = (lat0 - lat) * mPerDegLat   (ke selatan positif)
Semua koordinat dibulatkan ke 0,1 m.

Yang DIPERKIRAKAN (OSM di area ini tidak punya tag lajur, lebar, tinggi gedung, atau lampu):
jumlah lajur dan lebar jalan dari kelas jalan dan jarak antarjalur, garis tengah lajur yang
dihaluskan, geometri persimpangan, tinggi gedung (acak berbiji), trotoar, pohon, lampu lalu
lintas simulasi, zebra cross, dan posisi halte.
"""

import argparse
import json
import math
import os
import random
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "osm", "machung_raw.json")
OUT = os.path.join(ROOT, "js", "sim3d", "data", "machung-city.json")

ATTRIBUTION = "© Kontributor OpenStreetMap"
LICENSE = "ODbL 1.0 (opendatacommons.org/licenses/odbl)"
SOURCE = "OpenStreetMap lewat Overpass API, diambil 28 September 2026"

# Potongan peta sekitar 1 km x 1 km: Jalan Karangampel Timur di utara, kampus di tengah,
# dan bundaran Villa Puncak Tidar di selatan dan timur. (minX, minZ, maxX, maxZ)
CROP = (-390.0, -450.0, 610.0, 590.0)

# Perkiraan per kelas jalan: lebar lajur (m), jari-jari tikungan trotoar di persimpangan (m),
# jari-jari penghalus tikungan garis tengah (m), kecepatan maksimum simulasi (km/jam),
# dan tingkat kepentingan untuk prioritas di persimpangan (besar = utama).
CLASS = {
    "tertiary": dict(w=3.5, rc=6.0, fil=30.0, v=40, imp=3),
    "unclassified": dict(w=2.75, rc=4.5, fil=16.0, v=30, imp=2),
    "residential": dict(w=2.75, rc=4.5, fil=16.0, v=30, imp=2),
    "living_street": dict(w=2.7, rc=3.5, fil=10.0, v=15, imp=1),
    "service": dict(w=2.8, rc=3.5, fil=10.0, v=20, imp=1),
}
SHOULDER = 0.3  # bahu aspal di luar lajur paling kiri dan kanan
SW_W = 1.8  # lebar trotoar
XWALK_W = 3.0  # lebar zebra cross (searah jalan)
XWALK_EXT = 3.5  # tambahan pangkasan lajur untuk zebra cross dan garis henti
DEAD_TRIM = 5.0  # lajur di ujung buntu berhenti 5 m sebelum ujung, lalu putar balik
MIN_SPUR = 25.0  # ruas buntu lebih pendek dari ini tidak dilalui kendaraan

# Halte: nama, nama jalan (harus ada di data), titik perkiraan, dan arah jalan (derajat, 0 =
# timur, 90 = selatan) untuk memilih lajur. Urutan = urutan putaran shuttle. Arah dipilih supaya
# putaran bisa ditempuh tanpa putar balik (lihat check_halte_loop): dari Gerbang ke barat, memutari
# blok di utara Jalan Karangampel Timur, turun ke bundaran Villa Puncak Tidar, lalu kembali lewat
# Villa Puncak Lawu dan Jalan Raya Candi V.
HALTE = [
    dict(id="gerbang", name="Gerbang Ma Chung", street="Jalan Karangampel Timur", near=(80.0, -212.0), hdg=200),
    dict(id="karangampel", name="Jalan Karangampel Timur", street="Jalan Karangampel Timur", near=(-15.0, -250.0), hdg=200),
    dict(id="tidar", name="Jalan Puncak Tidar", street="Jalan Puncak Tidar", near=(330.0, 242.0), hdg=0),
    dict(id="lawu", name="Villa Puncak Lawu", street="Villa Puncak Lawu", near=(470.0, 20.0), hdg=None),
    dict(id="candi", name="Jalan Raya Candi V", street="Jalan Raya Candi V", near=(420.0, -231.0), hdg=180),
]

# Zebra cross tanpa lampu (titik perkiraan dan nama jalan, diletakkan di ruas terdekat yang cukup
# jauh dari persimpangan). Gerbang pejalan kaki kampus di data adalah dua footway di x sekitar 45
# dan 68; ruas jalan di sana terlalu pendek, jadi zebra cross diletakkan di timurnya, di depan halte.
MIDBLOCK_XWALKS = [
    dict(id="gerbang", near=(100.0, -206.0), street="Jalan Karangampel Timur", note="dekat gerbang kampus dan halte Gerbang Ma Chung"),
    dict(id="lawu", near=(474.0, 50.0), street="Villa Puncak Lawu", note="dekat halte Villa Puncak Lawu"),
    dict(id="candi", near=(445.0, -236.0), street="Jalan Raya Candi V", note="dekat halte Jalan Raya Candi V"),
]

# Ruas OSM yang sengaja tidak dipakai. Alasannya dicatat di keluaran (meta.dropped).
DROP_WAYS = {
    794227383: "jalan pendek yang sejajar dan hanya 6 sampai 8 m dari Jalan Karangampel Timur; dengan lebar perkiraan kedua aspal saling menimpa",
}

# Sela samping minimal dari garis konektor ke garis tengah trotoar (m): setengah lebar kendaraan
# terlebar (shuttle 1,05) + sela perisai 0,45 + badan pejalan kaki 0,3 + geser pejalan kaki ke arah
# jalan paling jauh 0,45 (js/sim3d/pedestrians.js) + 0,05. Ditambah sapuan bodi di tikungan.
# Bagian trotoar yang lebih dekat tetap digambar, tetapi tidak dilalui pejalan kaki.
WALK_CONN_CLEAR = 2.3

# ---------------------------------------------------------------- geometri dasar


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def mul(a, k):
    return (a[0] * k, a[1] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def norm(a):
    n = math.hypot(a[0], a[1])
    return (a[0] / n, a[1] / n) if n > 1e-12 else (1.0, 0.0)


def left(d):
    """Normal kiri dari arah d (x ke timur, z ke selatan)."""
    return (d[1], -d[0])


def right(d):
    return (-d[1], d[0])


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def hdg(d):
    return math.atan2(d[1], d[0])


def unit(h):
    return (math.cos(h), math.sin(h))


def poly_len(p):
    return sum(dist(p[i], p[i + 1]) for i in range(len(p) - 1))


def dedupe(p, eps=0.05):
    out = [p[0]]
    for q in p[1:]:
        if dist(q, out[-1]) > eps:
            out.append(q)
    if len(out) == 1 and len(p) > 1:
        out.append(p[-1])
    return out


def point_at(p, s):
    """Titik dan arah satuan pada jarak s sepanjang polyline p."""
    if s <= 0:
        return p[0], norm(sub(p[1], p[0]))
    acc = 0.0
    for i in range(len(p) - 1):
        L = dist(p[i], p[i + 1])
        if acc + L >= s and L > 1e-9:
            t = (s - acc) / L
            return lerp(p[i], p[i + 1], t), norm(sub(p[i + 1], p[i]))
        acc += L
    return p[-1], norm(sub(p[-1], p[-2]))


def slice_poly(p, s0, s1):
    """Bagian polyline antara jarak s0 dan s1."""
    L = poly_len(p)
    s0 = max(0.0, s0)
    s1 = min(L, s1)
    if s1 - s0 < 1e-6:
        a, _ = point_at(p, s0)
        b, d = point_at(p, s0)
        return [a, add(b, mul(d, 0.01))]
    out = [point_at(p, s0)[0]]
    acc = 0.0
    for i in range(len(p) - 1):
        L = dist(p[i], p[i + 1])
        acc2 = acc + L
        if s0 < acc2 < s1:
            out.append(p[i + 1])
        acc = acc2
    out.append(point_at(p, s1)[0])
    return dedupe(out, 1e-4)


def simplify(p, tol):
    """Douglas Peucker, titik ujung tetap."""
    if len(p) < 3:
        return p[:]
    keep = [False] * len(p)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = p[i], p[j]
        ab = sub(b, a)
        L = math.hypot(*ab)
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            if L < 1e-9:
                d = dist(p[k], a)
            else:
                d = abs(cross(ab, sub(p[k], a))) / L
            if d > best:
                best, bi = d, k
        if best > tol and bi > 0:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [q for q, k in zip(p, keep) if k]


def fillet(p, R, max_frac=0.45, step=math.radians(6)):
    """Ganti tiap sudut tajam dengan busur lingkaran (jari-jari R, dibatasi panjang ruas)."""
    if len(p) < 3:
        return p[:]
    n = len(p)
    seg = [dist(p[i], p[i + 1]) for i in range(n - 1)]
    out = [p[0]]
    for i in range(1, n - 1):
        a, b, c = p[i - 1], p[i], p[i + 1]
        d1 = norm(sub(b, a))
        d2 = norm(sub(c, b))
        turn = math.acos(max(-1.0, min(1.0, dot(d1, d2))))
        if turn < math.radians(1.5) or turn > math.radians(175):
            out.append(b)
            continue
        T = R * math.tan(turn / 2)
        lim1 = seg[i - 1] * (0.9 if i - 1 == 0 else max_frac)
        lim2 = seg[i] * (0.9 if i == n - 2 else max_frac)
        T = min(T, lim1, lim2)
        r = T / math.tan(turn / 2)
        p1 = sub(b, mul(d1, T))
        p2 = add(b, mul(d2, T))
        side = right(d1) if cross(d1, d2) > 0 else left(d1)
        ctr = add(p1, mul(side, r))
        a0 = math.atan2(p1[1] - ctr[1], p1[0] - ctr[0])
        a1 = math.atan2(p2[1] - ctr[1], p2[0] - ctr[0])
        da = wrap(a1 - a0)
        m = max(1, int(math.ceil(abs(da) / step)))
        for k in range(m + 1):
            ang = a0 + da * k / m
            out.append((ctr[0] + r * math.cos(ang), ctr[1] + r * math.sin(ang)))
    out.append(p[-1])
    return dedupe(out, 0.02)


def min_radius(p, win=1.5):
    """Jari-jari tikungan tertajam (m) dari perubahan arah dalam jendela +-win meter."""
    L = poly_len(p)
    if L < 2 * win + 0.5:
        return float("inf")
    best = float("inf")
    s = win
    while s <= L - win:
        _, d0 = point_at(p, s - win)
        _, d1 = point_at(p, s + win)
        turn = abs(wrap(hdg(d1) - hdg(d0)))
        if turn > 1e-3:
            best = min(best, 2 * win / turn)
        s += 0.5
    return best


def smooth_centerline(pts, R, need):
    """Haluskan garis tengah jalan: sederhanakan lalu bulatkan sudutnya dengan busur. Bila masih ada
    tikungan yang lebih tajam dari need (misalnya tikungan tusuk konde yang di OSM digambar dengan
    banyak ruas pendek), sederhanakan lebih kasar supaya busurnya bisa lebih besar."""
    best = None
    for tol in (0.25, 0.6, 1.2, 2.5, 4.0):
        cl = fillet(simplify(pts, tol), R)
        r = min_radius(cl)
        if best is None or r > best[0]:
            best = (r, cl)
        if r >= need:
            return cl
    return best[1]


def offset(p, d):
    """Geser polyline ke kiri sejauh d (negatif = ke kanan)."""
    n = len(p)
    out = []
    for i in range(n):
        if i == 0:
            nn = left(norm(sub(p[1], p[0])))
            out.append(add(p[0], mul(nn, d)))
        elif i == n - 1:
            nn = left(norm(sub(p[-1], p[-2])))
            out.append(add(p[-1], mul(nn, d)))
        else:
            n1 = left(norm(sub(p[i], p[i - 1])))
            n2 = left(norm(sub(p[i + 1], p[i])))
            m = norm(add(n1, n2))
            c = max(0.5, dot(m, n1))
            out.append(add(p[i], mul(m, d / c)))
    return out


def resample(p, step):
    L = poly_len(p)
    n = max(1, int(math.ceil(L / step)))
    return [point_at(p, L * k / n)[0] for k in range(n + 1)]


def bezier(p0, p1, p2, p3, n=None):
    if n is None:
        L = dist(p0, p1) + dist(p1, p2) + dist(p2, p3)
        n = max(4, int(L / 1.0))
    out = []
    for k in range(n + 1):
        t = k / n
        u = 1 - t
        out.append(
            (
                u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
            )
        )
    return out


def quad(p0, c, p2, n=8):
    out = []
    for k in range(n + 1):
        t = k / n
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]))
    return out


def line_intersect(p, d, q, e):
    """p + a d = q + b e. Mengembalikan (a, b) atau None bila sejajar."""
    den = cross(d, e)
    if abs(den) < 1e-9:
        return None
    w = sub(q, p)
    return (cross(w, e) / den, cross(w, d) / den)


def seg_intersect(a, b, c, d):
    def orient(p, q, r):
        return cross(sub(q, p), sub(r, p))

    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return (o1 * o2 < 0) and (o3 * o4 < 0)


def point_in_poly(pt, poly):
    x, z = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z):
            xc = xi + (z - zi) * (xj - xi) / (zj - zi)
            if x < xc:
                inside = not inside
        j = i
    return inside


def poly_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % len(poly)]
        a += x0 * z1 - x1 * z0
    return a / 2


def centroid(poly):
    a = poly_area(poly)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    cx = cz = 0.0
    for i in range(len(poly)):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % len(poly)]
        f = x0 * z1 - x1 * z0
        cx += (x0 + x1) * f
        cz += (z0 + z1) * f
    return (cx / (6 * a), cz / (6 * a))


def seg_point_dist(p, a, b):
    ab = sub(b, a)
    L2 = dot(ab, ab)
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, dot(sub(p, a), ab) / L2))
    return dist(p, add(a, mul(ab, t)))


def clip_poly_rect(poly, rect):
    x0, z0, x1, z1 = rect

    def clip(pts, inside, inter):
        out = []
        n = len(pts)
        for i in range(n):
            cur = pts[i]
            prev = pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(xv):
        return lambda a, b: (xv, a[1] + (b[1] - a[1]) * (xv - a[0]) / (b[0] - a[0]))

    def iz(zv):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zv - a[1]) / (b[1] - a[1]), zv)

    pts = poly
    for inside, inter in (
        (lambda p: p[0] >= x0, ix(x0)),
        (lambda p: p[0] <= x1, ix(x1)),
        (lambda p: p[1] >= z0, iz(z0)),
        (lambda p: p[1] <= z1, iz(z1)),
    ):
        if not pts:
            break
        pts = clip(pts, inside, inter)
    return pts


def lb_clip(a, b, rect):
    """Liang Barsky: parameter (t0, t1) bagian segmen a-b di dalam persegi, atau None."""
    x0, z0, x1, z1 = rect
    dx, dz = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for pv, qv in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dz, a[1] - z0), (dz, z1 - a[1])):
        if abs(pv) < 1e-12:
            if qv < 0:
                return None
            continue
        r = qv / pv
        if pv < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return (t0, t1)


def self_intersects(poly):
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            c, d = poly[j], poly[(j + 1) % n]
            if seg_intersect(a, b, c, d):
                return True
    return False


def convex_hull(pts):
    pts = sorted(set((round(p[0], 3), round(p[1], 3)) for p in pts))
    if len(pts) < 3:
        return pts
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(sub(lower[-1], lower[-2]), sub(p, lower[-2])) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(sub(upper[-1], upper[-2]), sub(p, upper[-2])) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def r1(v):
    v = round(v, 1)
    return 0.0 if v == 0 else v


def P1(p):
    return [r1(p[0]), r1(p[1])]


def PL(pts):
    return [P1(p) for p in pts]


def meters_per_degree(lat0):
    p = math.radians(lat0)
    m_lat = 111132.954 - 559.822 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
    m_lon = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p) + 0.118 * math.cos(5 * p)
    return m_lat, m_lon


# ---------------------------------------------------------------- struktur


class Edge:
    __slots__ = (
        "id", "a", "b", "pts", "ids", "way", "cls", "name", "oneway", "ring", "private", "maxspeed",
        "bridge", "cl", "L", "sep", "nf", "nb", "w", "half", "routable", "trim", "trimfull", "lanes",
        "sidewalk", "keep", "internal",
    )

    def __init__(self):
        self.lanes = {}
        self.trim = {"a": 0.0, "b": 0.0}
        self.trimfull = {"a": 0.0, "b": 0.0}
        self.sidewalk = [True, True]
        self.sep = None
        self.keep = True
        self.internal = False


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


# ---------------------------------------------------------------- konversi


class City:
    def __init__(self, raw):
        self.raw = raw
        self.log = []

    def say(self, *a):
        msg = " ".join(str(x) for x in a)
        self.log.append(msg)
        print(msg)

    # ------------------------------------------------ 1. muat dan proyeksikan
    def load(self):
        els = self.raw["elements"]
        self.ll = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node"}
        self.ways = [e for e in els if e["type"] == "way"]
        uni = next(w for w in self.ways if w.get("tags", {}).get("amenity") == "university")
        ids = [n for n in uni["nodes"] if n in self.ll]
        lat0 = sum(self.ll[n][0] for n in ids[:-1]) / (len(ids) - 1)
        lon0 = sum(self.ll[n][1] for n in ids[:-1]) / (len(ids) - 1)
        self.lat0, self.lon0 = round(lat0, 5), round(lon0, 5)
        self.mlat, self.mlon = meters_per_degree(self.lat0)
        self.P = {nid: ((lon - self.lon0) * self.mlon, (self.lat0 - lat) * self.mlat) for nid, (lat, lon) in self.ll.items()}
        self.campus_poly = [self.P[n] for n in ids[:-1]]
        self.say("titik asal", self.lat0, self.lon0)

    # ------------------------------------------------ 2. pilih jalan dan potong
    def drop_ways(self):
        before = len(self.ways)
        self.ways = [w for w in self.ways if w["id"] not in DROP_WAYS]
        self.dropped = [dict(way=k, why=v) for k, v in DROP_WAYS.items()]
        self.say("ruas OSM yang tidak dipakai", before - len(self.ways))

    @staticmethod
    def drivable(t):
        hw = t.get("highway")
        if hw not in CLASS:
            return False
        if t.get("area") == "yes":
            return False
        if hw == "service" and t.get("service") in ("driveway", "parking_aisle"):
            return False
        if t.get("motorcar") == "no" or t.get("motor_vehicle") == "no" or t.get("access") == "no":
            return False
        return True

    def snap_dangles(self):
        """Ujung jalan yang berhenti beberapa meter sebelum jalan lain (celah digitasi OSM)
        disambungkan: lurus ke depan sampai 22 m, atau ke titik terdekat bila jaraknya <= 6 m."""
        dw = [w for w in self.ways if self.drivable(w.get("tags", {})) and len(w["nodes"]) >= 2]
        rect = CROP
        self.snaps = []
        failed = set()
        next_id = 9_000_000_000_000
        for _ in range(500):
            use = defaultdict(int)
            for w in dw:
                for n in set(w["nodes"]):
                    use[n] += 1
            found = None
            for w in dw:
                ids = w["nodes"]
                if ids[0] == ids[-1]:
                    continue
                for pos, n, nb in ((0, ids[0], ids[1]), (-1, ids[-1], ids[-2])):
                    if (w["id"], pos) in failed or use[n] != 1 or n not in self.P or nb not in self.P:
                        continue
                    p = self.P[n]
                    if not (rect[0] + 5 < p[0] < rect[2] - 5 and rect[1] + 5 < p[1] < rect[3] - 5):
                        continue
                    d = norm(sub(p, self.P[nb]))
                    best = None
                    for w2 in dw:
                        if w2 is w or w2.get("tags", {}).get("bridge") == "yes":
                            continue
                        ids2 = w2["nodes"]
                        for i in range(len(ids2) - 1):
                            if ids2[i] not in self.P or ids2[i + 1] not in self.P:
                                continue
                            a, b = self.P[ids2[i]], self.P[ids2[i + 1]]
                            ab = sub(b, a)
                            Lab = math.hypot(*ab)
                            if Lab < 0.05:
                                continue
                            li = line_intersect(p, d, a, ab)
                            if li and 0 < li[0] <= 22 and 0 <= li[1] <= 1:
                                ang = math.acos(min(1.0, abs(dot(d, mul(ab, 1 / Lab)))))
                                if ang > math.radians(25) and (best is None or li[0] < best[0]):
                                    best = (li[0], w2, i, li[1])
                            q = seg_point_dist(p, a, b)
                            if q <= 6 and (best is None or q < best[0]):
                                t = max(0.0, min(1.0, dot(sub(p, a), ab) / (Lab * Lab)))
                                best = (q, w2, i, t)
                    if best is None:
                        failed.add((w["id"], pos))
                        continue
                    found = (w, pos, best)
                    break
                if found:
                    break
            if not found:
                break
            w, pos, (gap, w2, i, t) = found
            ids2 = w2["nodes"]
            a, b = self.P[ids2[i]], self.P[ids2[i + 1]]
            q = lerp(a, b, t)
            if dist(a, q) < 1.0:
                target = ids2[i]
            elif dist(b, q) < 1.0:
                target = ids2[i + 1]
            else:
                target = next_id
                next_id += 1
                self.P[target] = q
                ids2.insert(i + 1, target)
            if pos == 0:
                w["nodes"].insert(0, target)
            else:
                w["nodes"].append(target)
            self.snaps.append(dict(way=w["id"], to=w2["id"], gap=round(gap, 1)))
        self.say("celah OSM yang disambung", len(self.snaps), [(x["way"], x["gap"]) for x in self.snaps])

    def build_edges(self):
        rect = CROP
        bid = {}
        self.boundary = set()
        self.V = {}

        def new_bnd(pt):
            key = (round(pt[0], 2), round(pt[1], 2))
            if key not in bid:
                bid[key] = -(len(bid) + 1)
                self.boundary.add(bid[key])
            return bid[key]

        pieces = []
        for w in self.ways:
            t = w.get("tags", {})
            if not self.drivable(t):
                continue
            ids = [n for n in w["nodes"] if n in self.P]
            if len(ids) < 2:
                continue
            cur = []
            inside = lambda p: rect[0] <= p[0] <= rect[2] and rect[1] <= p[1] <= rect[3]
            for k, nid in enumerate(ids):
                p = self.P[nid]
                if k == 0:
                    if inside(p):
                        cur.append((nid, p))
                    continue
                q = self.P[ids[k - 1]]
                iq, ip = inside(q), inside(p)
                if iq and ip:
                    cur.append((nid, p))
                    continue
                res = lb_clip(q, p, rect)
                if res is None:
                    continue
                t0, t1 = res
                if iq and not ip:
                    e = lerp(q, p, t1)
                    cur.append((new_bnd(e), e))
                    pieces.append((w, cur))
                    cur = []
                elif ip and not iq:
                    e = lerp(q, p, t0)
                    cur = [(new_bnd(e), e), (nid, p)]
                else:
                    if t1 - t0 > 1e-6:
                        a = lerp(q, p, t0)
                        b = lerp(q, p, t1)
                        pieces.append((w, [(new_bnd(a), a), (new_bnd(b), b)]))
            if len(cur) >= 2:
                pieces.append((w, cur))
        pieces = [(w, pc) for w, pc in pieces if len(pc) >= 2]

        count = defaultdict(int)
        for w, pc in pieces:
            for nid, p in pc:
                count[nid] += 1
                self.V[nid] = p
            count[pc[0][0]] += 1
            count[pc[-1][0]] += 1
        vertex = set(n for n, c in count.items() if c >= 2)
        self.edges = []

        def make(w, seq):
            if len(seq) < 2:
                return
            if seq[0][0] == seq[-1][0]:
                # lingkaran tertutup dengan satu simpul: potong di tengah
                if len(seq) < 4:
                    return
                m = len(seq) // 2
                vertex.add(seq[m][0])
                make(w, seq[: m + 1])
                make(w, seq[m:])
                return
            pts = [p for _, p in seq]
            if poly_len(pts) < 0.05:
                return
            t = w.get("tags", {})
            e = Edge()
            e.id = len(self.edges)
            e.a, e.b = seq[0][0], seq[-1][0]
            e.pts = pts
            e.ids = [n for n, _ in seq]
            e.way = [w["id"]]
            e.cls = t["highway"]
            e.name = t.get("name")
            ow = t.get("oneway")
            e.oneway = ow in ("yes", "1", "true") or t.get("junction") == "roundabout"
            if ow == "-1":
                e.oneway = True
                e.pts.reverse()
                e.ids.reverse()
                e.a, e.b = e.b, e.a
            e.ring = None
            e.private = t.get("access") in ("private", "customers")
            ms = t.get("maxspeed")
            e.maxspeed = float(ms) if ms and ms.replace(".", "").isdigit() else None
            e.bridge = t.get("bridge") == "yes"
            self.edges.append(e)

        for w, pc in pieces:
            cur = [pc[0]]
            for k in range(1, len(pc)):
                cur.append(pc[k])
                if k == len(pc) - 1 or pc[k][0] in vertex:
                    make(w, cur)
                    cur = [pc[k]]

        # tandai bundaran: tag junction=roundabout, atau lingkaran satu arah kecil tertutup
        ringway = set()
        for w in self.ways:
            t = w.get("tags", {})
            if not self.drivable(t):
                continue
            ids = w["nodes"]
            closed = len(ids) > 3 and ids[0] == ids[-1]
            if t.get("junction") == "roundabout" or (closed and t.get("oneway") == "yes"):
                pts = [self.P[n] for n in ids[:-1] if n in self.P]
                if not pts:
                    continue
                cx = sum(p[0] for p in pts) / len(pts)
                cz = sum(p[1] for p in pts) / len(pts)
                r = sum(math.hypot(p[0] - cx, p[1] - cz) for p in pts) / len(pts)
                if t.get("junction") == "roundabout" or r <= 25:
                    ringway.add(w["id"])
        for e in self.edges:
            if e.way[0] in ringway:
                e.ring = -1
        self.say("ruas awal", len(self.edges), "simpul batas", len(self.boundary))

    def incidence(self):
        inc = defaultdict(list)
        for e in self.edges:
            inc[e.a].append((e, "a"))
            inc[e.b].append((e, "b"))
        self.inc = inc
        return inc

    # ------------------------------------------------ 3. rapikan topologi
    def merge_degree2(self):
        changed = True
        while changed:
            changed = False
            inc = self.incidence()
            for v, lst in list(inc.items()):
                if len(lst) != 2 or v in self.boundary:
                    continue
                (e1, s1), (e2, s2) = lst
                if e1 is e2 or e1.ring is not None or e2.ring is not None:
                    continue
                k1 = (e1.cls, e1.name, e1.oneway, e1.private, e1.maxspeed)
                k2 = (e2.cls, e2.name, e2.oneway, e2.private, e2.maxspeed)
                if k1 != k2:
                    continue
                # orientasikan e1 berakhir di v dan e2 berawal di v
                if s1 == "a":
                    if e1.oneway:
                        e1, e2, s1, s2 = e2, e1, s2, s1
                    else:
                        self.flip(e1)
                        s1 = "b"
                if s1 != "b":
                    continue
                if s2 == "b":
                    if e2.oneway:
                        continue
                    self.flip(e2)
                    s2 = "a"
                if e1.a == e2.b:
                    continue
                e1.pts = e1.pts + e2.pts[1:]
                e1.ids = e1.ids + e2.ids[1:]
                e1.way = e1.way + e2.way
                e1.b = e2.b
                self.edges.remove(e2)
                changed = True
                break
        # buang ruas sangat pendek dengan menyatukan kedua simpulnya
        for e in list(self.edges):
            if poly_len(e.pts) < 0.6 and e.a != e.b and e.ring is None:
                keep, drop = e.a, e.b
                if drop in self.boundary:
                    keep, drop = drop, keep
                self.edges.remove(e)
                for f in self.edges:
                    if f.a == drop:
                        f.a = keep
                        f.pts[0] = self.V[keep]
                    if f.b == drop:
                        f.b = keep
                        f.pts[-1] = self.V[keep]
        for i, e in enumerate(self.edges):
            e.id = i
        self.incidence()
        self.say("ruas setelah digabung", len(self.edges))

    @staticmethod
    def flip(e):
        e.pts.reverse()
        e.ids.reverse()
        e.a, e.b = e.b, e.a

    # ------------------------------------------------ 4. lajur per ruas
    def estimate_lanes(self):
        oneways = [e for e in self.edges if e.oneway and e.ring is None]
        segs = []
        for e in oneways:
            for i in range(len(e.pts) - 1):
                a, b = e.pts[i], e.pts[i + 1]
                if dist(a, b) > 0.5:
                    segs.append((e, a, b, norm(sub(b, a))))
        for e in oneways:
            L = poly_len(e.pts)
            samples = []
            s = 5.0
            while s < L - 5.0 or (not samples and s < L):
                p, d = point_at(e.pts, s)
                best = None
                for f, a, b, dd in segs:
                    if f is e or dot(d, dd) > -0.8:
                        continue
                    q = seg_point_dist(p, a, b)
                    if q < 30 and (best is None or q < best[0]):
                        ab = sub(b, a)
                        t = max(0.0, min(1.0, dot(sub(p, a), ab) / max(1e-9, dot(ab, ab))))
                        side = dot(sub(add(a, mul(ab, t)), p), right(d))
                        best = (q, side)
                if best and best[1] > 0:
                    samples.append(best[0])
                s += 5.0
            if samples:
                samples.sort()
                e.sep = samples[max(0, int(len(samples) * 0.25) - 0)]
        for e in self.edges:
            c = CLASS[e.cls]
            if e.ring is not None:
                e.nf, e.nb, e.w = 1, 0, 4.0
            elif e.oneway:
                if e.cls in ("service", "living_street") or e.sep is None:
                    e.nf, e.nb, e.w = 1, 0, 3.5
                else:
                    cmax = e.sep - 1.0
                    if cmax >= 6.0:
                        e.nf, e.nb, e.w = 2, 0, 3.0
                    elif cmax >= 5.5:
                        e.nf, e.nb, e.w = 2, 0, 2.75
                    elif cmax >= 3.0:
                        e.nf, e.nb, e.w = 1, 0, min(3.5, cmax)
                    else:
                        e.nf, e.nb, e.w = 1, 0, 3.0
                    # sisi kanan (arah jalur seberang) tanpa trotoar: itu median
                    e.sidewalk = [True, False]
            else:
                e.nf, e.nb, e.w = 1, 1, c["w"]
            e.half = (e.nf + e.nb) * e.w / 2 + SHOULDER
            e.cl = smooth_centerline(e.pts, c["fil"], e.w * max(e.nf, e.nb) / 2 + 4.0) if e.ring is None else e.pts[:]
            e.L = poly_len(e.cl)
        n2 = sum(1 for e in self.edges if e.nf == 2)
        self.say("ruas satu arah dua lajur", n2)

    # ------------------------------------------------ 5. bundaran
    def build_rings(self):
        inc = self.incidence()
        uf = UF()
        ring_edges = [e for e in self.edges if e.ring is not None]
        for e in ring_edges:
            uf.union(e.a, e.b)
        groups = defaultdict(list)
        for e in ring_edges:
            groups[uf.find(e.a)].append(e)
        self.rings = []
        self.ring_of_vertex = {}
        for root, es in groups.items():
            pts = [p for e in es for p in e.pts]
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            r = sum(math.hypot(p[0] - cx, p[1] - cz) for p in pts) / len(pts)
            verts = set()
            for e in es:
                verts.add(e.a)
                verts.add(e.b)
            # arah putar dari data: hitung perubahan sudut rata-rata sepanjang arah ruas
            turn = 0.0
            for e in es:
                for i in range(len(e.pts) - 1):
                    a0 = math.atan2(e.pts[i][1] - cz, e.pts[i][0] - cx)
                    a1 = math.atan2(e.pts[i + 1][1] - cz, e.pts[i + 1][0] - cx)
                    turn += wrap(a1 - a0)
            rid = len(self.rings)
            ring = dict(id=rid, c=(cx, cz), r=r, verts=verts, edges=es, cw=turn > 0, w=4.0 if r < 12 else 4.5)
            self.rings.append(ring)
            for v in verts:
                self.ring_of_vertex[v] = rid
            for e in es:
                e.ring = rid
                e.routable = False
        closed_ok = all(g["cw"] for g in self.rings)
        self.say("bundaran", len(self.rings), "semua searah jarum jam (lalu lintas kiri):", closed_ok)

    # ------------------------------------------------ 6. persimpangan
    def arm_of(self, e, end):
        pts = e.cl if end == "a" else e.cl[::-1]
        return dict(e=e, end=end, v=e.a if end == "a" else e.b, pts=pts, L=e.L, half=e.half)

    @staticmethod
    def arm_dir(arm):
        s = min(8.0, arm["L"] * 0.5)
        p, _ = point_at(arm["pts"], s)
        return norm(sub(p, arm["pts"][0]))

    def ribbon(self, arm, upto=40.0):
        sl = slice_poly(arm["pts"], 0.0, min(arm["L"], upto))
        return offset(sl, arm["half"]) + offset(sl, -arm["half"])[::-1]

    def arm_needs(self, arms):
        """Pangkasan minimal tiap lengan supaya pita jalan tidak saling tumpang tindih,
        ditambah ruang untuk tikungan trotoar."""
        rib = [self.ribbon(a) for a in arms]
        bbs = []
        for r in rib:
            xs = [p[0] for p in r]
            zs = [p[1] for p in r]
            bbs.append((min(xs), min(zs), max(xs), max(zs)))
        dirs = [self.arm_dir(a) for a in arms]
        needs = [2.5 if len(arms) > 1 else 0.0 for _ in arms]
        for i, ai in enumerate(arms):
            for j, aj in enumerate(arms):
                if i == j:
                    continue
                poly = rib[j]
                bb = bbs[j]
                last = None
                t = min(30.0, ai["L"])
                while t >= 0:
                    p, d = point_at(ai["pts"], t)
                    nn = left(d)
                    h = ai["half"] + 0.3
                    s0 = add(p, mul(nn, h))
                    s1 = sub(p, mul(nn, h))
                    if not (max(s0[0], s1[0]) < bb[0] or min(s0[0], s1[0]) > bb[2] or max(s0[1], s1[1]) < bb[1] or min(s0[1], s1[1]) > bb[3]):
                        hit = point_in_poly(p, poly) or point_in_poly(s0, poly) or point_in_poly(s1, poly)
                        if not hit:
                            for k in range(len(poly)):
                                if seg_intersect(s0, s1, poly[k], poly[(k + 1) % len(poly)]):
                                    hit = True
                                    break
                        if hit:
                            last = t
                            break
                    t -= 0.5
                if last is None:
                    continue
                th = math.acos(max(-1.0, min(1.0, dot(dirs[i], dirs[j]))))
                rc = (CLASS[ai["e"].cls]["rc"] + CLASS[aj["e"].cls]["rc"]) / 2
                if th > math.radians(160):
                    fil = 0.0
                elif th < math.radians(40):
                    fil = rc
                else:
                    fil = rc / math.tan(th / 2)
                needs[i] = max(needs[i], last + 0.5 + fil)
        return [min(30.0, n) for n in needs]

    def build_junctions(self):
        inc = self.incidence()
        # ruas buntu pendek (atau satu arah buntu) disebut taji: tetap digambar, tidak dilalui
        # kendaraan, dan tidak dihitung sebagai lengan persimpangan.
        spur = set()
        while True:
            eff = {v: [(e, end) for e, end in lst if e.id not in spur] for v, lst in inc.items()}
            ends = set(v for v, lst in eff.items() if v not in self.boundary and v not in self.ring_of_vertex and len(lst) <= 1)
            grow = False
            for e in self.edges:
                if e.ring is not None or e.id in spur:
                    continue
                if (e.a in ends or e.b in ends) and (e.L < MIN_SPUR or e.oneway):
                    spur.add(e.id)
                    grow = True
            if not grow:
                break
        self.spur = spur
        self.eff = eff
        self.dead = set(v for v, lst in eff.items() if v not in self.boundary and v not in self.ring_of_vertex and len(lst) == 1)
        for e in self.edges:
            if e.ring is not None:
                continue
            e.routable = e.id not in spur
        inc = eff
        cand = [v for v, lst in inc.items() if v not in self.boundary and v not in self.ring_of_vertex and len(lst) >= 2]
        uf = UF()
        for v in cand:
            uf.find(v)
        for it in range(5):
            clusters = defaultdict(list)
            for v in cand:
                clusters[uf.find(v)].append(v)
            cl_of = {v: uf.find(v) for v in cand}
            needs = {}
            self.cluster_arms = {}
            for root, vs in clusters.items():
                vset = set(vs)
                arms = []
                for v in vs:
                    for e, end in inc[v]:
                        other = e.b if end == "a" else e.a
                        if other in vset and e.L < 60:
                            continue
                        arms.append(self.arm_of(e, end))
                self.cluster_arms[root] = arms
                ns = self.arm_needs(arms)
                for a, n in zip(arms, ns):
                    needs[(a["e"].id, a["end"])] = n
            merged = False
            for e in self.edges:
                if e.ring is not None:
                    continue
                if e.a in cl_of and e.b in cl_of and cl_of[e.a] != cl_of[e.b]:
                    na = needs.get((e.id, "a"), 0)
                    nb = needs.get((e.id, "b"), 0)
                    if e.L < na + nb + 1.0:
                        va = [v for v in cand if cl_of[v] == cl_of[e.a]]
                        vb = [v for v in cand if cl_of[v] == cl_of[e.b]]
                        pts = [self.V[v] for v in va + vb]
                        diam = max(dist(p, q) for p in pts for q in pts)
                        if diam <= 42 and it < 4:
                            uf.union(e.a, e.b)
                            merged = True
            if not merged:
                break
        self.needs = needs
        self.cluster_of = cl_of
        self.clusters = clusters
        for e in self.edges:
            if e.ring is None and e.a in cl_of and e.b in cl_of and cl_of[e.a] == cl_of[e.b] and e.L < 60:
                e.internal = True
                e.routable = False
        self.say("klaster persimpangan", len(clusters), "dari", len(cand), "simpul")

    # ------------------------------------------------ 7. pangkasan ruas
    def ring_trim(self, e, end):
        ring = self.rings[self.ring_of_vertex[e.a if end == "a" else e.b]]
        pts = e.cl if end == "a" else e.cl[::-1]
        target = ring["r"] + ring["w"] / 2 + 4.5
        t = 0.0
        while t < e.L:
            p, _ = point_at(pts, t)
            if dist(p, ring["c"]) >= target:
                break
            t += 0.25
        return max(t, ring["w"] / 2 + 3.0)

    def compute_trims(self, signal_roots):
        for e in self.edges:
            if e.ring is not None:
                continue
            for end, v in (("a", e.a), ("b", e.b)):
                if v in self.boundary:
                    base = 0.0
                elif v in self.ring_of_vertex:
                    base = self.ring_trim(e, end)
                elif v in self.dead:
                    base = DEAD_TRIM
                else:
                    base = self.needs.get((e.id, end), 2.5)
                e.trim[end] = base
                ext = XWALK_EXT if (v in self.cluster_of and self.cluster_of[v] in signal_roots) else 0.0
                e.trimfull[end] = base + ext
            tot = e.trimfull["a"] + e.trimfull["b"]
            if e.L < tot + 1.0 and tot > 0:
                k = max(0.05, (e.L - 1.0) / tot)
                for end in ("a", "b"):
                    ext = e.trimfull[end] - e.trim[end]
                    e.trimfull[end] *= k
                    e.trim[end] = max(0.0, e.trimfull[end] - ext)

    # ------------------------------------------------ 8. lampu lalu lintas simulasi
    def choose_signals(self):
        inc = self.inc
        cands = []
        for root, vs in self.clusters.items():
            arms = self.cluster_arms[root]
            tert = sum(1 for a in arms if a["e"].cls == "tertiary")
            if 3 <= len(arms) <= 4 and tert >= 2 and all(a["e"].routable for a in arms if a["e"].cls == "tertiary"):
                c = (sum(self.V[v][0] for v in vs) / len(vs), sum(self.V[v][1] for v in vs) / len(vs))
                cands.append((root, c, len(arms)))
        gate = HALTE[0]["near"]
        cands.sort(key=lambda x: dist(x[1], gate))
        chosen = []
        for root, c, n in cands:
            if all(dist(c, cc) > 110 for _, cc in chosen):
                # lengan harus cukup panjang untuk zebra cross
                ok = True
                for a in self.cluster_arms[root]:
                    if a["L"] < self.needs.get((a["e"].id, a["end"]), 3) + XWALK_EXT + 8:
                        ok = False
                if ok:
                    chosen.append((root, c))
            if len(chosen) >= 2:
                break
        self.signal_roots = [r for r, _ in chosen]
        for r, c in chosen:
            self.say("lampu simulasi di", [round(c[0]), round(c[1])], "lengan", len(self.cluster_arms[r]))
        for r, c, n in cands[:8]:
            self.say("  kandidat", [round(c[0]), round(c[1])], n)

    # ------------------------------------------------ 9. lajur
    def build_lanes(self):
        self.lanes = []
        for e in self.edges:
            e.lanes = {"f": [], "b": []}
            if e.ring is not None or not e.routable:
                continue
            ta, tb = e.trimfull["a"], e.trimfull["b"]
            if e.L - ta - tb < 0.8:
                e.routable = False
                continue
            sl = slice_poly(e.cl, ta, e.L - tb)
            spd = CLASS[e.cls]["v"]
            if e.maxspeed:
                spd = min(spd, e.maxspeed)
            if e.oneway:
                n = e.nf
                for i in range(n):
                    off = ((n - 1) / 2 - i) * e.w
                    self.add_lane(e, "f", i, offset(sl, off), spd)
            else:
                for i in range(e.nf):
                    self.add_lane(e, "f", i, offset(sl, (e.nf - i - 0.5) * e.w), spd)
                rev = sl[::-1]
                for i in range(e.nb):
                    self.add_lane(e, "b", i, offset(rev, (e.nb - i - 0.5) * e.w), spd)

    def add_lane(self, e, d, i, pts, spd, ring=None):
        lane = dict(
            id=len(self.lanes), e=e.id if e is not None else -1, d=1 if d == "f" else -1, i=i,
            w=e.w if e is not None else 4.0, p=pts, v=spd, j0=-1, j1=-1, rb=ring,
            portal=None, name=e.name if e is not None else None, cls=e.cls if e is not None else "ring",
            private=bool(e.private) if e is not None else False,
        )
        if e is not None:
            start_v = e.a if d == "f" else e.b
            end_v = e.b if d == "f" else e.a
            if end_v in self.boundary:
                lane["portal"] = "out"
            if start_v in self.boundary:
                lane["portal"] = "in"
            e.lanes[d].append(lane)
        self.lanes.append(lane)
        return lane

    def in_out_lanes(self, e, end):
        """Lajur yang masuk ke dan keluar dari ujung 'end' ruas e."""
        if end == "b":
            return e.lanes["f"], e.lanes["b"]
        return e.lanes["b"], e.lanes["f"]

    # ------------------------------------------------ 10. konektor
    @staticmethod
    def conn_ctrl(P0, d0, P3, d3):
        ch = dist(P0, P3)
        dh = abs(wrap(hdg(d3) - hdg(d0)))
        if dh < 0.3:
            k0 = k3 = ch / 3
        else:
            li = line_intersect(P0, d0, P3, mul(d3, -1))
            if li and 0.3 < li[0] < 3 * ch + 5 and 0.3 < li[1] < 3 * ch + 5:
                f = (4.0 / 3.0) * math.tan(dh / 4) / math.tan(dh / 2) if dh < math.pi - 0.05 else 0.55
                k0, k3 = li[0] * f, li[1] * f
            else:
                k0 = k3 = ch * 0.4
        return [P0, add(P0, mul(d0, k0)), sub(P3, mul(d3, k3)), P3]

    def add_conn(self, j, lin, lout, move, rank, ctrl=None, pts=None, extra=None):
        c = dict(id=len(self.conns), j=j["id"], f=lin["id"], t=lout["id"], m=move, r=rank)
        if ctrl is not None:
            c["b"] = ctrl
        if pts is not None:
            c["p"] = pts
        if extra:
            c.update(extra)
        self.conns.append(c)
        j["conns"].append(c["id"])
        return c

    def new_junction(self, kind, center, verts):
        j = dict(id=len(self.junctions), k=kind, x=center[0], z=center[1], v=verts, conns=[], poly=[], sig=None, rb=None, arms=[])
        self.junctions.append(j)
        return j

    def build_regular(self):
        self.junctions = []
        self.conns = []
        self.jid_of_root = {}
        inc = self.eff
        for root, vs in self.clusters.items():
            arms = self.cluster_arms[root]
            ctr = (sum(self.V[v][0] for v in vs) / len(vs), sum(self.V[v][1] for v in vs) / len(vs))
            j = self.new_junction("x", ctr, vs)
            self.jid_of_root[root] = j["id"]
            if root in self.signal_roots:
                j["k"] = "x"
                j["signal"] = True
            vset = set(vs)
            # graf internal untuk memeriksa jalur di dalam klaster
            internal = defaultdict(list)
            for v in vs:
                for e, end in inc[v]:
                    other = e.b if end == "a" else e.a
                    if other in vset and e.L < 60 and other != v:
                        if end == "a" or not e.oneway:
                            internal[v].append(other)

            def reach(a, b):
                if a == b:
                    return True
                seen = {a}
                st = [a]
                while st:
                    x = st.pop()
                    for y in internal[x]:
                        if y == b:
                            return True
                        if y not in seen:
                            seen.add(y)
                            st.append(y)
                return False

            imp = [CLASS[a["e"].cls]["imp"] for a in arms]
            top = max(imp) if imp else 0
            unequal = len(set(imp)) > 1
            # data lengan untuk poligon dan trotoar
            for a in arms:
                e = a["e"]
                base = e.trim[a["end"]]
                full = e.trimfull[a["end"]]
                a["base"] = base
                a["full"] = full
                pb, db = point_at(a["pts"], base)
                pf, df = point_at(a["pts"], full)
                a["pb"], a["db"], a["pf"], a["df"] = pb, db, pf, df
                a["phi"] = hdg(sub(pf, ctr)) if dist(pf, ctr) > 0.5 else hdg(df)
                a["major"] = unequal and CLASS[e.cls]["imp"] == top
            arms.sort(key=lambda a: a["phi"])
            j["arms_raw"] = arms
            for ai, a in enumerate(arms):
                lin, _ = self.in_out_lanes(a["e"], a["end"])
                for bi, b in enumerate(arms):
                    if a is b:
                        continue
                    _, lout = self.in_out_lanes(b["e"], b["end"])
                    if not lin or not lout:
                        continue
                    if not reach(a["v"], b["v"]):
                        continue
                    for L in lin:
                        P0 = L["p"][-1]
                        d0 = norm(sub(L["p"][-1], L["p"][-2]))
                        # lajur keluar di lengan b: pilih sesuai jenis belokan
                        Q = lout[0]["p"][0]
                        dq = norm(sub(lout[0]["p"][1], lout[0]["p"][0]))
                        dh = wrap(hdg(dq) - hdg(d0))
                        if abs(dh) > math.radians(150):
                            continue
                        move = "S" if abs(dh) < math.radians(30) else ("R" if dh > 0 else "L")
                        nA, nB = len(lin), len(lout)
                        i = L["i"]
                        if move == "R":
                            jj = max(0, min(nB - 1, nB - nA + i))
                        else:
                            jj = min(i, nB - 1)
                        O = lout[jj]
                        P3 = O["p"][0]
                        d3 = norm(sub(O["p"][1], O["p"][0]))
                        if root in self.signal_roots:
                            rank = 0
                        elif not unequal:
                            rank = 0
                        elif a["major"] and b["major"]:
                            rank = 0
                        elif a["major"]:
                            rank = 0 if move != "R" else 1
                        else:
                            rank = 2
                        self.add_conn(j, L, O, move, rank, ctrl=self.conn_ctrl(P0, d0, P3, d3))
            j["poly"] = self.junction_poly(arms, ctr)

    def junction_poly(self, arms, ctr):
        pts = []
        n = len(arms)
        for k, a in enumerate(arms):
            b = arms[(k + 1) % n]
            h = a["half"]
            nb_a = right(a["db"])  # sisi + (arah sudut bertambah) dari lengan yang menghadap keluar
            nf_a = right(a["df"])
            pminus_b = sub(a["pb"], mul(nb_a, h))
            pminus_f = sub(a["pf"], mul(nf_a, h))
            pplus_f = add(a["pf"], mul(nf_a, h))
            pplus_b = add(a["pb"], mul(nb_a, h))
            if a["full"] - a["base"] > 0.1:
                pts += [pminus_b, pminus_f, pplus_f, pplus_b]
            else:
                pts += [pminus_f, pplus_f]
            if n == 1:
                break
            nb_b = right(b["db"])
            q = sub(b["pb"], mul(nb_b, b["half"]))
            p = pplus_b
            li = line_intersect(p, mul(a["db"], -1), q, mul(b["db"], -1))
            if li and 0.2 < li[0] < 45 and 0.2 < li[1] < 45:
                K = add(p, mul(a["db"], -li[0]))
                pts += quad(p, K, q, 8)[1:-1]
        pts = dedupe(pts, 0.05)
        if len(pts) >= 3 and self_intersects(pts):
            pts = convex_hull(pts)
        return pts

    def build_dead_ends(self):
        for v in self.dead:
            lst = self.eff[v]
            e, end = lst[0]
            if not e.routable:
                continue
            lin, lout = self.in_out_lanes(e, end)
            if not lin or not lout:
                continue
            arm = self.arm_of(e, end)
            u = self.arm_dir(arm)
            d = mul(u, -1)  # arah menuju ujung buntu
            E = self.V[v]
            Rb = max(4.5, lin[0]["w"] + 1.5)
            j = self.new_junction("dead", E, [v])
            L = lin[0]
            O = lout[0]
            P0 = L["p"][-1]
            N = add(E, mul(left(d), Rb))
            S = add(E, mul(right(d), Rb))
            path = bezier(P0, add(P0, mul(d, 2.0)), sub(N, mul(d, 2.0)), N, 6)
            b0 = hdg(left(d))
            for k in range(1, 19):
                ang = b0 + math.pi * k / 18
                path.append((E[0] + Rb * math.cos(ang), E[1] + Rb * math.sin(ang)))
            Q = O["p"][0]
            path += bezier(S, add(S, mul(d, -2.0)), add(Q, mul(d, 2.0)), Q, 6)[1:]
            self.add_conn(j, L, O, "U", 0, pts=dedupe(path, 0.05))
            rr = Rb + L["w"] / 2 + 0.6
            j["poly"] = [(E[0] + rr * math.cos(2 * math.pi * k / 24), E[1] + rr * math.sin(2 * math.pi * k / 24)) for k in range(24)]
            j["bulb"] = [E[0], E[1], rr]

    def build_ring_junctions(self):
        inc = self.inc
        self.ring_data = []
        for ring in self.rings:
            c, r, w = ring["c"], ring["r"], ring["w"]
            arms = []
            for v in ring["verts"]:
                for e, end in inc[v]:
                    if e.ring is not None or not e.routable:
                        continue
                    a = self.arm_of(e, end)
                    t = e.trimfull[end]
                    pf, df = point_at(a["pts"], t)
                    a["pf"], a["df"], a["full"] = pf, df, t
                    a["alpha"] = math.atan2(pf[1] - c[1], pf[0] - c[0])
                    arms.append(a)
            if not arms:
                continue
            arms.sort(key=lambda a: a["alpha"])
            # kelompokkan lengan yang sangat berdekatan sudutnya
            groups = []
            for a in arms:
                if groups and wrap(a["alpha"] - groups[-1][-1]["alpha"]) < 0.2:
                    groups[-1].append(a)
                else:
                    groups.append([a])
            if len(groups) > 1 and wrap(groups[0][0]["alpha"] - groups[-1][-1]["alpha"]) % (2 * math.pi) < 0.2:
                groups[0] = groups.pop() + groups[0]
            G = len(groups)
            alphas = []
            for g in groups:
                s = sum(math.sin(a["alpha"]) for a in g)
                cc = sum(math.cos(a["alpha"]) for a in g)
                alphas.append(math.atan2(s, cc))
            order = sorted(range(G), key=lambda k: alphas[k])
            groups = [groups[k] for k in order]
            alphas = [alphas[k] for k in order]
            gaps = [((alphas[(k + 1) % G] - alphas[k]) % (2 * math.pi)) or 2 * math.pi for k in range(G)]
            deltas = []
            for k in range(G):
                want = 6.0 / r
                lim = 0.42 * min(gaps[k], gaps[k - 1])
                deltas.append(max(0.08, min(want, lim)))

            def rp(th):
                return (c[0] + r * math.cos(th), c[1] + r * math.sin(th))

            def tangent(th):
                return (-math.sin(th), math.cos(th))

            def arc(t0, t1, step=math.radians(5)):
                n = max(2, int(math.ceil(abs(t1 - t0) / step)))
                return [rp(t0 + (t1 - t0) * k / n) for k in range(n + 1)]

            # potongan cincin di antara kelompok (searah jarum jam = sudut bertambah)
            pieces = []
            for k in range(G):
                t0 = alphas[k] + deltas[k]
                t1 = alphas[(k + 1) % G] - deltas[(k + 1) % G]
                while t1 <= t0:
                    t1 += 2 * math.pi
                lane = self.add_lane(None, "f", 0, arc(t0, t1), 20, ring=ring["id"])
                lane["w"] = w
                lane["name"] = self.ring_name(groups[k] + groups[(k + 1) % G])
                pieces.append(lane)
            rd = dict(id=ring["id"], c=c, r=r, w=w, junctions=[], arms=[])
            for k in range(G):
                g = groups[k]
                al = alphas[k]
                de = deltas[k]
                j = self.new_junction("ring", rp(al), sorted(set(a["v"] for a in g)))
                j["rb"] = ring["id"]
                prev_piece = pieces[k - 1]
                next_piece = pieces[k]
                self.add_conn(j, prev_piece, next_piece, "S", 0, pts=arc(al - de, al + de, math.radians(4)), extra=dict(ringc=1))
                for a in g:
                    lin, lout = self.in_out_lanes(a["e"], a["end"])
                    for L in lout:
                        P0 = rp(al - de)
                        d0 = tangent(al - de)
                        P3 = L["p"][0]
                        d3 = norm(sub(L["p"][1], L["p"][0]))
                        self.add_conn(j, prev_piece, L, "L", 0, ctrl=self.conn_ctrl(P0, d0, P3, d3), extra=dict(exit=1))
                        break
                    for L in lin:
                        P0 = L["p"][-1]
                        d0 = norm(sub(L["p"][-1], L["p"][-2]))
                        P3 = rp(al + de)
                        d3 = tangent(al + de)
                        self.add_conn(j, L, next_piece, "L", 2, ctrl=self.conn_ctrl(P0, d0, P3, d3), extra=dict(entry=1))
                    rd["arms"].append(dict(alpha=al, delta=de, j=j["id"]))
                j["poly"] = self.ring_flare(g, c, r, w, al, de)
                rd["junctions"].append(j["id"])
            self.ring_data.append(rd)

    def ring_name(self, arms):
        for a in arms:
            if a["e"].name:
                return a["e"].name
        return None

    def ring_flare(self, g, c, r, w, al, de):
        ro = r + w / 2
        poly = []
        # titik tutup lengan paling "minus" dan paling "plus"
        caps = []
        for a in g:
            nn = right(a["df"])
            caps.append((sub(a["pf"], mul(nn, a["half"])), add(a["pf"], mul(nn, a["half"]))))
        pm = caps[0][0]
        pp = caps[-1][1]
        th_p = al + de + 2.0 / ro
        th_m = al - de - 2.0 / ro

        def op(th):
            return (c[0] + ro * math.cos(th), c[1] + ro * math.sin(th))

        poly.append(pm)
        for a_i, (m_, p_) in enumerate(caps):
            if a_i > 0:
                poly.append(m_)
            poly.append(p_)
        qp = op(th_p)
        ctrl = add(c, mul(norm(sub(pp, c)), ro + 1.0))
        poly += quad(pp, ctrl, qp, 6)[1:]
        n = max(2, int((th_p - th_m) / math.radians(6)))
        for k in range(1, n):
            poly.append(op(th_p - (th_p - th_m) * k / n))
        qm = op(th_m)
        ctrl = add(c, mul(norm(sub(pm, c)), ro + 1.0))
        poly += quad(qm, ctrl, pm, 6)[:-1]
        return dedupe(poly, 0.05)

    # ------------------------------------------------ 11. komponen terhubung kuat
    def scc(self):
        NL = len(self.lanes)
        NC = len(self.conns)
        PORTAL = NL + NC
        adj = [[] for _ in range(NL + NC + 1)]
        for c in self.conns:
            adj[c["f"]].append(NL + c["id"])
            adj[NL + c["id"]].append(c["t"])
        for L in self.lanes:
            if L["portal"] == "out":
                adj[L["id"]].append(PORTAL)
            if L["portal"] == "in":
                adj[PORTAL].append(L["id"])

        def tarjan(nodes_ok):
            index = {}
            low = {}
            on = set()
            st = []
            comps = []
            counter = [0]
            for s in range(len(adj)):
                if s in index or not nodes_ok(s):
                    continue
                work = [(s, 0)]
                index[s] = low[s] = counter[0]
                counter[0] += 1
                st.append(s)
                on.add(s)
                while work:
                    v, i = work[-1]
                    nbrs = [w for w in adj[v] if nodes_ok(w)]
                    if i < len(nbrs):
                        work[-1] = (v, i + 1)
                        w = nbrs[i]
                        if w not in index:
                            index[w] = low[w] = counter[0]
                            counter[0] += 1
                            st.append(w)
                            on.add(w)
                            work.append((w, 0))
                        elif w in on:
                            low[v] = min(low[v], index[w])
                    else:
                        work.pop()
                        if work:
                            u = work[-1][0]
                            low[u] = min(low[u], low[v])
                        if low[v] == index[v]:
                            comp = []
                            while True:
                                w = st.pop()
                                on.discard(w)
                                comp.append(w)
                                if w == v:
                                    break
                            comps.append(comp)
            return comps

        comps = tarjan(lambda n: True)
        big = max(comps, key=len)
        keep = set(big)
        core_comps = tarjan(lambda n: n != PORTAL and n in keep)
        core = set(max(core_comps, key=len))
        self.say("SCC dengan portal", len(big), "tanpa portal (inti)", len(core), "total simpul", len(adj))
        for L in self.lanes:
            L["keep"] = L["id"] in keep
            L["core"] = L["id"] in core
        for c in self.conns:
            c["keep"] = (NL + c["id"]) in keep
            c["core"] = (NL + c["id"]) in core
        # buang lajur dan konektor di luar SCC lalu beri nomor ulang
        old_l = {L["id"]: L for L in self.lanes}
        lanes = [L for L in self.lanes if L["keep"]]
        lmap = {}
        for i, L in enumerate(lanes):
            lmap[L["id"]] = i
        conns = [c for c in self.conns if c["keep"] and c["f"] in lmap and c["t"] in lmap]
        cmap = {}
        for i, c in enumerate(conns):
            cmap[c["id"]] = i
        for L in lanes:
            L["id"] = lmap[L["id"]]
        for c in conns:
            c["id"] = cmap[c["id"]]
            c["f"] = lmap[c["f"]]
            c["t"] = lmap[c["t"]]
        for j in self.junctions:
            j["conns"] = [cmap[k] for k in j["conns"] if k in cmap]
        for e in self.edges:
            for d in ("f", "b"):
                e.lanes[d] = [L for L in e.lanes[d] if L["keep"]]
        self.lanes = lanes
        self.conns = conns
        for c in conns:
            jj = self.junctions[c["j"]]
            self.lanes[c["f"]]["j1"] = jj["id"]
            self.lanes[c["t"]]["j0"] = jj["id"]
        for L in self.lanes:
            L["dead"] = False
        self.say("lajur", len(lanes), "konektor", len(conns))

    # ------------------------------------------------ 12. lampu, zebra cross
    def build_signals_and_crossings(self):
        self.signals = []
        self.crossings = []
        for root in self.signal_roots:
            j = self.junctions[self.jid_of_root[root]]
            sig = dict(id=len(self.signals), j=j["id"], arms=[], crossings=[], x=j["x"], z=j["z"])
            for a in j["arms_raw"]:
                e = a["e"]
                lin, lout = self.in_out_lanes(e, a["end"])
                mid = (a["base"] + a["full"]) / 2
                p, d = point_at(a["pts"], mid)
                xw = dict(
                    id=len(self.crossings), x=p[0], z=p[1], h=hdg(d), len=2 * a["half"] + 0.4, w=XWALK_W,
                    sig=sig["id"], j=j["id"], e=e.id, end=a["end"], t=mid,
                )
                self.crossings.append(xw)
                sig["crossings"].append(xw["id"])
                if lin:
                    stop = point_at(a["pts"], a["full"])[0]
                    sig["arms"].append(dict(lanes=[L["id"] for L in lin], name=e.name, cls=e.cls, x=stop[0], z=stop[1], h=hdg(mul(a["df"], -1)), half=a["half"]))
            j["sig"] = sig["id"]
            self.signals.append(sig)
        for m in MIDBLOCK_XWALKS:
            # posisi terdekat dari titik perkiraan di semua ruas bernama sama, hanya di bagian ruas
            # yang berjarak minimal 10 m dari persimpangan di kedua ujungnya
            best = None
            for e in self.edges:
                if e.ring is not None or not e.routable or e.oneway or e.name != m["street"]:
                    continue
                lo = e.trimfull["a"] + 10
                hi = e.L - e.trimfull["b"] - 10
                if hi <= lo:
                    continue
                s = lo
                while s <= hi:
                    p, _ = point_at(e.cl, s)
                    dd = dist(p, m["near"])
                    if best is None or dd < best[0]:
                        best = (dd, e, s)
                    s += 0.5
            if not best or best[0] > 40:
                self.say("PERINGATAN: zebra cross tidak bisa diletakkan", m["id"])
                continue
            _, e, bs = best
            p, d = point_at(e.cl, bs)
            xw = dict(id=len(self.crossings), x=p[0], z=p[1], h=hdg(d), len=2 * e.half + 0.4, w=XWALK_W, sig=None, j=None, e=e.id, end=None, t=bs, note=m["note"])
            self.crossings.append(xw)
        self.say("lampu", len(self.signals), "zebra cross", len(self.crossings))

    # ------------------------------------------------ 13. halte
    def build_halte(self):
        self.halte = []
        for hc in HALTE:
            best = None
            for L in self.lanes:
                if not L["core"] or L["i"] != 0 or L["rb"] is not None or L["name"] != hc["street"]:
                    continue
                if L["private"]:
                    continue
                pts = L["p"]
                Ll = poly_len(pts)
                if Ll < 45:
                    continue
                s = 18.0
                while s <= Ll - 18:
                    p, d = point_at(pts, s)
                    dd = dist(p, hc["near"])
                    if hc["hdg"] is not None:
                        dd += 30 * abs(wrap(hdg(d) - math.radians(hc["hdg"])))
                    if best is None or dd < best[0]:
                        best = (dd, L, s, p, d)
                    s += 1.0
            if not best:
                self.say("PERINGATAN: halte tidak ditemukan", hc["name"])
                continue
            _, L, s, p, d = best
            shelter = add(p, mul(left(d), L["w"] / 2 + SHOULDER + SW_W / 2 + 0.3))
            self.halte.append(
                dict(
                    id=hc["id"], name=hc["name"], street=hc["street"], lane=L["id"], s=s, x=p[0], z=p[1],
                    h=hdg(d), side="kiri", shelter=shelter, edge=L["e"],
                )
            )
            self.say("halte", hc["name"], "lajur", L["id"], "s", round(s, 1), "di", [round(p[0]), round(p[1])])
        self.check_halte_loop()

    def check_halte_loop(self):
        """Rute terpendek antarhalte berurutan di graf lajur inti, TANPA putar balik (shuttle 6 m
        tidak berputar balik di ujung jalan buntu). Rute disimpan untuk gambar pratinjau dan
        dicatat panjangnya di meta.stats.loopLength."""
        import heapq

        out = defaultdict(list)
        for c in self.conns:
            if c["core"] and c["m"] != "U" and not self.lanes[c["t"]]["private"]:
                clen = poly_len(bezier(*c["b"])) if "b" in c else poly_len(c["p"])
                out[c["f"]].append((c["t"], clen, c["id"]))
        llen = [poly_len(L["p"]) for L in self.lanes]
        total = 0.0
        self.loop_paths = []
        self.loop_legs = []
        for k in range(len(self.halte)):
            a = self.halte[k]
            b = self.halte[(k + 1) % len(self.halte)]
            dist0 = {a["lane"]: llen[a["lane"]] - a["s"]}
            prev = {}
            pq = [(dist0[a["lane"]], a["lane"])]
            found = None
            while pq:
                dd, u = heapq.heappop(pq)
                if dd > dist0.get(u, 1e18):
                    continue
                if u == b["lane"] and u != a["lane"]:
                    found = dd - (llen[u] - b["s"])
                    break
                for v, cl, cid in out[u]:
                    nd = dd + cl + llen[v]
                    if nd < dist0.get(v, 1e18):
                        dist0[v] = nd
                        prev[v] = (u, cid)
                        heapq.heappush(pq, (nd, v))
            if found is None:
                self.say("PERINGATAN: tidak ada rute tanpa putar balik dari", a["name"], "ke", b["name"])
                self.loop_legs.append(None)
            else:
                total += found
                seq = [b["lane"]]
                u = b["lane"]
                while u != a["lane"] or len(seq) == 1:
                    pu, cid = prev[u]
                    seq.append(("c", cid))
                    seq.append(pu)
                    u = pu
                    if u == a["lane"]:
                        break
                seq.reverse()
                self.loop_paths.append(seq)
                self.loop_legs.append(round(found))
                self.say("rute", a["name"], "->", b["name"], round(found), "m")
        self.loop_len = total
        self.say("panjang putaran halte", round(total), "m")

    # ------------------------------------------------ 14. trotoar dan jaringan pejalan kaki
    def build_walks(self):
        self.wnodes = []
        self.wedges = []
        key_node = {}

        def node(key, pt):
            if key in key_node:
                return key_node[key]
            key_node[key] = len(self.wnodes)
            self.wnodes.append(pt)
            return key_node[key]

        def sw_off(e):
            return e.half + SW_W / 2

        def side_ok(e, sigma):
            return e.sidewalk[0] if sigma > 0 else e.sidewalk[1]

        walk_t = {}
        for e in self.edges:
            if e.ring is not None or e.id in self.spur or e.internal:
                continue
            for end, v in (("a", e.a), ("b", e.b)):
                t = e.trim[end]
                if v in self.cluster_of and self.cluster_of[v] in self.signal_roots:
                    t = e.trim[end] + XWALK_EXT / 2
                if v in self.dead:
                    t = 0.0 if not e.routable else 0.0
                walk_t[(e.id, end)] = t
        # sisi trotoar per ruas: sigma +1 kiri (arah a ke b), -1 kanan
        self.sw_poly = {}
        for e in self.edges:
            if e.ring is not None or e.id in self.spur or e.internal:
                continue
            ta, tb = walk_t[(e.id, "a")], walk_t[(e.id, "b")]
            if e.a in self.dead and e.routable:
                ta = self.bulb_r(e) + 0.2
            if e.b in self.dead and e.routable:
                tb = self.bulb_r(e) + 0.2
            if e.L - ta - tb < 1.0:
                continue
            sl = slice_poly(e.cl, ta, e.L - tb)
            for sigma in (1, -1):
                if not side_ok(e, sigma):
                    continue
                pl = offset(sl, sigma * sw_off(e))
                na = node((e.id, "a", sigma), pl[0])
                nb = node((e.id, "b", sigma), pl[-1])
                self.sw_poly[(e.id, sigma)] = (na, nb, pl)
        # pecah trotoar di zebra cross tengah ruas
        mid_split = defaultdict(list)
        for xw in self.crossings:
            if xw["j"] is None:
                mid_split[xw["e"]].append(xw)
        for eid, xws in mid_split.items():
            e = self.edges[eid]
            for sigma in (1, -1):
                if (eid, sigma) not in self.sw_poly:
                    continue
                na, nb, pl = self.sw_poly.pop((eid, sigma))
                ta = walk_t[(eid, "a")]
                cuts = sorted(xw["t"] - ta for xw in xws)
                prev_n = na
                prev_s = 0.0
                Lp = poly_len(pl)
                for xw, cs in zip(sorted(xws, key=lambda x: x["t"]), cuts):
                    cs = max(0.5, min(Lp - 0.5, cs))
                    p, _ = point_at(pl, cs)
                    mn = node(("x", xw["id"], sigma), p)
                    self.wedges.append(dict(a=prev_n, b=mn, k="w", p=slice_poly(pl, prev_s, cs)))
                    prev_n, prev_s = mn, cs
                self.wedges.append(dict(a=prev_n, b=nb, k="w", p=slice_poly(pl, prev_s, Lp)))
            for xw in xws:
                a_ = key_node.get(("x", xw["id"], 1))
                b_ = key_node.get(("x", xw["id"], -1))
                if a_ is not None and b_ is not None:
                    self.wedges.append(dict(a=a_, b=b_, k="x", x=xw["id"], p=[self.wnodes[a_], self.wnodes[b_]]))
        for (eid, sigma), (na, nb, pl) in self.sw_poly.items():
            self.wedges.append(dict(a=na, b=nb, k="w", p=pl))
        # sudut persimpangan biasa
        for j in self.junctions:
            if j["k"] != "x":
                continue
            arms = j["arms_raw"]
            n = len(arms)
            for k in range(n):
                a = arms[k]
                b = arms[(k + 1) % n]
                if n == 1:
                    break
                sa = -1 if a["end"] == "a" else 1  # sisi + lengan a
                sb = 1 if b["end"] == "a" else -1  # sisi - lengan b
                ka = (a["e"].id, a["end"], sa)
                kb = (b["e"].id, b["end"], sb)
                if ka not in key_node or kb not in key_node:
                    continue
                P = self.wnodes[key_node[ka]]
                Q = self.wnodes[key_node[kb]]
                li = line_intersect(P, mul(a["db"], -1), Q, mul(b["db"], -1))
                if li and 0.1 < li[0] < 40 and 0.1 < li[1] < 40:
                    K = add(P, mul(a["db"], -li[0]))
                    path = quad(P, K, Q, 8)
                else:
                    path = [P, Q]
                self.wedges.append(dict(a=key_node[ka], b=key_node[kb], k="w", p=path))
            if j.get("sig") is not None:
                sig = self.signals[j["sig"]]
                for xid in sig["crossings"]:
                    xw = self.crossings[xid]
                    e = self.edges[xw["e"]]
                    ka = (e.id, xw["end"], 1)
                    kb = (e.id, xw["end"], -1)
                    if ka in key_node and kb in key_node:
                        self.wedges.append(dict(a=key_node[ka], b=key_node[kb], k="x", x=xid, p=[self.wnodes[key_node[ka]], self.wnodes[key_node[kb]]]))
        # ujung buntu: memutar di sekeliling bulatan aspal
        for j in self.junctions:
            if j["k"] != "dead":
                continue
            v = j["v"][0]
            e, end = self.eff[v][0]
            ka = (e.id, end, 1)
            kb = (e.id, end, -1)
            if ka not in key_node or kb not in key_node:
                continue
            E = (j["x"], j["z"])
            rr = j["bulb"][2] + SW_W / 2
            P = self.wnodes[key_node[ka]]
            Q = self.wnodes[key_node[kb]]
            a0 = math.atan2(P[1] - E[1], P[0] - E[0])
            a1 = math.atan2(Q[1] - E[1], Q[0] - E[0])
            arm = self.arm_of(e, end)
            u = self.arm_dir(arm)
            back = hdg(mul(u, -1))
            # lewat sisi jauh (arah -u)
            da = wrap(a1 - a0)
            mid = a0 + da / 2
            if abs(wrap(mid - back)) > math.pi / 2:
                da = da - 2 * math.pi if da > 0 else da + 2 * math.pi
            path = [P]
            for k in range(1, 16):
                ang = a0 + da * k / 16
                path.append((E[0] + rr * math.cos(ang), E[1] + rr * math.sin(ang)))
            path.append(Q)
            self.wedges.append(dict(a=key_node[ka], b=key_node[kb], k="w", p=path))
        # bundaran: trotoar melingkar di luar cincin, di antara lengan
        for ring in self.rings:
            c, r, w = ring["c"], ring["r"], ring["w"]
            rs = r + w / 2 + SW_W / 2 + 0.3
            arms = []
            for v in ring["verts"]:
                for e, end in self.inc[v]:
                    if e.ring is not None:
                        continue
                    ka = (e.id, end, -1 if end == "a" else 1)
                    kb = (e.id, end, 1 if end == "a" else -1)
                    P = self.wnodes[key_node[ka]] if ka in key_node else None
                    Q = self.wnodes[key_node[kb]] if kb in key_node else None
                    ref = P or Q
                    if ref is None:
                        continue
                    arms.append(dict(al=math.atan2(ref[1] - c[1], ref[0] - c[0]), plus=ka if P else None, minus=kb if Q else None))
            arms.sort(key=lambda a: a["al"])
            n = len(arms)
            for k in range(n):
                a = arms[k]
                b = arms[(k + 1) % n]
                if n < 2 or not a["plus"] or not b["minus"]:
                    continue
                P = self.wnodes[key_node[a["plus"]]]
                Q = self.wnodes[key_node[b["minus"]]]
                t0 = math.atan2(P[1] - c[1], P[0] - c[0])
                t1 = math.atan2(Q[1] - c[1], Q[0] - c[0])
                while t1 <= t0:
                    t1 += 2 * math.pi
                m = max(2, int((t1 - t0) / math.radians(6)))
                path = [P]
                for q in range(1, m):
                    th = t0 + (t1 - t0) * q / m
                    path.append((c[0] + rs * math.cos(th), c[1] + rs * math.sin(th)))
                path.append(Q)
                self.wedges.append(dict(a=key_node[a["plus"]], b=key_node[b["minus"]], k="w", p=path))
        self.push_walks()
        self.clear_walks()
        self.fix_crossings()
        self.stitch_walks()
        # kaitkan node trotoar ke zebra cross
        for xw in self.crossings:
            xw["walk"] = None
        for i, we in enumerate(self.wedges):
            if we["k"] == "x":
                self.crossings[we["x"]]["walk"] = i
        self.say("trotoar node", len(self.wnodes), "tepi", len(self.wedges))

    def push_walks(self):
        """Geser jalur pejalan kaki di sudut persimpangan (dan di tempat lain yang terlalu dekat
        dengan jalur belok kendaraan) menjauhi koridor kendaraan, supaya trotoar tetap tersambung
        mengelilingi blok. Tanpa ini, sudut trotoar yang dilewati sapuan bodi kendaraan yang berbelok
        harus dipotong dan pejalan kaki tidak pernah sampai ke zebra cross.
        Garis trotoar asli tetap digambar (hiasan); jalur yang digeser digambar juga, jadi sudut
        trotoar tampak sedikit lebih lebar. Pergeseran dibatasi 2,5 m. Bagian yang masih terlalu dekat
        setelah digeser dipotong oleh clear_walks()."""
        G = 4.0
        soft = defaultdict(list)
        hard = defaultdict(list)

        def put(g, p, r):
            g[(int(p[0] // G), int(p[1] // G))].append((p[0], p[1], r))

        for c in self.conns:
            pts = bezier(*c["b"]) if "b" in c else c["p"]
            w = max(self.lanes[c["f"]]["w"], self.lanes[c["t"]]["w"])
            for q in resample(pts, 0.8):
                put(hard, q, w / 2 - 0.25 + SW_W / 2 - 0.12)
            for q, sw in self.js_sweep_samples(c["b"] if "b" in c else c["p"], True if "b" in c else None):
                put(soft, q, WALK_CONN_CLEAR + sw + 0.25)
        for L in self.lanes:
            if L["rb"] is not None:
                continue
            for q, sw in self.js_sweep_samples(L["p"], False):
                put(soft, q, WALK_CONN_CLEAR + sw + 0.25)
        for e in self.edges:
            if e.ring is not None or e.id in self.spur:
                continue
            for q in resample(e.cl, 1.0):
                put(hard, q, e.half + SW_W / 2 - 0.12)
        rings = [(rg["c"], rg["r"], rg["w"]) for rg in self.rings]

        def worst(p):
            """Pelanggaran terbesar: (kedalaman, arah dorong) atau None."""
            gx, gz = int(p[0] // G), int(p[1] // G)
            best = None
            for g in (hard, soft):
                for dx in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for qx, qz, r in g.get((gx + dx, gz + dz), ()):
                            ex = p[0] - qx
                            ez = p[1] - qz
                            d2 = ex * ex + ez * ez
                            if d2 >= r * r:
                                continue
                            d = math.sqrt(d2)
                            depth = r - d
                            if best is None or depth > best[0]:
                                best = (depth, (ex / d, ez / d) if d > 1e-6 else (0.0, 1.0))
            for c, r, w in rings:
                d = dist(p, c)
                lo = r - w / 2 - 0.3
                hi = r + w / 2 + SW_W / 2 - 0.12
                if lo < d < hi:
                    depth = hi - d
                    if best is None or depth > best[0]:
                        best = (depth, norm(sub(p, c)) if d > 1e-6 else (1.0, 0.0))
            return best

        def push(p, p0, limit=2.5):
            for _ in range(10):
                wv = worst(p)
                if wv is None:
                    return p, True
                depth, dv = wv
                p = (p[0] + dv[0] * (depth + 0.03), p[1] + dv[1] * (depth + 0.03))
                if dist(p, p0) > limit:
                    return p, False
            return p, worst(p) is None

        fixed = set()
        for we in self.wedges:
            if we["k"] == "x":
                fixed.add(we["a"])
                fixed.add(we["b"])
        used = set()
        for we in self.wedges:
            used.add(we["a"])
            used.add(we["b"])
        moved_nodes = 0
        for n in used:
            if n in fixed:
                continue
            p0 = self.wnodes[n]
            if worst(p0) is None:
                continue
            p, ok = push(p0, p0)
            if ok:
                self.wnodes[n] = p
                moved_nodes += 1
        self.wpushed = []
        moved_edges = 0
        for we in self.wedges:
            if we["k"] != "w":
                continue
            orig = we["p"]
            A = self.wnodes[we["a"]]
            B = self.wnodes[we["b"]]
            pts = resample(orig, 0.7)
            pts[0] = A
            pts[-1] = B
            base = pts[:]
            changed = dist(A, orig[0]) > 0.02 or dist(B, orig[-1]) > 0.02
            for it in range(5):
                bad = False
                for k in range(1, len(pts) - 1):
                    if worst(pts[k]) is None:
                        continue
                    q, _ = push(pts[k], base[k])
                    pts[k] = q
                    bad = True
                    changed = True
                if not bad:
                    break
                # haluskan (titik ujung tetap)
                for _ in range(2):
                    sm = pts[:]
                    for k in range(1, len(pts) - 1):
                        sm[k] = ((pts[k - 1][0] + 2 * pts[k][0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * pts[k][1] + pts[k + 1][1]) / 4)
                    pts = sm
            if changed:
                moved_edges += 1
                self.wpushed.append(orig)
                we["p"] = simplify(pts, 0.03)
        self.say("trotoar digeser menjauhi jalur belok: node", moved_nodes, "tepi", moved_edges)

    def clear_walks(self):
        """Potong bagian trotoar yang menimpa aspal jalan lain, persimpangan, atau jalur belok
        kendaraan (misalnya dua jalan sejajar yang sangat berdekatan). Bagian yang tidak menimpa
        aspal tetapi terlalu dekat dengan koridor kendaraan yang berbelok tetap digambar (hiasan),
        tetapi tidak dilalui pejalan kaki."""
        G = 12.0
        grid = defaultdict(list)
        soft = defaultdict(list)

        def put(g, p, r):
            g[(int(p[0] // G), int(p[1] // G))].append((p, r))

        for e in self.edges:
            # taji buntu tanpa lalu lintas boleh dilintasi trotoar (seperti mulut gang)
            if e.ring is not None or e.id in self.spur:
                continue
            for p in resample(e.cl, 1.0):
                put(grid, p, e.half + SW_W / 2 - 0.12)
        for c in self.conns:
            pts = bezier(*c["b"]) if "b" in c else c["p"]
            w = max(self.lanes[c["f"]]["w"], self.lanes[c["t"]]["w"])
            # aspal di bawah konektor
            for p in resample(pts, 0.8):
                put(grid, p, w / 2 - 0.25 + SW_W / 2 - 0.12)
            # koridor kendaraan terlebar ditambah sapuan bodi di tikungan (lihat WALK_CONN_CLEAR)
            # + 0,15 m sela untuk penyederhanaan dan pembulatan koordinat di keluaran
            for p, sw in self.js_sweep_samples(c["b"] if "b" in c else c["p"], True if "b" in c else None):
                put(soft, p, WALK_CONN_CLEAR + sw + 0.15)
        for L in self.lanes:
            if L["rb"] is not None:
                continue
            for p, sw in self.js_sweep_samples(L["p"], False):
                put(soft, p, WALK_CONN_CLEAR + sw + 0.15)
        polys = []
        for j in self.junctions:
            if len(j["poly"]) >= 3:
                xs = [q[0] for q in j["poly"]]
                zs = [q[1] for q in j["poly"]]
                polys.append((min(xs), min(zs), max(xs), max(zs), j["poly"]))
        rings = [(rg["c"], rg["r"], rg["w"]) for rg in self.rings]

        def near(g, p):
            gx, gz = int(p[0] // G), int(p[1] // G)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q, r in g.get((gx + dx, gz + dz), ()):
                        if dist(p, q) < r:
                            return True
            return False

        def blocked(p):
            """0 bebas, 1 terlalu dekat koridor belok (hiasan saja), 2 menimpa aspal."""
            if near(grid, p):
                return 2
            for x0, z0, x1, z1, poly in polys:
                if x0 - 1 <= p[0] <= x1 + 1 and z0 - 1 <= p[1] <= z1 + 1 and point_in_poly(p, poly):
                    return 2
            for c, r, w in rings:
                d = dist(p, c)
                if r - w / 2 - 0.3 < d < r + w / 2 + SW_W / 2 - 0.12:
                    return 2
            return 1 if near(soft, p) else 0

        out = []
        self.wdeco = []
        cut = 0
        for we in self.wedges:
            if we["k"] != "w":
                out.append(we)
                continue
            pts = we["p"]
            L = poly_len(pts)
            if L < 0.2:
                continue
            n = max(2, int(math.ceil(L / 0.5)))
            ss = [L * k / n for k in range(n + 1)]
            flags = [blocked(point_at(pts, s)[0]) for s in ss]
            if not any(flags):
                out.append(we)
                continue
            cut += 1
            # rangkaian sampel dengan tanda yang sama
            runs = []
            k0 = 0
            for k in range(1, n + 2):
                if k == n + 1 or flags[k] != flags[k0]:
                    runs.append((k0, k - 1, flags[k0]))
                    k0 = k
            for a, b, f in runs:
                if f == 2:
                    continue
                s0, s1 = ss[max(0, a - 1) if f == 1 else a], ss[min(n, b + 1) if f == 1 else b]
                if f == 1:
                    if s1 - s0 >= 0.5:
                        self.wdeco.append(slice_poly(pts, s0, s1))
                    continue
                if s1 - s0 < 2.5:
                    if s1 - s0 >= 0.5:
                        self.wdeco.append(slice_poly(pts, s0, s1))
                    continue
                piece = slice_poly(pts, s0, s1)
                na = we["a"] if a == 0 else self.new_wnode(piece[0])
                nb = we["b"] if b == n else self.new_wnode(piece[-1])
                out.append(dict(a=na, b=nb, k="w", p=piece))
        self.wedges = out
        self.walk_blocked = blocked
        # garis trotoar asli (sebelum digeser) tetap digambar sebagai hiasan
        for pl in getattr(self, "wpushed", []):
            self.wdeco.append(pl)
        # node yang tidak lagi dipakai tetap ada (tidak masalah), node tepi berganti indeks tidak
        self.say("trotoar yang dipotong", cut, "potongan hiasan", len(self.wdeco))

    def fix_crossings(self):
        """Ujung zebra cross adalah tempat pejalan kaki menunggu. Bila ujungnya terlalu dekat dengan
        koridor kendaraan yang berbelok (atau jatuh di aspal jalan lain, misalnya di jalur sempit di
        antara dua jalan yang berdempetan), tempat menunggu digeser menjauhi jalan di sepanjang garis
        zebra cross sampai 3 m. Bila tetap tidak bisa, zebra cross itu tidak dibuat."""
        drop = set()
        for we in self.wedges:
            if we["k"] != "x":
                continue
            a, b = we["a"], we["b"]
            moves = {}
            for n, o in ((a, b), (b, a)):
                pn = self.wnodes[n]
                if self.walk_blocked(pn) == 0:
                    continue
                dv = norm(sub(pn, self.wnodes[o]))
                got = None
                for k in range(1, 13):
                    q = add(pn, mul(dv, 0.25 * k))
                    if self.walk_blocked(q) == 0:
                        got = q
                        break
                if got is None:
                    drop.add(we["x"])
                    break
                moves[n] = got
            if we["x"] in drop:
                continue
            for n, q in moves.items():
                self.wnodes[n] = q
            we["p"] = [self.wnodes[a], self.wnodes[b]]
        if not drop:
            return
        # buang zebra cross yang tidak bisa dipakai, lalu nomori ulang
        self.wedges = [we for we in self.wedges if not (we["k"] == "x" and we["x"] in drop)]
        keep = [x for x in self.crossings if x["id"] not in drop]
        remap = {x["id"]: i for i, x in enumerate(keep)}
        for i, x in enumerate(keep):
            x["id"] = i
        self.crossings = keep
        for we in self.wedges:
            if we["k"] == "x":
                we["x"] = remap[we["x"]]
        for sg in self.signals:
            sg["crossings"] = [remap[c] for c in sg["crossings"] if c in remap]
        self.say("zebra cross dibuang karena ujungnya tidak aman", len(drop), "tersisa", len(self.crossings))

    def stitch_walks(self):
        """Sambungkan ujung trotoar yang terputus (derajat 1) ke node trotoar lain yang sangat dekat
        di komponen lain, bila garis penghubungnya bebas dari aspal dan koridor kendaraan. Celah
        kecil seperti ini muncul di sudut persimpangan setelah pemotongan."""
        deg = defaultdict(int)
        for we in self.wedges:
            deg[we["a"]] += 1
            deg[we["b"]] += 1
        uf = UF()
        for we in self.wedges:
            uf.union(we["a"], we["b"])
        nodes = list(deg.keys())
        xends = set()
        for we in self.wedges:
            if we["k"] == "x":
                xends.add(we["a"])
                xends.add(we["b"])
        G = 6.0
        grid = defaultdict(list)
        for n in nodes:
            p = self.wnodes[n]
            grid[(int(p[0] // G), int(p[1] // G))].append(n)
        added = 0
        for u in nodes:
            if deg[u] != 1:
                continue
            pu = self.wnodes[u]
            gx, gz = int(pu[0] // G), int(pu[1] // G)
            best = None
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for v in grid.get((gx + dx, gz + dz), ()):
                        if v == u or uf.find(v) == uf.find(u):
                            continue
                        dd = dist(pu, self.wnodes[v])
                        lim = 4.5 if u in xends else 4.0
                        if dd < lim and (best is None or dd < best[0]):
                            best = (dd, v)
            if not best:
                continue
            v = best[1]
            pv = self.wnodes[v]
            n = max(2, int(math.ceil(best[0] / 0.4)))
            if any(self.walk_blocked(lerp(pu, pv, k / n)) for k in range(n + 1)):
                continue
            self.wedges.append(dict(a=u, b=v, k="w", p=[pu, pv]))
            deg[u] += 1
            deg[v] += 1
            uf.union(u, v)
            added += 1
        self.say("sambungan trotoar yang terputus", added)

    @staticmethod
    def js_sweep_samples(pts, is_bezier):
        """Sapuan bodi per titik, dihitung PERSIS seperti js/sim3d/city.js (Link.sweeps) dari geometri
        yang sudah dibulatkan seperti di keluaran, supaya jarak aman trotoar di sini cocok dengan
        koridor perisai di simulator. is_bezier True: titik kontrol bezier konektor; None: polyline
        konektor; False: polyline lajur (disederhanakan 0,03 m seperti di keluaran)."""
        if is_bezier:
            p0, p1, p2, p3 = [P1(q) for q in pts]
            approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3)
            n = max(6, min(60, int(math.ceil(approx / 0.75))))
            poly = []
            for k in range(n + 1):
                t = k / n
                u = 1 - t
                a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
                poly.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
        elif is_bezier is None:
            poly = [P1(q) for q in pts]  # polyline konektor: dibulatkan saja, tidak disederhanakan
        else:
            poly = [P1(q) for q in simplify(pts, 0.03)]
        out = [poly[0]]
        for q in poly[1:]:
            if dist(q, out[-1]) > 0.02:
                out.append(q)
        poly = out
        if len(poly) < 2:
            return [(poly[0], 0.0)]
        cum = [0.0]
        hs = []
        for i in range(1, len(poly)):
            cum.append(cum[-1] + dist(poly[i - 1], poly[i]))
            hs.append(math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]))
        L = cum[-1]

        def at(sv):
            if sv <= 0:
                return poly[0], hs[0]
            if sv >= L:
                return poly[-1], hs[-1]
            lo, hi = 0, len(poly) - 1
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if cum[mid] <= sv:
                    lo = mid
                else:
                    hi = mid
            segL = (cum[hi] - cum[lo]) or 1.0
            t = (sv - cum[lo]) / segL
            return lerp(poly[lo], poly[hi], t), hs[lo]

        n = max(2, int(math.ceil(L)) + 1)
        k = []
        for i in range(n):
            sv = i / (n - 1) * L
            _, ha = at(max(0.0, sv - 1.5))
            _, hb = at(min(L, sv + 1.5))
            dh = wrap(hb - ha)
            ds = min(L, sv + 1.5) - max(0.0, sv - 1.5)
            k.append(abs(dh) / ds if ds > 0.2 else 0.0)
        step = L / (n - 1)
        W = max(1, int(round(3 / max(step, 0.05))))
        sw = []
        for i in range(n):
            km = max(k[max(0, i - W): min(n, i + W + 1)])
            sw.append(min(2.5, 9 * km / 2))
        # simulator memakai sapuan di titik proyeksi pejalan kaki, yang bisa sedikit bergeser dari
        # sampel terdekat: pakai nilai terbesar dalam +-2 m supaya aman
        W2 = max(1, int(round(2 / max(step, 0.05))))
        res = []
        for i in range(n):
            res.append((at(i / (n - 1) * L)[0], max(sw[max(0, i - W2): min(n, i + W2 + 1)])))
        return res

    @staticmethod
    def sweep_samples(pts, step=0.8, hl=3.0):
        """Titik sampel sepanjang jalur dengan sapuan bodi setempat ke luar tikungan untuk kendaraan
        terpanjang (shuttle 6 m, pusat di jalur): hl^2 / (2R), R = jari-jari tertajam dalam jarak
        hl dari titik itu, dibatasi 2,5 m. Rumus yang sama dipakai perisai (js/sim3d/city.js)."""
        rs = resample(pts, step)
        n = len(rs)
        k = [0.0] * n
        w = max(1, int(round(1.5 / step)))
        for i in range(n):
            a = rs[max(0, i - w)]
            b = rs[min(n - 1, i + w)]
            c0 = rs[max(0, i - w) + 1] if max(0, i - w) + 1 < n else b
            c1 = rs[min(n - 1, i + w) - 1] if min(n - 1, i + w) - 1 >= 0 else a
            h0 = hdg(sub(c0, a))
            h1 = hdg(sub(b, c1))
            ds = dist(a, b)
            if ds > 1e-6:
                k[i] = abs(wrap(h1 - h0)) / ds
        W = max(1, int(round(hl / step)))
        out = []
        for i in range(n):
            km = max(k[max(0, i - W): min(n, i + W + 1)])
            out.append((rs[i], min(2.5, hl * hl * km / 2.0)))
        return out

    def new_wnode(self, pt):
        self.wnodes.append(pt)
        return len(self.wnodes) - 1

    def bulb_r(self, e):
        return max(4.5, e.w + 1.5) + e.w / 2 + 0.6

    # ------------------------------------------------ 15. gedung, area hijau, pohon, label
    def build_scenery(self):
        rect = CROP
        # sampel garis tengah jalan untuk menolak gedung dan pohon yang menutup jalan
        grid = defaultdict(list)
        G = 20.0
        for e in self.edges:
            half = e.half if e.ring is None else self.rings[e.ring]["w"] / 2 + 0.5
            pts = e.cl if e.ring is None else e.pts
            for p in resample(pts, 2.0):
                grid[(int(p[0] // G), int(p[1] // G))].append((p, half))
        for rg in self.rings:
            c = rg["c"]
            for k in range(36):
                th = 2 * math.pi * k / 36
                p = (c[0] + rg["r"] * math.cos(th), c[1] + rg["r"] * math.sin(th))
                grid[(int(p[0] // G), int(p[1] // G))].append((p, rg["w"] / 2 + 0.5))
        self.junction_polys = [j["poly"] for j in self.junctions if len(j["poly"]) >= 3]
        self.road_grid = grid

        def near_road(p, extra):
            gx, gz = int(p[0] // G), int(p[1] // G)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q, half in grid.get((gx + dx, gz + dz), ()):
                        if dist(p, q) < half + extra:
                            return True
            return False

        rng_seed = 20260928
        self.buildings = []
        dropped = 0
        bgrid = defaultdict(list)
        for w in self.ways:
            t = w.get("tags", {})
            if "building" not in t:
                continue
            ids = [n for n in w["nodes"] if n in self.P]
            if len(ids) < 4 or ids[0] != ids[-1]:
                continue
            poly = [self.P[n] for n in ids[:-1]]
            poly = dedupe(poly, 0.1)
            if len(poly) < 3:
                continue
            if poly_area(poly) < 0:
                poly.reverse()
            cen = centroid(poly)
            if not (rect[0] + 2 <= cen[0] <= rect[2] - 2 and rect[1] + 2 <= cen[1] <= rect[3] - 2):
                continue
            poly = clip_poly_rect(poly, rect)
            if len(poly) < 3:
                continue
            area = abs(poly_area(poly))
            if area < 8:
                continue
            # gedung yang sedikit menjorok ke badan jalan (data OSM kadang bergeser) didorong
            # mundur. Gedung yang benar-benar menutup jalan dibuang.
            xs = [p[0] for p in poly]
            zs = [p[1] for p in poly]

            def nearby(pt):
                gx, gz = int(pt[0] // G), int(pt[1] // G)
                for dx in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for q, half in grid.get((gx + dx, gz + dz), ()):
                            yield q, half

            bad = False
            for gx in range(int(min(xs) // G) - 1, int(max(xs) // G) + 2):
                for gz in range(int(min(zs) // G) - 1, int(max(zs) // G) + 2):
                    for q, half in grid.get((gx, gz), ()):
                        if half > 1.5 and point_in_poly(q, poly):
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
            if not bad:
                area0 = abs(poly_area(poly))
                moved = []
                for pt in poly:
                    best = None
                    for q, half in nearby(pt):
                        d0 = dist(pt, q)
                        need = half + 0.5
                        if d0 < need and (best is None or need - d0 > best[0]):
                            best = (need - d0, q, d0)
                    if best:
                        depth, q, d0 = best
                        if depth > 2.8:
                            bad = True
                            break
                        dirv = norm(sub(pt, q)) if d0 > 0.05 else (0.0, 1.0)
                        pt = add(pt, mul(dirv, depth))
                    moved.append(pt)
                if not bad:
                    if abs(poly_area(moved)) < 0.55 * area0 or poly_area(moved) <= 0:
                        bad = True
                    else:
                        poly = moved
                        for jp in self.junction_polys:
                            if any(point_in_poly(pt, jp) for pt in poly):
                                bad = True
                                break
            if bad:
                dropped += 1
                continue
            area = abs(poly_area(poly))
            rnd = random.Random(w["id"] ^ rng_seed)
            campus = point_in_poly(cen, self.campus_poly)
            bt = t.get("building")
            if campus:
                kind = "campus"
                floors = rnd.choice([3, 3, 4, 4, 5]) if area > 250 else rnd.choice([2, 3])
            elif bt == "mosque" or t.get("religion") == "muslim":
                kind = "mosque"
                floors = rnd.choice([1, 2])
            elif bt in ("commercial", "retail") or t.get("amenity") in ("food_court", "cafe") or t.get("leisure") == "sports_centre":
                kind = "commercial"
                floors = rnd.choice([2, 2, 3])
            else:
                kind = "house"
                floors = 2 if (area > 300 or rnd.random() < 0.4) else 1
            # atap limasan untuk rumah yang hampir persegi panjang
            roof = "flat"
            obb = self.obb(poly)
            if kind in ("house", "mosque", "commercial") and area < 420 and obb and area / (obb[2] * obb[3]) > 0.86:
                roof = "hip"
            b = dict(p=poly, f=floors, k=kind, r=roof, c=rnd.randrange(8), id=w["id"])
            if roof == "hip":
                b["obb"] = obb
            self.buildings.append(b)
            for gx in range(int(min(xs) // G), int(max(xs) // G) + 1):
                for gz in range(int(min(zs) // G), int(max(zs) // G) + 1):
                    bgrid[(gx, gz)].append(len(self.buildings) - 1)
        self.say("gedung", len(self.buildings), "dibuang karena menutup jalan", dropped)

        def in_building(p, pad=0.8):
            for bi in bgrid.get((int(p[0] // G), int(p[1] // G)), ()):
                poly = self.buildings[bi]["p"]
                if point_in_poly(p, poly):
                    return True
                if min(seg_point_dist(p, poly[k], poly[(k + 1) % len(poly)]) for k in range(len(poly))) < pad:
                    return True
            return False

        # area hijau dan lain-lain
        AREA = {
            ("landuse", "grass"): "grass", ("landuse", "meadow"): "grass", ("landuse", "village_green"): "grass",
            ("landuse", "recreation_ground"): "park", ("landuse", "flowerbed"): "garden",
            ("leisure", "park"): "park", ("leisure", "garden"): "garden", ("leisure", "playground"): "park",
            ("leisure", "pitch"): "pitch", ("leisure", "swimming_pool"): "water",
            ("landuse", "orchard"): "orchard", ("landuse", "farmland"): "farmland", ("landuse", "forest"): "wood",
            ("natural", "wood"): "wood", ("natural", "scrub"): "scrub", ("natural", "grassland"): "grass",
            ("natural", "water"): "water", ("landuse", "cemetery"): "cemetery",
        }
        self.areas = []
        for w in self.ways:
            t = w.get("tags", {})
            kind = None
            for (k, v), kd in AREA.items():
                if t.get(k) == v:
                    kind = kd
                    break
            if not kind:
                continue
            ids = [n for n in w["nodes"] if n in self.P]
            if len(ids) < 4 or ids[0] != ids[-1]:
                continue
            poly = dedupe([self.P[n] for n in ids[:-1]], 0.2)
            poly = clip_poly_rect(poly, rect)
            if len(poly) < 3 or abs(poly_area(poly)) < 30:
                continue
            if poly_area(poly) < 0:
                poly.reverse()
            self.areas.append(dict(p=poly, k=kind, id=w["id"]))
        self.say("area", len(self.areas))

        # pohon
        trees = []
        density = {"wood": 70, "orchard": 55, "park": 160, "garden": 140, "scrub": 110, "grass": 450, "cemetery": 220, "farmland": 900}
        for a in self.areas:
            dens = density.get(a["k"])
            if not dens:
                continue
            poly = a["p"]
            area = abs(poly_area(poly))
            n = int(area / dens)
            rnd = random.Random(a["id"])
            xs = [p[0] for p in poly]
            zs = [p[1] for p in poly]
            tries = 0
            got = 0
            while got < n and tries < n * 6:
                tries += 1
                p = (rnd.uniform(min(xs), max(xs)), rnd.uniform(min(zs), max(zs)))
                if not point_in_poly(p, poly) or near_road(p, 2.2) or in_building(p):
                    continue
                kind = 1 if a["k"] in ("orchard", "scrub") else 0
                trees.append((p[0], p[1], rnd.uniform(0.75, 1.25) * (0.8 if kind else 1.0), kind))
                got += 1
        for w in self.ways:
            t = w.get("tags", {})
            if t.get("natural") != "tree_row":
                continue
            ids = [n for n in w["nodes"] if n in self.P]
            if len(ids) < 2:
                continue
            pl = [self.P[n] for n in ids]
            rnd = random.Random(w["id"])
            for p in resample(pl, 7.0):
                if rect[0] <= p[0] <= rect[2] and rect[1] <= p[1] <= rect[3] and not near_road(p, 1.8) and not in_building(p):
                    trees.append((p[0], p[1], rnd.uniform(0.85, 1.15), 0))
        # pohon peneduh di tepi jalan utama dan jalan di sekitar kampus
        for e in self.edges:
            if e.ring is not None:
                continue
            nearc = dist(point_at(e.cl, e.L / 2)[0], (0, 0)) < 260
            if not (e.cls == "tertiary" or (nearc and e.cls in ("residential", "service") and e.L > 40)):
                continue
            rnd = random.Random(e.id * 7919 + 13)
            s = e.trim["a"] + 8
            step = 13.0 if e.cls == "tertiary" else 17.0
            while s < e.L - e.trim["b"] - 8:
                p, d = point_at(e.cl, s)
                for sigma in (1, -1):
                    if not (e.sidewalk[0] if sigma > 0 else e.sidewalk[1]):
                        continue
                    if rnd.random() < 0.25:
                        continue
                    q = add(p, mul(left(d), sigma * (e.half + SW_W + 1.4)))
                    if not near_road(q, 1.6) and not in_building(q, 1.2):
                        trees.append((q[0], q[1], rnd.uniform(0.8, 1.1), 0))
                s += step
        self.trees = trees
        self.say("pohon", len(trees))

        # label
        self.labels = [dict(t="Universitas Ma Chung", x=centroid(self.campus_poly)[0], z=centroid(self.campus_poly)[1], h=0.0, k="campus")]
        runs = defaultdict(list)
        for e in self.edges:
            if e.name and e.ring is None and e.L > 60:
                runs[e.name].append(e)
        for name, es in runs.items():
            es.sort(key=lambda e: -e.L)
            placed = []
            for e in es:
                if len(placed) >= (2 if e.cls == "tertiary" else 1):
                    break
                span = e.L - e.trim["a"] - e.trim["b"]
                if span < 50:
                    continue
                p, d = point_at(e.cl, e.trim["a"] + span / 2)
                if any(dist(p, q) < 250 for q in placed):
                    continue
                h = hdg(d)
                if abs(wrap(h)) > math.pi / 2:
                    h = wrap(h + math.pi)
                placed.append(p)
                self.labels.append(dict(t=name, x=p[0], z=p[1], h=h, k="street", cls=e.cls))
        self.say("label", len(self.labels))

    @staticmethod
    def obb(poly):
        """Kotak berorientasi terkecil (dari arah sisi poligon): (cx, cz, panjang, lebar, sudut)."""
        best = None
        n = len(poly)
        for k in range(n):
            d = norm(sub(poly[(k + 1) % n], poly[k]))
            nn = left(d)
            us = [dot(p, d) for p in poly]
            vs = [dot(p, nn) for p in poly]
            L = max(us) - min(us)
            W = max(vs) - min(vs)
            if best is None or L * W < best[0]:
                cu = (max(us) + min(us)) / 2
                cv = (max(vs) + min(vs)) / 2
                c = add(mul(d, cu), mul(nn, cv))
                if L >= W:
                    best = (L * W, c, L, W, hdg(d))
                else:
                    best = (L * W, c, W, L, hdg(nn))
        if not best:
            return None
        _, c, L, W, h = best
        return [c[0], c[1], L, W, h]

    # ------------------------------------------------ 16. keluaran
    def output(self):
        roads = []
        for e in self.edges:
            if e.ring is not None:
                continue
            roads.append(
                dict(
                    id=e.id, name=e.name, cls=e.cls, ow=1 if e.oneway else 0, nf=e.nf, nb=e.nb, lw=r1(e.w), half=r1(e.half),
                    p=PL(e.cl), t0=r1(e.trim["a"]), t1=r1(e.trim["b"]), f0=r1(e.trimfull["a"]), f1=r1(e.trimfull["b"]),
                    ja=self.vertex_kind(e.a), jb=self.vertex_kind(e.b), priv=1 if e.private else 0,
                    route=1 if e.routable and (e.lanes["f"] or e.lanes["b"]) else 0,
                    sw=[1 if e.sidewalk[0] else 0, 1 if e.sidewalk[1] else 0], osm=e.way,
                )
            )
        lanes = []
        for L in self.lanes:
            o = dict(id=L["id"], e=L["e"], d=L["d"], i=L["i"], w=r1(L["w"]), v=L["v"], j0=L["j0"], j1=L["j1"], p=PL(simplify(L["p"], 0.03)))
            if L["rb"] is not None:
                o["rb"] = L["rb"]
            if L["portal"]:
                o["portal"] = L["portal"]
            if L["core"]:
                o["core"] = 1
            if L["name"]:
                o["name"] = L["name"]
            if L["private"]:
                o["priv"] = 1
            lanes.append(o)
        conns = []
        for c in self.conns:
            o = dict(id=c["id"], j=c["j"], f=c["f"], t=c["t"], m=c["m"], r=c["r"])
            if "b" in c:
                o["b"] = PL(c["b"])
            if "p" in c:
                o["p"] = PL(c["p"])
            for k in ("ringc", "entry", "exit"):
                if c.get(k):
                    o[k] = 1
            if c["core"]:
                o["core"] = 1
            conns.append(o)
        juncs = []
        for j in self.junctions:
            o = dict(id=j["id"], k=j["k"], x=r1(j["x"]), z=r1(j["z"]), c=j["conns"], poly=PL(j["poly"]))
            if j.get("sig") is not None:
                o["sig"] = j["sig"]
            if j.get("rb") is not None:
                o["rb"] = j["rb"]
            if j.get("bulb"):
                o["bulb"] = [r1(v) for v in j["bulb"]]
            juncs.append(o)
        rings = [dict(id=rd["id"], x=r1(rd["c"][0]), z=r1(rd["c"][1]), r=r1(rd["r"]), w=rd["w"], j=rd["junctions"]) for rd in self.ring_data]
        sigs = []
        for s in self.signals:
            sigs.append(
                dict(
                    id=s["id"], j=s["j"], x=r1(s["x"]), z=r1(s["z"]), xw=s["crossings"],
                    arms=[dict(lanes=a["lanes"], name=a["name"], cls=a["cls"], x=r1(a["x"]), z=r1(a["z"]), h=round(a["h"], 3), half=r1(a["half"])) for a in s["arms"]],
                    plan=dict(green=12.0, greenMinor=9.0, yellow=4.5, allRed=2.0, walk=8.0, pedClear=7.0),
                )
            )
        xws = []
        for x in self.crossings:
            o = dict(id=x["id"], x=r1(x["x"]), z=r1(x["z"]), h=round(x["h"], 3), len=r1(x["len"]), w=x["w"], e=x["e"], walk=x["walk"])
            if x["sig"] is not None:
                o["sig"] = x["sig"]
            if x["j"] is not None:
                o["j"] = x["j"]
            if x.get("note"):
                o["note"] = x["note"]
            xws.append(o)
        halte = [
            dict(id=h["id"], name=h["name"], street=h["street"], lane=h["lane"], s=r1(h["s"]), x=r1(h["x"]), z=r1(h["z"]), h=round(h["h"], 3), side=h["side"], shelter=P1(h["shelter"]), road=h["edge"])
            for h in self.halte
        ]
        walks = dict(
            nodes=PL(self.wnodes),
            edges=[dict(a=w["a"], b=w["b"], k=w["k"], p=PL(simplify(w["p"], 0.05)), **({"x": w["x"]} if "x" in w else {})) for w in self.wedges],
            deco=[PL(simplify(p, 0.05)) for p in self.wdeco],
        )
        bld = []
        for b in self.buildings:
            o = dict(p=PL(b["p"]), f=b["f"], k=b["k"], r=b["r"], c=b["c"])
            if "obb" in b:
                o["obb"] = [r1(b["obb"][0]), r1(b["obb"][1]), r1(b["obb"][2]), r1(b["obb"][3]), round(b["obb"][4], 3)]
            bld.append(o)
        areas = [dict(p=PL(a["p"]), k=a["k"]) for a in self.areas]
        areas.append(dict(p=PL(clip_poly_rect(self.campus_poly, CROP)), k="campus"))
        trees = [[r1(t[0]), r1(t[1]), round(t[2], 2), t[3]] for t in self.trees]
        labels = [dict(t=l["t"], x=r1(l["x"]), z=r1(l["z"]), h=round(l["h"], 3), k=l["k"]) for l in self.labels]
        doc = dict(
            format="liveshuttle-city/1",
            meta=dict(
                title="Sekitar Universitas Ma Chung, Malang",
                attribution=ATTRIBUTION,
                attributionUrl="https://www.openstreetmap.org/copyright",
                license=LICENSE,
                source=SOURCE,
                rawFile="data/osm/machung_raw.json",
                tool="tools/osm_to_city.py",
                projection=dict(
                    type="equirectangular-local", lat0=self.lat0, lon0=self.lon0, mPerDegLat=round(self.mlat, 4), mPerDegLon=round(self.mlon, 4),
                    formula="x = (lon - lon0) * mPerDegLon; z = (lat0 - lat) * mPerDegLat", axes="x ke timur, z ke selatan, y ke atas", units="meter", precision="0,1 m",
                    sameOriginAs="js/data/machung-2d.json",
                ),
                bounds=dict(minX=CROP[0], minZ=CROP[1], maxX=CROP[2], maxZ=CROP[3]),
                driving="kiri",
                droppedWays=self.dropped,
                snappedGaps=[dict(way=x["way"], to=x["to"], gap=x["gap"]) for x in self.snaps],
                roundaboutDirection="searah jarum jam dilihat dari atas (sesuai arah ruas OSM)",
                estimated=[
                    "Jumlah dan lebar lajur diperkirakan dari kelas jalan dan jarak antarjalur, karena OSM di area ini tidak punya tag lanes atau width.",
                    "Garis tengah lajur, tikungan, dan persimpangan dibentuk ulang dan dihaluskan dari garis jalan OSM.",
                    "Tinggi gedung diperkirakan acak berbiji: rumah 1 sampai 2 lantai, gedung kampus 3 sampai 5 lantai, 3,2 m per lantai.",
                    "Lampu lalu lintas adalah lampu simulasi. Data OSM di area ini tidak punya lampu lalu lintas.",
                    "Trotoar, zebra cross, pohon peneduh, dan halte ditambahkan untuk simulasi.",
                    "Tanah dibuat datar. Aslinya daerah ini berbukit.",
                ],
                stats=dict(roads=len(roads), lanes=len(lanes), connectors=len(conns), junctions=len(juncs), roundabouts=len(rings), signals=len(sigs), crossings=len(xws), halte=len(halte), buildings=len(bld), areas=len(areas), trees=len(trees), loopLength=round(self.loop_len), loopLegs=self.loop_legs),
            ),
            roads=roads, lanes=lanes, connectors=conns, junctions=juncs, roundabouts=rings, signals=sigs, crossings=xws,
            halte=halte, walks=walks, buildings=bld, areas=areas, trees=trees, labels=labels,
        )
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        self.say("ditulis", OUT, os.path.getsize(OUT) // 1024, "KB")
        return doc

    def vertex_kind(self, v):
        if v in self.boundary:
            return "batas"
        if v in self.ring_of_vertex:
            return "bundaran"
        if v in self.dead:
            return "buntu"
        return "simpang"

    def run(self):
        self.load()
        self.drop_ways()
        self.snap_dangles()
        self.build_edges()
        self.merge_degree2()
        self.estimate_lanes()
        self.build_rings()
        self.build_junctions()
        self.choose_signals()
        self.compute_trims(set(self.signal_roots))
        self.build_lanes()
        self.build_regular()
        self.build_dead_ends()
        self.build_ring_junctions()
        self.scc()
        self.build_signals_and_crossings()
        self.build_halte()
        self.build_walks()
        self.build_scenery()
        return self.output()


# ---------------------------------------------------------------- pratinjau


def draw_png(doc, path, scale=1.6):
    from PIL import Image, ImageDraw

    b = doc["meta"]["bounds"]
    W = int((b["maxX"] - b["minX"]) * scale)
    H = int((b["maxZ"] - b["minZ"]) * scale)
    img = Image.new("RGB", (W, H), (236, 234, 222))
    dr = ImageDraw.Draw(img)

    def T(p):
        return ((p[0] - b["minX"]) * scale, (p[1] - b["minZ"]) * scale)

    col = {"grass": (190, 220, 160), "park": (170, 215, 150), "garden": (175, 215, 150), "wood": (130, 185, 120), "scrub": (160, 200, 140), "orchard": (160, 205, 130), "farmland": (225, 225, 170), "pitch": (150, 205, 150), "water": (150, 190, 230), "cemetery": (190, 210, 180), "campus": (236, 222, 205)}
    for a in doc["areas"]:
        if a["k"] == "campus":
            dr.polygon([T(p) for p in a["p"]], outline=(220, 120, 80))
        else:
            dr.polygon([T(p) for p in a["p"]], fill=col.get(a["k"], (200, 200, 200)))
    for pl in doc["walks"].get("deco", []):
        dr.line([T(p) for p in pl], fill=(235, 190, 150), width=max(1, int(1.8 * scale)))
    for we in doc["walks"]["edges"]:
        if we["k"] == "w":
            dr.line([T(p) for p in we["p"]], fill=(200, 196, 186), width=max(1, int(1.8 * scale)))
    for r in doc["roads"]:
        pts = r["p"]
        wpx = max(1, int(2 * r["half"] * scale))
        dr.line([T(p) for p in pts], fill=(150, 150, 158) if r["route"] else (185, 180, 175), width=wpx)
    for j in doc["junctions"]:
        if len(j["poly"]) >= 3:
            dr.polygon([T(p) for p in j["poly"]], fill=(150, 150, 158))
    for rg in doc["roundabouts"]:
        c = T((rg["x"], rg["z"]))
        ro = (rg["r"] + rg["w"] / 2) * scale
        ri = (rg["r"] - rg["w"] / 2) * scale
        dr.ellipse([c[0] - ro, c[1] - ro, c[0] + ro, c[1] + ro], fill=(150, 150, 158))
        dr.ellipse([c[0] - ri, c[1] - ri, c[0] + ri, c[1] + ri], fill=(150, 200, 140))
    for bl in doc["buildings"]:
        fill = (230, 150, 110) if bl["k"] == "campus" else (120, 190, 170) if bl["k"] == "mosque" else (205, 190, 175)
        dr.polygon([T(p) for p in bl["p"]], fill=fill, outline=(150, 130, 120))
    for t in doc["trees"]:
        p = T(t)
        rr = 1.6 * scale * t[2]
        dr.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=(90, 150, 90))
    for L in doc["lanes"]:
        c = (40, 110, 200) if L.get("core") else (160, 90, 200)
        dr.line([T(p) for p in L["p"]], fill=c, width=1)
        p0 = T(L["p"][-1])
        dr.ellipse([p0[0] - 1.5, p0[1] - 1.5, p0[0] + 1.5, p0[1] + 1.5], fill=(200, 40, 40))
    for c in doc["connectors"]:
        pts = bezier(*[tuple(p) for p in c["b"]]) if "b" in c else [tuple(p) for p in c["p"]]
        colr = {0: (30, 160, 80), 1: (230, 150, 0), 2: (220, 60, 60)}[c["r"]]
        dr.line([T(p) for p in pts], fill=colr, width=1)
    for x in doc["crossings"]:
        d = unit(x["h"])
        n = left(d)
        c = (x["x"], x["z"])
        a = add(c, mul(n, x["len"] / 2))
        bb = sub(c, mul(n, x["len"] / 2))
        dr.line([T(a), T(bb)], fill=(255, 255, 255), width=max(2, int(3 * scale)))
    for seq in doc.get("_loop", []):
        pts = []
        for item in seq:
            if isinstance(item, tuple):
                c = doc["connectors"][item[1]]
                pts += bezier(*[tuple(p) for p in c["b"]]) if "b" in c else [tuple(p) for p in c["p"]]
            else:
                pts += [tuple(p) for p in doc["lanes"][item]["p"]]
        if len(pts) > 1:
            dr.line([T(p) for p in pts], fill=(240, 60, 160), width=3)
    for s in doc["signals"]:
        p = T((s["x"], s["z"]))
        dr.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], outline=(220, 30, 30), width=3)
    for h in doc["halte"]:
        p = T((h["x"], h["z"]))
        dr.rectangle([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], fill=(20, 160, 150), outline=(0, 0, 0))
        dr.text((p[0] + 7, p[1] - 6), h["name"], fill=(0, 60, 60))
    for lb in doc["labels"]:
        dr.text(T((lb["x"], lb["z"])), lb["t"], fill=(60, 60, 60))
    img.save(path)
    print("pratinjau", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", help="simpan gambar pratinjau")
    ap.add_argument("--scale", type=float, default=1.6)
    args = ap.parse_args()
    with open(RAW, encoding="utf-8") as f:
        raw = json.load(f)
    city = City(raw)
    doc = city.run()
    if args.png:
        doc["_loop"] = city.loop_paths
        draw_png(doc, args.png, args.scale)


if __name__ == "__main__":
    main()
