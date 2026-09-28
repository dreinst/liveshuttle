"""Cari objek simulator yang masih tertahan setelah destroy() lewat heap snapshot."""
import json
import time

from sim3d_common import BASE, launch, new_page, wait_ready, sync_playwright


def snapshot_counts(cdp, names):
    chunks = []
    cdp.on("HeapProfiler.addHeapSnapshotChunk", lambda e: chunks.append(e["chunk"]))
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.takeHeapSnapshot", {"reportProgress": False})
    data = json.loads("".join(chunks))
    meta = data["snapshot"]["meta"]
    fields = meta["node_fields"]
    nf = len(fields)
    types = meta["node_types"][0]
    strings = data["strings"]
    nodes = data["nodes"]
    ti = fields.index("type")
    ni = fields.index("name")
    counts = {n: 0 for n in names}
    detached = 0
    for i in range(0, len(nodes), nf):
        name = strings[nodes[i + ni]]
        t = types[nodes[i + ti]]
        if t == "object" and name in counts:
            counts[name] += 1
        if name.startswith("Detached "):
            detached += 1
    return counts, detached


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    cdp = ctx.new_cdp_session(page)
    cdp.send("HeapProfiler.enable")
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    for i in range(6):
        page.evaluate("() => window.__harness.destroy()")
        time.sleep(0.3)
        page.evaluate("() => window.__harness.mount('bebas')")
        wait_ready(page)
        time.sleep(1.0)
    page.evaluate("() => window.__harness.destroy()")
    time.sleep(0.5)
    names = ["App", "Planner", "Traffic", "Hud", "WebGLRenderer", "Scene", "Mesh", "InstancedMesh", "HTMLCanvasElement", "HTMLLinkElement", "HTMLDivElement", "HTMLButtonElement", "Tutorial", "Signals", "BufferGeometry"]
    counts, detached = snapshot_counts(cdp, names)
    print("setelah 4 kali mount dan destroy:", counts, "detached:", detached)
    b.close()
