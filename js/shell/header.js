// Header aplikasi: logo, konteks pelajaran, navigasi, progres, dan panel daftar pelajaran.

import { LESSONS } from '../lessons/index.js';
import { progress } from './progress.js';
import { icon } from '../engine/icons.js';

export const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
  <rect x="1" y="1" width="30" height="30" rx="9" fill="#0d2826" stroke="#2dd4bf" stroke-opacity=".4"/>
  <path d="M8.5 12.2a10 10 0 0 1 15 0" stroke="#2dd4bf" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".5"/>
  <path d="M11.2 15a6 6 0 0 1 9.6 0" stroke="#2dd4bf" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".9"/>
  <rect x="12.2" y="16.6" width="7.6" height="11" rx="2.6" fill="#2dd4bf"/>
  <rect x="13.5" y="18.5" width="5" height="2.4" rx=".8" fill="#042f2e"/>
</svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function ring(done, total) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const f = total ? done / total : 0;
  return `<svg class="progress-ring" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="3"/>
    <circle cx="12" cy="12" r="${r}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-opacity="${f > 0 ? 1 : 0}"
      stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/>
  </svg>`;
}

export function createHeader(root) {
  root.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="#/" aria-label="SimOtonom, kembali ke beranda">${LOGO_SVG}<span class="brand-name">SimOtonom</span></a>
      <div class="header-context" data-el="context"></div>
      <nav class="main-nav" aria-label="Navigasi utama">
        <a class="nav-link" href="#/" data-nav="home">${icon('home')}<span>Beranda</span></a>
        <a class="nav-link" href="#/simulator/tutorial" data-nav="sim">${icon('cube')}<span>Simulator 3D</span></a>
        <button class="nav-link nav-lessons" type="button" aria-expanded="false" aria-controls="nav-panel" data-nav="lesson">
          ${icon('book')}<span>Pelajaran</span>${icon('chevronDown')}
        </button>
      </nav>
      <div class="header-progress" data-el="progress" title="Pelajaran yang sudah tuntas"></div>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav-panel" aria-label="Buka menu">${icon('menu')}</button>
    </div>
    <div class="nav-panel" id="nav-panel" hidden>
      <div class="nav-panel-links">
        <a class="nav-panel-link" href="#/">${icon('home')}<span>Beranda</span></a>
        <a class="nav-panel-link" href="#/simulator/tutorial">${icon('cube')}<span>Simulator 3D</span></a>
      </div>
      <p class="nav-panel-title">Pelajaran</p>
      <ol class="nav-lesson-list" data-el="list"></ol>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const panel = $('#nav-panel');
  const lessonsBtn = $('.nav-lessons');
  const menuBtn = $('.menu-toggle');
  const contextEl = $('[data-el="context"]');
  const progressEl = $('[data-el="progress"]');
  const listEl = $('[data-el="list"]');
  let route = { name: 'home' };

  function renderList() {
    listEl.innerHTML = LESSONS.map((l, i) => {
      const p = progress.lesson(l.id);
      const current = route.name === 'lesson' && route.id === l.id;
      const state = p.complete ? 'done' : p.doneCount > 0 || p.visited ? 'progress' : 'new';
      const stateText = p.complete ? 'tuntas' : p.doneCount > 0 ? 'sedang dikerjakan' : 'belum dimulai';
      return `<li><a class="nav-lesson is-${state}${current ? ' is-current' : ''}" href="#/pelajaran/${l.id}"${current ? ' aria-current="page"' : ''}>
        <span class="nav-lesson-num">${p.complete ? icon('check') : String(i + 1).padStart(2, '0')}</span>
        <span class="nav-lesson-title">${esc(l.title)}</span>
        <span class="visually-hidden">(${stateText})</span>
      </a></li>`;
    }).join('');
  }

  function renderProgress() {
    const done = progress.completedCount();
    const total = LESSONS.length;
    progressEl.innerHTML = `${ring(done, total)}<span class="header-progress-text"><strong>${done}</strong>/${total}<span class="header-progress-label"> tuntas</span></span>`;
    progressEl.setAttribute('aria-label', `${done} dari ${total} pelajaran tuntas`);
    progressEl.setAttribute('role', 'img');
  }

  function isOpen() {
    return !panel.hidden;
  }
  function open(trigger) {
    renderList();
    panel.hidden = false;
    lessonsBtn.setAttribute('aria-expanded', String(trigger === lessonsBtn));
    menuBtn.setAttribute('aria-expanded', String(trigger === menuBtn));
    root.classList.add('panel-open');
    const current = panel.querySelector('.is-current') || panel.querySelector('a');
    current?.focus({ preventScroll: true });
  }
  function close(returnFocus = false) {
    if (!isOpen()) return;
    const trigger = menuBtn.getAttribute('aria-expanded') === 'true' ? menuBtn : lessonsBtn;
    panel.hidden = true;
    lessonsBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-expanded', 'false');
    root.classList.remove('panel-open');
    if (returnFocus) trigger.focus();
  }

  lessonsBtn.addEventListener('click', () => (isOpen() ? close() : open(lessonsBtn)));
  menuBtn.addEventListener('click', () => (isOpen() ? close() : open(menuBtn)));
  panel.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !panel.contains(e.target) && !lessonsBtn.contains(e.target) && !menuBtn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close(true);
  });
  progress.subscribe(() => {
    renderProgress();
    if (isOpen()) renderList();
  });

  function update(r) {
    route = r;
    close();
    for (const a of root.querySelectorAll('.main-nav [data-nav]')) {
      const on = a.dataset.nav === r.name;
      a.classList.toggle('is-active', on);
      if (a.tagName === 'A') {
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    }
    if (r.name === 'lesson') {
      const i = LESSONS.findIndex((l) => l.id === r.id);
      const l = LESSONS[i];
      contextEl.innerHTML = l
        ? `<span class="crumb-num">Pelajaran ${i + 1} dari ${LESSONS.length}</span><span class="crumb-sep" aria-hidden="true">·</span><span class="crumb-title">${esc(l.title)}</span>`
        : '';
    } else if (r.name === 'sim') {
      contextEl.innerHTML = '<span class="crumb-title">Simulator Kota 3D</span>';
    } else contextEl.innerHTML = '';
    renderProgress();
  }

  renderProgress();
  return { update, close };
}
