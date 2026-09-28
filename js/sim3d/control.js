// Kontrol: mengubah rencana menjadi perintah kemudi, gas, dan rem.
// Kemudi memakai pure pursuit: mobil diarahkan ke satu titik di jalur rencana sejauh
// jarak pandang ke depan (lookahead) yang bertambah sesuai kecepatan.
// Gas dan rem mengikuti target percepatan dari perencanaan.
import { EGO } from './ego.js';
import { clamp } from './util.js';

export class Controller {
  constructor(app) {
    this.app = app;
    this.steerCmd = 0;
    this.accCmd = 0;
    this.gas = 0;
    this.brake = 0;
    this.lookahead = 6;
    this.target = { x: 0, z: 0 };
    this.keys = { up: false, down: false, left: false, right: false };
  }

  purePursuit() {
    const { app } = this;
    const e = app.ego;
    const pl = app.planner;
    const pts = pl.path;
    const n = pl.pathN;
    if (n < 2) return 0;
    const Ld = clamp(2.4 + 0.55 * Math.abs(e.v), 3.6, 15);
    this.lookahead = Ld;
    // titik jalur pada jarak Ld dari proyeksi mobil
    let tx = pts[n - 1].x;
    let tz = pts[n - 1].z;
    for (let i = 1; i < n; i++) {
      if (pts[i].d >= Ld) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = (Ld - a.d) / Math.max(1e-6, b.d - a.d);
        tx = a.x + (b.x - a.x) * t;
        tz = a.z + (b.z - a.z) * t;
        break;
      }
    }
    this.target.x = tx;
    this.target.z = tz;
    // titik acuan: gandar belakang
    const rx = e.x - Math.cos(e.h) * (EGO.wb / 2);
    const rz = e.z - Math.sin(e.h) * (EGO.wb / 2);
    const dx = tx - rx;
    const dz = tz - rz;
    const alpha = Math.atan2(dz, dx) - e.h;
    const dist = Math.max(1, Math.hypot(dx, dz));
    return Math.atan2(2 * EGO.wb * Math.sin(alpha), dist);
  }

  step() {
    const { app } = this;
    const e = app.ego;
    const pl = app.planner;
    let steer = 0;
    let acc = 0;
    let reverse = false;
    if (app.autopilot) {
      steer = this.purePursuit();
      acc = pl.aDes;
      if (pl.backup) {
        // saat mundur, setir lurus
        steer = 0;
        reverse = true;
      }
    } else {
      const k = this.keys;
      const steerTarget = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      steer = steerTarget * EGO.maxSteer * clamp(1.1 - Math.abs(e.v) / 25, 0.35, 1);
      if (k.up) acc = e.v < -0.1 ? 4 : 2.2;
      else if (k.down) {
        if (e.v > 0.3) acc = -5;
        else {
          acc = -1.2;
          reverse = true;
        }
      } else acc = e.v > 0.05 ? -0.35 : e.v < -0.05 ? 0.6 : 0;
      if (e.v < -0.05) reverse = true;
      // rem darurat otomatis tetap aktif saat mengemudi sendiri
      if (pl.aeb || pl.manualBrakeT > 0) {
        acc = -app.weather.fx.brakeMax;
        reverse = false;
      }
    }
    this.steerCmd = steer;
    this.accCmd = acc;
    const fx = app.weather.fx;
    this.gas = acc > 0 ? clamp(acc / EGO.maxAccel, 0, 1) : 0;
    this.brake = acc < 0 ? clamp(-acc / fx.brakeMax, 0, 1) : 0;
    return { steer, acc, reverse };
  }
}
