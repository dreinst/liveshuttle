// Notifikasi singkat di bagian bawah layar.

import { icon } from '../engine/icons.js';

const MAX = 2;

/**
 * Tampilkan toast.
 * @param {string} text isi pesan (teks biasa)
 * @param {object} [opts] { tone: 'info' | 'ok' | 'warn', duration (ms) }
 */
export function toast(text, { tone = 'info', duration = 3600 } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  // pesan yang sama tidak perlu ditumpuk
  for (const old of region.querySelectorAll('.toast')) if (old.dataset.text === text) old.remove();
  const node = document.createElement('div');
  node.dataset.text = text;
  node.className = `toast is-${tone}`;
  node.innerHTML = `<span class="toast-icon">${icon(tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : 'info')}</span><span class="toast-text"></span>`;
  node.querySelector('.toast-text').textContent = text;
  region.append(node);
  while (region.children.length > MAX) region.firstElementChild.remove();
  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 250);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/** Hapus semua toast (misalnya saat pindah halaman). */
export function clearToasts() {
  const region = document.getElementById('toasts');
  if (region) region.textContent = '';
}
