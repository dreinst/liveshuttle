"""Diagnosa keluar jalan: jalankan fisika tanpa menggambar, kumpulkan kejadian keluar jalan,
lalu gambar tiap klaster di atas geometri peta (aspal, persimpangan, lajur, konektor, jejak kendaraan).
Pemakaian: python3 sim3d_peta_offroad.py MENIT"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright, SHOTS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 10
with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.keyboard.press("Space")
    page.evaluate(f"() => window.__sim3d.debug.runSteps({int(minutes * 3600)})")
    ev = page.evaluate("() => window.__sim3d.debug.offRoadEvents()")
    s = snap(page)
    b.close()
print("kejadian", len(ev), "inv", s["invariants"]["redLight"], s["invariants"]["pedContact"])
doc = json.load(open(os.path.join(ROOT, "js/sim3d/data/machung-city.json")))
# klaster sederhana (radius 12 m)
clusters = []
for e in ev:
    for c in clusters:
        if math.hypot(c["x"] - e[0], c["z"] - e[1]) < 12:
            c["ev"].append(e)
            break
    else:
        clusters.append({"x": e[0], "z": e[1], "ev": [e]})
print("klaster", len(clusters))


def bez(bp, n=24):
    out = []
    for k in range(n + 1):
        t = k / n
        u = 1 - t
        out.append((u**3 * bp[0][0] + 3 * u * u * t * bp[1][0] + 3 * u * t * t * bp[2][0] + t**3 * bp[3][0], u**3 * bp[0][1] + 3 * u * u * t * bp[1][1] + 3 * u * t * t * bp[2][1] + t**3 * bp[3][1]))
    return out


out_dir = os.path.join(SHOTS, "offroad")
os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    os.remove(os.path.join(out_dir, f))
for ci, c in enumerate(clusters[:30]):
    S = 14
    R = 22
    x0, z0 = c["x"] - R, c["z"] - R
    img = Image.new("RGB", (2 * R * S, 2 * R * S), (236, 234, 222))
    dr = ImageDraw.Draw(img)
    T = lambda p: ((p[0] - x0) * S, (p[1] - z0) * S)
    near = lambda pts: any(abs(p[0] - c["x"]) < R + 20 and abs(p[1] - c["z"]) < R + 20 for p in pts)
    for r in doc["roads"]:
        if not near(r["p"]):
            continue
        # pita aspal
        pts = r["p"]
        half = r["half"]
        for i in range(len(pts) - 1):
            a, bb = pts[i], pts[i + 1]
            L = math.hypot(bb[0] - a[0], bb[1] - a[1]) or 1
            nx, nz = (bb[1] - a[1]) / L, -(bb[0] - a[0]) / L
            dr.polygon([T((a[0] + nx * half, a[1] + nz * half)), T((bb[0] + nx * half, bb[1] + nz * half)), T((bb[0] - nx * half, bb[1] - nz * half)), T((a[0] - nx * half, a[1] - nz * half))], fill=(160, 160, 168))
    for j in doc["junctions"]:
        if len(j["poly"]) >= 3 and near(j["poly"]):
            dr.polygon([T(p) for p in j["poly"]], fill=(150, 150, 175), outline=(90, 90, 200))
    for rg in doc["roundabouts"]:
        if math.hypot(rg["x"] - c["x"], rg["z"] - c["z"]) < R + rg["r"] + 10:
            cc = T((rg["x"], rg["z"]))
            ro = (rg["r"] + rg["w"] / 2) * S
            ri = (rg["r"] - rg["w"] / 2) * S
            dr.ellipse([cc[0] - ro, cc[1] - ro, cc[0] + ro, cc[1] + ro], fill=(160, 160, 168))
            dr.ellipse([cc[0] - ri, cc[1] - ri, cc[0] + ri, cc[1] + ri], fill=(150, 200, 140))
    for L in doc["lanes"]:
        if near(L["p"]):
            dr.line([T(p) for p in L["p"]], fill=(40, 110, 200), width=2)
    for k in doc["connectors"]:
        pts = bez(k["b"]) if "b" in k else k["p"]
        if near(pts):
            dr.line([T(p) for p in pts], fill={0: (30, 160, 80), 1: (230, 150, 0), 2: (220, 60, 60)}[k["r"]], width=2)
    for e in c["ev"][:12]:
        x, z, lid, lk, h, ln, hw, typ = e[:8]
        cs, sn = math.cos(h), math.sin(h)
        hl = ln / 2
        corners = [(x + cs * u * hl - sn * w * hw, z + sn * u * hl + cs * w * hw) for u, w in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
        dr.polygon([T(p) for p in corners], outline=(200, 0, 0))
    e0 = c["ev"][0]
    dr.text((6, 6), f"({c['x']:.1f},{c['z']:.1f}) n={len(c['ev'])} link={sorted(set(e[2] for e in c['ev']))} {sorted(set(e[3] for e in c['ev']))} {sorted(set(e[7] for e in c['ev']))}", fill=(0, 0, 0))
    img.save(os.path.join(out_dir, f"c{ci:02d}.png"))
for ci, c in enumerate(clusters):
    print(ci, round(c["x"], 1), round(c["z"], 1), len(c["ev"]), sorted(set(e[2] for e in c["ev"])), sorted(set(e[3] for e in c["ev"])), sorted(set(e[7] for e in c["ev"])), "lat", sorted(set(round(e[8], 2) for e in c["ev"])))
