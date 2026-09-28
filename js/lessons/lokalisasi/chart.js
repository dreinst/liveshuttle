// Grafik galat posisi terhadap waktu dengan sumbu tegak logaritmik.
//
// Grafik bawaan engine (ui.timeChart) memakai skala linear, sehingga galat 0,05 m tidak terlihat
// bila di grafik yang sama ada lompatan GPS 15 m. Grafik ini memakai kelas CSS yang sama
// (ctl-chart, chart-canvas, chart-legend) supaya tampilannya seragam dengan pelajaran lain.
// Nilai NaN memutus garis, jadi estimasi yang dimatikan tidak disambung dengan garis lurus.

import { el } from '../../engine/ui.js';
import { fmt } from '../../engine/math.js';
import { COLORS, MONO, withAlpha } from '../../engine/theme.js';

/**
 * opts: { label, series: [{ label, color }], span (detik terlihat), min, max (m), height,
 *         ticks (garis bantu), target: { value, label } garis sasaran }
 * @returns {{ el, push(t, values), clear(), draw(), setValue(i, text), setActive(i, on) }}
 */
export function logChart(parent, opts) {
  const { label = '', series, span = 30, min = 0.01, max = 40, height = 150, ticks = [0.1, 1, 10], target = null } = opts;
  const canvas = el('canvas', { class: 'chart-canvas', role: 'img', 'aria-label': label || 'Grafik' });
  canvas.style.height = `${height}px`;
  const values = series.map(() => el('span', { class: 'chart-now', text: '-' }));
  const keys = series.map((s, i) => el('span', { class: 'chart-key', style: { '--sw': s.color } }, el('i'), s.label, values[i]));
  const node = el(
    'div',
    { class: 'ctl ctl-chart' },
    label ? el('div', { class: 'ctl-head' }, el('span', { class: 'ctl-label', text: label })) : null,
    canvas,
    el('div', { class: 'chart-legend' }, keys),
  );
  parent.append(node);

  const data = []; // [t, v0, v1, ...]
  let dirty = true;
  const l0 = Math.log10(min);
  const l1 = Math.log10(max);

  /** Gambar ulang bila ada data baru atau ukuran kanvas berubah. Aman dipanggil tiap frame. */
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, canvas.clientWidth);
    const h = Math.max(10, canvas.clientHeight);
    const resized = canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr);
    if (!dirty && !resized) return;
    dirty = false;
    if (resized) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const padL = 44;
    const padR = 8;
    const padY = 8;
    const tEnd = data.length ? Math.max(span, data[data.length - 1][0]) : span;
    const tStart = tEnd - span;
    const X = (t) => padL + ((t - tStart) / span) * (w - padL - padR);
    const Y = (v) => h - padY - ((Math.log10(Math.min(max, Math.max(min, v))) - l0) / (l1 - l0)) * (h - 2 * padY);

    // garis bantu dan labelnya
    g.font = `10px ${MONO}`;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.lineWidth = 1;
    for (const v of ticks) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(w - padR, y);
      g.stroke();
      g.fillStyle = 'rgba(148, 163, 184, 0.9)';
      g.fillText(fmt(v, v < 1 ? 1 : 0, 'm'), padL - 6, y);
    }
    if (target) {
      const y = Math.round(Y(target.value)) + 0.5;
      g.strokeStyle = withAlpha(COLORS.ok, 0.8);
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(w - padR, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = COLORS.ok;
      g.fillText(target.label, padL - 6, y);
    }

    // garis tiap deret
    g.lineJoin = 'round';
    g.lineCap = 'round';
    series.forEach((s, si) => {
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.beginPath();
      let pen = false;
      for (const row of data) {
        const v = row[si + 1];
        if (row[0] < tStart - 0.2 || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const x = X(row[0]);
        const y = Y(v);
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.stroke();
    });
  }

  return {
    el: node,
    push(t, vals) {
      data.push([t, ...vals]);
      while (data.length > 2 && data[0][0] < t - span - 1) data.shift();
      dirty = true;
    },
    clear() {
      data.length = 0;
      dirty = true;
    },
    draw,
    setValue(i, text) {
      if (values[i].textContent !== text) values[i].textContent = text;
    },
    setActive(i, on) {
      keys[i].classList.toggle('is-off', !on);
    },
  };
}
