// Daftar model. Semua kendaraan dan pejalan kaki dibuat lewat pabrik di folder ini supaya bentuknya
// mudah diganti tanpa menyentuh kode lalu lintas. Ukuran (DIMS) adalah ukuran asli tiap jenis.
import * as car from './car.js';
import * as mpv from './mpv.js';
import * as angkot from './angkot.js';
import * as pickup from './pickup.js';
import * as motorbike from './motorbike.js';
import * as shuttle from './shuttle.js';
import * as pedestrian from './pedestrian.js';
import * as halte from './halte.js';

export const VEHICLE_MODELS = { car, mpv, angkot, pickup, motorbike };
export const VEHICLE_DIMS = {
  car: car.DIMS,
  mpv: mpv.DIMS,
  angkot: angkot.DIMS,
  pickup: pickup.DIMS,
  motorbike: motorbike.DIMS,
  shuttle: shuttle.DIMS,
};
export { shuttle, pedestrian, halte };
