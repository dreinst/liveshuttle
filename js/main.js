// SimOtonom: boot aplikasi, router hash, dan kait uji (window.__simotonom).
//
// Rute:
//   #/                     beranda
//   #/pelajaran            beranda, digulir ke daftar pelajaran
//   #/pelajaran/<id>       halaman pelajaran
//   #/simulator            dialihkan ke #/simulator/tutorial
//   #/simulator/tutorial   simulator kota 3D, mode tutorial
//   #/simulator/bebas      simulator kota 3D, mode bebas
//   lainnya                kembali ke beranda

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
  if (parts[0] === 'simulator') {
    if (parts.length === 1) return { redirect: '#/simulator/tutorial' };
    if ((parts[1] === 'tutorial' || parts[1] === 'bebas') && parts.length === 2) return { name: 'sim', mode: parts[1], key: `sim:${parts[1]}` };
    return { redirect: '#/simulator/tutorial' };
  }
  return { redirect: '#/' };
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
  if (!route.scrollTo) window.scrollTo(0, 0);

  const hooks = { setState, reducedMotion };
  if (route.name === 'lesson') current = renderLesson(main, route.id, hooks);
  else if (route.name === 'sim') current = renderSimulator(main, route.mode, hooks);
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
