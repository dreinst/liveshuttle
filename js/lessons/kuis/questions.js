// Bank soal Kuis Akhir.
//
// Setiap soal punya empat pilihan. Pilihan pertama (answer: 0) adalah jawaban yang benar di berkas
// ini saja: urutan soal dan urutan pilihan diacak setiap kali kuis dimulai (lihat ./model.js).
// Isi soal dan penjelasannya mengikuti teks pelajaran supaya bisa dijawab dari materi yang ada.
// `explain` berisi HTML tepercaya (boleh <strong>, <em>, <sub>), `q` dan `options` teks biasa.

import { findLesson } from '../index.js';

const lessonTopic = (id, icon) => ({ id, title: findLesson(id)?.title || id, icon, href: `#/pelajaran/${id}`, linkText: 'Pelajari lagi' });

// Urutan di sini menjadi urutan tabel hasil per topik.
export const TOPICS = {
  'level-otomasi': lessonTopic('level-otomasi', 'hand'),
  sensor: lessonTopic('sensor', 'sensor'),
  persepsi: lessonTopic('persepsi', 'eye'),
  lokalisasi: lessonTopic('lokalisasi', 'target'),
  rute: lessonTopic('rute', 'route'),
  kontrol: lessonTopic('kontrol', 'steering'),
  keputusan: lessonTopic('keputusan', 'brain'),
  'jarak-aman': lessonTopic('jarak-aman', 'gauge'),
  shuttle: lessonTopic('shuttle', 'car'),
  'shuttle-3d': { id: 'shuttle-3d', title: 'Shuttle 3D Ma Chung', icon: 'cube', href: '#/shuttle-3d/panduan', linkText: 'Buka lagi' },
};

export const QUESTIONS = [
  {
    id: 'l3-ambil-alih',
    topic: 'level-otomasi',
    q: 'Mobil level 3 sedang mengemudi sendiri di jalan tol. Di depan ada zona konstruksi yang berada di luar ODD-nya. Apa yang seharusnya terjadi?',
    options: [
      'Sistem memberi permintaan ambil alih, dan orang di kursi pengemudi harus siap mengemudi.',
      'Sistem terus mengemudi, karena level 3 bisa bekerja di semua kondisi jalan.',
      'Orang di kursi pengemudi tidak perlu berbuat apa pun, karena level 3 tidak pernah meminta bantuan.',
      'Sistem langsung mati tanpa peringatan, lalu kemudi diserahkan saat itu juga.',
    ],
    answer: 0,
    explain:
      'Di level 3 sistem mengemudi dan memantau jalan, tetapi hanya di dalam ODD. Sebelum keluar dari ODD, sistem memberi <strong>permintaan ambil alih</strong> dengan hitungan mundur, dan orang di kursi pengemudi harus siap mengambil alih. Sistem yang menjadi cadangannya sendiri baru ada di level 4.',
  },
  {
    id: 'l4-risiko-minimal',
    topic: 'level-otomasi',
    q: 'Pada level berapa sistem mengemudi sendiri dan, bila ada masalah, membawa mobil ke kondisi risiko minimal tanpa bantuan manusia, tetapi hanya di dalam ODD?',
    options: ['Level 4', 'Level 2', 'Level 3', 'Level 5'],
    answer: 0,
    explain:
      'Level 4 menjadi cadangannya sendiri di dalam ODD, misalnya dengan menepi lalu berhenti dengan aman. Level 3 masih butuh orang yang siap mengambil alih. Level 5 tidak dibatasi ODD dan belum ada di pasaran.',
  },
  {
    id: 'radar-kabut',
    topic: 'sensor',
    q: 'Kabut tebal turun. Sensor mana yang hampir tidak terganggu dan tetap bisa melihat jauh?',
    options: ['Radar', 'Kamera', 'LiDAR', 'Ultrasonik'],
    answer: 0,
    explain:
      'Gelombang radio radar hampir tidak terganggu oleh hujan, kabut, atau gelap. Cahaya yang ditangkap kamera dan laser LiDAR tersebar oleh titik-titik air. Ultrasonik memang hanya menjangkau sekitar 5 m.',
  },
  {
    id: 'hantu-radar',
    topic: 'persepsi',
    q: 'Radar melaporkan ada objek di depan mobil. Daerah itu juga diawasi kamera dan LiDAR, tetapi keduanya tidak melihat apa pun. Apa yang dilakukan fusi sensor?',
    options: [
      'Menolak deteksi itu sebagai pantulan palsu (hantu).',
      'Memercayai radar dan langsung mengerem darurat.',
      'Menaikkan keyakinan objek itu, karena radar paling tahan cuaca.',
      'Menandainya sebagai pejalan kaki, karena objeknya kecil.',
    ],
    answer: 0,
    explain:
      'Hanya radar yang melapor di daerah yang juga diawasi kamera dan LiDAR, jadi deteksi itu ditolak sebagai <strong>hantu</strong> (ghost). Pantulan seperti ini sering berasal dari benda logam datar, misalnya tutup gorong-gorong di aspal.',
  },
  {
    id: 'ambang-tinggi',
    topic: 'persepsi',
    q: 'Ambang keyakinan persepsi dinaikkan terlalu tinggi. Apa akibatnya?',
    options: [
      'Objek nyata ikut terbuang (negatif palsu), terutama pejalan kaki dan pesepeda.',
      'Benda yang bukan objek ikut dilaporkan sebagai objek (positif palsu).',
      'Jangkauan kamera dan LiDAR bertambah, sehingga objek terlihat lebih awal.',
      'Posisi setiap objek menjadi lebih tepat, karena derau sensor berkurang.',
    ],
    answer: 0,
    explain:
      'Ambang yang tinggi membuang objek yang keyakinannya rendah, termasuk objek nyata. Kesalahan ini disebut <strong>negatif palsu</strong>, dan akibatnya lebih berbahaya daripada positif palsu. Pejalan kaki dan pesepeda paling cepat hilang karena tubuhnya kecil. Positif palsu justru muncul saat ambang terlalu rendah.',
  },
  {
    id: 'gps-multipath',
    topic: 'lokalisasi',
    q: 'Mobil melaju di antara gedung-gedung tinggi, lalu posisi GPS-nya melompat belasan meter. Apa penyebab utamanya?',
    options: [
      'Sinyal satelit memantul di dinding gedung sebelum sampai ke penerima (multipath).',
      'Galat kecil laju roda dan giroskop terus menumpuk dari waktu ke waktu (drift).',
      'Udara lembap di antara gedung menghamburkan sinyal satelit sebelum sampai.',
      'Peta HD belum memuat letak gedung tinggi, sehingga posisi GPS ikut bergeser.',
    ],
    answer: 0,
    explain:
      'Di antara gedung tinggi hanya sedikit satelit yang terlihat, dan sebagian sinyal baru sampai setelah memantul. Jalannya lebih panjang, sehingga jarak ke satelit terukur terlalu jauh dan posisi GPS melompat. Gejala ini disebut <strong>multipath</strong>. Drift adalah masalah odometri, dan tumbuhnya pelan-pelan.',
  },
  {
    id: 'kalman',
    topic: 'lokalisasi',
    q: 'GPS tidak drift tetapi melompat-lompat. Odometri halus tetapi drift. Bagaimana filter Kalman menggabungkan keduanya?',
    options: [
      'Tebakan digeser memakai odometri, lalu ditarik ke arah GPS sesuai ketidakpastian masing-masing.',
      'Posisi GPS selalu dipakai apa adanya, dan odometri dibuang selama sinyal GPS masih ada.',
      'Posisi dari GPS dan odometri dirata-rata dengan bobot tetap, masing-masing setengah.',
      'Hanya odometri yang dipakai karena paling halus, dan GPS dipakai saat mobil berhenti saja.',
    ],
    answer: 0,
    explain:
      'Filter Kalman bekerja dalam dua langkah yang terus berulang. <strong>Prediksi</strong> menggeser tebakan memakai odometri, sehingga ketidakpastiannya membesar. <strong>Koreksi</strong> menarik tebakan ke arah posisi GPS, dan kuatnya tarikan bergantung pada perbandingan ketidakpastian keduanya. Posisi GPS yang terlalu jauh dari prediksi ditolak.',
  },
  {
    id: 'astar-dijkstra',
    topic: 'rute',
    q: 'Apa perbedaan utama A* dibanding Dijkstra dalam mencari rute?',
    options: [
      'A* menambahkan heuristik (perkiraan sisa biaya ke tujuan), jadi biasanya memeriksa lebih sedikit node.',
      'A* selalu menemukan rute yang lebih murah daripada Dijkstra, walaupun memeriksa lebih banyak node.',
      'Dijkstra memakai heuristik ke arah tujuan, sedangkan A* hanya memakai biaya dari titik start.',
      'A* tidak bisa menghitung ulang rute setelah ada jalan yang ditutup, sedangkan Dijkstra bisa.',
    ],
    answer: 0,
    explain:
      'A* memilih node berikutnya dengan nilai f(n) = g(n) + h(n) terkecil. Heuristik h menarik pencarian ke arah tujuan. Selama h tidak pernah melebihi biaya sebenarnya, rute A* sama optimalnya dengan rute Dijkstra, tetapi node yang diperiksa biasanya jauh lebih sedikit.',
  },
  {
    id: 'lookahead-pendek',
    topic: 'kontrol',
    q: 'Pada pengendali pure pursuit, lookahead (Ld) dibuat sangat pendek, misalnya 3 m, saat mobil melaju 40 km/jam. Apa yang terjadi?',
    options: [
      'Mobil berayun ke kiri dan kanan, karena setir selalu sedikit terlambat.',
      'Mobil memotong tikungan ke sisi dalam, karena berbelok terlalu awal.',
      'Mobil berhenti, karena titik tujuan sudah terlalu dekat dengan mobil.',
      'Kecepatan mobil melewati kecepatan target (overshoot), lalu turun lagi.',
    ],
    answer: 0,
    explain:
      'Dengan Ld pendek, simpangan kecil dibalas dengan belokan tajam. Setir selalu sedikit terlambat, jadi mobil kebablasan ke sisi lain dan ayunannya makin besar. Ld yang terlalu panjang justru membuat mobil <strong>memotong tikungan</strong>.',
  },
  {
    id: 'pid-ki',
    topic: 'kontrol',
    q: 'Pengendali PID mengatur kecepatan mobil. Nilai Ki dibuat terlalu besar. Apa akibat yang paling mungkin?',
    options: [
      'Kecepatan melewati target (overshoot), karena suku integral sudah menumpuk.',
      'Kecepatan tertahan sedikit di bawah target dan tidak pernah sampai.',
      'Mobil berayun ke kiri dan kanan jalur.',
      'Perintah gas dan rem bergetar, karena derau sensor kecepatan ikut diperkuat.',
    ],
    answer: 0,
    explain:
      'Ki menjumlahkan selisih kecepatan dari waktu ke waktu. Selama mobil belum sampai target, suku I terus menumpuk, dan saat target tercapai tumpukan itu masih mendorong gas. Kecepatan yang tertahan di bawah target adalah gejala pengendali yang hanya memakai Kp. Getaran akibat derau adalah gejala Kd yang terlalu besar.',
  },
  {
    id: 'menyalip-kanan',
    topic: 'keputusan',
    q: 'Di jalan dua arah di Indonesia, mobil otonom ingin melewati mobil mogok yang menutup lajurnya. Menurut UU Nomor 22 Tahun 2009 Pasal 109 ayat (1), bagaimana cara yang benar?',
    options: [
      'Menyalip lewat lajur sebelah kanan, setelah celah dari arah berlawanan cukup.',
      'Menyalip lewat bahu jalan sebelah kiri, supaya tidak mengganggu arus lawan.',
      'Menyalip lewat lajur sebelah kanan secepatnya, tanpa perlu menunggu celah.',
      'Menunggu di belakang sampai mobil mogok diderek, karena menyalip dilarang.',
    ],
    answer: 0,
    explain:
      'Pasal 109 ayat (1) mengatur bahwa kendaraan yang akan melewati kendaraan lain memakai lajur sebelah kanan, dengan jarak pandang bebas dan ruang yang cukup. Di jalan dua arah, lajur kanan dipakai kendaraan dari arah berlawanan. Karena itu mobil menunggu sampai waktu tiba mobil lawan lebih besar dari waktu menyalip ditambah cadangan.',
  },
  {
    id: 'lampu-kuning',
    topic: 'keputusan',
    q: 'Lampu berubah kuning saat mobil otonom mendekati persimpangan. Dengan aturan di pelajaran Pengambilan Keputusan, kapan mobil memilih berhenti?',
    options: [
      'Bila jarak ke garis henti lebih besar dari jarak henti nyamannya, v² / (2 × 3).',
      'Bila jarak ke garis henti lebih kecil dari jarak henti nyamannya, v² / (2 × 3).',
      'Selalu berhenti, berapa pun jarak dan kecepatannya.',
      'Tidak pernah berhenti, karena lampu kuning berarti masih boleh lewat.',
    ],
    answer: 0,
    explain:
      'Mobil membandingkan jarak ke garis henti <em>d</em> dengan jarak henti nyaman pada perlambatan 3 m/s². Bila <em>d</em> lebih besar, mobil masih sempat berhenti dengan nyaman, jadi ia berhenti. Bila sudah terlalu dekat, mengerem mendadak justru berbahaya, jadi mobil terus melaju. Keputusan diambil sekali, lalu dipegang.',
  },
  {
    id: 'jarak-pengereman',
    topic: 'jarak-aman',
    q: 'Kecepatan mobil naik menjadi dua kali lipat, sedangkan jalan dan remnya sama. Jarak pengeremannya (tanpa jarak reaksi) menjadi berapa kali lipat?',
    options: ['Empat kali lipat', 'Dua kali lipat', 'Tetap sama', 'Setengahnya'],
    answer: 0,
    explain:
      'Jarak pengereman = v² / (2 × μ × g). Karena kecepatan v dikuadratkan, kecepatan dua kali lipat membuat jarak pengereman empat kali lipat. Jarak reaksi v × t<sub>r</sub> hanya naik dua kali lipat.',
  },
  {
    id: 'shuttle-ditutup',
    topic: 'shuttle',
    q: 'Shuttle otonom sedang mengantar penumpang di kawasan kampus. Jalan di rutenya tiba-tiba ditutup, padahal masih ada jalan lain menuju halte tujuan. Apa yang seharusnya dilakukan shuttle?',
    options: [
      'Menghitung ulang rute dari posisinya sekarang, tanpa ruas yang ditutup.',
      'Tetap lewat jalan itu, karena rutenya sudah dihitung sebelum berangkat.',
      'Berhenti di tempat sampai petugas membuka jalan itu kembali.',
      'Kembali dulu ke halte awal, lalu mencari rute baru dari halte itu.',
    ],
    answer: 0,
    explain:
      'Ruas yang ditutup dihapus dari graf jalan, lalu shuttle menghitung ulang rute dengan A* mulai dari ruas yang sedang dilaluinya. Proses ini disebut <strong>perencanaan ulang</strong> (replanning). Kembali ke halte awal hanya membuang waktu penumpang.',
  },
  {
    id: 'ttc',
    topic: 'jarak-aman',
    q: 'Mobil melaju 20 m/s, 30 m di belakang mobil lain yang melaju searah 14 m/s. Bila tidak ada yang berubah, berapa TTC-nya?',
    options: ['5 detik', '1,5 detik', '2,1 detik', '0,2 detik'],
    answer: 0,
    explain:
      'TTC (time to collision) adalah jarak dibagi kecepatan mendekat. Kecepatan mendekatnya 20 − 14 = 6 m/s, jadi TTC = 30 / 6 = 5 detik. Di pelajaran Jarak Aman, AEB baru memberi peringatan saat TTC di bawah 2,5 detik.',
  },
  {
    id: 'lapisan-otonomi',
    topic: 'shuttle-3d',
    q: 'Di bagian bawah layar Shuttle 3D Ma Chung ada empat lapisan otonomi yang bekerja berulang-ulang. Mana urutan yang benar?',
    options: [
      'Indra → Pahami → Rencana → Gerak',
      'Pahami → Indra → Gerak → Rencana',
      'Indra → Rencana → Pahami → Gerak',
      'Rencana → Indra → Pahami → Gerak',
    ],
    answer: 0,
    explain:
      'Indra (sensor) mengumpulkan titik LiDAR, gambar kamera, dan pantulan radar. Pahami (persepsi) mengubahnya menjadi daftar benda dengan jarak dan kecepatan. Rencana memilih rute dan tindakan. Gerak (kendali) mengatur setir, gas, dan rem. Urutan ini sama dengan Sensor → Persepsi → Perencanaan → Kontrol di pelajaran.',
  },
  {
    id: 'peta-hd',
    topic: 'shuttle-3d',
    q: 'Jalan di Shuttle 3D Ma Chung berasal dari OpenStreetMap. Mengapa kendaraan tanpa pengemudi sungguhan tetap butuh peta HD?',
    options: [
      'Peta HD mencatat setiap lajur, garis henti, dan rambu sampai hitungan sentimeter, sedangkan jumlah dan lebar lajur di OSM sering hanya perkiraan.',
      'OpenStreetMap tidak memuat nama jalan, jadi rute ke halte tidak bisa dicari.',
      'Dengan peta HD, kendaraan tidak lagi butuh LiDAR, kamera, dan radar.',
      'OpenStreetMap hanya tersedia untuk kota di luar Indonesia.',
    ],
    answer: 0,
    explain:
      'OSM adalah peta komunitas. Nama jalan, bundaran, dan gedungnya asli, tetapi jumlah lajur, lebar lajur, dan bentuk persimpangan di simulator ini kami perkirakan (lihat panel Tentang peta). Peta HD merekam lajur dengan ketelitian sentimeter, dan LiDAR mencocokkan diri dengannya untuk lokalisasi. Sensor tetap wajib, karena peta tidak tahu siapa yang sedang ada di jalan.',
  },
  {
    id: 'perisai',
    topic: 'shuttle-3d',
    q: 'Kamu mengambil kemudi shuttle dan menekan gas penuh ke arah lampu merah. Apa yang dilakukan perisai keselamatan?',
    options: [
      'Mengerem sendiri begitu jarak ke garis henti hampir sama dengan jarak henti, sehingga shuttle berhenti sebelum garis.',
      'Tidak berbuat apa-apa, karena saat kemudi manual perisai dimatikan.',
      'Hanya membunyikan peringatan, lalu kamu yang harus mengerem.',
      'Mengubah lampu menjadi hijau supaya shuttle boleh lewat.',
    ],
    answer: 0,
    explain:
      'Perisai berjalan setiap langkah fisika (1/60 detik) untuk semua kendaraan, sesudah perintah autopilot atau perintahmu dan sebelum roda bergerak. Ia mencari batasan terdekat di depan (garis henti lampu merah, zebra cross yang dipakai, pejalan kaki di jalur) dan mengerem bila sisa jaraknya sudah hampir sama dengan jarak henti.',
  },
  {
    id: 'pejalan-uji',
    topic: 'shuttle-3d',
    q: 'Tombol Pejalan kaki menyeberang memunculkan orang di depan shuttle. Kapan orang itu boleh muncul?',
    options: [
      'Bila jaraknya dari shuttle masih lebih besar dari jarak henti shuttle, v × waktu reaksi + v² / (2 × perlambatan rem), ditambah cadangan.',
      'Kapan saja, tepat di depan bemper, supaya perisai diuji paling keras.',
      'Hanya saat shuttle berhenti di halte.',
      'Hanya saat cuaca cerah, karena saat hujan pejalan kaki tidak menyeberang.',
    ],
    answer: 0,
    explain:
      'Pejalan kaki hanya dimunculkan sejauh jarak yang masih cukup untuk berhenti. Kalau belum aman, misalnya di depan shuttle ada persimpangan atau ada kendaraan lain yang terlalu dekat, pejalan kaki menunggu dan kamu diberi tahu alasannya. Pejalan kaki di simulator juga baru melangkah ke jalan bila semua kendaraan yang datang masih bisa berhenti.',
  },
  {
    id: 'hujan-3d',
    topic: 'shuttle-3d',
    q: 'Cuaca di Shuttle 3D berganti menjadi Hujan. Gesekan jalan turun dari 0,8 menjadi 0,5. Apa akibatnya bagi shuttle?',
    options: [
      'Perlambatan rem terbesar ikut turun, jadi jarak henti lebih panjang dan shuttle menurunkan batas kecepatannya.',
      'Jarak henti tetap sama, karena rem shuttle listrik tidak terpengaruh jalan basah.',
      'Radar berhenti bekerja, jadi shuttle hanya memakai kamera.',
      'Shuttle boleh melaju lebih cepat karena jalanan lebih sepi.',
    ],
    answer: 0,
    explain:
      'Perlambatan terbesar kira-kira μ × g, jadi μ yang lebih kecil membuat bagian v² / (2 × perlambatan) lebih panjang. Karena itu shuttle membatasi diri 25 km/jam saat hujan. Saat kabut ia membatasi diri 20 km/jam karena jangkauan kamera dan LiDAR memendek. Radar tetap bekerja dalam hujan dan kabut.',
  },
  {
    id: 'bundaran',
    topic: 'shuttle-3d',
    q: 'Shuttle mendekati salah satu bundaran di Villa Puncak Tidar. Bagaimana cara shuttle masuk bundaran?',
    options: [
      'Memberi jalan kepada kendaraan yang sudah berputar di dalam bundaran, lalu masuk dan berputar searah jarum jam.',
      'Masuk lebih dulu karena shuttle datang dari kanan, lalu berputar searah jarum jam.',
      'Memberi jalan kepada kendaraan di dalam bundaran, lalu berputar berlawanan arah jarum jam.',
      'Berhenti sampai bundaran benar-benar kosong, berapa lama pun antreannya.',
    ],
    answer: 0,
    explain:
      'Kendaraan yang sudah di dalam bundaran didahulukan, jadi shuttle menunggu celah sebelum masuk. Indonesia berlalu lintas di kiri, sehingga bundaran diputari searah jarum jam. Menunggu sampai bundaran kosong sama sekali tidak perlu, cukup sampai ada celah yang aman.',
  },
  {
    id: 'motor-malang',
    topic: 'shuttle-3d',
    q: 'Jalan di sekitar Ma Chung dan Malang ramai sepeda motor dan angkot. Mengapa lapisan Pahami shuttle mengawasi motor dengan ketat?',
    options: [
      'Motor kecil dan bisa berubah arah dengan cepat, jadi posisinya harus terus dilacak dan gerakannya ditebak.',
      'Motor tidak terlihat oleh LiDAR, jadi hanya bisa dideteksi oleh radar.',
      'Motor selalu melaju lebih cepat dari batas kecepatan, jadi pasti menabrak.',
      'Motor tidak boleh lewat di jalan yang dilalui shuttle.',
    ],
    answer: 0,
    explain:
      'Benda kecil yang lincah seperti motor dan pejalan kaki paling mudah terlewat dan paling cepat berubah arah. Karena itu persepsi melacak setiap benda dari waktu ke waktu, bukan hanya melihat satu gambar, supaya gerakan berikutnya bisa diperkirakan.',
  },
];
