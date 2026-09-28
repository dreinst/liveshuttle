// Panduan sepuluh langkah. Tugas dicek otomatis dari kejadian simulator (event) dan dari keadaan
// yang dibaca berkala (check). Kejadian hanya dihitung selama langkahnya sedang dibuka.
// Lanjut selalu boleh; langkah baru dianggap selesai bila tugasnya selesai.
import { fmt } from './util.js';
import { WEATHER_LABEL } from './weather.js';

const mmss = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const STEPS = [
  {
    id: 'kenalan',
    title: 'Kenalan dengan LiveShuttle',
    body:
      '<p>LiveShuttle adalah shuttle listrik tanpa pengemudi, panjangnya sekitar 6 m dengan 12 kursi. Ia berkeliling lima halte di sekitar Universitas Ma Chung, Malang.</p>' +
      '<p>Jalan, bundaran, dan gedungnya berasal dari OpenStreetMap, jadi nama jalan yang kamu lihat adalah nama aslinya. Peta rute di pojok menunjukkan ke mana shuttle pergi.</p>',
    task: 'Lihat dari kamera Kabin, lalu buka kamera Peta.',
    check: (g) => g.seen.has('kabin') && g.seen.has('peta'),
  },
  {
    id: 'indra',
    layer: 'indra',
    title: 'Indra: sensor shuttle',
    body:
      '<p>Di atap ada LiDAR yang berputar dan mengukur jarak dengan sinar laser ke segala arah. Kamera di depan mengenali warna lampu dan jenis benda. Radar mengukur jarak dan kecepatan, dan tetap bekerja saat kabut.</p>' +
      '<p>Pilih Tampilan sensor Detail untuk melihat area kamera dan radar.</p>',
    live: (app) => {
      const r = app.sensors.ranges();
      return `Jangkauan sekarang: LiDAR ${fmt(r.lidar, 0)} m, kamera ${fmt(r.kamera, 0)} m, radar ${fmt(r.radar, 0)} m.`;
    },
    task: 'Nyalakan Sinar LiDAR (tombol L).',
    check: (g) => g.seen.has('sinar-lidar'),
  },
  {
    id: 'pahami',
    layer: 'pahami',
    title: 'Pahami: apa saja di sekitar',
    body:
      '<p>Titik-titik LiDAR dan gambar kamera diolah menjadi daftar benda: mobil, motor, angkot, dan pejalan kaki. Tiap benda punya jarak dan kecepatan, dan dilacak dari waktu ke waktu supaya gerakannya bisa ditebak.</p>' +
      '<p>Motor dan pejalan kaki paling perlu diawasi karena kecil dan bisa berubah arah dengan cepat.</p>',
    live: (app) => app.sensors.layers().pahami,
    task: 'Tunggu sampai shuttle mendeteksi pejalan kaki di depannya.',
    check: (g) => g.seen.has('deteksi-pejalan'),
  },
  {
    id: 'rencana',
    layer: 'rencana',
    title: 'Rencana: rute di jalan sungguhan',
    body:
      '<p>Shuttle mencari rute ke halte berikutnya dengan A* di jaringan jalan OSM. Di bundaran ia memberi jalan kepada kendaraan yang sudah berputar. Di simpang, jalan kecil memberi jalan kepada jalan utama seperti Jalan Karangampel Timur.</p>' +
      '<p>Pilih alat Tutup jalan, lalu klik jalan yang dilewati garis biru, di peta rute atau di tampilan 3D.</p>',
    task: 'Tutup jalan di rute shuttle dan lihat rutenya diperbarui.',
    check: (g) => g.seen.has('reroute'),
  },
  {
    id: 'gerak',
    layer: 'gerak',
    title: 'Gerak: setir dan kecepatan',
    body:
      '<p>Autopilot mengarahkan setir ke titik di depan pada garis tengah lajur (pure pursuit). Gas dan rem dibatasi perubahannya supaya penumpang tidak tersentak.</p>' +
      '<p>Sekarang giliranmu. Pakai tombol panah atau W, A, S, D, atau tombol kemudi di layar.</p>',
    task: 'Tekan Ambil kemudi (tombol M), lalu kemudikan shuttle beberapa meter.',
    check: (g) => g.seen.has('manual-jalan'),
  },
  {
    id: 'perisai',
    title: 'Perisai keselamatan',
    body:
      '<p>Aturannya: apa pun yang terjadi, tidak ada kendaraan yang bisa menerobos lampu merah atau menabrak pejalan kaki. Perisai memeriksa jalur di depan setiap 1/60 detik, sesudah perintahmu dan sebelum roda bergerak.</p>' +
      '<p>Bila jarak ke garis henti atau pejalan kaki sudah hampir sama dengan jarak henti, perisai mengambil alih rem. Coba saja, dengan gas penuh sekalipun.</p>',
    task: 'Saat mengemudi, arahkan shuttle ke lampu merah atau ke pejalan kaki sampai perisai mengerem.',
    check: (g) => g.seen.has('perisai-manual'),
  },
  {
    id: 'menyeberang',
    title: 'Pejalan kaki menyeberang',
    body:
      '<p>Tombol Pejalan kaki menyeberang (Y) memunculkan orang yang menyeberang di depan shuttle. Ia hanya muncul sejauh jarak yang masih cukup untuk berhenti. Kalau belum aman, ia menunggu dan kamu diberi tahu alasannya.</p>' +
      '<p>Jarak henti = v × waktu reaksi + v² / (2 × perlambatan rem). Perlambatan rem bergantung pada gesekan jalan, jadi saat hujan jarak henti lebih panjang.</p>',
    live: (app) => {
      const c = app.ego.lastCrossing;
      if (!c) return 'Belum ada pejalan kaki uji.';
      return `Terakhir: shuttle melaju ${fmt(c.v * 3.6, 0)} km/jam, gesekan jalan ${fmt(c.mu, 1)}, jarak henti ${fmt(c.need, 1)} m. Pejalan kaki muncul ${fmt(c.dist, 0)} m di depan.`;
    },
    task: 'Tekan Pejalan kaki menyeberang, lalu lihat shuttle berhenti untuknya.',
    check: (g) => {
      const app = g.app;
      const v = app.ego.veh;
      return g.seen.has('menyeberang') && Math.abs(app.ego.vs) < 0.3 && app.peds.peds.some((p) => p.test && Math.hypot(p.x - v.x, p.z - v.z) < 35);
    },
  },
  {
    id: 'cuaca',
    title: 'Cuaca berganti tiap 5 menit',
    body:
      '<p>Cuaca berganti sendiri tiap 5 menit waktu simulasi: Cerah, Hujan, Kabut, Malam, lalu Cerah lagi. Saat dijeda hitungannya berhenti, saat dipercepat pergantiannya datang lebih cepat.</p>' +
      '<p>Hujan membuat jalan licin, jadi jarak henti lebih panjang. Kabut memperpendek jangkauan kamera dan LiDAR. Malam membuat kamera kurang peka. Shuttle menurunkan kecepatannya sendiri dan menjelaskan alasannya.</p>',
    live: (app) => `${WEATHER_LABEL[app.weather.name]}, berganti dalam ${mmss(app.weather.countdown)}. ${app.ego.weatherNote()}`,
  },
  {
    id: 'halte',
    title: 'Halte dan penumpang',
    body:
      '<p>Shuttle berhenti tepat di depan halte dengan pintu di sisi kiri, sisi trotoar. Penumpang yang sampai tujuan turun dulu, lalu yang menunggu naik. Tiap penumpang punya halte tujuan.</p>' +
      '<p>Kamu bisa menambah penumpang dengan Panggil penumpang di panel Kendali.</p>',
    task: 'Tunggu sampai ada penumpang yang naik di halte.',
    check: (g) => g.seen.has('naik'),
  },
  {
    id: 'selesai',
    title: 'Siap menjelajah',
    body:
      '<p>Kamu sudah melihat seluruh rantai: indra, pahami, rencana, dan gerak, dengan perisai keselamatan di ujungnya.</p>' +
      '<p>Di mode Jelajah kamu bebas memasang kendaraan parkir, galian jalan, menutup jalan, memanggil penumpang, dan mengatur kepadatan lalu lintas.</p>',
  },
];

export class Guide {
  constructor(app) {
    this.app = app;
    this.i = 0;
    this.done = new Set();
    this.seen = new Set();
  }

  go(i) {
    this.i = Math.max(0, Math.min(STEPS.length - 1, i));
    this.seen.clear();
    this.render();
  }

  next() {
    if (this.i === STEPS.length - 1) this.app.setMode('jelajah');
    else this.go(this.i + 1);
  }

  prev() {
    this.go(this.i - 1);
  }

  /** Kejadian dari simulator (camera, sinar-lidar, deteksi-pejalan, reroute, manual-jalan, perisai-manual, menyeberang, naik, halte). */
  event(type, value) {
    this.seen.add(type === 'camera' ? value : type);
    this.check();
  }

  check() {
    const st = STEPS[this.i];
    if (this.app.mode !== 'panduan' || !st.check || this.done.has(st.id) || !st.check(this)) return;
    this.done.add(st.id);
    this.app.toast('Tugas selesai. Lanjut kapan saja.', 'ok');
    this.render();
  }

  render() {
    this.app.hud.renderGuide(STEPS[this.i], this.i, STEPS.length, this.done.has(STEPS[this.i].id));
  }

  summary() {
    return { step: this.i, total: STEPS.length, id: STEPS[this.i].id, done: [...this.done] };
  }
}
