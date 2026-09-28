"""Tangkapan layar cepat pelajaran Persepsi. Pemakaian: python3 tests/persepsi_look.py NAMA [--mobile] [--step N] [--wait MS] [--full] [--js KODE]"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

args = sys.argv[1:]
name = args[0]
mobile = "--mobile" in args
step = int(args[args.index("--step") + 1]) if "--step" in args else 0
wait = int(args[args.index("--wait") + 1]) if "--wait" in args else 3000
full = "--full" in args
with Session(mobile=mobile) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/persepsi", 800)
    if step:
        s.page.locator(f'.step-dot[data-go="{step}"]').dispatch_event("click")
    if "--js" in args:
        s.page.evaluate(args[args.index("--js") + 1])
    s.page.wait_for_timeout(wait)
    s.shot(name, full=full)
    dump({"hook": s.hook(), "status": s.page.locator(".sim-status").inner_text(), "errors": s.errors})
