"""Periksa data peta: setiap titik trotoar (termasuk geser pejalan kaki 0,45 m) harus berada di luar
koridor perisai kendaraan terlebar (shuttle): 1,05 + 0,45 + 0,3 + sapuan bodi setempat dari garis
tengah setiap lajur dan konektor. Sapuan dihitung persis seperti js/sim3d/city.js."""
import collections
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import osm_to_city as M  # noqa: E402

d = json.load(open(os.path.join(ROOT, 'js/sim3d/data/machung-city.json')))
G=4.0
grid=collections.defaultdict(list)
for c in d['connectors']:
    for q,sw in M.City.js_sweep_samples(c['b'] if 'b' in c else c['p'], True if 'b' in c else None):
        grid[(int(q[0]//G),int(q[1]//G))].append((q,sw))
for L in d['lanes']:
    # JSON lanes are already simplified and rounded; JS uses them as is
    for q,sw in M.City.js_sweep_samples(L['p'], None):
        grid[(int(q[0]//G),int(q[1]//G))].append((q,sw))
worst=[]
for i,e in enumerate(d['walks']['edges']):
    if e['k']!='w': continue
    for w in M.resample(e['p'],0.5):
        gx,gz=int(w[0]//G),int(w[1]//G)
        m=9
        for dx in (-1,0,1):
            for dz in (-1,0,1):
                for q,sw in grid.get((gx+dx,gz+dz),()):
                    m=min(m, math.hypot(w[0]-q[0],w[1]-q[1])-(2.25+sw))
        if m<0: worst.append((round(m,3),i,[round(v,1) for v in w]))
worst.sort()
print('pelanggaran', len(worst), worst[:10])
print('LULUS' if not worst else 'GAGAL')
