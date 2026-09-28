// Pelajaran 8: Jarak Aman dan Rem Darurat.
//
// Susunannya mengikuti pelajaran contoh (sensor.js):
//   - ./jarak-aman/model.js   fisika satu dimensi: jarak henti, tiga skenario, AEB bertahap, calon
//                             penumpang angkot (tanpa DOM);
//   - ./jarak-aman/safety.js  perisai keselamatan dan pemantau aturan pejalan kaki;
//   - ./jarak-aman/street.js  lalu lintas latar dan pejalan kaki di trotoar;
//   - ./jarak-aman/scene.js   gambar Jalan Soekarno-Hatta dan jalan tol (ilustrasi), pita jarak,
//                             garis titik henti, dan tanda benturan;
//   - file ini berisi teks pelajaran, panel kontrol, kamera, deteksi tugas, dan lem antarbagian.
//
// Alur simulasi: mode 'ikut' (ACC mengikuti kendaraan depan), lalu tombol skenario memulai mode
// 'jalan' (satu percobaan yang dihitung langkah demi langkah), dan berakhir di mode 'selesai'
// (hasil tampil sampai pelajar mengubah pengaturan, menekan skenario lagi, atau Ulangi).
//
// Tempat mengikuti kecepatan: sampai 50 km/jam (batas kecepatan Jalan Soekarno-Hatta menurut
// OpenStreetMap) simulasi berjalan di jalan kota itu, di atasnya di jalan tol. Keduanya gambar
// ilustrasi. Angkot hanya ada di jalan kota.

import { COLORS } from '../engine/theme.js';
import { fmt, fmtSigned, msToKmh, kmhToMs, clamp, approach } from '../engine/math.js';
import { createLabelLayer } from '../engine/draw.js';
import { drawAttribution } from '../engine/osm2d.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import * as M from './jarak-aman/model.js';
import { createMonitor, pedConstraint, shieldSpeed } from './jarak-aman/safety.js';
import { createStreet } from './jarak-aman/street.js';
import {
  drawWorld,
  drawStreetLife,
  drawPassenger,
  drawLaneBand,
  drawStopMark,
  drawDimension,
  drawRuler,
  drawCarBox,
  drawLeadAngkot,
  drawHazard,
  drawImpact,
  drawOffscreenArrow,
  drawPlaceTag,
  dimensionY,
  placeFor,
  PLACES,
  LANE_Y,
  FOCUS_Y,
} from './jarak-aman/scene.js';

const L = M.CAR_LENGTH;
const NEAR_MISS = 2; // sisa jarak di bawah ini dianggap nyaris (m)
const C = {
  react: '#f59e0b',
  brake: '#ef4444',
  lead: '#60a5fa',
  leadStop: '#93c5fd',
  obstacle: '#fb923c',
  ok: '#22c55e',
  angkot: '#7dd3fc',
  penumpang: '#f0abfc',
};
const SCENARIO_NAMES = { rem: 'Mobil depan rem mendadak', rintangan: 'Rintangan diam muncul', angkot: 'Angkot berhenti mendadak' };

// Preset tiap langkah: pengaturan yang membuat tugas langkah itu masuk akal.
const STEP_PRESETS = [
  { kmh: 40, tau: 2, road: 'kering', reaction: 'manusia', aeb: false, context: 'rem' },
  { kmh: 80, tau: 1, road: 'basah', reaction: 'manusia', aeb: false, context: 'rem' },
  { kmh: 80, tau: 1, road: 'basah', reaction: 'manusia', aeb: false, context: 'rem' },
  { kmh: 80, tau: 1, road: 'basah', reaction: 'manusia', aeb: false, context: 'rintangan' },
  { kmh: 80, tau: 1, road: 'basah', reaction: 'manusia', aeb: true, context: 'rintangan' },
  { kmh: 40, tau: 1, road: 'kering', reaction: 'manusia', aeb: false, context: 'angkot' },
];

const fmtMu = (mu) => fmt(mu, Math.round(mu * 100) % 10 ? 2 : 1);
const kmhOf = (ms) => msToKmh(ms);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export default {
  id: 'jarak-aman',
  title: 'Jarak Aman dan Rem Darurat',
  layout: 'sim',
  intro:
    '<p>Mobil otonom harus selalu bisa berhenti sebelum menabrak. Di pelajaran ini kamu menghitung jarak henti, mengatur jarak ke kendaraan di depan, lalu menguji rem darurat otomatis di jalan kering, basah, dan licin. Percobaannya berlangsung di Jalan Soekarno-Hatta, Malang, dan di jalan tol untuk kecepatan tinggi.</p>',
  steps: [
    {
      title: 'Jarak henti',
      body:
        '<p>Jarak henti adalah jarak yang ditempuh mobil sejak bahaya muncul sampai mobil diam. Selama waktu reaksi, mobil masih melaju dengan kecepatan penuh. Bagian ini disebut <strong>jarak reaksi</strong>. Setelah rem bekerja, mobil melambat sampai berhenti. Bagian ini disebut <strong>jarak pengereman</strong>.</p>' +
        '<div class="formula">d = v × t<sub>r</sub> + v² / (2 × μ × g)</div>' +
        '<p>v adalah kecepatan dalam m/s, t<sub>r</sub> waktu reaksi, μ koefisien gesek ban dengan jalan, dan g = 9,8 m/s². Perlambatan terbesar yang bisa dicapai kira-kira μ × g.</p>' +
        '<p>Nilai μ di sini perkiraan: sekitar 0,8 di jalan kering, 0,5 di jalan basah, dan 0,25 di jalan licin. Nilai sebenarnya bergantung pada ban dan permukaan jalan. Waktu reaksi pengemudi manusia yang umum dipakai sekitar 1,5 detik. Untuk sistem otomatis dipakai 0,3 detik sebagai ilustrasi.</p>' +
        '<p>Sampai 50 km/jam, simulasi berlangsung di Jalan Soekarno-Hatta, Malang. Menurut data OpenStreetMap, jalan ini punya dua lajur per arah yang dipisahkan median, dengan batas kecepatan 50 km/jam. Di atas 50 km/jam, simulasi pindah ke jalan tol. Kedua gambar jalan adalah ilustrasi.</p>' +
        '<p class="note">Jarak reaksi naik sebanding dengan kecepatan. Jarak pengereman naik dengan kuadrat kecepatan, jadi kecepatan dua kali lipat membuat jarak pengereman empat kali lipat.</p>',
      task: {
        id: 'calc',
        text: 'Atur kecepatan <strong>80 km/jam</strong> dan jalan <strong>basah</strong>, lalu baca rumus beserta angkanya di bawah simulasi atau di panel Rumus jarak henti.',
      },
    },
    {
      title: 'Mobil depan rem mendadak',
      body:
        '<p>Mobilmu memakai ACC (adaptive cruise control) yang menjaga <strong>jarak waktu</strong> ke mobil depan. Jarak waktu 1 detik berarti mobilmu melewati suatu titik 1 detik setelah mobil depan. Pada 80 km/jam, jaraknya sekitar 22 m.</p>' +
        '<p>Bila mobil depan mengerem sekuat mungkin dan kedua mobil punya rem yang sama baik, jarak pengereman keduanya sama. Yang membedakan adalah jarak reaksi. Selama kamu bereaksi, mobil depan sudah melambat, sedangkan mobilmu masih melaju penuh.</p>' +
        '<p>Perhatikan pita kuning (jarak reaksi) dan pita merah (jarak pengereman) yang tergambar di jalan saat percobaan berjalan.</p>',
      task: {
        id: 'crash',
        text: 'Dengan jarak waktu 1 detik, jalan basah, dan reaksi pengemudi manusia, tekan <strong>Mobil depan rem mendadak</strong> dan lihat hasilnya.',
      },
    },
    {
      title: 'Jarak waktu yang cukup',
      body:
        '<p>Jika kedua mobil bisa mengerem sama kuat, mobilmu aman selama jarak waktunya lebih panjang dari waktu reaksi. Sisa jarak saat berhenti sama dengan kecepatan dikali selisih keduanya. Pada 80 km/jam (22,2 m/s) dengan jarak 2 detik dan waktu reaksi 1,5 detik, selisihnya 0,5 detik, jadi sisa jaraknya 22,2 × 0,5 = 11,1 m.</p>' +
        '<p>Karena itu pengemudi dianjurkan menjaga jarak 2 sampai 3 detik. Cara mengukurnya mudah: saat mobil depan melewati sebuah patok, hitung detik sampai mobilmu melewati patok yang sama.</p>' +
        '<p class="note">Coba juga <strong>Rintangan diam muncul</strong>. Mobil depan pindah lajur, lalu tampak mobil mogok di lajurmu. Mobil mogok tidak ikut mengerem, jadi seluruh jarak henti harus muat sebelum rintangan.</p>',
      task: {
        id: 'gap-fix',
        text: 'Naikkan jarak waktu menjadi <strong>minimal 2 detik</strong>, lalu tekan lagi <strong>Mobil depan rem mendadak</strong> dengan reaksi manusia sampai mobilmu berhenti dengan aman.',
      },
    },
    {
      title: 'Rem darurat otomatis (AEB)',
      body:
        '<p>AEB (autonomous emergency braking) memantau objek di depan dengan radar dan kamera. Ia menghitung <strong>TTC</strong> (time to collision), yaitu jarak dibagi kecepatan mendekat. TTC adalah sisa waktu sebelum tabrakan bila kecepatan tidak berubah. Bila jarak tidak mengecil, TTC tak terhingga (∞). Seperti pada radar di pelajaran Sensor, kecepatan relatif di panel bertanda minus saat jarak mengecil.</p>' +
        '<p>AEB di simulasi ini bekerja bertahap:</p>' +
        '<ul><li>TTC di bawah 2,5 detik: peringatan tabrakan depan (FCW).</li><li>TTC di bawah 1,6 detik: rem sebagian, sekitar setengah kekuatan rem.</li><li>TTC di bawah 1 detik: rem penuh.</li></ul>' +
        '<p>Ambang ini hanya contoh, tiap produsen memakai angka sendiri. Di sini AEB bertindak seketika, tanpa jeda deteksi. AEB tidak menunggu reaksi pengemudi, jadi paling berguna saat bahaya muncul tiba-tiba dan sudah dekat.</p>' +
        '<p class="note">Pada skenario mobil depan rem mendadak, TTC turun pelan karena kedua mobil awalnya sama cepat. Dengan pengaturan langkah ini, pengemudi sudah mengerem sebelum AEB mulai mengerem, jadi AEB tidak mengubah hasil. Coba juga rintangan diam pada 40 km/jam: AEB mencegah tabrakan, walau mobilmu berhenti sangat dekat.</p>',
      task: {
        id: 'aeb',
        text: 'Nyalakan <strong>AEB</strong>, biarkan jarak waktu pendek (1 detik), lalu tekan <strong>Rintangan diam muncul</strong>. Bandingkan hasilnya dengan tanpa AEB.',
      },
    },
    {
      title: 'Jalan licin',
      body:
        '<p>Di jalan licin, ban hanya mampu memperlambat mobil sekitar 2,5 m/s². Jarak pengereman menjadi dua kali jarak di jalan basah dan kira-kira tiga kali jarak di jalan kering.</p>' +
        '<p>AEB tetap mengerem pada TTC yang sama. Di jalan licin, jarak yang tersisa pada saat itu tidak lagi cukup untuk berhenti. Hasil percobaan menampilkan jarak waktu minimal agar tidak menabrak untuk tiap kondisi jalan.</p>' +
        '<p>Kalau jarak yang dibutuhkan melebihi 3 detik, cara yang tersisa adalah menurunkan kecepatan. Coba 40 km/jam dengan jarak 3 detik.</p>' +
        '<p class="note">Pada skenario mobil depan rem mendadak, jarak waktu minimal hampir tidak bergantung pada kondisi jalan, karena mobil depan juga sulit berhenti di jalan yang sama licinnya. Di jalan licin, rintangan yang diam jauh lebih berbahaya.</p>',
      task: {
        id: 'licin',
        text: 'Ubah jalan ke <strong>licin</strong> dengan AEB menyala, tekan <strong>Rintangan diam muncul</strong>, lalu baca jarak waktu yang dibutuhkan di hasil percobaan.',
      },
    },
    {
      title: 'Angkot berhenti mendadak',
      body:
        '<p>Angkot di Malang bisa berhenti di mana saja saat ada calon penumpang, kadang tanpa memberi tanda lebih dulu. Di percobaan ini angkot di depanmu mengerem sekuat mungkin sambil merapat ke trotoar Jalan Soekarno-Hatta. Kecepatan awalnya 40 km/jam, di bawah batas 50 km/jam.</p>' +
        '<p>Pada 40 km/jam, jarak waktu 1 detik hanya sekitar 11 m. Hitungan dari langkah 3 tetap berlaku: bila angkot dan mobilmu mengerem sama kuat, mobilmu aman hanya jika jarak waktunya lebih panjang dari waktu reaksi. Kecepatan rendah memperpendek jarak dalam meter, sedangkan jarak waktu minimalnya tetap sama.</p>' +
        '<p class="note">Calon penumpang menunggu di trotoar dan baru melangkah ke pintu setelah angkot diam. Setiap kendaraan di simulasi ini juga dijaga perisai keselamatan: 60 kali per detik perisai memeriksa apakah ada pejalan kaki di jalurnya dan mengerem bila perlu. Perisai itu hanya melindungi pejalan kaki. Tabrakan dengan angkot tidak dicegah, karena itulah yang sedang kamu uji.</p>',
      task: {
        id: 'angkot',
        text: 'Dengan reaksi manusia dan AEB mati, atur jarak waktu, lalu tekan <strong>Angkot berhenti mendadak</strong> sampai mobilmu berhenti aman di belakang angkot.',
      },
    },
  ],
  summary:
    '<p>Jarak henti terdiri dari jarak reaksi dan jarak pengereman: d = v × t<sub>r</sub> + v² / (2 × μ × g).</p>' +
    '<ul>' +
    '<li>Jarak reaksi sebanding dengan kecepatan dan waktu reaksi. Jarak pengereman naik dengan kuadrat kecepatan dan makin panjang saat jalan licin.</li>' +
    '<li>Jika kendaraan di depan mengerem sama kuat, jarak waktu harus lebih panjang dari waktu reaksi. Itulah alasan anjuran jarak 2 sampai 3 detik, di jalan tol maupun di belakang angkot di Jalan Soekarno-Hatta.</li>' +
    '<li>Untuk rintangan diam, seluruh jarak henti harus muat sebelum rintangan.</li>' +
    '<li>AEB memakai TTC untuk memberi peringatan lalu mengerem. AEB bisa mencegah atau melunakkan tabrakan, tetapi di jalan licin tetap butuh jarak lebih besar dan kecepatan lebih rendah.</li>' +
    '</ul>' +
    '<p class="note">Simulasi ini menyederhanakan banyak hal. Rem langsung mencapai perlambatan yang diminta tanpa jeda, AEB bereaksi seketika saat TTC melewati ambang (AEB sungguhan butuh sepersekian detik untuk mendeteksi dan mengerem), semua kendaraan punya rem dan ban yang sama, ACC menjaga jarak dengan sempurna, peringatan tidak mempercepat reaksi pengemudi, dan benturan tidak dimodelkan. Nilai μ, waktu reaksi sistem, dan ambang AEB adalah contoh. Gambar Jalan Soekarno-Hatta dan jalan tol adalah ilustrasi. Nama jalan, jumlah lajur, dan batas 50 km/jam berasal dari data OpenStreetMap, sedangkan lebar lajur, bangunan, dan lalu lintas lainnya hanya perkiraan atau hiasan.</p>',

  styles: `
    .lesson-jarak-aman .ja-meter { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 2; padding: 7px 12px 6px;
      border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 12px; background: rgba(11, 18, 32, 0.88);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); pointer-events: none; color: var(--text-soft); font-size: 0.8rem; line-height: 1.3; }
    .lesson-jarak-aman .ja-mhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
    .lesson-jarak-aman .ja-mtitle { color: var(--muted); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    .lesson-jarak-aman .ja-mcalc { color: var(--text); font-family: var(--mono); font-size: 0.8rem; white-space: nowrap; }
    .lesson-jarak-aman .ja-mcalc b { font-weight: 700; }
    .lesson-jarak-aman .ja-mfull { display: none; }
    .lesson-jarak-aman .ja-meter.is-wide .ja-mfull { display: inline; }
    .lesson-jarak-aman .ja-meter.is-covered { visibility: hidden; }
    .lesson-jarak-aman .ja-meter.is-wide .ja-mshort { display: none; }
    .lesson-jarak-aman .ja-r { color: #fbbf24; }
    .lesson-jarak-aman .ja-b { color: #f87171; }
    .lesson-jarak-aman .ja-verdict { margin-left: auto; padding: 1px 9px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; white-space: nowrap; }
    .lesson-jarak-aman .ja-verdict[data-tone='ok'] { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
    .lesson-jarak-aman .ja-verdict[data-tone='danger'] { background: rgba(239, 68, 68, 0.17); color: #fca5a5; }
    .lesson-jarak-aman .ja-track { position: relative; height: 10px; margin: 19px 2px 18px; border-radius: 5px; background: rgba(148, 163, 184, 0.16); }
    .lesson-jarak-aman .ja-fill { position: absolute; top: 0; bottom: 0; }
    .lesson-jarak-aman .ja-fill.is-react { left: 0; border-radius: 5px 0 0 5px; background: var(--warn); }
    .lesson-jarak-aman .ja-fill.is-brake { border-radius: 0 5px 5px 0; background: #ef4444; }
    .lesson-jarak-aman .ja-pin { position: absolute; top: -5px; bottom: -5px; width: 0; border-left: 2px solid var(--pc); }
    .lesson-jarak-aman .ja-pin.is-dashed { border-left-style: dashed; }
    .lesson-jarak-aman .ja-pin[hidden] { display: none; }
    .lesson-jarak-aman .ja-pin em { position: absolute; left: 0; color: var(--pc); font-size: 0.72rem; font-style: normal; font-weight: 650; white-space: nowrap; transform: translateX(var(--tx, -50%)); }
    .lesson-jarak-aman .ja-pin.is-a em { bottom: 100%; margin-bottom: 2px; }
    .lesson-jarak-aman .ja-pin.is-b em { top: 100%; margin-top: 2px; }
    .lesson-jarak-aman .ja-banner { --bc: var(--ok); position: absolute; top: 48px; left: 50%; z-index: 3; display: flex; gap: 10px; align-items: flex-start;
      width: max-content; max-width: min(92%, 500px); padding: 10px 14px; transform: translateX(-50%);
      border: 1px solid var(--border); border-left: 4px solid var(--bc); border-radius: 12px; background: rgba(17, 26, 46, 0.96);
      box-shadow: var(--shadow); pointer-events: none; }
    .lesson-jarak-aman .ja-banner[hidden] { display: none; }
    .lesson-jarak-aman .ja-banner[data-tone='warn'] { --bc: var(--warn); }
    .lesson-jarak-aman .ja-banner[data-tone='danger'] { --bc: #f87171; }
    .lesson-jarak-aman .ja-banner > .icon { flex: none; margin-top: 3px; color: var(--bc); font-size: 1.1rem; }
    .lesson-jarak-aman .ja-banner p { margin: 0; }
    .lesson-jarak-aman .ja-banner-title { color: var(--bc); font-weight: 800; }
    .lesson-jarak-aman .ja-banner-text { color: var(--text); font-size: 0.9rem; }
    .lesson-jarak-aman .ja-banner-sub { margin-top: 2px; color: var(--text-soft); font-size: 0.84rem; }
    .lesson-jarak-aman .ja-scn .btn { flex: 1 1 100%; min-height: 44px; justify-content: flex-start; }
    .lesson-jarak-aman .ja-grp-res { order: 1; grid-column: 1 / -1; }
    .lesson-jarak-aman .ja-grp-rumus { order: 2; }
    .lesson-jarak-aman .ja-result p { margin: 0; }
    .lesson-jarak-aman .ja-result p + p { margin-top: 5px; }
    .lesson-jarak-aman .ja-result-title { color: var(--text); font-weight: 700; }
    .lesson-jarak-aman .ja-result-meta { color: var(--muted); font-size: 0.8rem; }
    .lesson-jarak-aman .ctl-callout.is-danger { background: rgba(239, 68, 68, 0.11); }
    .lesson-jarak-aman .ctl-callout.is-danger .icon { color: #f87171; }
    .lesson-jarak-aman .ja-formula { padding: 10px 12px; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 0.88rem; line-height: 1.75; }
    .lesson-jarak-aman .ja-f-line { white-space: normal; }
    .lesson-jarak-aman .ja-term { display: inline-block; white-space: nowrap; }
    .lesson-jarak-aman .ja-f-given { color: var(--muted); font-size: 0.8rem; }
    .lesson-jarak-aman .ja-formula strong { color: var(--accent); }
    @media (max-width: 600px) {
      .lesson-jarak-aman .ja-grp-scn { order: -2; }
      .lesson-jarak-aman .ja-grp-res { order: -1; }
      .lesson-jarak-aman .ja-meter { left: 8px; right: 8px; bottom: 8px; padding: 6px 10px 5px; }
      .lesson-jarak-aman .ja-mcalc { font-size: 0.74rem; }
      .lesson-jarak-aman .ja-pin em { font-size: 0.68rem; }
      .lesson-jarak-aman .ja-banner { right: 8px; left: 8px; width: auto; max-width: none; padding: 8px 12px; transform: none; }
      .lesson-jarak-aman .ja-banner-text { font-size: 0.84rem; }
      .lesson-jarak-aman .ja-banner-sub { font-size: 0.78rem; }
      .lesson-jarak-aman .ja-formula { font-size: 0.8rem; }
    }
  `,

  mount(ctx) {
    // ---------- keadaan ----------
    const s = { kmh: 40, tau: 2, road: 'kering', reaction: 'manusia', aeb: false };
    let context = 'rem'; // skenario pembanding terakhir: 'rem' | 'rintangan' | 'angkot'
    let mode = 'ikut'; // 'ikut' | 'jalan' | 'selesai'
    const follow = { x: 0, v: kmhToMs(s.kmh), gap: kmhToMs(s.kmh) * s.tau, leadV: kmhToMs(s.kmh) };
    let run = null; // percobaan yang sedang berjalan atau baru selesai (model.js)
    let info = null; // data pendukung percobaan: pengaturan, titik henti, bingkai kamera
    let last = null; // hasil percobaan terakhir
    const holds = {};
    const cam = { left: -10, span: 60, offset: 0, y: 0, ready: false, yReady: false, rebase: false };
    let lastPanel = 0;
    let lastFrame = 0;
    let meterH = 80;
    let hudH = 30;
    let bannerH = 0;
    let bottomBlock = 90; // tinggi area bawah yang tertutup meteran atau banner (px)

    const mu = () => M.ROADS[s.road].mu;
    const tr = () => M.REACTIONS[s.reaction].t;
    const params = () => ({ v: kmhToMs(s.kmh), tau: s.tau, mu: mu(), tr: tr(), aeb: s.aeb });
    const wet = () => s.road !== 'kering';

    // Tempat dan kendaraan depan. Angkot hanya ada di jalan kota; di jalan tol konteks angkot
    // diperlakukan seperti mobil depan yang mengerem.
    const place = () => (mode === 'ikut' || !info ? placeFor(s.kmh) : info.place);
    const followContext = () => (context === 'angkot' && placeFor(s.kmh) !== 'kota' ? 'rem' : context);
    const followLead = () =>
      followContext() === 'angkot'
        ? { kind: 'angkot', length: M.ANGKOT.length, width: M.ANGKOT.width, lat: M.ANGKOT.cruiseLat }
        : { kind: 'car', length: L, width: M.CAR_WIDTH, lat: 0 };

    // ---------- keselamatan ----------
    const monitor = createMonitor();
    const street = createStreet();

    /** Pejalan kaki trotoar dalam koordinat lajur (y dihitung dari tengah lajur kiri). */
    function walkersLane() {
      return street.walkerConstraints().map((p) => ({ r: p.r, points: p.points.map((q) => ({ x: q.x, y: q.y - LANE_Y })) }));
    }
    /** Calon penumpang dalam koordinat dunia (untuk perisai kendaraan latar). */
    function passengerWorld() {
      const ped = run && run.ped;
      if (!ped || ped.state === 'dalam') return [];
      return [{ r: ped.r, points: [{ x: ped.x, y: LANE_Y + ped.lat }, { x: ped.board.x, y: LANE_Y + ped.board.lat }] }];
    }
    function lessonBoxes() {
      if (mode === 'ikut') {
        const fl = followLead();
        const rear = follow.x + follow.gap;
        return [
          { id: 'mobilmu', x: follow.x - L / 2, y: LANE_Y, heading: 0, length: L, width: M.CAR_WIDTH },
          { id: fl.kind === 'angkot' ? 'angkot' : 'mobil-depan', x: rear + fl.length / 2, y: LANE_Y + fl.lat, heading: 0, length: fl.length, width: fl.width },
        ];
      }
      return M.runBoxes(run).map((b) => ({ ...b, y: b.y + LANE_Y }));
    }
    function lessonPeds() {
      const peds = street.walkers.map((p) => ({ id: p.id, x: p.x, y: p.y, r: p.r }));
      const pc = run ? M.passengerCircle(run) : null;
      if (pc) peds.push({ ...pc, y: pc.y + LANE_Y });
      return peds;
    }

    // ---------- kanvas, lapisan di atas kanvas, dan loop ----------
    const labels = createLabelLayer();
    const view = ctx.createView({
      label: 'Jalan Soekarno-Hatta, Malang, dilihat dari atas (gambar ilustrasi). Mobilmu berwarna hijau toska mengikuti mobil depan di lajur kiri.',
      background: COLORS.ground,
    });

    const meter = ui.el('div', { class: 'ja-meter', 'aria-hidden': 'true' });
    meter.innerHTML = `
      <div class="ja-mhead">
        <span class="ja-mtitle">Jarak henti</span>
        <span class="ja-mcalc"><span class="ja-mfull" data-m="full"></span><span class="ja-mshort" data-m="short"></span> <b data-m="total"></b></span>
        <span class="ja-verdict" data-m="verdict"></span>
      </div>
      <div class="ja-track">
        <i class="ja-fill is-react" data-m="react"></i><i class="ja-fill is-brake" data-m="brake"></i>
        <span class="ja-pin is-a" data-m="pinA"><em></em></span>
        <span class="ja-pin is-b is-dashed" data-m="pinB"><em></em></span>
      </div>`;
    const mEl = (k) => meter.querySelector(`[data-m="${k}"]`);
    ctx.stage.append(meter);

    const banner = ui.el('div', { class: 'ja-banner', hidden: true });
    ctx.stage.append(banner);

    const loop = ctx.createLoop({
      update(dt) {
        const refX = mode === 'ikut' ? follow.x : run.ego.x;
        const where = place();
        if (street.place !== where) street.init(where, refX, wet());
        street.setWet(wet());
        if (mode === 'ikut') updateFollow(dt);
        else if (mode === 'jalan') {
          run.extraPeds = walkersLane();
          M.stepRun(run, dt);
          if (run.done) finishRun();
        } else if (mode === 'selesai' && run) {
          run.extraPeds = walkersLane();
          M.stepPassenger(run, dt); // penumpang tetap naik walau percobaan sudah selesai
        }
        street.update(dt, { refX: mode === 'ikut' ? follow.x : run.ego.x, mu: mu(), peds: passengerWorld() });
        monitor.check(lessonBoxes().concat(street.boxes()), lessonPeds());
      },
      render,
    });

    // Tinggi HUD, banner, dan meteran menentukan area jalan yang bebas di kanvas.
    // Di layar sempit banner hasil menempati tempat meteran di bawah, supaya jalan tetap terlihat.
    const narrow = () => view.width < 560;
    function layoutOverlays() {
      hudH = ctx.hud.offsetHeight || hudH;
      const covered = narrow() && !banner.hidden;
      meter.classList.toggle('is-covered', covered);
      if (!covered) meterH = meter.offsetHeight || meterH;
      bannerH = banner.hidden ? 0 : banner.offsetHeight;
      if (narrow()) {
        banner.style.top = 'auto';
        banner.style.bottom = '8px';
      } else {
        banner.style.top = `${Math.round(10 + hudH + 8)}px`;
        banner.style.bottom = 'auto';
      }
      bottomBlock = covered ? bannerH + 8 : meterH + (narrow() ? 8 : 10);
    }
    const ro = new ResizeObserver(layoutOverlays);
    ro.observe(meter);
    ro.observe(ctx.hud);
    ro.observe(banner);
    ctx.onCleanup(() => ro.disconnect());
    view.onResize((v) => {
      meter.classList.toggle('is-wide', v.width >= 640);
      layoutOverlays();
      refreshMeter(); // posisi label pin bergantung pada lebar meteran
    });
    meter.classList.toggle('is-wide', view.width >= 640);

    // ---------- panel kontrol ----------
    const scnGroup = ui.group(ctx.controls, { title: 'Skenario', className: 'ja-grp-scn' });
    const scnRow = ui.buttonRow(scnGroup, { className: 'ja-scn' });
    ui.button(scnRow, { label: SCENARIO_NAMES.rem, variant: 'primary', icon: 'alert', onClick: () => startScenario('rem') });
    ui.button(scnRow, { label: SCENARIO_NAMES.rintangan, variant: 'secondary', icon: 'car', onClick: () => startScenario('rintangan') });
    ui.button(scnRow, { label: SCENARIO_NAMES.angkot, variant: 'secondary', icon: 'hand', onClick: () => startScenario('angkot') });
    const outs = ui.readoutGrid(scnGroup);
    const outGap = ui.readout(outs, { label: 'Jarak', value: '-' });
    const outTimeGap = ui.readout(outs, { label: 'Jarak waktu', value: '-' });
    const outTtc = ui.readout(outs, { label: 'TTC', value: '∞' });
    const outRel = ui.readout(outs, { label: 'Kecepatan relatif', value: '0 km/jam' });
    // hasil percobaan: di layar lebar selebar panel di bawah pengaturan, di ponsel tepat setelah Skenario
    const resGroup = ui.group(ctx.controls, { title: 'Hasil percobaan', className: 'ja-grp-res' });
    const result = ui.el('div', { class: 'ctl-callout is-info ja-result' });
    resGroup.append(result);

    const setGroup = ui.group(ctx.controls, { title: 'Kecepatan dan jarak' });
    const speedCtl = ui.slider(setGroup, {
      label: 'Kecepatan',
      min: 20,
      max: 120,
      step: 5,
      value: s.kmh,
      unit: 'km/jam',
      hint: '-',
      onInput: (v) => setSetting('kmh', v),
    });
    const gapCtl = ui.slider(setGroup, {
      label: 'Jarak waktu ACC',
      min: 0.5,
      max: 3,
      step: 0.1,
      digits: 1,
      value: s.tau,
      unit: 'detik',
      hint: '-',
      onInput: (v) => setSetting('tau', Math.round(v * 10) / 10),
    });
    setGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Anjuran umum: jaga jarak 2 sampai 3 detik dari kendaraan di depan.' }));

    const brakeGroup = ui.group(ctx.controls, { title: 'Jalan dan pengereman' });
    const roadCtl = ui.segmented(brakeGroup, {
      label: 'Kondisi jalan',
      options: M.ROAD_IDS.map((id) => ({ value: id, label: M.ROADS[id].label })),
      value: s.road,
      onChange: (v) => setSetting('road', v),
    });
    const roadHint = ui.el('p', { class: 'ctl-hint' });
    brakeGroup.append(roadHint);
    const reactCtl = ui.segmented(brakeGroup, {
      label: 'Waktu reaksi',
      options: [
        { value: 'manusia', label: 'Manusia' },
        { value: 'sistem', label: 'Sistem otomatis' },
      ],
      value: s.reaction,
      onChange: (v) => setSetting('reaction', v),
    });
    const reactHint = ui.el('p', { class: 'ctl-hint' });
    brakeGroup.append(reactHint);
    const aebCtl = ui.toggle(brakeGroup, {
      label: 'AEB',
      color: COLORS.kamera,
      hint: 'Rem darurat otomatis yang memantau TTC',
      checked: s.aeb,
      onChange: (on) => setSetting('aeb', on),
    });

    const fGroup = ui.group(ctx.controls, { title: 'Rumus jarak henti', wide: true, className: 'ja-grp-rumus' });
    const fBox = ui.el('div', { class: 'ja-formula' });
    fGroup.append(fBox);

    // HUD di atas kanvas
    const chipSpeed = ui.hudChip(ctx.hud, { label: 'Kecepatan', color: COLORS.ego });
    const chipTtc = ui.hudChip(ctx.hud, { label: 'TTC', color: COLORS.radar });
    const chipAeb = ui.hudChip(ctx.hud, { label: 'AEB', color: COLORS.kamera });
    const chipPlace = ui.hudChip(ctx.hud, { label: 'Lokasi', color: '#4ade80' });

    // ---------- kait uji (hanya dibaca oleh skrip uji) ----------
    const hook = {
      get redRuns() {
        return monitor.redRuns;
      },
      get pedContacts() {
        return monitor.pedContacts;
      },
      get otherCollisions() {
        return monitor.otherCollisions;
      },
      get shieldActs() {
        return monitor.shieldActs + street.shieldActs + (run ? run.shieldActs : 0);
      },
      get clamps() {
        return monitor.clamps + street.clamps + (run ? run.clamps : 0);
      },
      snapshot: () => ({
        ...monitor.snapshot(),
        shieldActs: hook.shieldActs,
        clamps: hook.clamps,
        signals: 0,
        mode,
        place: place(),
        context,
        kmh: s.kmh,
        walkers: street.walkers.length,
        npcs: street.npcs.length,
        passenger: run && run.ped ? { state: run.ped.state, x: run.ped.x, lat: run.ped.lat, door: run.lead.door } : null,
        lead: run ? { kind: run.lead.kind, v: run.lead.v, lat: run.lead.lat } : null,
        time: loop.time,
      }),
    };
    window.__lessonSafety = hook;
    ctx.onCleanup(() => {
      if (window.__lessonSafety === hook) delete window.__lessonSafety;
    });

    // ---------- pengaturan ----------
    function setSetting(key, value) {
      s[key] = value;
      if (mode === 'selesai') backToFollow();
      refreshSettings();
    }

    function applyPreset(p) {
      Object.assign(s, { kmh: p.kmh, tau: p.tau, road: p.road, reaction: p.reaction, aeb: p.aeb });
      context = p.context;
      speedCtl.set(s.kmh);
      gapCtl.set(s.tau);
      roadCtl.set(s.road);
      reactCtl.set(s.reaction);
      aebCtl.set(s.aeb);
      backToFollow();
      refreshSettings();
    }

    function refreshSettings() {
      const v = kmhToMs(s.kmh);
      gapCtl.setHint(`Setara ${fmt(v * s.tau, 1)} m pada ${fmt(s.kmh, 0)} km/jam.`);
      speedCtl.setHint(
        placeFor(s.kmh) === 'kota'
          ? `Lokasi: Jalan Soekarno-Hatta, Malang. Batas kecepatannya ${M.CITY_MAX_KMH} km/jam menurut OpenStreetMap.`
          : `Lokasi: jalan tol (ilustrasi). Sampai ${M.CITY_MAX_KMH} km/jam simulasi berada di Jalan Soekarno-Hatta.`,
      );
      roadHint.textContent = `μ sekitar ${fmtMu(mu())} (perkiraan), perlambatan maksimum ${fmt(mu() * M.G, 1)} m/s².`;
      reactHint.textContent =
        s.reaction === 'manusia' ? 'Pengemudi manusia: 1,5 detik, nilai yang umum dipakai.' : 'Sistem otomatis: 0,3 detik, angka ilustrasi.';
      refreshFormula();
      refreshMeter();
      refreshPanels(0);
      if (mode === 'ikut') view.setLabel(followLabel());
    }

    function followLabel() {
      const where = placeFor(s.kmh) === 'kota' ? 'Jalan Soekarno-Hatta, Malang,' : 'Jalan tol';
      const who = followLead().kind === 'angkot' ? 'angkot' : 'mobil depan';
      return `${where} dilihat dari atas (gambar ilustrasi). Mobilmu berwarna hijau toska mengikuti ${who} di lajur kiri. Pita kuning dan merah di depan mobilmu menunjukkan jarak reaksi dan jarak pengereman.`;
    }

    // ---------- mode ikut (ACC) ----------
    function updateFollow(dt) {
      const vT = kmhToMs(s.kmh);
      let v = approach(follow.v, vT, 3 * dt);
      const want = v * s.tau;
      const rate = clamp((want - follow.gap) * 1.2, -6, 6);
      let leadV = v + rate;
      // perisai keselamatan untuk mobilmu dan kendaraan depan (pejalan kaki trotoar)
      const a = mu() * M.G;
      const peds = walkersLane();
      const fl = followLead();
      const leadRear = follow.x + follow.gap;
      const leadCon = pedConstraint({ front: leadRear + fl.length, length: fl.length, y: fl.lat, halfW: fl.width / 2, dir: 1 }, peds);
      const sl = shieldSpeed(follow.leadV, leadV, leadCon, a, dt);
      if (sl.limited) monitor.shieldActs += 1;
      leadV = sl.v;
      const egoCon = pedConstraint({ front: follow.x, length: L, y: 0, halfW: M.CAR_WIDTH / 2, dir: 1 }, peds);
      const se = shieldSpeed(follow.v, v, egoCon, a, dt);
      if (se.limited) monitor.shieldActs += 1;
      v = se.v;
      let egoDx = v * dt;
      if (egoDx > se.clampTo) {
        egoDx = Math.max(0, se.clampTo);
        v = 0;
        monitor.clamps += 1;
      }
      let leadDx = leadV * dt;
      if (leadDx > sl.clampTo) {
        leadDx = Math.max(0, sl.clampTo);
        leadV = 0;
        monitor.clamps += 1;
      }
      follow.gap += leadDx - egoDx;
      follow.x += egoDx;
      follow.v = v;
      follow.leadV = leadV;
    }

    function backToFollow() {
      const x = run ? run.ego.x : follow.x;
      const v = kmhToMs(s.kmh);
      if (mode !== 'ikut') {
        Object.assign(follow, { x, v, gap: v * s.tau, leadV: v });
        cam.rebase = true;
      }
      mode = 'ikut';
      run = null;
      info = null;
      banner.hidden = true;
      layoutOverlays();
      view.setLabel(followLabel());
    }

    // ---------- percobaan ----------
    function startScenario(sc) {
      if (sc === 'angkot' && s.kmh > M.CITY_MAX_KMH) {
        // angkot tidak lewat jalan tol: pindah ke Jalan Soekarno-Hatta dengan batas kecepatannya
        s.kmh = M.CITY_MAX_KMH;
        speedCtl.set(s.kmh);
        ctx.toast(`Angkot tidak lewat jalan tol. Kecepatan diturunkan ke ${M.CITY_MAX_KMH} km/jam, batas kecepatan Jalan Soekarno-Hatta.`, { tone: 'info' });
      }
      const p = params();
      const x0 = run ? run.ego.x : follow.x;
      context = sc;
      Object.assign(follow, { x: x0, v: p.v, gap: p.v * p.tau, leadV: p.v });
      run = M.createRun(p, sc, x0);
      const ghost = M.simulate(p, sc, { ghost: true });
      const real = M.simulate(p, sc);
      const ghostStopX = x0 + ghost.ego.x;
      const braking = sc === 'rem' || sc === 'angkot';
      const leadStopX = braking ? x0 + ghost.lead.x : null;
      const far = braking ? leadStopX + run.lead.length : run.obstacle.x + L;
      info = {
        p,
        sc,
        kmh: s.kmh,
        road: s.road,
        reaction: s.reaction,
        place: placeFor(s.kmh),
        ghostStopX,
        leadStopX,
        willCollide: real.outcome.collided,
        frameLeft: x0 - L - 3,
        frameRight: Math.max(ghostStopX, far, run.ped ? run.ped.x + 2 : -Infinity) + 8,
      };
      mode = 'jalan';
      cam.rebase = true;
      banner.hidden = true;
      layoutOverlays();
      for (const k of Object.keys(holds)) holds[k] = 0;
      if (ctx.paused) ctx.resume();
      view.setLabel(
        sc === 'rem'
          ? 'Percobaan berjalan: mobil depan mengerem mendadak di lajur kiri.'
          : sc === 'angkot'
            ? 'Percobaan berjalan: angkot di depan mobilmu berhenti mendadak di Jalan Soekarno-Hatta untuk menaikkan calon penumpang yang menunggu di trotoar.'
            : 'Percobaan berjalan: mobil depan pindah ke lajur kanan dan ada mobil mogok di lajur kiri.',
      );
      refreshSettings();
    }

    function finishRun() {
      mode = 'selesai';
      const p = info.p;
      const o = run.outcome;
      if (o.collided) monitor.otherCollisions += 1;
      const cf = p.aeb ? M.simulate({ ...p, aeb: false }, info.sc).outcome : null;
      const need = {};
      for (const id of M.ROAD_IDS) need[id] = M.neededGapStep({ ...p, mu: M.ROADS[id].mu }, info.sc);
      last = { o, p, cf, need, sc: info.sc, kmh: info.kmh, road: info.road, reaction: info.reaction };
      const d = describe(last);
      banner.dataset.tone = d.tone;
      banner.innerHTML = `${icon(d.tone === 'ok' ? 'check' : 'alert')}<div><p class="ja-banner-title">${esc(d.title)}</p><p class="ja-banner-text">${esc(d.main)}</p>${
        d.sub ? `<p class="ja-banner-sub">${esc(d.sub)}</p>` : ''
      }</div>`;
      banner.hidden = false;
      layoutOverlays();
      view.setLabel(`Hasil percobaan ${SCENARIO_NAMES[info.sc].toLowerCase()}: ${d.title.toLowerCase()}. ${d.main}`);
      renderResult();
      checkRunTask(last);
      refreshPanels(0);
    }

    // Teks hasil: judul, kalimat utama, kalimat tambahan untuk banner, dan rincian untuk panel.
    function describe(r) {
      const { o, p, cf, sc } = r;
      const who = r.reaction === 'manusia' ? 'pengemudi' : 'sistem';
      const target = sc === 'rem' ? 'mobil depan' : sc === 'angkot' ? 'angkot' : 'mobil mogok';
      let tone = 'ok';
      let title = 'Aman';
      let main = `Mobilmu berhenti dengan sisa jarak ${fmt(o.remaining, 1, 'm')} di belakang ${target}.`;
      if (o.collided) {
        tone = 'danger';
        title = 'Tabrakan';
        main =
          sc === 'rem'
            ? `Benturan ${fmt(kmhOf(o.impact), 0, 'km/jam')} (selisih kecepatan kedua mobil).`
            : sc === 'angkot'
              ? `Mobilmu menabrak angkot, benturan ${fmt(kmhOf(o.impact), 0, 'km/jam')} (selisih kecepatan keduanya).`
              : `Mobilmu menabrak mobil mogok pada ${fmt(kmhOf(o.impact), 0, 'km/jam')}.`;
      } else if (o.remaining < NEAR_MISS) {
        tone = 'warn';
        title = 'Nyaris';
        main =
          o.remaining < 0.05
            ? `Mobilmu berhenti tepat menempel di belakang ${target}, tanpa sisa jarak.`
            : `Mobilmu berhenti hanya ${fmt(o.remaining, 1, 'm')} di belakang ${target}.`;
      }

      const lines = [];
      const st = M.stoppingDistance(p.v, p.tr, p.mu);
      if (sc === 'rem' || sc === 'angkot') {
        if (p.tau < p.tr - 1e-9) lines.push(`Jarak waktu ${fmt(p.tau, 1)} detik lebih pendek dari waktu reaksi ${fmt(p.tr, 1)} detik. Selama ${who} bereaksi, mobilmu menempuh ${fmt(st.reaction, 1, 'm')} tanpa mengerem.`);
        else if (p.tau < p.tr + 1e-9) lines.push(`Jarak waktu ${fmt(p.tau, 1)} detik sama dengan waktu reaksi, jadi jarak reaksi (${fmt(st.reaction, 1, 'm')}) sama dengan jarak ke ${target}.`);
        else lines.push(`Jarak waktu ${fmt(p.tau, 1)} detik lebih panjang dari waktu reaksi ${fmt(p.tr, 1)} detik, jadi jarak reaksi masih muat.`);
      } else {
        lines.push(`Mobil mogok terlihat ${fmt(o.eventGap, 1, 'm')} di depan, sedangkan jarak henti mobilmu ${fmt(st.total, 1, 'm')}.`);
      }

      let sub = '';
      if (p.aeb) {
        const aebBrakeT = o.aebTimes[2]?.t ?? o.aebTimes[3]?.t ?? Infinity;
        const warnT = o.aebTimes[1]?.t ?? Infinity;
        const bad = o.collided || o.remaining < NEAR_MISS;
        const cfKmh = Math.round(kmhOf(cf.impact || 0));
        const oKmh = Math.round(kmhOf(o.impact || 0));
        if (o.aebMax < 1) {
          lines.push('AEB tidak perlu bertindak karena TTC tidak pernah turun di bawah 2,5 detik.');
        } else if (aebBrakeT >= p.tr - 1e-6) {
          lines.push(
            warnT < p.tr
              ? `AEB sempat memberi peringatan, tetapi ${who} sudah mengerem sebelum TTC turun di bawah 1,6 detik.${bad ? ' Hasilnya sama dengan tanpa AEB.' : ''}`
              : `AEB baru bertindak setelah ${who} mengerem.${bad ? ' Hasilnya sama dengan tanpa AEB.' : ''}`,
          );
          if (bad) sub = 'AEB tidak sempat mengubah hasil.';
        } else if (cf.collided && !o.collided) {
          lines.push(`Tanpa AEB, mobilmu akan menabrak pada ${fmt(cfKmh, 0, 'km/jam')}. AEB mulai mengerem ${fmt(p.tr - aebBrakeT, 1)} detik sebelum ${who} dan mencegah tabrakan.`);
          sub = `Tanpa AEB: menabrak pada ${fmt(cfKmh, 0, 'km/jam')}.`;
        } else if (cf.collided && o.collided) {
          lines.push(`Tanpa AEB, benturan ${fmt(cfKmh, 0, 'km/jam')}. AEB mulai mengerem ${fmt(p.tr - aebBrakeT, 1)} detik sebelum ${who} dan menurunkan benturan sebesar ${fmt(cfKmh - oKmh, 0, 'km/jam')}.`);
          sub = `Tanpa AEB: benturan ${fmt(cfKmh, 0, 'km/jam')}.`;
        } else {
          lines.push(`Tanpa AEB, mobilmu juga berhenti, dengan sisa jarak ${fmt(cf.remaining, 1, 'm')}.`);
        }
      }
      if (!sub && (o.collided || o.remaining < NEAR_MISS)) sub = lines[0];

      // r.need sudah berupa kelipatan 0,1 detik yang benar-benar tanpa benturan (model.neededGapStep)
      const fmtNeed = (x) => (!Number.isFinite(x) ? 'lebih dari 12 detik' : x <= 0 ? 'berapa pun cukup' : `${fmt(x, 1)} detik`);
      lines.push(
        `Jarak waktu minimal agar tidak menabrak pada ${fmt(r.kmh, 0)} km/jam dengan pengaturan ini: ` +
          M.ROAD_IDS.map((id) => `jalan ${M.ROADS[id].label.toLowerCase()} ${fmtNeed(r.need[id])}`).join(', ') +
          '.',
      );
      return { tone, title, main, sub, lines };
    }

    function renderResult() {
      if (!last) {
        result.className = 'ctl-callout is-info ja-result';
        result.innerHTML = `${icon('info')}<div><p>Belum ada percobaan. Tekan salah satu skenario di atas.</p></div>`;
        return;
      }
      const d = describe(last);
      result.className = `ctl-callout is-${d.tone === 'ok' ? 'ok' : d.tone === 'warn' ? 'warn' : 'danger'} ja-result`;
      const where = placeFor(last.kmh) === 'kota' ? 'Jalan Soekarno-Hatta' : 'jalan tol';
      const meta =
        `${SCENARIO_NAMES[last.sc]} di ${where}, ${fmt(last.kmh, 0)} km/jam, jarak waktu ${fmt(last.p.tau, 1)} detik, ` +
        `jalan ${M.ROADS[last.road].label.toLowerCase()}, reaksi ${M.REACTIONS[last.reaction].short.toLowerCase()}, AEB ${last.p.aeb ? 'menyala' : 'mati'}.`;
      result.innerHTML =
        `${icon(d.tone === 'ok' ? 'check' : 'alert')}<div>` +
        `<p class="ja-result-title">${esc(d.title)}. ${esc(d.main)}</p>` +
        d.lines.map((l) => `<p>${esc(l)}</p>`).join('') +
        `<p class="ja-result-meta">${esc(meta)}</p></div>`;
    }

    // ---------- tugas ----------
    const currentTask = () => ctx.lesson.steps[ctx.currentStep()]?.taskId || null;

    function checkRunTask(r) {
      const id = currentTask();
      if (!id || ctx.isTaskDone(id)) return;
      const { o, p, cf, sc } = r;
      let ok = false;
      if (id === 'crash') ok = sc === 'rem' && r.reaction === 'manusia' && !p.aeb && p.tau <= 1.25 && (o.collided || o.remaining < NEAR_MISS);
      else if (id === 'gap-fix') ok = sc === 'rem' && r.reaction === 'manusia' && p.tau >= 1.95 && !o.collided;
      else if (id === 'aeb') {
        const aebBrakeT = o.aebTimes[2]?.t ?? o.aebTimes[3]?.t ?? Infinity;
        const early = aebBrakeT < p.tr - 1e-6;
        const better = cf && cf.collided && (!o.collided || kmhOf(cf.impact) - kmhOf(o.impact) >= 3);
        ok = p.aeb && p.tau < 2 && early && better;
      } else if (id === 'licin') ok = r.road === 'licin' && p.aeb && sc === 'rintangan';
      else if (id === 'angkot') ok = sc === 'angkot' && r.reaction === 'manusia' && !p.aeb && !o.collided && o.remaining >= NEAR_MISS;
      if (ok) ctx.completeTask(id);
    }

    function checkHoldTasks(realDt) {
      const id = currentTask();
      if (id !== 'calc' || ctx.isTaskDone(id)) return;
      holds.calc = s.kmh === 80 && s.road === 'basah' ? (holds.calc || 0) + realDt : 0;
      if (holds.calc >= 1) ctx.completeTask('calc');
    }

    // ---------- meteran jarak henti dan rumus ----------
    function refreshFormula() {
      const v = kmhToMs(s.kmh);
      const st = M.stoppingDistance(v, tr(), mu());
      const vs = fmt(v, 2);
      // tiap suku tidak dipotong, tetapi baris boleh patah di antara suku (layar sempit)
      const term = (html, cls = '') => `<span class="ja-term ${cls}">${html}</span>`;
      fBox.innerHTML =
        `<div class="ja-f-line">d = ${term('v × t<sub>r</sub>', 'ja-r')} + ${term('v² / (2 × μ × g)', 'ja-b')}</div>` +
        `<div class="ja-f-line ja-f-given">${term(`v = ${fmt(s.kmh, 0)} km/jam = ${vs} m/s,`)} ${term(`t<sub>r</sub> = ${fmt(tr(), 1)} detik,`)} ${term(`μ = ${fmtMu(mu())},`)} ${term('g = 9,8 m/s²')}</div>` +
        `<div class="ja-f-line">d = ${term(`${vs} × ${fmt(tr(), 1)}`, 'ja-r')} + ${term(`${vs}² / (2 × ${fmtMu(mu())} × 9,8)`, 'ja-b')}</div>` +
        `<div class="ja-f-line">&nbsp;&nbsp;= ${term(`${fmt(st.reaction, 1)} m`, 'ja-r')} + ${term(`${fmt(st.braking, 1)} m`, 'ja-b')} = <strong>${fmt(st.total, 1)} m</strong></div>`;
    }

    function refreshMeter() {
      const v = kmhToMs(s.kmh);
      const st = M.stoppingDistance(v, tr(), mu());
      const vs = fmt(v, 2);
      mEl('full').innerHTML =
        `<span class="ja-r">${vs} × ${fmt(tr(), 1)}</span> + <span class="ja-b">${vs}² / (2 × ${fmtMu(mu())} × 9,8)</span> = ` +
        `<span class="ja-r">${fmt(st.reaction, 1)}</span> + <span class="ja-b">${fmt(st.braking, 1)}</span> =`;
      mEl('short').innerHTML = `<span class="ja-r">${fmt(st.reaction, 1)}</span> + <span class="ja-b">${fmt(st.braking, 1)}</span> =`;
      mEl('total').textContent = fmt(st.total, 1, 'm');

      const gap = v * s.tau;
      const ctxNow = mode === 'ikut' || !info ? followContext() : info.sc;
      const leadName = ctxNow === 'angkot' ? 'angkot' : 'mobil depan';
      let pinB;
      let margin;
      if (ctxNow === 'rem' || ctxNow === 'angkot') {
        pinB = { at: gap + st.braking, text: `${leadName} berhenti ${fmt(gap + st.braking, 1, 'm')}`, color: C.leadStop, dashed: true };
        margin = gap - st.reaction; // sama-sama mengerem sekuat mungkin
      } else {
        const d0 = M.obstacleDistance(v, s.tau);
        pinB = { at: d0, text: `mobil mogok terlihat ${fmt(d0, 1, 'm')}`, color: C.obstacle, dashed: false };
        margin = d0 - st.total;
      }
      const verdict = mEl('verdict');
      verdict.dataset.tone = margin >= 0 ? 'ok' : 'danger';
      verdict.textContent = margin >= 0 ? `cukup, sisa ${fmt(margin, 1, 'm')}` : `kurang ${fmt(-margin, 1, 'm')}`;

      const max = Math.max(st.total, gap, pinB.at) * 1.04 + 1;
      const pct = (x) => clamp((x / max) * 100, 0, 100);
      mEl('react').style.width = `${pct(st.reaction)}%`;
      const brake = mEl('brake');
      brake.style.left = `${pct(st.reaction)}%`;
      brake.style.width = `${pct(st.total) - pct(st.reaction)}%`;
      placePin(mEl('pinA'), pct(gap), `${leadName} ${fmt(gap, 1, 'm')}`, C.lead, false);
      placePin(mEl('pinB'), pct(pinB.at), pinB.text, pinB.color, pinB.dashed);
    }

    // Label pin berada di tengah pin, tetapi digeser seperlunya supaya tidak keluar dari meteran.
    function placePin(pin, pct, text, color, dashed) {
      pin.style.left = `${pct}%`;
      pin.style.setProperty('--pc', color);
      pin.classList.toggle('is-dashed', dashed);
      const em = pin.querySelector('em');
      em.textContent = text;
      const tw = pin.parentElement.clientWidth;
      const w = em.offsetWidth;
      if (!tw || !w) {
        pin.style.setProperty('--tx', pct < 18 ? '-2px' : pct > 72 ? 'calc(-100% + 2px)' : '-50%');
        return;
      }
      const x = (pct / 100) * tw;
      const left = clamp(x - w / 2, -2, tw - w + 2);
      pin.style.setProperty('--tx', `${Math.round(left - x)}px`);
    }

    // ---------- pembaruan panel (dari render, sekitar 8 kali per detik) ----------
    function measureNow() {
      if (mode === 'ikut') {
        const closing = follow.v - follow.leadV;
        return { gap: follow.gap, v: follow.v, closing, ttc: M.ttcOf(follow.gap, closing) };
      }
      const m = M.measure(run);
      return { gap: Math.max(0, m.gap), v: run.ego.v, closing: run.done ? 0 : m.closing, ttc: run.done ? NaN : m.ttc };
    }

    function refreshPanels(realDt) {
      const m = measureNow();
      outGap.set(fmt(m.gap, 1, 'm'));
      const tg = m.v > 0.3 ? m.gap / m.v : NaN;
      outTimeGap.set(Number.isFinite(tg) ? fmt(tg, 1, 'detik') : '-');
      outTimeGap.setTone(Number.isFinite(tg) && tg < 2 ? 'warn' : '');
      const ttcText = Number.isNaN(m.ttc) ? '-' : Number.isFinite(m.ttc) ? fmt(m.ttc, 1, 'detik') : '∞';
      const ttcTone = m.ttc < M.AEB_TTC.full ? 'danger' : m.ttc < M.AEB_TTC.fcw ? 'warn' : '';
      outTtc.set(ttcText);
      outTtc.setTone(ttcTone);
      // kecepatan relatif = kecepatan target dikurangi kecepatan mobilmu, jadi minus berarti mendekat
      // (tanda yang sama dengan radar di pelajaran Sensor)
      outRel.set(fmtSigned(-kmhOf(m.closing), 0, 'km/jam'));
      outRel.setTone(m.closing > 0.5 ? 'warn' : '');

      chipSpeed.set(fmt(kmhOf(m.v), 0, 'km/jam'));
      chipTtc.set(ttcText);
      chipTtc.setTone(ttcTone);
      const aebOn = mode === 'ikut' ? s.aeb : info.p.aeb;
      const stage = mode === 'ikut' || !run ? 0 : run.aebStage;
      chipAeb.set(aebOn ? M.AEB_STAGES[stage] : 'mati');
      chipAeb.setTone(!aebOn ? '' : stage >= 3 ? 'danger' : stage >= 1 ? 'warn' : 'ok');
      chipPlace.set(PLACES[place()].chip);
      chipPlace.show(!narrow());

      checkHoldTasks(realDt);
      ctx.setStatus(statusText());
    }

    function statusText() {
      const road = M.ROADS[s.road].label.toLowerCase();
      if (mode === 'ikut') {
        const v = kmhToMs(s.kmh);
        const st = M.stoppingDistance(v, tr(), mu());
        const who = followLead().kind === 'angkot' ? 'angkot' : 'mobil depan';
        return `Mobilmu mengikuti ${who} pada ${fmt(s.kmh, 0)} km/jam dengan jarak waktu ${fmt(s.tau, 1)} detik (${fmt(v * s.tau, 1, 'm')}). Jarak henti di jalan ${road}: ${fmt(st.total, 1, 'm')}.`;
      }
      if (mode === 'selesai') {
        const d = describe(last);
        const ped = run && run.ped;
        const extra = ped && (ped.state === 'jalan' || ped.state === 'naik') ? ' Penumpang sedang naik ke angkot.' : '';
        return `${d.title}. ${d.main}${extra}`;
      }
      const who = info.reaction === 'manusia' ? 'Pengemudi' : 'Sistem';
      if (run.t < 0) {
        if (info.sc === 'rem') return 'Mobilmu mengikuti mobil depan. Perhatikan lampu remnya.';
        if (info.sc === 'angkot') return 'Mobilmu mengikuti angkot. Ada calon penumpang menunggu di trotoar.';
        return 'Mobil depan pindah ke lajur kanan.';
      }
      const first =
        info.sc === 'rem'
          ? 'Mobil depan mengerem sekuat mungkin.'
          : info.sc === 'angkot'
            ? 'Angkot berhenti mendadak untuk menaikkan penumpang.'
            : `Ada mobil mogok ${fmt(run.eventGap, 0, 'm')} di depan.`;
      const parts = [first];
      if (run.driverBraking) parts.push(`${who} mengerem penuh.`);
      else parts.push(`${who} masih bereaksi.`);
      if (info.p.aeb && run.aebStage >= 1) parts.push(`AEB: ${M.AEB_STAGES[run.aebStage]}.`);
      return parts.join(' ');
    }

    // ---------- kamera ----------
    function updateCamera(realDt) {
      const W = view.width;
      const H = view.height;
      if (W < 2 || H < 2) return;
      const maxSpan = Math.max(36, W / 5); // mobil tidak lebih kecil dari 5 piksel per meter
      const minSpan = Math.min(maxSpan, 44);
      const k = realDt > 0 ? 1 - Math.exp(-realDt / 0.3) : 1;
      let left;
      if (mode === 'ikut') {
        const st = M.stoppingDistance(follow.v, tr(), mu());
        const leadStop = followContext() !== 'rintangan' ? follow.gap + (follow.leadV * follow.leadV) / (2 * mu() * M.G) : 0;
        const ahead = Math.max(st.total + 6, follow.gap + L + 10, leadStop + 8);
        const want = clamp((ahead + L + 4) / 0.96, minSpan, maxSpan);
        cam.span = cam.ready ? cam.span + (want - cam.span) * k : want;
        left = follow.x - L - 4 - 0.02 * cam.span;
      } else {
        const span0 = info.frameRight - info.frameLeft;
        const want = clamp(span0, minSpan, maxSpan);
        cam.span = cam.ready ? cam.span + (want - cam.span) * k : want;
        left = span0 <= cam.span + 0.5 ? info.frameLeft : clamp(run.ego.x - 0.4 * cam.span, info.frameLeft, info.frameRight - cam.span);
      }
      if (!cam.ready || cam.rebase) {
        cam.offset = cam.ready ? cam.left - left : 0;
        cam.rebase = false;
        cam.ready = true;
      }
      cam.offset *= realDt > 0 ? Math.exp(-realDt / 0.35) : 1;
      if (Math.abs(cam.offset) < 0.01) cam.offset = 0;
      cam.left = left + cam.offset;

      const scale = W / cam.span;
      // area bebas di antara HUD (atau banner hasil) dan meteran jarak henti
      const bannerTop = !banner.hidden && !narrow();
      const top = bannerTop ? 10 + hudH + 8 + bannerH + 4 : 10 + hudH + 6 + (narrow() ? 26 : 0); // label lokasi di layar sempit
      const bottom = H - (!banner.hidden && narrow() ? bannerH : meterH) - 16;
      const mid = bottom > top + 40 ? (top + bottom) / 2 : H / 2;
      const wantY = FOCUS_Y - (mid - H / 2) / scale;
      cam.y = cam.yReady ? cam.y + (wantY - cam.y) * k : wantY;
      cam.yReady = true;
      view.camera.scale = scale;
      view.camera.x = cam.left + cam.span / 2;
      view.camera.y = cam.y;
    }

    // ---------- menggambar ----------
    function render() {
      const now = performance.now();
      const realDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      updateCamera(realDt);
      const where = place();
      const g = view.begin(COLORS.ground);
      drawWorld(g, view, where, { labels });
      drawStreetLife(g, view, street, ctx.reducedMotion ? 0 : loop.time);
      if (mode === 'ikut') drawFollow(g);
      else drawRun(g);
      labels.draw(g, view);
      // layar sempit: lokasi sebagai label kecil di kanvas, karena baris chip HUD sudah penuh
      if (narrow()) drawPlaceTag(g, view, PLACES[where].tag, { top: 10 + hudH + 6 });
      // nama jalan dan batas kecepatan berasal dari OpenStreetMap
      if (where === 'kota') drawAttribution(g, view, { offsetY: bottomBlock });

      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    const egoBox = (xFront, braking) => ({ x: xFront - L / 2, y: LANE_Y, heading: 0, length: L, width: M.CAR_WIDTH, ego: true, braking });

    // Label untuk benda yang mungkin di luar layar (kamera ponsel hanya selebar sekitar 70 m).
    // Lapisan label menyembunyikan label berjangkar di luar layar. Karena itu label hanya dipasang
    // bila jangkarnya terlihat. Bila benda ada di luar tepi kanan, dipakai label di tepi kanan
    // dengan panah, digeser ke kiri supaya panah titik henti di tepi kanan tetap terlihat.
    function markLabel(x, y, text, opts, offText = null, offOpts = {}) {
      const b = view.visibleBounds();
      const pad = view.px(6);
      if (x >= b.minX + pad && x <= b.maxX - pad) labels.add(x, y, text, opts);
      else if (offText && x > b.maxX - pad) labels.add(b.maxX, y, `${offText} →`, { ...opts, align: 'right', dx: -28, ...offOpts });
    }

    // Baris label: nama kendaraan tepat di bawahnya (ROW_A), keterangan titik henti di bawahnya (ROW_B).
    const ROW_A = 12;
    const ROW_B = 35;
    const ROW_Y = LANE_Y + 0.9;

    function drawLead(g, lead, kind, { braking = false, doorOpen = false } = {}) {
      if (kind === 'angkot') drawLeadAngkot(g, view, lead, { braking, doorOpen });
      else drawCarBox(g, view, lead, { color: '#7d8fb0' });
    }

    function drawFollow(g) {
      const b = view.visibleBounds();
      const st = M.stoppingDistance(follow.v, tr(), mu());
      const x0 = follow.x;
      const leadRear = x0 + follow.gap;
      const fl = followLead();
      const leadName = fl.kind === 'angkot' ? 'angkot' : 'mobil depan';
      const lead = { x: leadRear + fl.length / 2, y: LANE_Y + fl.lat, heading: 0, length: fl.length, width: fl.width, braking: follow.leadV < follow.v - 0.4 };
      labels.add(x0 - L / 2, ROW_Y, 'mobilmu', { color: COLORS.accent, dy: ROW_A, size: 11 });
      markLabel(lead.x, ROW_Y, leadName, { color: fl.kind === 'angkot' ? C.angkot : C.lead, dy: ROW_A, size: 11 }, leadName);
      const dimY = dimensionY(place());
      markLabel(
        (x0 + Math.min(leadRear, b.maxX)) / 2,
        dimY,
        `${fmt(follow.gap, 1, 'm')} (${fmt(follow.gap / Math.max(0.1, follow.v), 1)} detik)`,
        { mono: true, size: 11, dy: 0 },
      );
      drawLaneBand(g, view, x0, x0 + st.reaction, C.react);
      drawLaneBand(g, view, x0 + st.reaction, x0 + st.total, C.brake);
      const end = x0 + st.total;
      if (end < b.maxX - view.px(8)) {
        drawStopMark(g, view, end, C.brake);
        labels.add(end, ROW_Y, `mobilmu berhenti (${fmt(st.total, 1, 'm')})`, { color: '#fca5a5', dy: ROW_B, size: 11 });
      } else {
        drawOffscreenArrow(g, view, LANE_Y, C.brake);
        labels.add(b.maxX, ROW_Y, `mobilmu berhenti setelah ${fmt(st.total, 1, 'm')}`, { color: '#fca5a5', align: 'right', dx: -8, dy: ROW_B, size: 11 });
      }
      if (followContext() !== 'rintangan') {
        const ls = leadRear + (follow.leadV * follow.leadV) / (2 * mu() * M.G);
        if (ls < b.maxX - view.px(8)) {
          drawStopMark(g, view, ls, C.leadStop, { dashed: true, width: 2 });
          labels.add(ls, ROW_Y, `${leadName} berhenti`, { color: C.leadStop, dy: ROW_B, size: 11 });
        }
      }
      drawDimension(g, view, x0, leadRear, undefined, dimY);

      drawLead(g, lead, fl.kind);
      drawCarBox(g, view, egoBox(x0, false));
    }

    function drawRun(g) {
      const r = run;
      const b = view.visibleBounds();
      const started = r.t >= -1e-9;
      const ev = r.eventX;
      const dimY = dimensionY(info.place);
      addRunCarLabels(r, started);

      // jejak yang sudah ditempuh sejak kejadian: kuning sebelum rem bekerja, merah saat mengerem
      if (started) {
        const bx = r.brakeStart ? r.brakeStart.x : r.ego.x;
        drawLaneBand(g, view, ev, Math.min(bx, r.ego.x), C.react, { alpha: 0.3 });
        if (r.brakeStart) drawLaneBand(g, view, r.brakeStart.x, r.ego.x, C.brake, { alpha: 0.3 });
        const byAeb = r.brakeStart && (!r.driverStart || r.driverStart.t > r.brakeStart.t + 1e-6);
        const reactEnd = r.brakeStart ? r.brakeStart.x : r.ego.x;
        const egoRear = r.ego.x - L - view.px(4);
        // label diletakkan di tengah bagian yang terlihat dan tidak tertutup mobilmu
        const spanLabel = (a, c, minPx, text, color) => {
          const lo = Math.max(a, b.minX + view.px(4));
          const hi = Math.min(c, b.maxX - view.px(4));
          if (hi - lo > view.px(minPx)) labels.add((lo + hi) / 2, LANE_Y, text, { color, size: 11, dy: 0, mono: true });
        };
        spanLabel(ev, Math.min(reactEnd, egoRear), 118, `${byAeb ? 'belum mengerem' : 'reaksi'} ${fmt(reactEnd - ev, 1)} m`, '#fcd34d');
        if (r.brakeStart) spanLabel(r.brakeStart.x, egoRear, 140, `pengereman ${fmt(r.ego.x - r.brakeStart.x, 1)} m`, '#fca5a5');
        // setelah berhenti dengan aman, tepi jalan dipakai untuk garis ukur sisa jarak
        if (!r.done || r.outcome.collided) drawRuler(g, view, ev, info.frameRight);

        // titik henti: kendaraan depan (bila mengerem) dan mobilmu (tanpa memperhitungkan benturan)
        const showStopText = !r.done || r.outcome.collided;
        if (info.sc !== 'rintangan') {
          drawStopMark(g, view, info.leadStopX, C.leadStop, { dashed: true, width: 2 });
          if (showStopText) markLabel(info.leadStopX, ROW_Y, info.sc === 'angkot' ? 'titik henti angkot' : 'titik henti mobil depan', { color: C.leadStop, dy: ROW_B, size: 11 });
        }
        const stopColor = info.willCollide ? C.brake : C.ok;
        if (info.ghostStopX < b.maxX - view.px(6)) {
          drawStopMark(g, view, info.ghostStopX, stopColor);
          if (showStopText) {
            const text = r.done ? 'tanpa benturan, mobilmu baru berhenti di sini' : 'titik henti mobilmu';
            labels.add(info.ghostStopX, ROW_Y, text, { color: info.willCollide ? '#fca5a5' : '#86efac', dy: ROW_B, size: 11, align: r.done ? 'right' : 'center', dx: r.done ? 4 : 0 });
          }
        } else {
          drawOffscreenArrow(g, view, LANE_Y, stopColor);
        }
        if (r.done && !r.outcome.collided) {
          const tx = M.targetOf(r).x;
          drawDimension(g, view, r.ego.x, tx, '#86efac', dimY);
          markLabel((r.ego.x + Math.min(tx, b.maxX)) / 2, dimY, `sisa ${fmt(r.outcome.remaining, 1, 'm')}`, { color: '#86efac', size: 11, dy: 0, mono: true });
        }
      }

      // mobil mogok
      if (r.obstacle) {
        const ob = { x: r.obstacle.x + L / 2, y: LANE_Y, heading: 0, length: L, width: M.CAR_WIDTH };
        drawCarBox(g, view, ob, { color: '#6b7a90', alpha: started ? 1 : 0.8, variant: info.place === 'kota' ? 'mpv' : 'sedan' });
        drawHazard(g, view, ob, ctx.reducedMotion || Math.floor(loop.time * 2.4) % 2 === 0);
      }
      // calon penumpang angkot (digambar sebelum angkot, supaya tampak naik ke pintu)
      if (r.ped && r.ped.state !== 'dalam') {
        drawPassenger(g, view, { x: r.ped.x, y: LANE_Y + r.ped.lat, heading: r.ped.heading, state: r.ped.state, alpha: r.ped.alpha }, ctx.reducedMotion ? 0 : loop.time);
      }
      // mobil depan atau angkot
      const lead = {
        x: r.lead.x + r.lead.length / 2,
        y: LANE_Y + r.lead.lat,
        heading: r.lead.yaw,
        length: r.lead.length,
        width: r.lead.width,
        braking: r.lead.decel > 0,
      };
      if (lead.x - lead.length < b.maxX + 2) drawLead(g, lead, r.lead.kind, { braking: lead.braking, doorOpen: r.lead.door > 0.5 });
      // mobilmu
      const braking = r.ego.decel > 0 || (r.done && r.brakeStart);
      drawCarBox(g, view, egoBox(r.ego.x, braking));

      if (r.done && r.outcome.collided) {
        drawImpact(g, view, r.ego.x, LANE_Y, ctx.reducedMotion ? 0 : loop.time);
        labels.add(r.ego.x, -6.6, `benturan ${fmt(kmhOf(r.outcome.impact), 0, 'km/jam')}`, { color: '#fecaca', bg: 'rgba(127, 29, 29, 0.92)', dy: -14, size: 12 });
      }
    }

    function addRunCarLabels(r, started) {
      // calon penumpang: tetap diberi label selama ia di luar angkot
      if (r.ped && r.ped.state !== 'dalam') {
        const text = r.ped.state === 'tunggu' ? 'calon penumpang' : 'penumpang naik';
        markLabel(r.ped.x, LANE_Y + r.ped.lat, text, { color: C.penumpang, dy: -16, size: 11, priority: 1 });
      }
      if (r.done) return; // banner dan tanda di jalan sudah menjelaskan hasilnya
      let egoText = 'mobilmu';
      let egoColor = COLORS.accent;
      if (started && !r.done) {
        if (r.ego.decel > 0) {
          const aebOnly = info.p.aeb && r.aebStage >= 2 && !r.driverBraking;
          egoText = aebOnly ? `AEB ${M.AEB_STAGES[r.aebStage]}` : 'mengerem';
          egoColor = '#fca5a5';
        } else {
          egoText = `reaksi ${fmt(Math.min(r.t, info.p.tr), 1)} / ${fmt(info.p.tr, 1)} detik`;
          egoColor = '#fcd34d';
        }
      }
      labels.add(r.ego.x - L / 2, ROW_Y, egoText, { color: egoColor, dy: ROW_A, size: 11, mono: started && !r.done && r.ego.decel <= 0 });
      let leadText = r.scenario === 'angkot' ? 'angkot' : 'mobil depan';
      if (r.scenario === 'rem' && started) leadText = r.lead.v > 0 ? 'mobil depan mengerem' : 'mobil depan berhenti';
      if (r.scenario === 'angkot' && started) leadText = r.lead.v > 0 ? 'angkot mengerem' : 'angkot berhenti';
      if (r.scenario === 'rintangan') leadText = started ? '' : 'mobil depan pindah lajur';
      const apartPx = (r.lead.x + r.lead.length / 2 - (r.ego.x - L / 2)) * view.camera.scale;
      const leadColor = r.scenario === 'angkot' ? C.angkot : C.lead;
      if (leadText && apartPx > 120) markLabel(r.lead.x + r.lead.length / 2, ROW_Y + r.lead.lat, leadText, { color: leadColor, dy: ROW_A, size: 11 }, leadText);
      if (r.obstacle) {
        // di luar layar: label tepi di baris bawah, supaya tidak terbaca sebagai nama mobil depan
        const ahead = `mobil mogok ${fmt(r.obstacle.x - r.ego.x, 0, 'm')} lagi`;
        markLabel(
          r.obstacle.x + L / 2,
          ROW_Y,
          started ? 'mobil mogok' : 'mobil mogok (belum terlihat)',
          { color: C.obstacle, dy: ROW_A, size: 11 },
          started ? ahead : 'mobil mogok (belum terlihat)',
          { dy: ROW_B },
        );
      }
    }

    // ---------- antarmuka ke shell ----------
    renderResult();
    refreshSettings();

    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (preset) applyPreset(preset);
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      reset() {
        backToFollow();
        const v = kmhToMs(s.kmh);
        Object.assign(follow, { v, gap: v * s.tau, leadV: v });
        for (const k of Object.keys(holds)) holds[k] = 0;
        monitor.reset();
        refreshMeter();
        refreshPanels(0);
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan oleh ctx. ResizeObserver dan kait uji dilepas lewat ctx.onCleanup.
      },
    };
  },
};
