"""Diagnosa pejalan kaki: di komponen trotoar mana mereka berada dan apakah mereka menyeberang."""
import collections
import json
import math
import os
import sys

from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, "js/sim3d/data/machung-city.json")))
W = d["walks"]
adj = collections.defaultdict(list)
for i, e in enumerate(W["edges"]):
    adj[e["a"]].append(i)
    adj[e["b"]].append(i)
comp = {}
cid = 0
for i in range(len(W["edges"])):
    if i in comp:
        continue
    st = [i]
    comp[i] = cid
    while st:
        u = st.pop()
        e = W["edges"][u]
        for nd in (e["a"], e["b"]):
            for v in adj[nd]:
                if v not in comp:
                    comp[v] = cid
                    st.append(v)
    cid += 1
xcomps = {comp[i] for i, e in enumerate(W["edges"]) if e["k"] == "x"}
minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 2
with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.keyboard.press("Space")
    for k in range(int(minutes * 2)):
        page.evaluate("() => window.__sim3d.debug.runSteps(1800)")
        pl = page.evaluate("() => window.__sim3d.debug.pedList()")
        s = snap(page)
        onx = [q for q in pl if q["edge"] >= 0 and comp.get(q["edge"]) in xcomps]
        print(round(s["simTime"]), "peds", len(pl), "on crossing comps", len(onx), collections.Counter(q["state"] for q in pl), "xing", s["traffic"]["crossings"], "gaveUp", s["traffic"]["gaveUp"], "blocked", s["traffic"]["blockedSteps"], "inv", s["invariants"]["pedContact"], s["invariants"]["redLight"])
    print([q for q in pl if q["state"] != "walk"][:10])
    print("LOG", log[:5])
    b.close()
