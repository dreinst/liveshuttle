// Widget DOM kecil untuk panel kontrol pelajaran. Gaya ada di css/style.css (kelas .ctl-*).
//
// Semua widget menerima `parent` sebagai argumen pertama dan langsung menambahkan dirinya ke
// parent. Widget tidak memasang listener global, jadi cukup dibuang bersama DOM-nya.
// Nilai angka yang tampil diformat dengan fmt() (koma desimal Indonesia).

import { fmt } from './math.js';
import { icon } from './icons.js';

let uid = 0;
/** id unik untuk elemen (misalnya pasangan label dan input). */
export const uniqueId = (prefix = 'ui') => `${prefix}-${++uid}`;

/**
 * Hyperscript mini: el('div', { class: 'x', text: 'Halo', onclick: fn }, child1, child2)
 * attrs khusus: class, text, html, style (objek), dataset (objek), on<event> (fungsi).
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function digitsFromStep(step) {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(3, s.length - i - 1);
}

/**
 * Kelompok kontrol berjudul (kartu kecil di panel kontrol).
 * @param {HTMLElement} parent biasanya ctx.controls
 * @param {object} opts { title, hint, wide (lebar penuh), className }
 * @returns {HTMLElement} elemen kelompok, tambahkan widget ke dalamnya
 */
export function group(parent, { title = '', hint = '', wide = false, className = '' } = {}) {
  const node = el('section', { class: `ctl-group${wide ? ' ctl-wide' : ''}${className ? ` ${className}` : ''}` });
  if (title) node.append(el('h3', { class: 'ctl-title', text: title }));
  if (hint) node.append(el('p', { class: 'ctl-hint', text: hint }));
  parent.append(node);
  return node;
}

/**
 * Slider angka dengan label dan nilai.
 * opts: { label, min, max, step, value, unit, digits, format(v), onInput(v), hint }
 * @returns {{el, input, value, set(v, silent?), setDisabled(bool)}}
 */
export function slider(parent, opts) {
  const { label, min = 0, max = 1, step = 0.1, value = min, unit = '', hint = '', onInput = null } = opts;
  const digits = opts.digits ?? digitsFromStep(step);
  const format = opts.format || ((v) => fmt(v, digits, unit));
  const id = uniqueId('slider');
  const out = el('output', { class: 'ctl-value', for: id });
  const input = el('input', { type: 'range', id, min, max, step, value });
  const node = el(
    'div',
    { class: 'ctl ctl-slider' },
    el('div', { class: 'ctl-head' }, el('label', { for: id, text: label }), out),
    input,
    hint ? el('div', { class: 'ctl-note', text: hint }) : null,
  );
  const paint = () => {
    const v = Number(input.value);
    out.textContent = format(v);
    const pct = ((v - Number(min)) / (Number(max) - Number(min) || 1)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', () => {
    paint();
    onInput?.(Number(input.value));
  });
  paint();
  parent.append(node);
  return {
    el: node,
    input,
    get value() {
      return Number(input.value);
    },
    set(v, silent = true) {
      input.value = v;
      paint();
      if (!silent) onInput?.(Number(input.value));
    },
    setDisabled(d) {
      input.disabled = !!d;
      node.classList.toggle('is-disabled', !!d);
    },
  };
}

/**
 * Sakelar nyala/mati (role="switch").
 * opts: { label, checked, onChange(checked), color (titik warna), hint (teks kecil di bawah label) }
 * @returns {{el, checked, set(on, silent?), setHint(text), setDisabled(bool)}}
 */
export function toggle(parent, opts) {
  const { label, checked = false, onChange = null, color = null, hint = '' } = opts;
  const hintEl = el('span', { class: 'toggle-hint', text: hint });
  const node = el(
    'button',
    { type: 'button', class: 'ctl ctl-toggle', role: 'switch', 'aria-checked': String(!!checked) },
    color ? el('span', { class: 'toggle-dot', style: { '--dot': color } }) : null,
    el('span', { class: 'toggle-text' }, el('span', { class: 'toggle-label', text: label }), hintEl),
    el('span', { class: 'switch', 'aria-hidden': 'true' }, el('span', { class: 'knob' })),
  );
  if (color) node.style.setProperty('--dot', color);
  let state = !!checked;
  const paint = () => {
    node.setAttribute('aria-checked', String(state));
    node.classList.toggle('is-on', state);
  };
  node.addEventListener('click', () => {
    state = !state;
    paint();
    onChange?.(state);
  });
  paint();
  parent.append(node);
  return {
    el: node,
    get checked() {
      return state;
    },
    set(on, silent = true) {
      state = !!on;
      paint();
      if (!silent) onChange?.(state);
    },
    setHint(text) {
      if (hintEl.textContent !== text) hintEl.textContent = text;
    },
    setDisabled(d) {
      node.disabled = !!d;
    },
  };
}

/**
 * Kontrol segmen (pilih satu dari beberapa), role="radiogroup" dengan navigasi panah.
 * opts: { label, ariaLabel (dipakai bila tanpa label terlihat), options: [{ value, label, icon? }], value, onChange(value) }
 * @returns {{el, value, set(v, silent?), setDisabled(bool)}}
 */
export function segmented(parent, opts) {
  const { label = '', ariaLabel = '', options, value = options[0]?.value, onChange = null } = opts;
  const labelId = uniqueId('seg');
  const bar = el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': label ? labelId : null, 'aria-label': label ? null : ariaLabel || 'Pilihan' });
  const node = el('div', { class: 'ctl ctl-seg' }, label ? el('div', { class: 'ctl-head' }, el('span', { id: labelId, class: 'ctl-label', text: label })) : null, bar);
  let current = value;
  const buttons = options.map((o) =>
    el('button', { type: 'button', role: 'radio', class: 'seg-btn', dataset: { value: String(o.value) }, html: o.icon ? `${icon(o.icon)}<span>${o.label}</span>` : null, text: o.icon ? null : o.label }),
  );
  const paint = () => {
    buttons.forEach((b, i) => {
      const on = options[i].value === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-active', on);
    });
  };
  const choose = (v, focus = false) => {
    if (v === current) return;
    current = v;
    paint();
    if (focus) buttons[options.findIndex((o) => o.value === v)]?.focus();
    onChange?.(v);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => choose(options[i].value));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const j = (i + d + options.length) % options.length;
      choose(options[j].value, true);
    });
    bar.append(b);
  });
  paint();
  parent.append(node);
  return {
    el: node,
    get value() {
      return current;
    },
    set(v, silent = true) {
      if (silent) {
        current = v;
        paint();
      } else choose(v);
    },
    setDisabled(d) {
      buttons.forEach((b) => (b.disabled = !!d));
    },
  };
}

/**
 * Tombol biasa.
 * opts: { label, onClick, variant: 'primary' | 'secondary' | 'ghost' | 'danger', icon, kbd, title, small }
 * @returns {HTMLButtonElement}
 */
export function button(parent, opts) {
  const { label, onClick = null, variant = 'secondary', icon: ic = null, kbd = null, title = null, small = false } = opts;
  const node = el('button', { type: 'button', class: `btn btn-${variant}${small ? ' btn-sm' : ''}`, title });
  node.innerHTML = `${ic ? icon(ic) : ''}<span class="btn-label"></span>${kbd ? `<kbd>${kbd}</kbd>` : ''}`;
  node.querySelector('.btn-label').textContent = label;
  if (onClick) node.addEventListener('click', onClick);
  parent.append(node);
  return node;
}

/**
 * Tombol tahan: aktif selama ditekan (mouse, sentuh, atau Spasi/Enter).
 * Cocok untuk gas, rem, atau maju/mundur. Pasangkan dengan tombol keyboard lewat ctx.keys().
 * opts: { label, icon, kbd, onChange(active), variant }
 * @returns {{el, active, setActive(bool)}}
 */
export function holdButton(parent, opts) {
  const { label, icon: ic = null, kbd = null, onChange = null, variant = 'secondary' } = opts;
  const node = el('button', { type: 'button', class: `btn btn-${variant} btn-hold`, 'aria-pressed': 'false' });
  node.innerHTML = `${ic ? icon(ic) : ''}<span class="btn-label"></span>${kbd ? `<kbd>${kbd}</kbd>` : ''}`;
  node.querySelector('.btn-label').textContent = label;
  let active = false;
  const set = (on) => {
    if (on === active) return;
    active = on;
    node.setAttribute('aria-pressed', String(on));
    node.classList.toggle('is-held', on);
    onChange?.(on);
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    node.setPointerCapture?.(e.pointerId);
    set(true);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(t, () => set(false));
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  node.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      set(true);
    }
  });
  node.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') set(false);
  });
  node.addEventListener('blur', () => set(false));
  parent.append(node);
  return {
    el: node,
    get active() {
      return active;
    },
    setActive: set,
  };
}

/** Baris tombol (flex) untuk mengelompokkan beberapa tombol. */
export function buttonRow(parent, { className = '' } = {}) {
  const node = el('div', { class: `ctl-row${className ? ` ${className}` : ''}` });
  parent.append(node);
  return node;
}

/**
 * Tampilan nilai (label kecil di atas, angka monospace di bawah).
 * opts: { label, value, color, big }
 * @returns {{el, set(text), setTone(tone)}} tone: '' | 'ok' | 'warn' | 'danger' | 'off'
 */
export function readout(parent, { label, value = '-', color = null, big = false } = {}) {
  const valueEl = el('span', { class: 'readout-value', text: value });
  const node = el('div', { class: `readout${big ? ' readout-big' : ''}` }, el('span', { class: 'readout-label', text: label }), valueEl);
  if (color) node.style.setProperty('--tone', color);
  parent.append(node);
  let last = value;
  return {
    el: node,
    set(text) {
      text = String(text);
      if (text !== last) {
        last = text;
        valueEl.textContent = text;
      }
    },
    setTone(tone) {
      node.dataset.tone = tone || '';
    },
  };
}

/** Grid readout (dua kolom atau lebih) sebagai wadah beberapa readout. */
export function readoutGrid(parent) {
  const node = el('div', { class: 'readout-grid' });
  parent.append(node);
  return node;
}

/**
 * Legenda warna. items: [{ color, label, shape: 'dot' | 'line' | 'square' }]
 */
export function legend(parent, items) {
  const node = el('ul', { class: 'legend' });
  for (const it of items) {
    node.append(el('li', {}, el('span', { class: `legend-swatch is-${it.shape || 'dot'}`, style: { '--sw': it.color } }), el('span', { text: it.label })));
  }
  parent.append(node);
  return node;
}

/**
 * Tabel data kecil yang bisa diperbarui berkali-kali tanpa berkedip.
 * opts: { columns: [{ key, label, align: 'left'|'center'|'right', className }], rows, caption, empty }
 * Nilai sel: string (teks biasa) atau { html: '...' } untuk isi HTML tepercaya (misalnya ikon).
 * @returns {{el, setRows(rows)}}
 */
export function dataTable(parent, { columns, rows = [], caption = '', empty = 'Belum ada data.' }) {
  const table = el('table', { class: 'data-table' });
  if (caption) table.append(el('caption', { class: 'visually-hidden', text: caption }));
  const thead = el('thead');
  const tr = el('tr');
  for (const c of columns) {
    const th = el('th', { scope: 'col', class: [c.align ? `is-${c.align}` : '', c.className || ''].join(' ').trim() || null });
    if (c.html) th.innerHTML = c.html;
    else th.textContent = c.label ?? '';
    tr.append(th);
  }
  thead.append(tr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const wrap = el('div', { class: 'data-table-wrap' }, table);
  parent.append(wrap);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  let last = '';
  const setRows = (list) => {
    let html = '';
    if (!list.length) html = `<tr><td class="is-empty" colspan="${columns.length}">${esc(empty)}</td></tr>`;
    for (const row of list) {
      html += `<tr${row._class ? ` class="${esc(row._class)}"` : ''}>`;
      columns.forEach((c, i) => {
        const v = row[c.key];
        const cls = [c.align ? `is-${c.align}` : '', c.className || ''].join(' ').trim();
        const content = v && typeof v === 'object' && 'html' in v ? v.html : esc(v ?? '');
        const tag = i === 0 && c.rowHeader !== false ? 'th scope="row"' : 'td';
        html += `<${tag}${cls ? ` class="${cls}"` : ''}>${content}</${tag.split(' ')[0]}>`;
      });
      html += '</tr>';
    }
    if (html !== last) {
      last = html;
      tbody.innerHTML = html;
    }
  };
  setRows(rows);
  return { el: wrap, table, setRows };
}

/** Catatan kecil di panel kontrol. tone: 'info' | 'warn' | 'ok'. html dianggap tepercaya. */
export function note(parent, html, { tone = 'info' } = {}) {
  const node = el('div', { class: `ctl-callout is-${tone}`, html: `${icon(tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info')}<div>${html}</div>` });
  parent.append(node);
  return node;
}

/**
 * Chip kecil untuk HUD di atas kanvas (ctx.hud).
 * opts: { label, color }
 * @returns {{el, set(text), show(bool), setTone(tone)}}
 */
export function hudChip(parent, { label = '', color = null } = {}) {
  const valueEl = el('span', { class: 'hud-value' });
  const node = el('div', { class: 'hud-chip' }, label ? el('span', { class: 'hud-label', text: label }) : null, valueEl);
  if (color) node.style.setProperty('--tone', color);
  parent.append(node);
  let last = null;
  return {
    el: node,
    set(text) {
      text = String(text);
      if (text !== last) {
        last = text;
        valueEl.textContent = text;
      }
    },
    show(on) {
      node.hidden = !on;
    },
    setTone(tone) {
      node.dataset.tone = tone || '';
    },
  };
}

/**
 * Grafik deret waktu kecil (misalnya galat kemudi atau kecepatan).
 * opts: { label, series: [{ label, color }], span (detik yang terlihat), min, max, unit, digits, height }
 * min/max null berarti skala otomatis. Menggambar ulang otomatis sekali per frame setelah push().
 * @returns {{el, push(t, ...values), clear(), draw()}}
 */
export function timeChart(parent, opts) {
  const { label = '', series, span = 10, min = null, max = null, unit = '', digits = 1, height = 120 } = opts;
  const canvas = el('canvas', { class: 'chart-canvas', role: 'img', 'aria-label': label || 'Grafik' });
  canvas.style.height = `${height}px`;
  const values = series.map(() => el('span', { class: 'chart-now' }));
  const legendEl = el(
    'div',
    { class: 'chart-legend' },
    series.map((s, i) => el('span', { class: 'chart-key', style: { '--sw': s.color } }, el('i'), s.label, values[i])),
  );
  const node = el('div', { class: 'ctl ctl-chart' }, label ? el('div', { class: 'ctl-head' }, el('span', { class: 'ctl-label', text: label })) : null, canvas, legendEl);
  parent.append(node);
  const data = []; // [t, v0, v1, ...]
  let raf = 0;

  function draw() {
    raf = 0;
    const g = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, canvas.clientWidth);
    const h = Math.max(10, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const tEnd = data.length ? data[data.length - 1][0] : span;
    const tStart = tEnd - span;
    let lo = min;
    let hi = max;
    if (lo == null || hi == null) {
      let a = Infinity;
      let b = -Infinity;
      for (const row of data) for (let i = 1; i < row.length; i++) if (Number.isFinite(row[i])) {
        a = Math.min(a, row[i]);
        b = Math.max(b, row[i]);
      }
      if (!Number.isFinite(a)) {
        a = 0;
        b = 1;
      }
      if (a === b) {
        a -= 1;
        b += 1;
      }
      const pad = (b - a) * 0.1;
      lo = lo ?? a - pad;
      hi = hi ?? b + pad;
    }
    const X = (t) => ((t - tStart) / span) * (w - 8) + 4;
    const Y = (v) => h - 6 - ((v - lo) / (hi - lo || 1)) * (h - 12);
    // grid
    g.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = 6 + ((h - 12) * i) / 4;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
    if (lo < 0 && hi > 0) {
      g.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(0, Y(0));
      g.lineTo(w, Y(0));
      g.stroke();
      g.setLineDash([]);
    }
    g.font = '10px ui-monospace, monospace';
    g.fillStyle = 'rgba(148, 163, 184, 0.9)';
    g.textBaseline = 'top';
    g.fillText(fmt(hi, digits, unit), 4, 2);
    g.textBaseline = 'bottom';
    g.fillText(fmt(lo, digits, unit), 4, h - 1);
    series.forEach((s, si) => {
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      let started = false;
      for (const row of data) {
        const v = row[si + 1];
        if (!Number.isFinite(v) || row[0] < tStart) continue;
        const x = X(row[0]);
        const y = Y(Math.max(lo, Math.min(hi, v)));
        if (started) g.lineTo(x, y);
        else {
          g.moveTo(x, y);
          started = true;
        }
      }
      g.stroke();
      const lastRow = data[data.length - 1];
      values[si].textContent = lastRow && Number.isFinite(lastRow[si + 1]) ? fmt(lastRow[si + 1], digits, unit) : '-';
    });
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  schedule();
  return {
    el: node,
    push(t, ...vals) {
      data.push([t, ...vals]);
      while (data.length > 2 && data[0][0] < t - span - 1) data.shift();
      schedule();
    },
    clear() {
      data.length = 0;
      schedule();
    },
    draw,
  };
}

/**
 * Pasang pintasan keyboard di window. Di pelajaran, pakai ctx.keys() yang otomatis dilepas.
 * bindings: { 'ArrowUp': { down(e), up(e) } | (e) => {} , ... }  (kunci = e.key, huruf kecil untuk huruf)
 * Tombol diabaikan saat fokus di input teks atau saat Ctrl/Alt/Meta ditekan.
 * @returns {Function} fungsi untuk melepas semua listener
 */
export function bindKeys(bindings, { target = window } = {}) {
  const held = new Set();
  const norm = (k) => (k.length === 1 ? k.toLowerCase() : k);
  const typing = (e) => {
    const t = e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes(t.type) || (t.type === 'range' && e.key.startsWith('Arrow'));
    return false;
  };
  const onDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    // biarkan tombol segmen dan radio memakai panah sendiri
    if (e.key.startsWith('Arrow') && e.target?.getAttribute?.('role') === 'radio') return;
    const k = norm(e.key);
    const b = bindings[k];
    if (!b) return;
    e.preventDefault();
    if (held.has(k)) return; // abaikan auto-repeat
    held.add(k);
    if (typeof b === 'function') b(e);
    else b.down?.(e);
  };
  const onUp = (e) => {
    const k = norm(e.key);
    if (!held.has(k)) return;
    held.delete(k);
    const b = bindings[k];
    if (b && typeof b === 'object') b.up?.(e);
  };
  const releaseAll = () => {
    for (const k of held) {
      const b = bindings[k];
      if (b && typeof b === 'object') b.up?.(null);
    }
    held.clear();
  };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  window.addEventListener('blur', releaseAll);
  return () => {
    releaseAll();
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', releaseAll);
  };
}
