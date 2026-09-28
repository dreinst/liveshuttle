"""Jalankan ulang skrip QA pelajaran milik agen lain terhadap server situs (port 8221, atau env PORT).

Skrip aslinya tidak diubah. Sebelum dijalankan, teksnya disesuaikan di memori:
kunci progres lama diganti liveshuttle.progress.v1, port diganti 8221, dan folder tangkapan
layar dialihkan ke tests/shots/situs/rerun/ supaya hasil agen lain tidak tertimpa.

Pemakaian: python3 tests/situs_rerun_lesson_qa.py kuis_indep_qa.py [--mobile] [argumen lain]
"""

import os
import re
import sys

import types

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = os.environ.get("PORT", "8221")
script = sys.argv[1]
rest = sys.argv[2:]


def adapt(src):
    src = src.replace("simotonom.progress.v1", "liveshuttle.progress.v1")
    src = re.sub(r"tests/shots/", "tests/shots/situs/rerun/", src)
    src = re.sub(r"(['\"])shots/", r"\1shots/situs/rerun/", src)
    src = src.replace('"shots", "', '"shots", "situs", "rerun", "')
    src = re.sub(r"127\.0\.0\.1:8\d\d\d", f"127.0.0.1:{PORT}", src)
    return src


sys.argv = [script, *rest, "--port", PORT]

# modul bantu milik agen lain (misalnya rute_util.py) juga menyimpan port di dalamnya:
# muat dengan penyesuaian yang sama sebelum skrip utama mengimpornya
for name in os.listdir(HERE):
    if name.endswith("_util.py") and not name.startswith("situs_"):
        mod_name = name[:-3]
        mod = types.ModuleType(mod_name)
        mod.__file__ = os.path.join(HERE, name)
        sys.modules[mod_name] = mod
        try:
            exec(compile(adapt(open(mod.__file__, encoding="utf-8").read()), name, "exec"), mod.__dict__)
        except Exception:
            del sys.modules[mod_name]

src = adapt(open(os.path.join(HERE, script), encoding="utf-8").read())
sys.path.insert(0, HERE)
os.chdir(os.path.dirname(HERE))
os.makedirs(os.path.join(HERE, "shots", "situs", "rerun"), exist_ok=True)
exec(compile(src, script, "exec"), {"__name__": "__main__", "__file__": os.path.join(HERE, script)})
