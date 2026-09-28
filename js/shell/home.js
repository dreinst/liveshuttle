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
    verb: 'Melihat',
    color: 'var(--kamera)',
    icon: 'sensor',
    text: 'Kamera, LiDAR, radar, dan ultrasonik mengumpulkan data tentang keadaan di sekitar mobil.',
    lessons: ['sensor'],
  },
  {
    title: 'Persepsi',
    verb: 'Memahami',
    color: 'var(--lidar)',
    icon: 'brain',
    text: 'Data mentah diolah menjadi daftar objek beserta posisi dan arah geraknya. Mobil juga menentukan posisinya sendiri.',
    lessons: ['persepsi', 'lokalisasi'],
  },
  {
    title: 'Perencanaan',
    verb: 'Memutuskan',
    color: 'var(--radar)',
    icon: 'route',
    text: 'Mobil memilih rute dan tindakan, misalnya berhenti di lampu merah atau menyalip mobil yang mogok.',
    lessons: ['rute', 'keputusan'],
  },
  {
    title: 'Kontrol',
    verb: 'Bergerak',
    color: 'var(--ultrasonik)',
    icon: 'steering',
    text: 'Setir, gas, dan rem diatur supaya mobil mengikuti rencana dengan mulus dan tetap berjarak aman.',
    lessons: ['kontrol', 'jarak-aman'],
  },
];

/** Ilustrasi kota isometrik untuk kartu simulator 3D (SVG buatan kode). */
function isoCity() {
  const P = (x, y, z = 0) => [160 + (x - y) * 14, 34 + (x + y) * 7 - z * 14];
  const pts = (arr) => arr.map((p) => P(...p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = (arr, fill, extra = '') => `<polygon points="${pts(arr)}" fill="${fill}" ${extra}/>`;
  const box = (x0, y0, x1, y1, h, top, left, right) =>
    poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]], left) +
    poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], right) +
    poly([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], top);
  let s = '';
  s += poly([[0, 0], [10, 0], [10, 10], [0, 10]], '#13261f');
  s += poly([[0, 4.3], [10, 4.3], [10, 5.7], [0, 5.7]], '#2b3240');
  s += poly([[4.3, 0], [5.7, 0], [5.7, 10], [4.3, 10]], '#2b3240');
  for (let x = 0.4; x < 10; x += 1.1) if (x < 4 || x > 5.9) s += `<line x1="${P(x, 5)[0]}" y1="${P(x, 5)[1]}" x2="${P(x + 0.5, 5)[0]}" y2="${P(x + 0.5, 5)[1]}" stroke="#facc15" stroke-width="1.2" stroke-opacity=".8"/>`;
  for (let y = 0.4; y < 10; y += 1.1) if (y < 4 || y > 5.9) s += `<line x1="${P(5, y)[0]}" y1="${P(5, y)[1]}" x2="${P(5, y + 0.5)[0]}" y2="${P(5, y + 0.5)[1]}" stroke="#facc15" stroke-width="1.2" stroke-opacity=".8"/>`;
  const buildings = [
    [0.6, 0.6, 3.6, 3.4, 3.2],
    [6.4, 0.5, 9.3, 2.2, 4.6],
    [6.4, 2.6, 8.2, 3.7, 1.8],
    [0.6, 6.4, 2.4, 9.2, 2.2],
    [2.8, 6.4, 3.8, 8.0, 3.8],
    [6.5, 6.6, 9.2, 9.2, 2.8],
  ].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const car = (x0, y0, x1, y1, color, dark) => box(x0, y0, x1, y1, 0.32, color, dark, dark);
  // lingkaran LiDAR di sekitar mobil otonom
  const [cx, cy] = P(2.9, 4.72, 0.35);
  let rings = '';
  [1.3, 2.3, 3.3].forEach((r, i) => {
    rings += `<ellipse cx="${cx}" cy="${cy}" rx="${(r * 19.8).toFixed(1)}" ry="${(r * 9.9).toFixed(1)}" fill="none" stroke="#2dd4bf" stroke-width="1.3" stroke-opacity="${(0.7 - i * 0.2).toFixed(2)}" stroke-dasharray="${i ? '4 5' : ''}"/>`;
  });
  s += rings;
  for (const [x0, y0, x1, y1, h] of buildings) {
    if (x0 + y0 > 9) continue;
    s += box(x0, y0, x1, y1, h, '#334766', '#1e293b', '#26344d');
  }
  s += car(2.4, 4.45, 3.4, 5.0, '#2dd4bf', '#0f766e');
  s += car(7.1, 5.05, 8.1, 5.55, '#7d8fb0', '#4f6283');
  s += car(4.5, 7.2, 5.0, 8.2, '#8d9ab3', '#56607a');
  for (const [x0, y0, x1, y1, h] of buildings) {
    if (x0 + y0 <= 9) continue;
    s += box(x0, y0, x1, y1, h, '#334766', '#1e293b', '#26344d');
  }
  // titik LiDAR yang mengenai dinding gedung terdekat
  const hits = [[3.6, 1.6, 1.2], [3.6, 2.4, 0.8], [3.6, 3.0, 1.4], [2.0, 6.4, 0.9], [1.4, 6.4, 1.6], [3.3, 6.4, 0.6]];
  s += hits.map(([x, y, z]) => `<circle cx="${P(x, y, z)[0].toFixed(1)}" cy="${P(x, y, z)[1].toFixed(1)}" r="1.8" fill="#22d3ee"/>`).join('');
  return `<svg class="iso-city" viewBox="0 8 320 172" role="img" aria-label="Ilustrasi kota 3D dengan mobil otonom yang memindai sekitarnya">${s}</svg>`;
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
        <p class="eyebrow">Simulator Kendaraan Otonom</p>
        <h1 class="hero-title" tabindex="-1">Belajar cara mobil tanpa pengemudi <span class="text-accent">melihat, berpikir, dan bergerak.</span></h1>
        <p class="hero-lead">Kendaraan otonom mengemudi sendiri dengan bantuan sensor dan perangkat lunak. Di sini kamu mempelajari cara kerjanya lewat simulasi kecil yang bisa kamu atur sendiri, lalu mencobanya di kota 3D.</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/pelajaran/${next.id}" data-el="start">${icon('play')}<span>${started ? 'Lanjutkan belajar' : 'Mulai belajar'}</span></a>
          <a class="btn btn-secondary btn-lg" href="#/simulator/tutorial">${icon('cube')}<span>Buka Simulator 3D</span></a>
        </div>
        <p class="hero-meta">${LESSONS.length} pelajaran interaktif. Progres tersimpan otomatis di browser ini.</p>
      </div>
      <div class="hero-visual">
        <div class="ambient-frame">
          <div class="ambient-bar">
            <span class="live-dot" aria-hidden="true"></span>
            <span>Kota mini, tampak atas</span>
            <span class="ambient-keys" aria-hidden="true">
              <span class="key-dot" style="--c: var(--accent)"></span>Mobil otonom
              <span class="key-dot" style="--c: var(--lidar)"></span>Titik LiDAR
            </span>
          </div>
          <div class="ambient-stage" data-el="ambient"></div>
        </div>
      </div>
    </section>

    <section class="section about">
      <div class="about-text">
        <h2 class="section-title">Apa itu transportasi tanpa pengemudi?</h2>
        <p>Transportasi tanpa pengemudi memakai kendaraan, misalnya mobil, bus, atau shuttle, yang bisa berjalan tanpa manusia memegang kemudi. Komputer di dalamnya membaca data sensor, mengenali keadaan di sekitar, memilih tindakan yang aman, lalu menggerakkan setir, gas, dan rem.</p>
        <p class="muted">Tingkat kemandiriannya dibagi menjadi level 0 sampai 5 menurut standar SAE J3016. Kamu akan mengenalnya di pelajaran pertama.</p>
      </div>
      <div class="about-howto">
        <h2 class="section-title">Cara belajar di sini</h2>
        <ol class="howto-list">
          <li><span class="howto-num">1</span><span>Pilih pelajaran. Urutannya mengikuti alur kerja mobil otonom, tetapi kamu boleh melompat.</span></li>
          <li><span class="howto-num">2</span><span>Baca penjelasan tiap langkah, lalu coba langsung di simulasinya.</span></li>
          <li><span class="howto-num">3</span><span>Kerjakan tugas di tiap langkah. Tugas tercentang otomatis saat kamu melakukannya.</span></li>
          <li><span class="howto-num">4</span><span>Uji pemahamanmu di Simulator Kota 3D dan Kuis Akhir.</span></li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Alur kerja mobil otonom</h2>
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
          <p class="eyebrow">Simulator Kota 3D</p>
          <h2 class="sim-card-title">Uji mobil otonom di kota virtual</h2>
          <p>Lihat bagaimana mobil otonom membaca sekitarnya dan bereaksi terhadap lalu lintas di kota 3D. Pilih Mode Tutorial untuk dipandu langkah demi langkah, atau Mode Bebas untuk bereksperimen sendiri.</p>
          <div class="sim-card-actions">
            <a class="mode-btn is-primary" href="#/simulator/tutorial">
              <span class="mode-icon">${icon('book')}</span>
              <span class="mode-text"><span class="mode-title">Mode Tutorial</span><span class="mode-sub">Dipandu langkah demi langkah</span></span>
              ${icon('arrowRight')}
            </a>
            <a class="mode-btn" href="#/simulator/bebas">
              <span class="mode-icon">${icon('sparkle')}</span>
              <span class="mode-text"><span class="mode-title">Mode Bebas</span><span class="mode-sub">Coba skenario sendiri</span></span>
              ${icon('arrowRight')}
            </a>
          </div>
          <p class="sim-card-note">${icon('info')}<span>Simulator ini memakai WebGL. Di ponsel lama, gerakannya bisa terasa lambat.</span></p>
        </div>
        <div class="sim-card-art">${isoCity()}</div>
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
      <div class="footer-brand"><strong>SimOtonom</strong><span>Simulator Kendaraan Otonom</span></div>
      <p>Materi disederhanakan untuk keperluan belajar. Progres hanya tersimpan di browser ini, tanpa akun.</p>
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
