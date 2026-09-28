// Daftar pelajaran. Urutan di sini menjadi urutan di beranda dan navigasi.
export const LESSONS = [
  {
    id: 'level-otomasi',
    title: 'Level Otomasi',
    summary: 'Kenali level SAE 0 sampai 5 dan siapa yang bertanggung jawab mengemudi di tiap level.',
    load: () => import('./level-otomasi.js'),
  },
  {
    id: 'sensor',
    title: 'Sensor Kendaraan',
    summary: 'Coba kamera, LiDAR, radar, dan ultrasonik, lalu lihat pengaruh hujan, kabut, dan malam.',
    load: () => import('./sensor.js'),
  },
  {
    id: 'persepsi',
    title: 'Persepsi dan Fusi Sensor',
    summary: 'Ubah data mentah sensor menjadi objek yang dikenali, dilacak, dan diprediksi geraknya.',
    load: () => import('./persepsi.js'),
  },
  {
    id: 'lokalisasi',
    title: 'Lokalisasi',
    summary: 'Gabungkan GPS, odometri, dan peta agar kendaraan tahu posisinya sampai hitungan sentimeter.',
    load: () => import('./lokalisasi.js'),
  },
  {
    id: 'rute',
    title: 'Perencanaan Rute',
    summary: 'Cari rute tercepat dengan A* dan Dijkstra, lalu tutup jalan dan lihat rute dihitung ulang.',
    load: () => import('./rute.js'),
  },
  {
    id: 'kontrol',
    title: 'Kendali Kemudi dan Kecepatan',
    summary: 'Atur pure pursuit dan PID supaya kendaraan mengikuti jalur dengan mulus.',
    load: () => import('./kontrol.js'),
  },
  {
    id: 'keputusan',
    title: 'Pengambilan Keputusan',
    summary: 'Lihat cara kendaraan memilih tindakan di lampu lalu lintas, zebra cross, dan saat ada mobil mogok.',
    load: () => import('./keputusan.js'),
  },
  {
    id: 'jarak-aman',
    title: 'Jarak Aman dan Rem Darurat',
    summary: 'Hitung jarak henti, atur jarak waktu, dan uji rem darurat otomatis di jalan kering sampai licin.',
    load: () => import('./jarak-aman.js'),
  },
  {
    id: 'shuttle',
    title: 'Misi Shuttle Otonom',
    summary: 'Jalankan shuttle tanpa pengemudi di kawasan kampus, antar penumpang, dan hadapi jalan yang ditutup.',
    load: () => import('./shuttle.js'),
  },
  {
    id: 'kuis',
    title: 'Kuis Akhir',
    summary: 'Uji pemahamanmu tentang semua materi dan lihat pembahasan tiap soal.',
    load: () => import('./kuis.js'),
  },
];

export const findLesson = (id) => LESSONS.find((l) => l.id === id) || null;
