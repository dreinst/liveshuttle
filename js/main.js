// LiveShuttle: boot aplikasi, router hash, dan kait uji (window.__simotonom, nama lama dipertahankan).
//
// Rute:
//   #/                       beranda
//   #/pelajaran              beranda, digulir ke daftar pelajaran
//   #/pelajaran/<id>         halaman pelajaran
//   #/shuttle-3d             dialihkan ke #/shuttle-3d/panduan
//   #/shuttle-3d/panduan     Shuttle 3D Ma Chung, mode panduan
//   #/shuttle-3d/jelajah     Shuttle 3D Ma Chung, mode jelajah
//   #/simulator[/tutorial]   rute lama, dialihkan ke #/shuttle-3d/panduan
//   #/simulator/bebas        rute lama, dialihkan ke #/shuttle-3d/jelajah
//   lainnya                  kembali ke beranda
//
// Kedua mode 3D memakai kunci rute yang sama ('sim'), jadi pindah panduan <-> jelajah tidak
// memasang ulang simulator bila modulnya bisa berganti mode di tempat (lihat simulator-page.js).

import { findLesson } from './lessons/index.js';
import { createHeader } from './shell/header.js';
import { renderHome } from './shell/home.js';
import { renderLesson } from './shell/lesson-page.js';
import { renderSimulator } from './shell/simulator-page.js';
import { Loop } from './engine/loop.js';

const main = document.getElementById('main');
const header = createHeader(document.getElementById('app-header'));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- status untuk kait uji ----------
const state = {
  route: '#/',
  routeName: 'home',
  lessonId: null,
  lessonStatus: null,
  stepIndex: null,
  stepCount: 0,
  completedTasks: [],
  paused: false,
  speed: 1,
  simStatus: null,
  simMode: null,
};
const setState = (partial) => Object.assign(state, partial);

const hook = {};
for (const key of Object.keys(state)) {
  Object.defineProperty(hook, key, {
    enumerable: true,
    get: () => (Array.isArray(state[key]) ? [...state[key]] : state[key]),
  });
}
Object.defineProperty(hook, 'activeLoops', { enumerable: true, get: () => Loop.activeCount });
Object.defineProperty(window, '__simotonom', { value: Object.freeze(hook), writable: false, configurable: false });

// ---------- router ----------
function parse(hash) {
  const h = (hash || '').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home', key: 'home' };
  if (parts[0] === 'pelajaran') {
    if (parts.length === 1) return { name: 'home', key: 'home', scrollTo: 'lessons' };
    if (findLesson(parts[1]) && parts.length === 2) return { name: 'lesson', id: parts[1], key: `lesson:${parts[1]}` };
    return { redirect: '#/' };
  }
  if (parts[0] === 'shuttle-3d') {
    if ((parts[1] === 'panduan' || parts[1] === 'jelajah') && parts.length === 2) return { name: 'sim', mode: parts[1], key: 'sim' };
    return { redirect: '#/shuttle-3d/panduan' };
  }
  if (parts[0] === 'simulator') {
    return { redirect: parts[1] === 'bebas' ? '#/shuttle-3d/jelajah' : '#/shuttle-3d/panduan' };
  }
  return { redirect: '#/' };
}

const SITE = 'LiveShuttle';
function pageTitle(route) {
  if (route.name === 'lesson') return `${findLesson(route.id)?.title || 'Pelajaran'} · ${SITE}`;
  if (route.name === 'sim') return `Shuttle 3D Ma Chung, ${route.mode === 'jelajah' ? 'Jelajah' : 'Panduan'} · ${SITE}`;
  return `${SITE} · Belajar transportasi tanpa pengemudi`;
}

let current = null;
let currentKey = null;
let firstRender = true;

function render() {
  let route = parse(location.hash);
  if (route.redirect) {
    history.replaceState(null, '', route.redirect);
    route = parse(route.redirect);
  }
  if (route.key === currentKey) {
    if (route.scrollTo === 'lessons') document.getElementById('daftar-pelajaran')?.scrollIntoView({ block: 'start' });
    // pindah mode 3D (panduan <-> jelajah) tanpa memasang ulang bila memungkinkan
    if (route.name === 'sim' && typeof current?.setMode === 'function') current.setMode(route.mode);
    setState({ route: location.hash || '#/' });
    return;
  }

  try {
    current?.destroy();
  } catch (err) {
    console.error(err);
  }
  current = null;
  currentKey = route.key;
  main.textContent = '';
  document.body.dataset.route = route.name;
  setState({
    route: location.hash || '#/',
    routeName: route.name,
    lessonId: null,
    lessonStatus: null,
    stepIndex: null,
    stepCount: 0,
    completedTasks: [],
    paused: false,
    speed: 1,
    simStatus: null,
    simMode: null,
  });
  header.update(route);
  document.title = pageTitle(route);
  if (!route.scrollTo) window.scrollTo(0, 0);

  const hooks = { setState, reducedMotion };
  if (route.name === 'lesson') current = renderLesson(main, route.id, hooks);
  else if (route.name === 'sim') {
    // dipanggil simulator-page.js setiap kali mode 3D berganti (dari rute atau dari dalam modul)
    hooks.onModeChange = (mode) => {
      const r = { ...route, mode };
      header.update(r);
      document.title = pageTitle(r);
      setState({ simMode: mode, route: location.hash || '#/' });
    };
    current = renderSimulator(main, route.mode, hooks);
  }
  else current = renderHome(main, { reducedMotion, scrollTo: route.scrollTo });

  // pindahkan fokus ke judul halaman agar pembaca layar tahu halaman berganti
  if (!firstRender) {
    const target = typeof current.focusTarget === 'function' ? current.focusTarget() : current.focusTarget;
    target?.focus({ preventScroll: true });
  }
  firstRender = false;
}

window.addEventListener('hashchange', render);

document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  const h1 = main.querySelector('h1');
  if (h1) h1.focus();
  else main.focus();
});

render();
