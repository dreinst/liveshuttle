"""Seberapa tenang LiDAR? Rekam bingkai berturut-turut (60 fps, di dalam halaman) lalu potong
gambar yang distabilkan pada satu benda (mobil parkir, mobil yang bergerak, dinding gedung),
sehingga gerak kamera tidak ikut terhitung. Hanya untuk uji: view dan scene diekspos lewat page.route.
Pemakaian: python3 tests/persepsi_verify_calm.py [--mobile] [--speed 1]"""
import base64
import json
import sys
from io import BytesIO

import numpy as np
from PIL import Image
from persepsi_verify_util import Session, SHOTS, BASE, dump

mobile = "--mobile" in sys.argv
tag = "m" if mobile else "d"
NF = 40


def patch(route):
    resp = route.fetch()
    body = resp.text()
    body = body.replace("const view = ctx.createView({", "const view = window.__pv = ctx.createView({", 1)
    body = body.replace("const scene = createScene({ street, seed: 11 });", "const scene = window.__ps = createScene({ street, seed: 11 });", 1)
    route.fulfill(response=resp, body=body, headers={**resp.headers, "content-type": "text/javascript"})


CAP = r"""
async (nf) => {
  const cv = document.querySelector('.sim-canvas');
  const out = [];
  for (let i = 0; i < nf; i++) {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const v = window.__pv, sc = window.__ps;
    const cam = { x: v.camera.x, y: v.camera.y, scale: v.camera.scale, w: v.width, h: v.height, dpr: v.dpr };
    const objs = {};
    for (const c of sc.street.parked) objs[c.id] = [c.x, c.y];
    for (const o of sc.traffic) objs[o.id] = [o.x, o.y];
    out.push({ t: sc.state.time, cam, objs, png: cv.toDataURL('image/png') });
  }
  return out;
}
"""

with Session(mobile=mobile) as S:
    S.page.route("**/js/lessons/persepsi.js", patch)
    S.go()
    S.toggle("Kamera")
    S.toggle("LiDAR")
    S.page.evaluate("() => window.scrollTo(0, 0)")
    S.page.wait_for_timeout(2500)
    frames = S.page.evaluate(CAP, NF)
    errors = list(S.errors)

imgs = [Image.open(BytesIO(base64.b64decode(f["png"].split(",")[1]))).convert("RGB") for f in frames]
dts = [round(frames[i + 1]["t"] - frames[i]["t"], 3) for i in range(len(frames) - 1)]


def to_px(f, x, y):
    c = f["cam"]
    return ((x - c["x"]) * c["scale"] + c["w"] / 2) * c["dpr"], ((y - c["y"]) * c["scale"] + c["h"] / 2) * c["dpr"]


def pick(pred):
    f0, f1 = frames[0], frames[-1]
    best = None
    for oid in f0["objs"]:
        if oid not in f1["objs"] or not pred(oid):
            continue
        ok = True
        for f in (f0, f1):
            x, y = to_px(f, *f["objs"][oid])
            W, H = f["cam"]["w"] * f["cam"]["dpr"], f["cam"]["h"] * f["cam"]["dpr"]
            if not (80 < x < W - 80 and 60 < y < H - 60):
                ok = False
        if ok:
            best = oid
            break
    return best


def strip(oid, name, half=70):
    crops = []
    for f, im in zip(frames, imgs):
        x, y = to_px(f, *f["objs"][oid])
        s = half * f["cam"]["dpr"]
        crops.append(np.asarray(im.crop((int(round(x - s)), int(round(y - s)), int(round(x + s)), int(round(y + s)))).resize((2 * half, 2 * half)), dtype=np.int16))
    # "kedip": rata-rata perubahan piksel sian antarbingkai dalam potongan yang distabilkan
    cyan = [((c[:, :, 2] > 150) & (c[:, :, 1] > 150) & (c[:, :, 0] < 140)) for c in crops]
    flick = []
    for i in range(len(crops) - 1):
        m = cyan[i] | cyan[i + 1]
        d = np.abs(crops[i + 1] - crops[i]).sum(axis=2)
        flick.append(float((d[m] > 60).mean()) if m.any() else 0.0)
    sheet = Image.new("RGB", (2 * half * 8, 2 * half * 2))
    for k in range(16):
        sheet.paste(Image.fromarray(crops[k].astype(np.uint8)), ((k % 8) * 2 * half, (k // 8) * 2 * half))
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    sheet.save(SHOTS + f"{tag}-calm-{name}.png")
    return {"id": oid, "cyanPx": int(np.mean([c.sum() for c in cyan])), "changedShareMean": round(float(np.mean(flick)), 3), "changedShareMax": round(float(np.max(flick)), 3)}


res = {"frameDt": dts[:12], "errors": errors}
pk = pick(lambda o: o.startswith("parkir"))
if pk:
    res["parked"] = strip(pk, "parked")
mv = pick(lambda o: o.startswith("mobil") or o.startswith("angkot"))
if mv:
    res["moving"] = strip(mv, "moving")
dump(res)
