// Pelajaran 10: Kuis Akhir.
//
// Susunan mengikuti pelajaran contoh (sensor.js), disesuaikan untuk tata letak 'full':
//   1. Teks pelajaran (intro, steps, summary) di objek default export.
//   2. Bank soal di ./kuis/questions.js, model kuis (acak, jawab, skor) di ./kuis/model.js.
//   3. mount(ctx) menyusun kartu soal dan halaman hasil di ctx.stage. Tidak ada kanvas dan loop,
//      jadi shell tidak menampilkan tombol Jeda, Ulangi, dan kecepatan.
//   4. Tugas dideteksi dari keadaan kuis: "selesai" saat semua soal satu percobaan terjawab,
//      "lulus" saat ada percobaan dengan skor minimal 70.
//   5. Pintasan 1 sampai 4 lewat ctx.keys, dengan tombol pilihan di layar sebagai padanannya.

import { fmt } from '../engine/math.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { QUESTIONS, TOPICS } from './kuis/questions.js';
import { createQuiz, PASS_SCORE, neededCorrect } from './kuis/model.js';

const TOTAL = QUESTIONS.length;
const NEED = neededCorrect(TOTAL);
const TOPIC_ORDER = Object.keys(TOPICS);
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plain = (html) => String(html).replace(/<[^>]*>/g, '');

export default {
  id: 'kuis',
  title: 'Kuis Akhir',
  layout: 'full',
  intro:
    '<p>Kuis ini menguji pemahamanmu tentang semua pelajaran, dari level otomasi sampai shuttle otonom, ditambah alur kerja mobil di Simulator 3D.</p>',
  steps: [
    {
      title: 'Jawab semua soal',
      body:
        `<p>Ada ${TOTAL} soal pilihan ganda, masing-masing dengan empat pilihan jawaban. Soal muncul satu per satu. Urutan soal dan urutan pilihannya diacak setiap kali kamu mulai.</p>` +
        '<p>Klik atau ketuk jawabanmu, atau tekan <kbd>1</kbd> sampai <kbd>4</kbd> di keyboard. Kamu langsung melihat apakah jawabanmu benar, lengkap dengan penjelasannya. Jawaban tidak bisa diganti, jadi baca soalnya baik-baik.</p>' +
        '<p class="note">Beberapa soal memakai angka contoh dari simulasi di pelajaran, misalnya perlambatan 3 m/s² untuk lampu kuning. Sistem sungguhan memakai angka yang ditetapkan tiap produsen.</p>',
      task: { id: 'selesai', text: `Jawab <strong>semua ${TOTAL} soal</strong> sampai skor akhirmu muncul.` },
    },
    {
      title: `Raih skor minimal ${PASS_SCORE}`,
      body:
        `<p>Skor adalah persentase jawaban benar, dari 0 sampai 100. Kamu lulus bila skornya minimal ${PASS_SCORE}, artinya minimal ${NEED} dari ${TOTAL} jawaban benar.</p>` +
        '<p>Belum lulus? Baca pembahasan setiap soal di halaman hasil, buka lagi pelajaran yang perlu diulang, lalu tekan <strong>Ulangi kuis</strong>. Soal dan pilihannya diacak ulang.</p>' +
        '<p class="note">Skor dihitung per percobaan. Satu percobaan dengan skor minimal 70 sudah cukup untuk tugas ini.</p>',
      task: { id: 'lulus', text: `Raih <strong>skor minimal ${PASS_SCORE}</strong> dalam satu kali mengerjakan kuis.` },
    },
  ],
  summary:
    '<p>Kamu sudah menempuh seluruh materi SimOtonom. Mobil otonom bekerja dalam siklus yang terus berulang:</p>' +
    '<ul><li>Sensor seperti kamera, LiDAR, radar, dan ultrasonik mengumpulkan data tentang sekitar mobil.</li>' +
    '<li>Persepsi mengubah data itu menjadi daftar objek, dan lokalisasi menentukan posisi mobil di peta.</li>' +
    '<li>Perencanaan memilih rute dan tindakan yang aman sesuai aturan lalu lintas.</li>' +
    '<li>Kontrol menggerakkan setir, gas, dan rem supaya mobil mengikuti jalur yang direncanakan.</li></ul>' +
    '<p>Untuk melihat semuanya bekerja bersamaan, buka <a href="#/simulator/bebas">Simulator 3D dalam Mode Bebas</a>.</p>',

  // Gaya khusus pelajaran ini, selalu diawali .lesson-kuis.
  styles: `
    .lesson-kuis .kz { display: flex; flex-direction: column; gap: 16px; }
    .lesson-kuis .kz-card { display: flex; flex-direction: column; gap: 18px; padding: clamp(18px, 2.4vw, 28px);
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
    .lesson-kuis .kz-play[hidden], .lesson-kuis .kz-result[hidden], .lesson-kuis .kz-feedback[hidden],
    .lesson-kuis .kz-next[hidden], .lesson-kuis .kz-hint[hidden], .lesson-kuis .kz-rev[hidden] { display: none; }

    .lesson-kuis .kz-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
    .lesson-kuis .kz-top-left { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
    .lesson-kuis .kz-count { color: var(--accent); font-size: .78rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .lesson-kuis .kz-topic { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 4px 11px;
      border: 1px solid var(--border); border-radius: 999px; background: var(--raised); color: var(--text-soft);
      font-size: .82rem; font-weight: 600; line-height: 1.3; }
    .lesson-kuis .kz-topic .icon { color: var(--accent); }
    .lesson-kuis .kz-tally { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    .lesson-kuis .kz-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 999px;
      background: color-mix(in srgb, var(--c) 14%, transparent); color: var(--c); font-size: .8rem; font-weight: 650; }
    .lesson-kuis .kz-pill b { font-family: var(--mono); font-weight: 700; }
    .lesson-kuis .kz-track { display: flex; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .lesson-kuis .kz-seg { flex: 1 1 0; height: 6px; border-radius: 99px; background: var(--raised); transition: background-color .2s ease; }
    .lesson-kuis .kz-seg.is-ok { background: var(--ok); }
    .lesson-kuis .kz-seg.is-bad { background: var(--danger); }
    .lesson-kuis .kz-seg.is-current { background: var(--accent); box-shadow: 0 0 0 2px rgba(45, 212, 191, .22); }

    .lesson-kuis .kz-q { font-size: clamp(1.08rem, 1.5vw, 1.28rem); font-weight: 700; line-height: 1.45; letter-spacing: -.005em; }
    .lesson-kuis .kz-opts { display: flex; flex-direction: column; gap: 10px; }
    .lesson-kuis .kz-opt { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 10px 14px;
      border: 1px solid var(--border); border-radius: 12px; background: var(--raised); color: var(--text);
      font-size: .98rem; line-height: 1.4; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent;
      transition: border-color .15s ease, background-color .15s ease, opacity .2s ease; }
    .lesson-kuis .kz-opt:hover:not(.is-locked) { border-color: var(--accent); background: #1c2946; }
    .lesson-kuis .kz-opt:hover:not(.is-locked) .kz-key { border-color: var(--accent); color: var(--accent); }
    .lesson-kuis .kz-key { flex: none; display: grid; place-items: center; width: 32px; height: 32px;
      border: 1px solid var(--border-strong); border-radius: 9px; background: var(--bg); color: var(--text-soft);
      font-family: var(--mono); font-size: .92rem; font-weight: 700; }
    .lesson-kuis .kz-opt-text { flex: 1 1 auto; min-width: 0; }
    .lesson-kuis .kz-tag { flex: none; font-size: .76rem; font-weight: 700; }
    .lesson-kuis .kz-tag:empty { display: none; }
    .lesson-kuis .kz-opt.is-locked { cursor: default; }
    .lesson-kuis .kz-opt.is-correct { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 13%, var(--raised)); }
    .lesson-kuis .kz-opt.is-correct .kz-key { border-color: var(--ok); background: var(--ok); color: #052e16; }
    .lesson-kuis .kz-opt.is-correct .kz-tag { color: #86efac; }
    .lesson-kuis .kz-opt.is-wrong { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 13%, var(--raised)); }
    .lesson-kuis .kz-opt.is-wrong .kz-key { border-color: var(--danger); background: var(--danger); color: #fff; }
    .lesson-kuis .kz-opt.is-wrong .kz-tag { color: #fca5a5; }
    .lesson-kuis .kz-opt.is-dim { opacity: .5; }

    .lesson-kuis .kz-feedback { --tone: var(--ok); display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
      border-left: 3px solid var(--tone); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      background: color-mix(in srgb, var(--tone) 9%, transparent); color: var(--text-soft); font-size: .96rem;
      animation: kz-in .25s ease-out; }
    .lesson-kuis .kz-feedback.is-bad { --tone: var(--danger); }
    .lesson-kuis .kz-verdict { display: flex; align-items: center; gap: 8px; color: var(--text); font-weight: 750; }
    .lesson-kuis .kz-verdict .icon { width: 1.2em; height: 1.2em; color: var(--tone); }
    .lesson-kuis .kz-feedback strong, .lesson-kuis .kz-feedback em, .lesson-kuis .kz-rev strong, .lesson-kuis .kz-rev em { color: var(--text); }
    .lesson-kuis sub { font-size: .75em; }
    .lesson-kuis .kz-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; min-height: 46px; }
    .lesson-kuis .kz-hint { color: var(--muted); font-size: .86rem; }
    .lesson-kuis .kz-next { margin-left: auto; min-height: 46px; padding: 0 20px; }
    @keyframes kz-in { from { opacity: 0; transform: translateY(4px); } }

    .lesson-kuis .kz-result { display: flex; flex-direction: column; gap: 16px; }
    .lesson-kuis .is-pass { --tone: var(--ok); }
    .lesson-kuis .is-fail { --tone: var(--warn); }
    .lesson-kuis .kz-score { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 18px 28px; }
    .lesson-kuis .kz-ring { position: relative; width: 140px; height: 140px; }
    .lesson-kuis .kz-ring svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .lesson-kuis .kz-ring-bg { fill: none; stroke: var(--raised); stroke-width: 11; }
    .lesson-kuis .kz-ring-fg { fill: none; stroke: var(--tone); stroke-width: 11; stroke-linecap: round; animation: kz-ring .9s ease-out both; }
    .lesson-kuis .kz-ring-mark { stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; opacity: .8; }
    .lesson-kuis .kz-ring-label { fill: var(--muted); font-family: var(--mono); font-size: 10px; font-weight: 700; }
    .lesson-kuis .kz-ring-val { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .lesson-kuis .kz-ring-num { color: var(--text); font-family: var(--mono); font-size: 2.3rem; font-weight: 800; line-height: 1; }
    .lesson-kuis .kz-ring-sub { margin-top: 5px; color: var(--muted); font-size: .76rem; }
    @keyframes kz-ring { from { stroke-dashoffset: ${RING_C.toFixed(2)}; } }
    .lesson-kuis .kz-res-text { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
    .lesson-kuis .kz-res-title { font-size: clamp(1.3rem, 2vw, 1.6rem); font-weight: 800; letter-spacing: -.015em; }
    .lesson-kuis .kz-res-detail { color: var(--text-soft); }
    .lesson-kuis .kz-res-best { color: var(--muted); font-size: .88rem; }
    .lesson-kuis .kz-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
    .lesson-kuis .kz-actions .btn { min-height: 44px; }
    .lesson-kuis .kz-section { display: flex; flex-direction: column; gap: 10px; }
    .lesson-kuis .kz-sec-title { color: var(--muted); font-size: .74rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .lesson-kuis .kz-topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    .lesson-kuis .kz-trow { --tone: var(--ok); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 6px 10px;
      padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-kuis .kz-trow.is-mid { --tone: var(--warn); }
    .lesson-kuis .kz-trow.is-low { --tone: #f87171; }
    .lesson-kuis .kz-trow .icon { color: var(--muted); }
    .lesson-kuis .kz-trow-name { min-width: 0; font-size: .88rem; font-weight: 600; line-height: 1.3; }
    .lesson-kuis .kz-trow-val { color: var(--tone); font-family: var(--mono); font-size: .86rem; font-weight: 700; }
    .lesson-kuis .kz-trow-bar { grid-column: 1 / -1; height: 4px; overflow: hidden; border-radius: 99px; background: var(--raised); }
    .lesson-kuis .kz-trow-bar i { display: block; height: 100%; border-radius: inherit; background: var(--tone); }

    .lesson-kuis .kz-rev-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
    .lesson-kuis .kz-rev-head h3 { font-size: 1.1rem; font-weight: 750; }
    .lesson-kuis .kz-rev-head .ctl-seg { min-width: 0; }
    .lesson-kuis .kz-allgood { color: var(--text-soft); }
    .lesson-kuis .kz-revs { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .lesson-kuis .kz-rev { --tone: var(--ok); display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 12px;
      padding: 14px 16px; border: 1px solid var(--border); border-left: 3px solid var(--tone); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-kuis .kz-rev.is-bad { --tone: #f87171; }
    .lesson-kuis .kz-rev-num { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
      background: color-mix(in srgb, var(--tone) 16%, transparent); color: var(--tone); font-family: var(--mono); font-size: .9rem; font-weight: 700; }
    .lesson-kuis .kz-rev-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .lesson-kuis .kz-rev-topic { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: .78rem; font-weight: 600; }
    .lesson-kuis .kz-rev-q { color: var(--text); font-weight: 650; line-height: 1.45; }
    .lesson-kuis .kz-rev-ans { display: flex; align-items: flex-start; gap: 7px; color: var(--text-soft); font-size: .92rem; }
    .lesson-kuis .kz-rev-ans .icon { margin-top: .2em; }
    .lesson-kuis .kz-rev-ans.is-ok .icon { color: var(--ok); }
    .lesson-kuis .kz-rev-ans.is-bad .icon { color: #f87171; }
    .lesson-kuis .kz-rev-exp { color: var(--muted); font-size: .9rem; line-height: 1.5; }
    .lesson-kuis .kz-rev-link { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; min-height: 32px; font-size: .86rem; font-weight: 600; }
    .lesson-kuis .kz-bottom { display: flex; justify-content: flex-end; }

    @media (hover: none) {
      .lesson-kuis .kz-hint { display: none; }
    }
    @media (max-width: 600px) {
      .lesson-kuis .kz-card { gap: 16px; padding: 16px; }
      .lesson-kuis .kz-opt { gap: 12px; padding: 10px 12px; font-size: .95rem; }
      .lesson-kuis .kz-key { width: 30px; height: 30px; }
      .lesson-kuis .kz-next { flex: 1 1 100%; margin-left: 0; }
      .lesson-kuis .kz-score { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; }
      .lesson-kuis .kz-res-text { align-items: center; }
      .lesson-kuis .kz-actions { justify-content: center; }
      .lesson-kuis .kz-actions .btn, .lesson-kuis .kz-bottom .btn { flex: 1 1 100%; }
      .lesson-kuis .kz-ring { width: 128px; height: 128px; }
      .lesson-kuis .kz-topics { gap: 6px; }
      .lesson-kuis .kz-trow { gap: 5px 10px; padding: 8px 12px; }
      .lesson-kuis .kz-rev { gap: 10px; padding: 12px; }
      .lesson-kuis .kz-rev-num { width: 26px; height: 26px; font-size: .82rem; }
      .lesson-kuis .kz-rev-head .ctl-seg { flex: 1 1 100%; }
    }
  `,

  mount(ctx) {
    // ---------- model ----------
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const quiz = createQuiz(QUESTIONS, ctx.rng(seed));
    let view = 'question'; // 'question' atau 'result'
    let reviewFilter = 'semua';
    const el = ui.el;
    const smooth = ctx.reducedMotion ? 'auto' : 'smooth';

    // ---------- kartu soal ----------
    const root = el('div', { class: 'kz' });
    const play = el('section', { class: 'kz-card kz-play', 'aria-label': 'Soal kuis' });
    const countEl = el('p', { class: 'kz-count' });
    const topicEl = el('span', { class: 'kz-topic' });
    const tallyEl = el('p', { class: 'kz-tally' });
    const track = el('ol', { class: 'kz-track', 'aria-hidden': 'true' });
    const segs = QUESTIONS.map(() => track.appendChild(el('li', { class: 'kz-seg' })));
    const qId = ui.uniqueId('kz-q');
    const qEl = el('h2', { class: 'kz-q', id: qId, tabindex: '-1' });
    const optsEl = el('div', { class: 'kz-opts', role: 'group', 'aria-labelledby': qId });
    const feedback = el('div', { class: 'kz-feedback', hidden: true });
    const hintEl = el('p', { class: 'kz-hint', html: 'Klik jawabanmu, atau tekan <kbd>1</kbd> sampai <kbd>4</kbd>.' });
    const nextBtn = el('button', { type: 'button', class: 'btn btn-primary kz-next', hidden: true, dataset: { act: 'lanjut' } });
    nextBtn.addEventListener('click', () => goNext());
    play.append(
      el('div', { class: 'kz-top' }, el('div', { class: 'kz-top-left' }, countEl, topicEl), tallyEl),
      track,
      qEl,
      optsEl,
      feedback,
      el('div', { class: 'kz-foot' }, hintEl, nextBtn),
    );

    const result = el('div', { class: 'kz-result', hidden: true });
    root.append(play, result);
    ctx.stage.append(root);

    // pintasan keyboard, padanannya tombol pilihan 1 sampai 4 di layar
    ctx.keys({
      1: () => answer(0),
      2: () => answer(1),
      3: () => answer(2),
      4: () => answer(3),
    });

    // ---------- soal ----------
    function renderQuestion() {
      const it = quiz.current;
      const t = TOPICS[it.q.topic];
      play.dataset.qid = it.q.id;
      countEl.textContent = `Soal ${fmt(quiz.index + 1)} dari ${fmt(TOTAL)}`;
      topicEl.innerHTML = `${icon(t.icon)}<span></span>`;
      topicEl.lastChild.textContent = t.title;
      qEl.textContent = it.q.q;
      optsEl.replaceChildren(...it.options.map((o, slot) => optionButton(o, slot)));
      feedback.hidden = true;
      feedback.replaceChildren();
      nextBtn.hidden = true;
      hintEl.hidden = false;
      refreshProgress();
    }

    function optionButton(o, slot) {
      const b = el(
        'button',
        { type: 'button', class: 'kz-opt', 'aria-keyshortcuts': String(slot + 1), dataset: { slot: String(slot), opt: String(o.key) } },
        el('span', { class: 'kz-key', 'aria-hidden': 'true', text: String(slot + 1) }),
        el('span', { class: 'kz-opt-text', text: o.text }),
        el('span', { class: 'kz-tag' }),
      );
      b.addEventListener('click', () => answer(slot));
      return b;
    }

    function refreshProgress() {
      const items = quiz.items;
      segs.forEach((s, i) => {
        const it = items[i];
        s.className = 'kz-seg';
        if (it?.chosen != null) s.classList.add(quiz.isCorrect(it) ? 'is-ok' : 'is-bad');
        else if (i === quiz.index && view === 'question') s.classList.add('is-current');
      });
      const right = quiz.correct;
      const wrong = quiz.answered - right;
      tallyEl.innerHTML =
        `<span class="kz-pill" style="--c: var(--ok)">${icon('check')}<span><b>${fmt(right)}</b> benar</span></span>` +
        `<span class="kz-pill" style="--c: #f87171">${icon('close')}<span><b>${fmt(wrong)}</b> salah</span></span>`;
    }

    function answer(slot) {
      if (view !== 'question') return;
      const res = quiz.choose(slot);
      if (!res) return;
      const { item, correct, correctSlot } = res;
      [...optsEl.children].forEach((b, i) => {
        b.classList.add('is-locked');
        b.setAttribute('aria-disabled', 'true');
        const key = b.querySelector('.kz-key');
        const tag = b.querySelector('.kz-tag');
        if (i === correctSlot) {
          b.classList.add('is-correct');
          key.innerHTML = icon('check');
          tag.textContent = i === slot ? 'Jawabanmu' : 'Jawaban benar';
        } else if (i === slot) {
          b.classList.add('is-wrong');
          key.innerHTML = icon('close');
          tag.textContent = 'Jawabanmu';
        } else b.classList.add('is-dim');
      });

      const rightText = item.options[correctSlot].text;
      feedback.className = `kz-feedback ${correct ? 'is-ok' : 'is-bad'}`;
      feedback.innerHTML =
        `<p class="kz-verdict">${icon(correct ? 'check' : 'close')}<span>${correct ? 'Benar.' : 'Kurang tepat.'}</span></p>` +
        (correct ? '' : `<p>Jawaban yang benar: <strong>${esc(rightText)}</strong></p>`) +
        `<p>${item.q.explain}</p>`;
      feedback.hidden = false;
      hintEl.hidden = true;
      nextBtn.innerHTML = `<span>${quiz.finished ? 'Lihat hasil' : 'Soal berikutnya'}</span>${icon('chevronRight')}`;
      nextBtn.hidden = false;
      refreshProgress();

      ctx.setStatus(correct ? `Benar. ${plain(item.q.explain)}` : `Kurang tepat. Jawaban yang benar: ${rightText}. ${plain(item.q.explain)}`);
      nextBtn.focus({ preventScroll: true });
      const r = nextBtn.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0) nextBtn.scrollIntoView({ block: 'nearest', behavior: smooth });

      if (res.finished) syncTasks();
    }

    function goNext() {
      if (view !== 'question') return;
      if (quiz.finished) {
        showResult();
        return;
      }
      if (!quiz.next()) return;
      renderQuestion();
      focusTop(qEl, play);
    }

    /** Fokus ke judul baru, dan gulir bila kartunya sudah terlewat ke atas. */
    function focusTop(target, card) {
      target.focus({ preventScroll: true });
      const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 60;
      if (card.getBoundingClientRect().top < headerH) card.scrollIntoView({ block: 'start', behavior: smooth });
    }

    // ---------- hasil ----------
    function showResult() {
      view = 'result';
      reviewFilter = 'semua';
      play.hidden = true;
      result.hidden = false;
      renderResult();
      const s = quiz.last;
      ctx.setStatus(
        `Kuis selesai. Skor ${fmt(s.score)} dari 100, ${fmt(s.correct)} dari ${fmt(s.total)} jawaban benar. ${s.passed ? 'Kamu lulus.' : `Kamu butuh skor minimal ${PASS_SCORE} untuk lulus.`}`,
      );
      // Halaman hasil adalah bahan langkah "Raih skor minimal". Bila pelajar masih di langkah
      // sebelumnya, kartu langkah ikut pindah ke sana. onStep lalu mencatat tugas "lulus" bila skornya
      // cukup, jadi pelajar yang langsung pergi setelah lulus tidak perlu mengulang kuis.
      const passStep = stepOf('lulus');
      if (ctx.currentStep() < passStep) ctx.goToStep(passStep);
      focusTop(result.querySelector('.kz-res-title'), result);
    }

    function restart() {
      quiz.start();
      view = 'question';
      result.hidden = true;
      result.replaceChildren();
      play.hidden = false;
      renderQuestion();
      ctx.setStatus('Percobaan baru dimulai. Soal dan pilihan jawabannya sudah diacak ulang.');
      focusTop(qEl, play);
    }

    function ringSvg(score) {
      const off = RING_C * (1 - score / 100);
      // sudut diukur dari atas searah jarum jam, sama dengan arah busur skor
      const a = (PASS_SCORE / 100) * 2 * Math.PI;
      const p = (r) => `${(60 + r * Math.sin(a)).toFixed(2)} ${(60 - r * Math.cos(a)).toFixed(2)}`;
      const [lx, ly] = p(RING_R + 17).split(' ');
      return `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <g transform="rotate(-90 60 60)">
          <circle class="kz-ring-bg" cx="60" cy="60" r="${RING_R}"/>
          ${score > 0 ? `<circle class="kz-ring-fg" cx="60" cy="60" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>` : ''}
        </g>
        <path class="kz-ring-mark" d="M ${p(RING_R - 8)} L ${p(RING_R + 8)}"/>
        <text class="kz-ring-label" x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central">${PASS_SCORE}</text>
      </svg>`;
    }

    function renderResult() {
      const s = quiz.last;
      const best = quiz.best;
      const titleId = ui.uniqueId('kz-res');
      result.replaceChildren();

      // skor
      const scoreCard = el('section', { class: `kz-card ${s.passed ? 'is-pass' : 'is-fail'}`, 'aria-labelledby': titleId });
      const retryTop = retryButton(s.passed ? 'secondary' : 'primary');
      const detail = s.passed
        ? `${fmt(s.correct)} dari ${fmt(s.total)} jawaban benar. Skor minimal untuk lulus ${PASS_SCORE}. Pembahasan setiap soal ada di bawah.`
        : `${fmt(s.correct)} dari ${fmt(s.total)} jawaban benar. Untuk lulus kamu butuh skor minimal ${PASS_SCORE}, yaitu ${fmt(NEED)} jawaban benar. Baca pembahasannya, lalu coba lagi.`;
      let bestLine = '';
      if (quiz.attempt > 1) {
        bestLine =
          best.attempt === s.attempt
            ? 'Ini skor terbaikmu sejauh ini.'
            : `Skor terbaikmu ${fmt(best.score)}, dari percobaan ke-${fmt(best.attempt)}.`;
      }
      const text = el(
        'div',
        { class: 'kz-res-text' },
        el('p', { class: 'kz-count', text: quiz.attempt > 1 ? `Hasil percobaan ke-${fmt(quiz.attempt)}` : 'Hasil kuis' }),
        el('h2', { class: 'kz-res-title', id: titleId, tabindex: '-1', text: s.passed ? 'Selamat, kamu lulus!' : 'Belum lulus kali ini' }),
        el('p', { class: 'kz-res-detail', text: detail }),
        bestLine ? el('p', { class: 'kz-res-best', text: bestLine }) : null,
        el('div', { class: 'kz-actions' }, retryTop),
      );
      const ring = el('div', {
        class: 'kz-ring',
        html: `${ringSvg(s.score)}<div class="kz-ring-val"><span class="kz-ring-num">${fmt(s.score)}</span><span class="kz-ring-sub">dari 100</span></div>`,
      });
      scoreCard.append(el('div', { class: 'kz-score' }, ring, text));

      // hasil per topik
      const topics = el('ul', { class: 'kz-topics' });
      for (const st of quiz.topicStats(TOPIC_ORDER)) {
        const t = TOPICS[st.topic];
        const ratio = st.correct / st.total;
        const row = el('li', { class: `kz-trow${ratio >= 1 ? '' : ratio > 0 ? ' is-mid' : ' is-low'}` });
        row.innerHTML = `${icon(t.icon)}<span class="kz-trow-name"></span><span class="kz-trow-val">${fmt(st.correct)} dari ${fmt(st.total)}</span><span class="kz-trow-bar" aria-hidden="true"><i style="width: ${Math.round(ratio * 100)}%"></i></span>`;
        row.querySelector('.kz-trow-name').textContent = t.title;
        topics.append(row);
      }
      scoreCard.append(el('div', { class: 'kz-section' }, el('h3', { class: 'kz-sec-title', text: 'Hasil per topik' }), topics));

      // pembahasan
      const reviewCard = el('section', { class: 'kz-card', 'aria-label': 'Pembahasan soal' });
      const wrong = s.total - s.correct;
      const head = el('div', { class: 'kz-rev-head' }, el('h3', { text: 'Pembahasan' }));
      reviewCard.append(head);
      if (wrong > 0) {
        ui.segmented(head, {
          ariaLabel: 'Saring pembahasan',
          options: [
            { value: 'semua', label: `Semua (${fmt(s.total)})` },
            { value: 'salah', label: `Yang salah (${fmt(wrong)})` },
          ],
          value: reviewFilter,
          onChange: (v) => {
            reviewFilter = v;
            applyFilter();
          },
        });
      } else {
        reviewCard.append(el('p', { class: 'kz-allgood', text: 'Semua jawabanmu benar. Penjelasan tiap soal tetap bisa kamu baca di bawah.' }));
      }
      const list = el('ol', { class: 'kz-revs' });
      quiz.items.forEach((it, i) => list.append(reviewItem(it, i)));
      reviewCard.append(list, el('div', { class: 'kz-bottom' }, retryButton('secondary')));
      result.append(scoreCard, reviewCard);
      applyFilter();
    }

    function reviewItem(it, i) {
      const ok = quiz.isCorrect(it);
      const t = TOPICS[it.q.topic];
      const chosen = it.options[it.chosen];
      const right = it.options[quiz.correctSlot(it)];
      const li = el('li', { class: `kz-rev ${ok ? 'is-ok' : 'is-bad'}`, dataset: { qid: it.q.id } });
      li.innerHTML =
        `<span class="kz-rev-num" aria-hidden="true">${fmt(i + 1)}</span>` +
        `<div class="kz-rev-body">` +
        `<span class="kz-rev-topic">${icon(t.icon)}<span>${esc(t.title)}</span></span>` +
        `<p class="kz-rev-q">${esc(it.q.q)}</p>` +
        `<p class="kz-rev-ans ${ok ? 'is-ok' : 'is-bad'}">${icon(ok ? 'check' : 'close')}<span>Jawabanmu: <strong>${esc(chosen.text)}</strong>${ok ? ' (benar)' : ' (kurang tepat)'}</span></p>` +
        (ok ? '' : `<p class="kz-rev-ans is-ok">${icon('check')}<span>Jawaban yang benar: <strong>${esc(right.text)}</strong></span></p>`) +
        `<p class="kz-rev-exp">${it.q.explain}</p>` +
        `<a class="kz-rev-link" href="${t.href}">${icon(t.id === 'simulator' ? 'cube' : 'book')}<span>${esc(t.linkText)}: ${esc(t.title)}</span></a>` +
        `</div>`;
      return li;
    }

    function applyFilter() {
      for (const li of result.querySelectorAll('.kz-rev')) li.hidden = reviewFilter === 'salah' && li.classList.contains('is-ok');
    }

    function retryButton(variant) {
      const b = ui.button(document.createDocumentFragment(), { label: 'Ulangi kuis', icon: 'reset', variant, onClick: () => restart() });
      b.dataset.act = 'ulangi';
      return b;
    }

    // ---------- deteksi tugas ----------
    const TASK_CHECKS = {
      selesai: () => quiz.history.length > 0,
      lulus: () => !!quiz.best?.passed,
    };
    const stepOf = (taskId) => ctx.lesson.steps.findIndex((s) => s.taskId === taskId);

    /** Selesaikan tugas milik langkah yang sedang dibuka bila syaratnya sudah terpenuhi. */
    function checkCurrentTask() {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      if (TASK_CHECKS[taskId]?.()) ctx.completeTask(taskId);
    }

    /**
     * Dipanggil saat satu percobaan selesai. Tugas langkah berikutnya menunggu sampai pelajar
     * membuka langkah itu, seperti di pelajaran lain. Tugas langkah SEBELUMNYA juga dicatat,
     * misalnya bila pelajar menekan Lanjut sebelum semua soal terjawab. Shell hanya menerima
     * tugas milik langkah yang sedang dibuka, jadi langkah itu dibuka sebentar lewat
     * ctx.goToStep lalu pelajar dikembalikan ke langkah semula (termasuk layar ringkasan).
     */
    function syncTasks() {
      const cur = ctx.currentStep();
      const earlier = Object.keys(TASK_CHECKS).filter((id) => !ctx.isTaskDone(id) && TASK_CHECKS[id]() && stepOf(id) < cur);
      if (!earlier.length) {
        checkCurrentTask();
        return;
      }
      // Tugas langkah sebelumnya dicatat lebih dulu, lalu tugas langkah sekarang lewat onStep saat
      // kembali. Dengan urutan ini toast terakhir dari shell sesuai dengan keadaan akhirnya.
      for (const id of earlier) ctx.goToStep(stepOf(id)); // onStep memanggil checkCurrentTask
      // Layar ringkasan tidak disimpan sebagai langkah terakhir. Buka langkah terakhir dulu supaya
      // pelajar yang kembali nanti tidak mendarat di langkah 1.
      if (cur === ctx.stepCount && ctx.currentStep() !== cur - 1) ctx.goToStep(cur - 1);
      ctx.goToStep(cur);
    }

    // ---------- mulai ----------
    renderQuestion();

    // ---------- antarmuka ke shell ----------
    return {
      onStep() {
        // Kuis tidak diubah saat langkah berganti: jawaban dan hasil yang sudah ada tetap tampil.
        // Tugas langkah yang baru dibuka langsung dicatat bila syaratnya sudah terpenuhi.
        checkCurrentTask();
      },
      reset() {
        restart();
      },
      destroy() {
        // Semua elemen ada di ctx.stage dan pintasan lewat ctx.keys, jadi dibersihkan oleh shell.
      },
    };
  },
};
