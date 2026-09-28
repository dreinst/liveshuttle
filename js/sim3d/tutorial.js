// Mode Tutorial: kartu langkah demi langkah. Tugas selesai otomatis dari keadaan simulasi.
// Lanjut selalu boleh ditekan. Langkah yang tugasnya selesai diberi tanda centang.
import { el, kmh } from './util.js';
import { CAMERA_LABEL, CAMERA_MODES } from './cameras.js';
import { WEATHER_LABEL } from './weather.js';

const pipeline = `<p class="s3d-pipe" aria-label="Alur kerja mobil otonom"><span data-k="sensor">Sensor</span><span aria-hidden="true">→</span><span data-k="persepsi">Persepsi</span><span aria-hidden="true">→</span><span data-k="rencana">Perencanaan</span><span aria-hidden="true">→</span><span data-k="kontrol">Kontrol</span></p>`;

export const STEPS = [
  {
    id: 'kenalan',
    title: 'Kenalan dengan mobil otonom',
    body: `${pipeline}<p>Mobil hijau toska dengan sensor berputar di atapnya adalah mobil otonom. Ia bekerja dalam empat tahap yang terus berulang, berkali-kali setiap detik.</p><p>Sensor mengumpulkan data. Persepsi mengenali benda di sekitar. Perencanaan memilih tindakan dan jalur. Kontrol menggerakkan setir, gas, dan rem.</p>`,
    task: 'Coba dua sudut kamera lain, misalnya Kejar dan Atas (tombol 1 sampai 4).',
    camera: ['orbit', { dist: 48 }],
    highlight: ['kamera'],
    actions: 'camera',
    check: (app, st) => st.cams.size >= 2,
  },
  {
    id: 'sensing',
    title: 'Sensor: LiDAR dan kamera',
    body: `<p>LiDAR di atap memancarkan sinar laser dan mengukur pantulannya. Titik biru muda adalah titik pantulan itu, diperbarui 10 kali per detik. Beberapa garis tipis menunjukkan arah sinarnya. Lingkaran titik-titik di aspal dekat mobil berasal dari sinar yang mengenai tanah.</p><p>Cincin biru muda yang besar menandai batas jangkauan deteksi, yaitu 60 m. Area ungu adalah bidang pandang kamera depan, sekitar 90 derajat. Kamera bisa membaca warna lampu lalu lintas, sedangkan LiDAR mengukur jarak dengan tepat.</p>`,
    task: 'Matikan tampilan LiDAR (tombol L), lalu nyalakan lagi.',
    // Dari atas setinggi 160 m seluruh cincin 60 m muat di area kanvas di antara panel.
    camera: ['atas', { height: 160 }],
    highlight: ['persepsi'],
    actions: 'lidar',
    enter: (app) => app.setLayer('lidar', true),
    check: (app, st) => st.lidarOff && app.sensing.showLidar,
  },
  {
    id: 'persepsi',
    title: 'Persepsi: apa yang dilihat mobil',
    body: `<p>Titik LiDAR dan gambar kamera diolah menjadi daftar objek. Tiap objek diberi kotak, kelas, dan jarak, misalnya Mobil 23 m.</p><p>Panel <em>Apa yang dilihat mobil</em> menampilkan objek terdekat dengan kecepatan relatifnya, objek pembatas yang sedang membatasi kecepatan, dan warna lampu lalu lintas berikutnya.</p>`,
    task: 'Amati panel sampai mobil mendeteksi pejalan kaki atau membaca warna lampu lalu lintas berikutnya.',
    camera: ['kejar'],
    highlight: ['persepsi'],
    enter: (app) => app.setLayer('boxes', true),
    // Beri waktu membaca dulu: tugas baru dinilai beberapa detik setelah langkah dibuka.
    check: (app, st) => app.simTime - st.enterT > 4 && (app.perception.list.some((t) => t.cls === 'pejalan' && t.known) || (app.perception.light && app.perception.light.color !== 'unknown')),
  },
  {
    id: 'rencana',
    title: 'Perencanaan: jalur dan lajur',
    body: `<p>Pita toska di jalan adalah jalur yang direncanakan untuk beberapa detik ke depan. Garis redup adalah sisa rute menuju tujuan, dihitung dengan algoritma A*.</p><p>Di Indonesia kendaraan berjalan di lajur kiri. Lajur kanan dipakai untuk menyalip atau bersiap belok kanan. Mobil hanya pindah lajur bila lajur sebelahnya aman.</p>`,
    task: 'Taruh mobil mogok di depan, lalu lihat mobil menyalip lewat lajur kanan.',
    camera: ['atas', { height: 80 }],
    highlight: ['rencana', 'uji'],
    actions: 'mogok',
    enter: (app) => app.setLayer('path', true),
    check: (app, st) => app.counters.overtakes > st.overtakes0,
  },
  {
    id: 'kontrol',
    title: 'Kontrol: gas, rem, dan kemudi',
    body: `<p>Kontrol mengubah rencana menjadi perintah. Kecepatan target awalnya 50 km/jam, sesuai batas umum di jalan perkotaan.</p><p>Batang gas, rem, dan kemudi menunjukkan perintah saat ini. Kemudi dihitung dengan <em>pure pursuit</em>: mobil diarahkan ke satu titik di jalur beberapa meter di depan, makin cepat makin jauh titiknya.</p>`,
    task: 'Ubah kecepatan target, lalu perhatikan batang gas dan rem.',
    camera: ['kejar'],
    highlight: ['kontrol'],
    actions: 'speed',
    check: (app, st) => st.speedChanged,
  },
  {
    id: 'keselamatan',
    title: 'Keselamatan: rem darurat',
    body: `<p>TTC (<em>time to collision</em>) adalah perkiraan waktu sampai tabrakan bila tidak ada yang berubah. Kalau TTC terlalu kecil, sistem rem darurat otomatis (AEB) mengerem penuh.</p><p>Tunggu mobil melaju sekitar 40 km/jam atau lebih, lalu buat pejalan kaki menyeberang mendadak. Perhatikan TTC dan jumlah rem darurat di indikator keselamatan.</p>`,
    task: 'Tekan J atau tombol Pejalan kaki menyeberang, lalu lihat rem darurat bekerja.',
    camera: ['kejar'],
    highlight: ['safety', 'uji'],
    actions: 'jay',
    check: (app, st) => app.counters.aebAuto > st.aeb0,
  },
  {
    id: 'cuaca',
    title: 'Cuaca: sensor ikut terpengaruh',
    body: `<p>Butiran hujan dan kabut menghamburkan sinar laser sehingga jangkauan deteksi turun ke sekitar 48 m saat hujan dan sekitar 27 m saat kabut. Pada malam hari kamera kesulitan, tetapi LiDAR tetap bekerja karena memancarkan cahaya sendiri.</p><p>Mobil otonom lalu menurunkan kecepatan supaya tetap bisa berhenti di dalam jarak yang terlihat sensor. Jalan basah juga membuat rem kurang pakem.</p>`,
    task: 'Ganti cuaca ke Hujan, Kabut, atau Malam, lalu perhatikan jangkauan sensor dan kecepatan mobil.',
    camera: ['orbit', { dist: 40, back: 0.8 }],
    highlight: ['cuaca'],
    actions: 'weather',
    check: (app, st) => st.weatherChanged && app.weather.name !== 'cerah',
  },
  {
    id: 'kota',
    title: 'Kota pintar: lampu adaptif',
    body: `<p>Lampu di kota ini terhubung dengan detektor antrean. Pada mode Adaptif, lampu hanya memberi hijau pada arah yang ada antreannya, dengan batas hijau minimum dan maksimum. Pada mode Waktu tetap, setiap arah mendapat giliran yang sama walaupun jalannya kosong.</p><p>Garis berwarna di aspal menunjukkan panjang antrean. Bandingkan rata-rata waktu tunggu di panel Kota pintar setelah beberapa menit.</p>`,
    task: 'Ganti mode lampu ke Waktu tetap atau sebaliknya.',
    camera: ['atas', { height: 150 }],
    highlight: ['kota'],
    actions: 'signal',
    enter: (app) => {
      app.setLayer('queues', true);
      // Dari ketinggian 150 m kabut menutupi kota, jadi cuaca dikembalikan cerah untuk langkah ini.
      if (app.weather.name === 'kabut') {
        app.setWeather('cerah');
        app.toast('Cuaca dikembalikan cerah supaya seluruh kota terlihat dari atas.');
      }
    },
    check: (app, st) => st.signalToggled,
  },
  {
    id: 'selesai',
    title: 'Selesai, saatnya bereksperimen',
    body: `<p>Kamu sudah melihat seluruh alur kerja mobil otonom, dari sensor sampai kontrol.</p><p>Di Mode Bebas semua panel dan alat tersedia. Coba taruh beberapa rintangan dengan mengklik jalan, lalu naikkan kepadatan lalu lintas dan lihat kapan mobil memilih menunggu celah. Kamu juga bisa mematikan autopilot dan mengemudi sendiri.</p>`,
    task: null,
    camera: ['orbit', { dist: 60 }],
    highlight: ['bebas'],
  },
];

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.i = 0;
    this.done = STEPS.map(() => false);
    this.hud = app.hud;
    this.st = this.freshState();
    this.acts = [];
    // satu listener per wadah (delegasi), jadi render ulang tidak menambah listener baru
    app.disposer.on(this.hud.tut.actions, 'click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      const a = this.acts[Number(b.dataset.act)];
      if (a) a.fn();
      this.refreshActions();
    });
    app.disposer.on(this.hud.tut.dots, 'click', (ev) => {
      const b = ev.target.closest('button[data-step]');
      if (b) this.go(Number(b.dataset.step), { focus: true });
    });
  }

  freshState() {
    const { app } = this;
    return {
      cams: new Set(),
      lidarOff: false,
      overtakes0: app.counters.overtakes,
      aeb0: app.counters.aebAuto,
      speedChanged: false,
      weatherChanged: false,
      signalToggled: false,
      enterT: app.simTime,
    };
  }

  get step() {
    return STEPS[this.i];
  }

  go(i, opts = {}) {
    const { app } = this;
    this.i = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = this.step;
    this.st = this.freshState();
    if (app.mode === 'tutorial') {
      if (s.camera) app.setCamera(s.camera[0], { ...(s.camera[1] || {}), reset: true, fromTutorial: true });
      if (s.enter) s.enter(app);
      this.hud.highlight(s.highlight);
    }
    this.render();
    // Langkah baru selalu mulai dari atas (judul dan paragraf pertama terlihat).
    this.hud.sheetBody.scrollTop = 0;
    this.hud.left.scrollTop = 0;
    if (opts.focus) this.hud.tut.title.focus({ preventScroll: true });
  }

  next() {
    if (this.i === STEPS.length - 1) {
      this.app.setMode('bebas');
      return;
    }
    this.go(this.i + 1, { focus: true });
  }

  prev() {
    this.go(this.i - 1, { focus: true });
  }

  /** Kejadian dari simulator yang dipakai tugas berbasis kejadian. */
  event(name, value) {
    const st = this.st;
    if (name === 'camera' && value) st.cams.add(value);
    if (name === 'lidar' && value === false) st.lidarOff = true;
    if (name === 'speed') st.speedChanged = true;
    if (name === 'weather') st.weatherChanged = true;
    if (name === 'signal') st.signalToggled = true;
    this.check();
    this.refreshActions();
  }

  check() {
    const s = this.step;
    if (!s.task || this.done[this.i] || this.app.mode !== 'tutorial') return;
    if (s.check && s.check(this.app, this.st)) {
      this.done[this.i] = true;
      this.app.toast('Tugas selesai. Tekan Lanjut untuk langkah berikutnya.', 'ok');
      this.render();
    }
  }

  actionButtons(kind) {
    const { app } = this;
    this.acts = [];
    const mk = (text, fn, pressed) => {
      const b = el('button', { type: 'button', class: 's3d-btn s3d-chipbtn', dataset: { act: String(this.acts.length) } }, text);
      this.acts.push({ fn, pressed });
      return b;
    };
    switch (kind) {
      case 'camera':
        return CAMERA_MODES.map((m, i) => mk(`${CAMERA_LABEL[m]} (${i + 1})`, () => app.setCamera(m), () => app.cameras.mode === m));
      case 'lidar':
        return [mk('LiDAR nyala atau mati (L)', () => app.toggleLidar(), () => app.sensing.showLidar)];
      case 'mogok':
        return [mk('Taruh mobil mogok', () => app.placeObstacle('mogok'))];
      case 'speed':
        return [30, 50, 70].map((v) => mk(`${v} km/jam`, () => app.setTargetSpeed(v), () => Math.round(kmh(app.targetSpeed)) === v));
      case 'jay':
        return [mk('Pejalan kaki menyeberang (J)', () => app.jaywalker())];
      case 'weather':
        return Object.entries(WEATHER_LABEL).map(([k, v]) => mk(v, () => app.setWeather(k), () => app.weather.name === k));
      case 'signal':
        return [
          mk('Adaptif', () => app.setSignalMode('adaptif'), () => app.signals.mode === 'adaptif'),
          mk('Waktu tetap', () => app.setSignalMode('tetap'), () => app.signals.mode === 'tetap'),
        ];
      case 'bebas':
        return [mk('Buka Mode Bebas', () => app.setMode('bebas'))];
      default:
        return [];
    }
  }

  refreshActions() {
    for (const b of this.hud.tut.actions.children) {
      const a = this.acts[Number(b.dataset.act)];
      if (a && typeof a.pressed === 'function') b.setAttribute('aria-pressed', String(!!a.pressed()));
    }
  }

  render() {
    const t = this.hud.tut;
    const s = this.step;
    const n = STEPS.length;
    t.step.textContent = `Langkah ${this.i + 1} dari ${n}`;
    t.pill.textContent = `Tutorial ${this.i + 1}/${n}: ${s.title}`;
    t.title.textContent = s.title;
    t.body.innerHTML = s.body;
    t.actions.replaceChildren(...this.actionButtons(s.actions));
    t.actions.hidden = !t.actions.children.length;
    this.refreshActions();
    if (s.task) {
      t.task.hidden = false;
      t.taskText.textContent = s.task;
      const d = this.done[this.i];
      t.task.dataset.done = String(d);
      t.taskState.textContent = d ? 'Selesai' : 'Belum selesai';
    } else t.task.hidden = true;
    t.prev.disabled = this.i === 0;
    t.next.textContent = this.i === n - 1 ? 'Buka Mode Bebas' : 'Lanjut';
    const dots = [];
    STEPS.forEach((st, k) => {
      const li = el('li', { class: 's3d-dotstep', dataset: { state: k === this.i ? 'now' : this.done[k] ? 'done' : st.task ? 'todo' : 'info' } });
      const b = el('button', { type: 'button', dataset: { step: String(k) }, 'aria-label': `Langkah ${k + 1}: ${st.title}${this.done[k] ? ', selesai' : ''}`, 'aria-current': k === this.i ? 'step' : null }, this.done[k] ? '✓' : String(k + 1));
      li.append(b);
      dots.push(li);
    });
    t.dots.replaceChildren(...dots);
  }

  summary() {
    return { step: this.i + 1, total: STEPS.length, id: this.step.id, title: this.step.title, done: this.done.slice(), taskIds: STEPS.map((s) => s.id) };
  }
}
