"""Rangkaian bingkai LiDAR saja (kamera mati) untuk menilai apakah gambarnya tenang.
Simpan 16 bingkai tiap ~70 ms, lalu satu lembar kontak dan potongan diperbesar."""
import sys
from io import BytesIO
from PIL import Image
from persepsi_verify_util import Session, dump, SHOTS

mobile = "--mobile" in sys.argv
tag = "m" if mobile else "d"
with Session(mobile=mobile) as S:
    S.go()
    S.toggle("Kamera")  # matikan kamera
    S.toggle("LiDAR")
    S.page.evaluate("() => window.scrollTo(0, 0)")
    S.page.wait_for_timeout(3000)
    frames = []
    for i in range(16):
        png = S.page.locator(".sim-canvas").first.screenshot()
        frames.append(Image.open(BytesIO(png)).convert("RGB"))
        S.page.wait_for_timeout(40)
    w, h = frames[0].size
    sheet = Image.new("RGB", (w * 2, h * 2))
    for k, i in enumerate([0, 5, 10, 15]):
        sheet.paste(frames[i], ((k % 2) * w, (k // 2) * h))
    sheet.save(SHOTS + f"{tag}-lidar-sheet.png")
    # potongan diperbesar di sekitar mobil (sepertiga kiri) untuk 4 bingkai berurutan
    cw, ch = w // 3, h // 2
    crops = [f.crop((w // 6, h // 4, w // 6 + cw, h // 4 + ch)).resize((cw * 2, ch * 2), Image.NEAREST) for f in frames[:4]]
    z = Image.new("RGB", (cw * 4, ch * 4))
    for k, c in enumerate(crops):
        z.paste(c, ((k % 2) * cw * 2, (k // 2) * ch * 2))
    z.save(SHOTS + f"{tag}-lidar-zoom.png")
    dump({"errors": S.errors, "size": [w, h]})
