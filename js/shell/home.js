// Halaman beranda.

import { LESSONS } from '../lessons/index.js';
import { progress } from './progress.js';
import { icon } from '../engine/icons.js';
import { mountAmbient } from './ambient.js';
import { toast } from './toast.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const PIPELINE = [
  {
    title: 'Sensor',
    verb: 'mengukur',
    color: 'var(--kamera)',
    icon: 'sensor',
    text: 'Kamera, LiDAR, radar, dan ultrasonik mencatat posisi dan gerak benda di sekitar kendaraan.',
    lessons: ['sensor'],
  },
  {
    title: 'Persepsi',
    verb: 'memahami',
    color: 'var(--lidar)',
    icon: 'brain',
    text: 'Data sensor digabung menjadi daftar objek, misalnya angkot atau pejalan kaki. Kendaraan juga menaksir posisinya sendiri di peta.',
    lessons: ['persepsi', 'lokalisasi'],
  },
  {
    title: 'Perencanaan',
    verb: 'memilih',
    color: 'var(--radar)',
    icon: 'route',
    text: 'Rute dipilih di jaringan jalan, lalu tindakan di tiap saat, misalnya menunggu lampu hijau atau memberi jalan kepada penyeberang.',
    lessons: ['rute', 'keputusan'],
  },
  {
    title: 'Kontrol',
    verb: 'menjalankan',
    color: 'var(--ultrasonik)',
    icon: 'steering',
    text: 'Setir, gas, dan rem diatur supaya kendaraan mengikuti rencana dengan halus dan tetap menjaga jarak aman.',
    lessons: ['kontrol', 'jarak-aman'],
  },
];

/** Ilustrasi isometrik untuk kartu Shuttle 3D: jalan kampus, bundaran, halte, dan shuttle (SVG buatan kode). */
function isoCampus() {
  const P = (x, y, z = 0) => [160 + (x - y) * 14, 34 + (x + y) * 7 - z * 14];
  const pts = (arr) => arr.map((p) => P(...p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = (arr, fill, extra = '') => `<polygon points="${pts(arr)}" fill="${fill}" ${extra}/>`;
  const box = (x0, y0, x1, y1, h, top, left, right) =>
    poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]], left) +
    poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], right) +
    poly([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], top);
  let s = '';
  // lingkaran di bidang tanah (bundaran), didekati dengan poligon
  const disc = (cx, cy, r, fill) => poly(Array.from({ length: 28 }, (_, i) => [cx + r * Math.cos((i / 28) * 2 * Math.PI), cy + r * Math.sin((i / 28) * 2 * Math.PI)]), fill);
  s += poly([[0, 0], [10, 0], [10, 10], [0, 10]], '#13261f');
  s += poly([[0, 4.3], [10, 4.3], [10, 5.7], [0, 5.7]], '#2b3240');
  s += poly([[4.3, 0], [5.7, 0], [5.7, 10], [4.3, 10]], '#2b3240');
  s += disc(5, 5, 1.55, '#2b3240');
  s += disc(5, 5, 0.75, '#1d4a33');
  for (let x = 0.4; x < 10; x += 1.1) if (x < 3.2 || x > 6.8) s += `<line x1="${P(x, 5)[0]}" y1="${P(x, 5)[1]}" x2="${P(x + 0.5, 5)[0]}" y2="${P(x + 0.5, 5)[1]}" stroke="#e5e7eb" stroke-width="1.1" stroke-opacity=".55"/>`;
  for (let y = 0.4; y < 10; y += 1.1) if (y < 3.2 || y > 6.8) s += `<line x1="${P(5, y)[0]}" y1="${P(5, y)[1]}" x2="${P(5, y + 0.5)[0]}" y2="${P(5, y + 0.5)[1]}" stroke="#e5e7eb" stroke-width="1.1" stroke-opacity=".55"/>`;
  const buildings = [
    [0.6, 0.6, 3.6, 3.4, 3.2],
    [6.4, 0.5, 9.3, 2.2, 4.6],
    [6.4, 2.6, 8.2, 3.7, 1.8],
    [0.6, 6.4, 2.4, 9.2, 2.2],
    [2.8, 6.4, 3.8, 8.0, 3.8],
    [6.5, 6.6, 9.2, 9.2, 2.8],
  ].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const car = (x0, y0, x1, y1, color, dark, h = 0.32) => box(x0, y0, x1, y1, h, color, dark, dark);
  // satu cincin jangkauan LiDAR yang diam dan samar di sekitar shuttle
  const [cx, cy] = P(2.55, 4.72, 0.35);
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${(2.6 * 19.8).toFixed(1)}" ry="${(2.6 * 9.9).toFixed(1)}" fill="rgba(34,211,238,0.05)" stroke="#22d3ee" stroke-width="1.1" stroke-opacity=".35" stroke-dasharray="3 5"/>`;
  for (const [x0, y0, x1, y1, h] of buildings) {
    if (x0 + y0 > 9) continue;
    s += box(x0, y0, x1, y1, h, '#334766', '#1e293b', '#26344d');
  }
  // halte: tiang dan pelat biru di trotoar
  const [hx, hy] = P(2.1, 3.95, 0);
  const [tx, ty] = P(2.1, 3.95, 1.25);
  s += `<line x1="${hx}" y1="${hy}" x2="${tx}" y2="${ty}" stroke="#94a3b8" stroke-width="1.4"/><rect x="${(tx - 5).toFixed(1)}" y="${(ty - 7).toFixed(1)}" width="10" height="9" rx="2" fill="#2563eb" stroke="#f8fafc" stroke-width="1"/>`;
  // shuttle otonom: kapsul putih dengan kaca gelap dan modul sensor toska di atap
  s += car(1.75, 4.36, 3.35, 4.98, '#e2e8f0', '#94a3b8', 0.62);
  s += poly([[1.85, 4.44, 0.63], [3.25, 4.44, 0.63], [3.25, 4.9, 0.63], [1.85, 4.9, 0.63]], '#0f172a');
  s += poly([[2.35, 4.55, 0.66], [2.75, 4.55, 0.66], [2.75, 4.79, 0.66], [2.35, 4.79, 0.66]], '#2dd4bf');
  s += car(7.1, 5.05, 8.0, 5.55, '#6cc3ea', '#3b8fb4', 0.42);
  s += car(4.5, 7.3, 4.75, 7.9, '#64748b', '#334155', 0.22);
  for (const [x0, y0, x1, y1, h] of buildings) {
    if (x0 + y0 <= 9) continue;
    s += box(x0, y0, x1, y1, h, '#334766', '#1e293b', '#26344d');
  }
  // titik LiDAR lembut yang mengenai dinding gedung terdekat
  const hits = [[3.6, 1.6, 1.2], [3.6, 2.4, 0.8], [3.6, 3.0, 1.4], [2.0, 6.4, 0.9], [1.4, 6.4, 1.6], [3.3, 6.4, 0.6]];
  s += hits.map(([x, y, z]) => `<circle cx="${P(x, y, z)[0].toFixed(1)}" cy="${P(x, y, z)[1].toFixed(1)}" r="1.7" fill="#22d3ee" fill-opacity=".8"/>`).join('');
  return `<svg class="iso-city" viewBox="0 8 320 172" role="img" aria-label="Ilustrasi shuttle otonom di jalan kampus dekat bundaran dan halte">${s}</svg>`;
}

function lessonStatus(l) {
  const p = progress.lesson(l.id);
  if (p.complete) return { cls: 'is-done', text: 'Tuntas', pct: 100 };
  if (p.total && p.doneCount > 0) return { cls: 'is-progress', text: `${p.doneCount} dari ${p.total} tugas`, pct: Math.round((p.doneCount / p.total) * 100) };
  if (p.visited) return { cls: 'is-visited', text: 'Sudah dibuka', pct: 0 };
  return { cls: 'is-new', text: 'Belum dimulai', pct: 0 };
}

export function renderHome(main, { reducedMotion = false, scrollTo = null } = {}) {
  const next = progress.nextLesson();
  const started = progress.hasAny();
  const page = document.createElement('div');
  page.className = 'page page-home';
  page.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">LiveShuttle</p>
        <h1 class="hero-title" tabindex="-1">Pelajari teknologi transportasi tanpa pengemudi, <span class="text-accent">lalu lihat shuttle otonom beraksi di jalanan sekitar Universitas Ma Chung.</span></h1>
        <p class="hero-lead">Setiap pelajaran berisi penjelasan singkat dan simulasi kecil yang bisa kamu atur sendiri. Petanya diambil dari jalanan Malang, mulai dari kampus Ma Chung sampai sekitar Alun-alun Merdeka.</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/pelajaran/${next.id}" data-el="start">${icon('play')}<span>${started ? 'Lanjutkan belajar' : 'Mulai belajar'}</span></a>
          <a class="btn btn-secondary btn-lg" href="#/shuttle-3d/panduan">${icon('cube')}<span>Buka Shuttle 3D</span></a>
        </div>
        <p class="hero-meta">${LESSONS.length} pelajaran interaktif. Progres tersimpan otomatis di browser ini.</p>
      </div>
      <div class="hero-visual">
        <div class="ambient-frame">
          <div class="ambient-bar">
            <span class="live-dot" aria-hidden="true"></span>
            <span>Villa Puncak Tidar, selatan kampus Ma Chung</span>
            <span class="ambient-keys" aria-hidden="true">
              <span class="key-dot" style="--c: var(--accent)"></span>Shuttle otonom
              <span class="key-dot" style="--c: var(--lidar)"></span>Titik LiDAR
            </span>
          </div>
          <div class="ambient-stage" data-el="ambient"></div>
        </div>
        <p class="ambient-note">Peta dari OpenStreetMap. Gerakan kendaraannya hanya ilustrasi.</p>
      </div>
    </section>

    <section class="section about">
      <div class="about-text">
        <h2 class="section-title">Apa itu transportasi tanpa pengemudi?</h2>
        <p>Kendaraan tanpa pengemudi, misalnya mobil, bus, atau shuttle kampus, berjalan tanpa manusia yang memegang kemudi. Komputernya membaca sensor, mengenali keadaan jalan, memilih tindakan yang aman, lalu mengatur setir, gas, dan rem.</p>
        <p class="muted">Tingkat kemandirian kendaraan dibagi menjadi level 0 sampai 5 menurut standar SAE J3016. Pelajaran pertama dimulai dari situ.</p>
      </div>
      <div class="about-howto">
        <h2 class="section-title">Cara belajar di sini</h2>
        <ol class="howto-list">
          <li><span class="howto-num">1</span><span>Pilih pelajaran. Urutannya mengikuti alur kerja kendaraan otonom, tetapi kamu boleh melompat.</span></li>
          <li><span class="howto-num">2</span><span>Baca langkahnya, lalu coba langsung di simulasi. Latarnya jalanan di sekitar Malang.</span></li>
          <li><span class="howto-num">3</span><span>Kerjakan tugas di tiap langkah. Tugas tercentang sendiri begitu kamu melakukannya.</span></li>
          <li><span class="howto-num">4</span><span>Ikuti shuttle di Shuttle 3D Ma Chung, lalu uji dirimu di Kuis Akhir.</span></li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Alur kerja kendaraan otonom</h2>
        <p class="section-sub">Setiap pelajaran membahas satu bagian dari alur ini.</p>
      </div>
      <ol class="pipeline">
        ${PIPELINE.map(
          (p, i) => `<li class="pipe-step" style="--c: ${p.color}">
            <div class="pipe-top"><span class="pipe-icon">${icon(p.icon)}</span><span class="pipe-index">${i + 1}</span></div>
            <h3 class="pipe-title">${p.title} <span class="pipe-verb">${p.verb}</span></h3>
            <p class="pipe-text">${p.text}</p>
            <div class="pipe-links">${p.lessons
              .map((id) => LESSONS.find((l) => l.id === id))
              .filter(Boolean)
              .map((l) => `<a href="#/pelajaran/${l.id}">${esc(l.title)}${icon('chevronRight')}</a>`)
              .join('')}</div>
          </li>`,
        ).join('')}
      </ol>
    </section>

    <section class="section">
      <div class="sim-card">
        <div class="sim-card-copy">
          <p class="eyebrow">Shuttle 3D Ma Chung</p>
          <h2 class="sim-card-title">Ikuti shuttle otonom keliling kampus</h2>
          <p>Shuttle tanpa pengemudi melaju di jalan sekitar Universitas Ma Chung. Jalannya dibuat dari data OpenStreetMap. Pilih Panduan kalau ingin ditemani langkah demi langkah, atau Jelajah kalau ingin berkeliling sendiri.</p>
          <div class="sim-card-actions">
            <a class="mode-btn is-primary" href="#/shuttle-3d/panduan">
              <span class="mode-icon">${icon('book')}</span>
              <span class="mode-text"><span class="mode-title">Panduan</span><span class="mode-sub">Ditemani langkah demi langkah</span></span>
              ${icon('arrowRight')}
            </a>
            <a class="mode-btn" href="#/shuttle-3d/jelajah">
              <span class="mode-icon">${icon('route')}</span>
              <span class="mode-text"><span class="mode-title">Jelajah</span><span class="mode-sub">Berkeliling dengan caramu sendiri</span></span>
              ${icon('arrowRight')}
            </a>
          </div>
          <p class="sim-card-note">${icon('info')}<span>Butuh WebGL. Di ponsel lama gerakannya bisa terasa lambat. Peta © Kontributor OpenStreetMap.</span></p>
        </div>
        <div class="sim-card-art">${isoCampus()}</div>
      </div>
    </section>

    <section class="section" id="daftar-pelajaran" data-el="lessons">
      <div class="section-head lessons-head">
        <div>
          <h2 class="section-title">Daftar pelajaran</h2>
          <p class="section-sub" data-el="summary"></p>
        </div>
        <div class="lessons-tools">
          <div class="overall-bar" aria-hidden="true"><i data-el="overall"></i></div>
          <div class="reset-wrap" data-el="reset"></div>
        </div>
      </div>
      <ol class="lesson-grid" data-el="grid"></ol>
    </section>

    <footer class="app-footer">
      <div class="footer-brand"><strong>LiveShuttle</strong><span>Belajar transportasi tanpa pengemudi</span></div>
      <p>Materi disederhanakan untuk belajar. Data peta © Kontributor OpenStreetMap (ODbL). Progres hanya tersimpan di browser ini, tanpa akun.</p>
    </footer>`;
  main.append(page);

  const $ = (sel) => page.querySelector(sel);
  const grid = $('[data-el="grid"]');
  const summary = $('[data-el="summary"]');
  const overall = $('[data-el="overall"]');
  const resetWrap = $('[data-el="reset"]');
  const startBtn = $('[data-el="start"]');

  function renderLessons() {
    const nextL = progress.nextLesson();
    const done = progress.completedCount();
    summary.textContent = `${done} dari ${LESSONS.length} pelajaran tuntas.`;
    overall.style.width = `${(done / LESSONS.length) * 100}%`;
    startBtn.href = `#/pelajaran/${nextL.id}`;
    startBtn.querySelector('span').textContent = progress.hasAny() ? 'Lanjutkan belajar' : 'Mulai belajar';
    grid.innerHTML = LESSONS.map((l, i) => {
      const st = lessonStatus(l);
      const isNext = l.id === nextL.id && st.cls !== 'is-done';
      return `<li><a class="lesson-card ${st.cls}${isNext ? ' is-next' : ''}" href="#/pelajaran/${l.id}">
        <span class="lesson-num">${st.cls === 'is-done' ? icon('check') : String(i + 1).padStart(2, '0')}</span>
        <span class="lesson-body">
          <span class="lesson-card-title">${esc(l.title)}${isNext ? '<span class="next-badge">Berikutnya</span>' : ''}</span>
          <span class="lesson-summary">${esc(l.summary)}</span>
          <span class="lesson-status"><span class="status-text">${st.text}</span><span class="mini-bar" aria-hidden="true"><i style="width:${st.pct}%"></i></span></span>
        </span>
      </a></li>`;
    }).join('');
  }

  function renderReset(confirming = false) {
    if (!progress.hasAny()) {
      resetWrap.innerHTML = '';
      return;
    }
    if (!confirming) {
      resetWrap.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-act="ask">${icon('trash')}<span>Atur ulang progres</span></button>`;
    } else {
      resetWrap.innerHTML = `<span class="reset-q">Hapus semua progres?</span>
        <button type="button" class="btn btn-danger btn-sm" data-act="yes">Ya, hapus</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="no">Batal</button>`;
      resetWrap.querySelector('[data-act="no"]').focus();
    }
  }
  resetWrap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'ask') renderReset(true);
    else if (act === 'no') {
      renderReset(false);
      resetWrap.querySelector('button')?.focus();
    } else if (act === 'yes') {
      progress.reset();
      toast('Progres sudah dihapus. Kamu bisa mulai lagi dari awal.', { tone: 'info' });
    }
  });

  renderLessons();
  renderReset();
  const unsub = progress.subscribe(() => {
    renderLessons();
    renderReset();
  });

  let ambient = null;
  try {
    ambient = mountAmbient($('[data-el="ambient"]'), { reducedMotion });
  } catch (err) {
    console.error(err);
  }

  if (scrollTo === 'lessons') requestAnimationFrame(() => $('[data-el="lessons"]').scrollIntoView({ block: 'start' }));

  return {
    focusTarget: $('.hero-title'),
    destroy() {
      unsub();
      ambient?.destroy();
      page.remove();
    },
  };
}
