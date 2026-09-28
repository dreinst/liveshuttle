// Lampu lalu lintas SIMULASI untuk pelajaran Misi Shuttle Otonom.
//
// OpenStreetMap tidak mencatat lampu lalu lintas di sekitar Universitas Ma Chung. Shuttle 3D Ma Chung
// memasang dua lampu simulasi di Jalan Karangampel Timur (data `signals` di
// js/sim3d/data/machung-city.json). Pelajaran ini memakai lampu yang sama dengan aturan waktu yang
// sama (salinan logika js/sim3d/signals.js tanpa bagian Three.js):
//   tiap lengan mendapat hijau sendiri, lalu kuning, lalu merah semua sebagai jeda pengosongan;
//   setelah semua lengan ada fase pejalan kaki eksklusif (semua kendaraan merah).
//
// Durasi kuning memenuhi aturan keselamatan:
//   kuning >= waktu reaksi + v_maks / (2 x perlambatan nyaman) + sela
//          = 1,0 + 11,1 / (2 x 2,2) + 0,5 = 4,0 detik, data memakai 4,5 detik.

import { SHIELD } from '../../sim3d/shield.js';

export const YELLOW_MIN = 1.0 + SHIELD.vMaxGlobal / (2 * 2.2) + 0.5;

export class SignalCtl {
  /**
   * @param {object} data satu entri `signals` dari data kota
   * @param {object} city City (js/sim3d/city.js)
   * @param {number} offset geseran awal siklus (detik), sama dengan Shuttle 3D (indeks x 23,5)
   */
  constructor(data, city, offset) {
    this.id = data.id;
    this.arms = data.arms;
    const plan = data.plan;
    if (plan.yellow < YELLOW_MIN) throw new Error('durasi kuning terlalu pendek untuk aturan keselamatan');
    this.offset = offset;
    this.stages = [];
    this.arms.forEach((a, i) => {
      const major = a.cls === 'tertiary';
      this.stages.push({ type: 'green', arm: i, dur: major ? plan.green : plan.greenMinor });
      this.stages.push({ type: 'yellow', arm: i, dur: plan.yellow });
      this.stages.push({ type: 'allred', arm: -1, dur: plan.allRed });
    });
    let longest = 0;
    for (const xid of data.xw) longest = Math.max(longest, city.crossings[xid].len);
    this.pedClearDur = Math.max(plan.pedClear, Math.ceil(longest / 1.1) + 1);
    if (data.xw.length) {
      this.stages.push({ type: 'walk', arm: -1, dur: plan.walk });
      this.stages.push({ type: 'pedclear', arm: -1, dur: this.pedClearDur });
      this.stages.push({ type: 'allred', arm: -1, dur: plan.allRed });
    }
    this.cycle = this.stages.reduce((a, s) => a + s.dur, 0);
    this.crossings = data.xw.map((id) => city.crossings[id]);
    for (const X of this.crossings) X.signal = this;
    this.arms.forEach((a, i) => {
      for (const lid of a.lanes) city.lanes[lid].sig = { ctl: this, arm: i };
    });
    this.reset();
  }

  reset() {
    this.k = 0;
    this.t = 0;
    this.phaseKey = 1;
    this.step(this.offset % this.cycle);
  }

  step(dt) {
    this.t += dt;
    let st = this.stages[this.k];
    while (this.t >= st.dur) {
      this.t -= st.dur;
      this.k = (this.k + 1) % this.stages.length;
      this.phaseKey++;
      st = this.stages[this.k];
    }
  }

  color(arm) {
    const st = this.stages[this.k];
    if (st.arm !== arm) return 'red';
    return st.type === 'green' ? 'green' : st.type === 'yellow' ? 'yellow' : 'red';
  }

  yellowLeft() {
    const st = this.stages[this.k];
    return st.type === 'yellow' ? st.dur - this.t : 0;
  }

  pedWalk() {
    return this.stages[this.k].type === 'walk';
  }

  /** Lampu pejalan kaki: 'hijau' saat fase jalan, 'kedip' saat pengosongan, selain itu 'merah'. */
  pedState() {
    const t = this.stages[this.k].type;
    return t === 'walk' ? 'hijau' : t === 'pedclear' ? 'kedip' : 'merah';
  }
}
