// Tempat bernama untuk start dan tujuan di pelajaran Perencanaan Rute.
//
// Koordinat dalam meter pada peta 'malang-roads' (titik asal = titik berat poligon Universitas
// Ma Chung, x ke timur, y ke selatan). Semua nama dan titik berasal dari data OpenStreetMap
// (© Kontributor OpenStreetMap, diambil 28 September 2026):
//   - Universitas Ma Chung: titik asal peta, yaitu titik berat poligon kampus di machung-2d.json.
//   - Tempat di pusat kota: titik tempat di malang-center.json, diubah ke koordinat malang-roads
//     dengan map.toMap(). Nama OSM untuk stasiun adalah "Stasiun Malang Bangunan Lama".
//   - Nama jalan: titik tengah rantai terpanjang jalan itu di malang-roads.json (map.streets()).
// Pelajaran memilih simpang graf terdekat dari titik ini sebagai node start atau tujuan.

export const PLACES = Object.freeze([
  { id: 'machung', name: 'Universitas Ma Chung', short: 'Ma Chung', x: 0, y: 0 },
  { id: 'alun-merdeka', name: 'Alun-Alun Merdeka', short: 'Alun-Alun Merdeka', x: 4559, y: 2808 },
  { id: 'stasiun', name: 'Stasiun Malang (bangunan lama)', short: 'Stasiun Malang', x: 5246, y: 2243 },
  { id: 'alun-bundar', name: 'Alun-Alun Bundar Malang', short: 'Alun-Alun Bundar', x: 4914, y: 2203 },
  { id: 'kayutangan', name: 'Pertokoan Kayutangan', short: 'Kayutangan', x: 4551, y: 2491 },
  { id: 'ijen', name: 'Jalan Besar Ijen', short: 'Jl. Besar Ijen', x: 3548, y: 1624 },
  { id: 'dieng', name: 'Jalan Terusan Dieng', short: 'Jl. Terusan Dieng', x: 2232, y: 1745 },
  { id: 'veteran', name: 'Jalan Veteran', short: 'Jl. Veteran', x: 3087, y: -26 },
  { id: 'soehat', name: 'Jalan Soekarno-Hatta', short: 'Jl. Soekarno-Hatta', x: 3325, y: -1415 },
]);

export const DEFAULT_START = 'machung';
export const DEFAULT_GOAL = 'alun-merdeka';
