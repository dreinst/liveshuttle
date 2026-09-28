"""Pembantu QA independen pelajaran Sensor (port 8262)."""
import time

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8262/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor-qa/"
IGNORE = ("GPU stall due to ReadPixels",)


def launch(p, gpu=False):
    args = ["--use-angle=metal", "--enable-gpu"] if gpu else []
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, reduced=False):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                                  device_scale_factor=2, reduced_motion="reduce" if reduced else "no-preference")
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900},
                                  reduced_motion="reduce" if reduced else "no-preference")
    page = ctx.new_page()
    log = []

    def on_console(m):
        if m.type in ("error", "warning") and not any(s in m.text for s in IGNORE):
            log.append(f"{m.type}: {m.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: log.append(f"requestfailed: {r.url} {r.failure}"))
    return ctx, page, log


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def open_lesson(page, clear=True):
    page.goto(BASE + "#/")
    if clear:
        page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/sensor")
    wait_ready(page)


def wait_ready(page, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = hook(page)
        if h["lessonId"] == "sensor" and h["lessonStatus"] == "ready" and page.evaluate("() => !!window.__lessonSafety"):
            return True
        page.wait_for_timeout(100)
    raise RuntimeError("pelajaran tidak siap")


def go_step(page, i):
    page.locator(f".step-dot[data-go='{i}']").first.click()
    page.wait_for_timeout(250)
    assert hook(page)["stepIndex"] == i, hook(page)["stepIndex"]


def toggle(page, name, want):
    t = page.locator(".ctl-toggle", has_text=name).first
    cur = t.get_attribute("aria-checked") == "true"
    if cur != want:
        t.click()
        page.wait_for_timeout(80)
    assert (t.get_attribute("aria-checked") == "true") == want, name


def weather(page, label):
    page.locator("[role=radiogroup][aria-label='Kondisi cuaca'] [role=radio]", has_text=label).first.click()
    page.wait_for_timeout(80)


def sim_speed(page, label):
    page.locator("[role=radiogroup][aria-label='Kecepatan simulasi'] [role=radio]", has_text=label).first.click()
    page.wait_for_timeout(80)


def safety(page):
    return page.evaluate("() => { const s = window.__lessonSafety.snapshot(); delete s.events; return s; }")


def wait_task(page, task, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(200)
    return None


def hold(page, locator, ms, mobile=False):
    """Tahan tombol lewat pointer sungguhan (sentuh di ponsel, tetikus di desktop)."""
    box = locator.bounding_box()
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    if mobile:
        cdp = page.context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        page.wait_for_timeout(ms)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        cdp.detach()
    else:
        page.mouse.move(x, y)
        page.mouse.down()
        page.wait_for_timeout(ms)
        page.mouse.up()


def ego_s(page):
    return page.evaluate("""() => { const sc = window.__lessonSafety.scene; const f = sc.frame.toFrame(sc.ego.x, sc.ego.y);
      return { s: f.s, d: f.d, v: sc.ego.speed, front: f.s + sc.ego.length / 2, rear: f.s - sc.ego.length / 2 }; }""")
