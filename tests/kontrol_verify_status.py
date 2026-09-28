"""QA mandiri: baris status muat (2 baris desktop, 3 baris ponsel) untuk semua jenis kalimat.

Skenario: melaju biasa, mendekati bundaran, di bundaran, berayun (Ld 2), memotong tikungan (Ld 18),
diambil alih, mulai dari diam. Status dicuplik tiap 150 ms; dicatat bila teksnya terpotong.
Pemakaian: python3 tests/kontrol_verify_status.py [--mobile]
"""
import sys
import time

from kontrol_verify_util import Session

MOBILE = "--mobile" in sys.argv
T = "m" if MOBILE else "d"

SAMPLER = """() => {
  if (window.__kvStat) return window.__kvStat;
  const st = window.__kvStat = { seen: {}, clipped: {} };
  setInterval(() => {
    const el = document.querySelector('.sim-status');
    if (!el) return;
    const text = el.textContent.replace(/[0-9]+([,][0-9]+)?/g, '#');
    st.seen[text] = (st.seen[text] || 0) + 1;
    if (el.scrollHeight > el.clientHeight + 2) st.clipped[text] = el.textContent;
  }, 150);
  return st;
}"""

with Session(mobile=MOBILE) as s:
    s.open_lesson()
    s.page.evaluate(SAMPLER)
    s.speed("2x")
    time.sleep(20)
    s.set_slider("Lookahead Ld", 2)
    time.sleep(15)
    s.set_slider("Lookahead Ld", 18)
    time.sleep(35)
    s.set_slider("Lookahead Ld", 8)
    s.click_text(".lesson-kontrol .result-row .btn", "Uji dari diam")
    time.sleep(25)
    st = s.page.evaluate(SAMPLER)
    print("jenis status:", len(st["seen"]))
    for k, v in sorted(st["seen"].items(), key=lambda kv: -kv[1]):
        print(f"  {v:4d}  {k}")
    print("terpotong:", st["clipped"] or "tidak ada")
    print("msgs:", s.msgs)
    sys.exit(1 if st["clipped"] or s.msgs else 0)
