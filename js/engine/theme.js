// Palet warna dan ukuran standar yang dipakai semua simulasi.
// Warna UI sama dengan variabel CSS di css/style.css. Warna kanvas hanya dipakai di sini.

export const COLORS = Object.freeze({
  // UI
  bg: '#0b1220',
  panel: '#111a2e',
  raised: '#17223b',
  border: '#24314f',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#2dd4bf',
  accentInk: '#042f2e',
  warn: '#f59e0b',
  danger: '#ef4444',
  ok: '#22c55e',

  // Kanvas: lingkungan
  ground: '#13261f',
  groundAlt: '#162c24',
  asphalt: '#2b3240',
  asphaltDark: '#252b37',
  asphaltLight: '#343c4c',
  sidewalk: '#3a4354',
  curb: '#56607a',
  laneMark: '#e5e7eb',
  centerLine: '#facc15',
  building: '#1e293b',
  roof: '#2c3a52',
  roofEdge: '#3b4a66',
  tree: '#1d4a33',
  treeLight: '#2a6446',
  wall: '#6b7385',
  wallDark: '#4b5263',

  // Kanvas: pelaku lalu lintas
  ego: '#2dd4bf',
  egoDark: '#0f766e',
  vehicles: Object.freeze(['#5b7aa6', '#6b7a90', '#7d8fb0', '#4f6283', '#8d9ab3', '#3f5f8a']),
  bus: '#c79a3a',
  shuttle: '#dbe4ee',
  pedestrian: '#fb7185',
  cyclist: '#f0abfc',
  // lalu lintas khas Malang
  angkot: '#6cc3ea',
  motor: '#64748b',
  helmets: Object.freeze(['#f8fafc', '#1f2937', '#dc2626', '#2563eb', '#facc15', '#16a34a']),
  hijab: Object.freeze(['#f472b6', '#a78bfa', '#38bdf8', '#fbbf24', '#e2e8f0', '#34d399']),
  halte: '#2563eb',
  cone: '#f97316',

  // Sensor
  kamera: '#a78bfa',
  lidar: '#22d3ee',
  radar: '#fbbf24',
  ultrasonik: '#a3e635',

  // Lampu lalu lintas
  lightRed: '#ef4444',
  lightYellow: '#fbbf24',
  lightGreen: '#22c55e',
  lightOff: '#1c2433',

  // Jalur dan penanda
  path: '#2dd4bf',
  pathAlt: '#60a5fa',
  target: '#f472b6',
});

export const SENSOR_COLORS = Object.freeze({
  kamera: COLORS.kamera,
  lidar: COLORS.lidar,
  radar: COLORS.radar,
  ultrasonik: COLORS.ultrasonik,
});

const CITY_CAR = Object.freeze({ length: 3.7, width: 1.65, wheelbase: 2.45 });

// Ukuran dalam meter. Angka ini realistis untuk kendaraan penumpang di Indonesia.
export const SIZES = Object.freeze({
  laneWidth: 3.5,
  car: Object.freeze({ length: 4.5, width: 1.8, wheelbase: 2.7 }),
  suv: Object.freeze({ length: 4.8, width: 1.9, wheelbase: 2.8 }),
  bus: Object.freeze({ length: 12, width: 2.5, wheelbase: 6.2 }),
  shuttle: Object.freeze({ length: 5, width: 2.1, wheelbase: 3.2 }),
  cyclist: Object.freeze({ length: 1.8, width: 0.6 }),
  pedestrian: Object.freeze({ radius: 0.35 }),
  sidewalk: 3,
  // kendaraan khas Malang (perkiraan ukuran umum). Kunci sama dengan `kind` di drawVehicle,
  // jadi new PathAgent({ kind: 'angkot' }) langsung mendapat ukuran yang benar.
  cityCar: CITY_CAR,
  city: CITY_CAR,
  mpv: Object.freeze({ length: 4.4, width: 1.73, wheelbase: 2.65 }),
  angkot: Object.freeze({ length: 4.1, width: 1.62, wheelbase: 2.35 }),
  motor: Object.freeze({ length: 1.9, width: 0.72, wheelbase: 1.28 }),
  minibus: Object.freeze({ length: 7.5, width: 2.2, wheelbase: 3.9 }),
});

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Ubah warna hex (#rrggbb) menjadi rgba() dengan alpha tertentu. */
export function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
