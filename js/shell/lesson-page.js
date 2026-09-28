// Halaman pelajaran: memuat modul pelajaran secara malas, menyusun tata letak, dan
// menyediakan objek konteks (ctx) untuk mount(). Kontrak ctx didokumentasikan di docs/ENGINE.md.

import { LESSONS, findLesson } from '../lessons/index.js';
import { progress } from './progress.js';
import { toast } from './toast.js';
import { icon } from '../engine/icons.js';
import { Loop } from '../engine/loop.js';
import { View } from '../engine/canvas.js';
import { Rng, clamp } from '../engine/math.js';
import { segmented, bindKeys } from '../engine/ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Galat karena berkas modul belum ada (bukan karena kodenya salah). */
function isMissingModule(err) {
  return err instanceof TypeError && /fetch|import|module/i.test(String(err.message));
}

function isValidLesson(l) {
  return !!l && typeof l === 'object' && typeof l.mount === 'function' && Array.isArray(l.steps);
}

/**
 * Tampilkan halaman pelajaran. Mengembalikan { destroy, focusTarget } secara langsung,
 * sementara modul pelajaran dimuat di belakang layar.
 * @param {HTMLElement} main
 * @param {string} id
 * @param {object} hooks { setState(partial), reducedMotion }
 */
export function renderLesson(main, id, hooks) {
  const entry = findLesson(id);
  const index = LESSONS.indexOf(entry);
  const page = document.createElement('div');
  page.className = 'page page-lesson is-loading';
  page.innerHTML = `
    <div class="lesson-layout">
      <header class="lesson-head">
        <p class="eyebrow">Pelajaran ${index + 1} dari ${LESSONS.length}</p>
        <h1 class="lesson-title" tabindex="-1">${esc(entry.title)}</h1>
      </header>
      <section class="sim-area">
        <div class="stage stage-loading"><div class="stage-message"><span class="spinner" aria-hidden="true"></span><span>Memuat pelajaran...</span></div></div>
      </section>
    </div>`;
  main.append(page);
  hooks.setState({ lessonId: id, lessonStatus: 'loading', stepIndex: null, stepCount: 0, completedTasks: [] });

  let destroyed = false;
  let teardown = null;

  const showFallback = () => {
    page.className = 'page page-lesson page-fallback';
    const nextL = LESSONS[index + 1];
    page.innerHTML = `
      <div class="fallback-card">
        <div class="fallback-icon">${icon('book')}</div>
        <p class="eyebrow">Pelajaran ${index + 1} dari ${LESSONS.length}</p>
        <h1 class="fallback-title" tabindex="-1">${esc(entry.title)}</h1>
        <p class="fallback-lead">Pelajaran ini sedang disiapkan.</p>
        <p class="muted">${esc(entry.summary)} Sementara menunggu, kamu bisa membuka pelajaran lain atau mencoba Simulator 3D.</p>
        <div class="fallback-actions">
          ${nextL ? `<a class="btn btn-primary" href="#/pelajaran/${nextL.id}">${icon('arrowRight')}<span>Pelajaran berikutnya</span></a>` : ''}
          <a class="btn btn-secondary" href="#/pelajaran">${icon('book')}<span>Daftar pelajaran</span></a>
          <a class="btn btn-ghost" href="#/">${icon('home')}<span>Beranda</span></a>
        </div>
        <p class="fallback-note muted">Koneksi terputus? <button type="button" class="link-btn" data-act="reload">Muat ulang halaman</button></p>
      </div>`;
    page.querySelector('[data-act="reload"]').addEventListener('click', () => location.reload());
    hooks.setState({ lessonStatus: 'missing' });
  };

  (async () => {
    let mod;
    try {
      mod = await entry.load();
    } catch (err) {
      if (destroyed) return;
      if (!isMissingModule(err)) console.error(err);
      showFallback();
      return;
    }
    if (destroyed) return;
    const lesson = mod?.default;
    if (!isValidLesson(lesson)) {
      console.error(`Modul pelajaran "${id}" tidak mengikuti kontrak (butuh default export dengan steps dan mount).`);
      showFallback();
      return;
    }
    teardown = buildLesson(page, lesson, entry, index, hooks);
  })();

  return {
    focusTarget: () => page.querySelector('h1'),
    destroy() {
      destroyed = true;
      try {
        teardown?.();
      } catch (err) {
        console.error(err);
      }
      page.remove();
    },
  };
}

function buildLesson(page, lesson, entry, index, hooks) {
  const id = entry.id;
  const layout = lesson.layout === 'full' ? 'full' : 'sim';
  const steps = lesson.steps;
  const N = steps.length;
  const taskSteps = [];
  steps.forEach((s, i) => {
    if (s.task?.id) taskSteps.push({ id: s.task.id, text: s.task.text || '', step: i });
  });
  progress.setTasks(
    id,
    taskSteps.map((t) => t.id),
  );

  let styleEl = null;
  if (lesson.styles) {
    styleEl = document.createElement('style');
    styleEl.dataset.lesson = id;
    styleEl.textContent = lesson.styles;
    document.head.append(styleEl);
  }

  const hasSteps = N > 0;
  const hadFocus = page.contains(document.activeElement);
  page.className = `page page-lesson lesson-${id} layout-${layout}${hasSteps ? '' : ' no-steps'}`;
  const nextL = LESSONS[index + 1];
  page.innerHTML = `
    <div class="lesson-layout">
      <header class="lesson-head">
        <p class="eyebrow">Pelajaran ${index + 1} dari ${LESSONS.length}</p>
        <h1 class="lesson-title" tabindex="-1">${esc(lesson.title || entry.title)}</h1>
        ${taskSteps.length ? `<div class="lesson-progress"><span class="lesson-progress-text" data-el="ptext"></span><span class="bar" aria-hidden="true"><i data-el="pbar"></i></span></div>` : ''}
        ${layout === 'full' && lesson.intro ? `<div class="lesson-intro prose">${lesson.intro}</div>` : ''}
      </header>
      <section class="sim-area" aria-label="Simulasi">
        <div class="stage${layout === 'full' ? ' stage-flow' : ''}" data-el="stage">
          <div class="hud" data-el="hud"></div>
          <div class="stage-badge" data-el="badge" hidden>${icon('pause')}<span>Dijeda</span></div>
          <div class="stage-error" data-el="error" hidden></div>
        </div>
        ${
          layout === 'sim'
            ? `<div class="sim-bar">
          <p class="sim-status" role="status" aria-live="polite" data-el="status">Simulasi siap.</p>
          <div class="sim-buttons">
            ${hasSteps ? `<button type="button" class="btn btn-ghost btn-sm step-jump" data-el="jump">${icon('arrowDown')}<span></span></button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" data-act="pause" aria-pressed="false">${icon('pause')}<span>Jeda</span></button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="reset">${icon('reset')}<span>Ulangi</span></button>
            <div class="speed-wrap" data-el="speed"></div>
          </div>
        </div>`
            : '<p class="visually-hidden" role="status" aria-live="polite" data-el="status"></p>'
        }
        <div class="controls" data-el="controls" aria-label="Kontrol simulasi"></div>
      </section>
      ${hasSteps ? '<aside class="step-panel" aria-label="Langkah pelajaran"><div class="step-card" data-el="card"></div></aside>' : ''}
    </div>`;

  if (hadFocus) page.querySelector('h1')?.focus({ preventScroll: true });
  const $ = (sel) => page.querySelector(`[data-el="${sel}"]`);
  const stage = $('stage');
  const hud = $('hud');
  const controls = $('controls');
  const statusEl = $('status');
  const badge = $('badge');
  const errorEl = $('error');
  const card = $('card');
  const pauseBtn = page.querySelector('[data-act="pause"]');
  const resetBtn = page.querySelector('[data-act="reset"]');
  const jumpBtn = $('jump');

  const abort = new AbortController();
  const cleanups = [];
  const loops = new Set();
  const views = new Set();
  const warned = new Set();
  let instance = null;
  let paused = false;
  let speed = 1;
  let syncing = false;
  let lastStatus = '';
  let stepIndex = hasSteps ? clamp(progress.lesson(id).lastStep || 0, 0, N - 1) : 0;

  // ---------- kontrol simulasi shell ----------
  let speedCtl = null;
  if (layout === 'sim') {
    speedCtl = segmented($('speed'), {
      ariaLabel: 'Kecepatan simulasi',
      options: [
        { value: 0.5, label: '0,5x' },
        { value: 1, label: '1x' },
        { value: 2, label: '2x' },
      ],
      value: 1,
      onChange: (v) => setSpeed(v),
    });
    pauseBtn.addEventListener('click', () => setPaused(!paused), { signal: abort.signal });
    resetBtn.addEventListener('click', () => doReset(), { signal: abort.signal });
    jumpBtn?.addEventListener('click', () => page.querySelector('.step-panel')?.scrollIntoView({ behavior: hooks.reducedMotion ? 'auto' : 'smooth', block: 'start' }), {
      signal: abort.signal,
    });
  }

  function syncButtons() {
    const hasLoop = loops.size > 0;
    if (pauseBtn) {
      pauseBtn.disabled = !hasLoop;
      resetBtn.disabled = !instance?.reset && !hasLoop;
      pauseBtn.setAttribute('aria-pressed', String(paused));
      pauseBtn.innerHTML = paused ? `${icon('play')}<span>Lanjutkan</span>` : `${icon('pause')}<span>Jeda</span>`;
      speedCtl?.setDisabled(!hasLoop);
      speedCtl?.set(speed, true);
    }
    badge.hidden = !(paused && hasLoop);
    hooks.setState({ paused, speed });
  }

  function setPaused(p) {
    paused = !!p;
    syncing = true;
    for (const l of loops) l.setPaused(paused);
    syncing = false;
    syncButtons();
  }

  function setSpeed(s) {
    speed = s;
    syncing = true;
    for (const l of loops) l.setSpeed(s);
    syncing = false;
    syncButtons();
  }

  function showError(text) {
    errorEl.hidden = false;
    errorEl.innerHTML = `<div class="stage-error-card">${icon('alert')}<p>${esc(text)}</p></div>`;
    hooks.setState({ lessonStatus: 'error' });
  }

  function doReset() {
    errorEl.hidden = true;
    try {
      instance?.reset?.();
    } catch (err) {
      console.error(err);
    }
    for (const l of loops) {
      l.resetTime();
      if (!l.running) l.start();
    }
    setPaused(false);
    hooks.setState({ lessonStatus: 'ready' });
  }

  // ---------- kartu langkah ----------
  function taskDone(taskId) {
    return progress.isTaskDone(id, taskId);
  }

  function updateLessonProgress() {
    const done = taskSteps.filter((t) => taskDone(t.id)).length;
    const ptext = $('ptext');
    if (ptext) {
      ptext.textContent = `${done} dari ${taskSteps.length} tugas selesai`;
      $('pbar').style.width = `${(done / taskSteps.length) * 100}%`;
    }
    hooks.setState({ completedTasks: taskSteps.filter((t) => taskDone(t.id)).map((t) => t.id) });
  }

  function dotsHtml() {
    return `<ol class="step-dots">${steps
      .map((s, i) => {
        const done = s.task?.id ? taskDone(s.task.id) : false;
        const cls = [i === stepIndex ? 'is-current' : '', done ? 'is-done' : '', s.task ? 'has-task' : 'no-task'].join(' ');
        const label = `Langkah ${i + 1}: ${s.title}${done ? ' (tugas selesai)' : ''}`;
        return `<li><button type="button" class="step-dot ${cls}" data-go="${i}" aria-label="${esc(label)}"${i === stepIndex ? ' aria-current="step"' : ''}></button></li>`;
      })
      .join('')}<li><button type="button" class="step-dot is-summary${stepIndex === N ? ' is-current' : ''}" data-go="${N}" aria-label="Ringkasan"${
      stepIndex === N ? ' aria-current="step"' : ''
    }></button></li></ol>`;
  }

  function taskBoxHtml(task) {
    const done = taskDone(task.id);
    return `<div class="task-box${done ? ' is-done' : ''}" data-el="task">
      <div class="task-head">
        <span class="task-icon">${done ? icon('check') : icon('target')}</span>
        <span class="task-label">Tugas</span>
        <span class="task-state">${done ? 'Selesai' : 'Belum selesai'}</span>
      </div>
      <p class="task-text">${task.text}</p>
    </div>`;
  }

  function renderCard() {
    if (!card) return;
    if (stepIndex < N) {
      const s = steps[stepIndex];
      card.innerHTML = `
        ${stepIndex === 0 && lesson.intro && layout === 'sim' ? `<div class="step-intro prose">${lesson.intro}</div>` : ''}
        <div class="step-meta"><span class="step-count">Langkah ${stepIndex + 1} dari ${N}</span>${dotsHtml()}</div>
        <h2 class="step-title" tabindex="-1">${esc(s.title)}</h2>
        <div class="step-body prose">${s.body || ''}</div>
        ${s.task ? taskBoxHtml(s.task) : ''}
        <div class="step-nav">
          <button type="button" class="btn btn-secondary" data-go="${stepIndex - 1}"${stepIndex === 0 ? ' disabled' : ''}>${icon('chevronLeft')}<span>Kembali</span></button>
          <button type="button" class="btn btn-primary" data-go="${stepIndex + 1}"><span>${stepIndex === N - 1 ? 'Selesai' : 'Lanjut'}</span>${icon('chevronRight')}</button>
        </div>`;
    } else {
      const doneCount = taskSteps.filter((t) => taskDone(t.id)).length;
      card.innerHTML = `
        <div class="step-meta"><span class="step-count">Ringkasan</span>${dotsHtml()}</div>
        <h2 class="step-title" tabindex="-1">Ringkasan pelajaran</h2>
        <div class="step-body prose">${lesson.summary || ''}</div>
        ${
          taskSteps.length
            ? `<div class="summary-tasks">
          <p class="summary-tasks-title">${doneCount === taskSteps.length ? 'Semua tugas selesai.' : `${doneCount} dari ${taskSteps.length} tugas selesai.`}</p>
          <ul>${taskSteps
            .map(
              (t) => `<li class="${taskDone(t.id) ? 'is-done' : ''}"><span class="summary-check">${taskDone(t.id) ? icon('check') : ''}</span>
                <button type="button" class="link-btn" data-go="${t.step}">Langkah ${t.step + 1}: ${esc(steps[t.step].title)}</button></li>`,
            )
            .join('')}</ul></div>`
            : ''
        }
        <div class="step-nav">
          <button type="button" class="btn btn-secondary" data-go="${N - 1}">${icon('chevronLeft')}<span>Kembali</span></button>
          ${
            nextLesson()
              ? `<a class="btn btn-primary" href="#/pelajaran/${nextLesson().id}"><span>Pelajaran berikutnya</span>${icon('chevronRight')}</a>`
              : `<a class="btn btn-primary" href="#/"><span>Ke beranda</span>${icon('home')}</a>`
          }
        </div>
        ${nextLesson() ? `<p class="next-hint">Berikutnya: <strong>${esc(nextLesson().title)}</strong></p>` : ''}`;
    }
    if (jumpBtn) jumpBtn.querySelector('span').textContent = stepIndex < N ? `Langkah ${stepIndex + 1}/${N}` : 'Ringkasan';
  }

  function nextLesson() {
    return LESSONS[index + 1] || null;
  }

  function goTo(i, { focus = false } = {}) {
    if (!hasSteps) return;
    i = clamp(i, 0, N);
    stepIndex = i;
    if (i < N) progress.setLastStep(id, i);
    else if (!taskSteps.length) progress.markComplete(id);
    renderCard();
    hooks.setState({ stepIndex: i });
    if (i < N) {
      try {
        instance?.onStep?.(i);
      } catch (err) {
        console.error(err);
      }
    }
    if (focus) card.querySelector('.step-title')?.focus({ preventScroll: true });
  }

  card?.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest('[data-go]');
      if (!b || b.disabled) return;
      goTo(Number(b.dataset.go), { focus: true });
    },
    { signal: abort.signal },
  );

  // ---------- konteks untuk pelajaran ----------
  const ctx = {
    lesson: Object.freeze({
      id,
      title: lesson.title || entry.title,
      number: index + 1,
      steps: steps.map((s) => ({ title: s.title, taskId: s.task?.id || null })),
    }),
    stage,
    hud,
    controls,
    root: page,
    signal: abort.signal,
    reducedMotion: !!hooks.reducedMotion,
    get stepCount() {
      return N;
    },
    get isMobile() {
      return window.matchMedia('(max-width: 900px)').matches;
    },
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    currentStep: () => stepIndex,
    goToStep: (i) => goTo(i),
    setStatus(text) {
      text = String(text ?? '');
      if (text === lastStatus) return;
      lastStatus = text;
      statusEl.textContent = text;
    },
    toast: (text, opts) => toast(text, opts),
    isTaskDone: (taskId) => taskDone(taskId),
    completeTask(taskId) {
      const t = taskSteps.find((x) => x.id === taskId);
      if (!t) {
        if (!warned.has(taskId)) {
          warned.add(taskId);
          console.warn(`completeTask: id tugas "${taskId}" tidak ada di steps pelajaran "${id}".`);
        }
        return false;
      }
      if (taskDone(taskId) || t.step !== stepIndex) return false;
      progress.markTask(id, taskId);
      updateLessonProgress();
      const box = card?.querySelector('[data-el="task"]');
      if (box) {
        box.outerHTML = taskBoxHtml(steps[t.step].task);
        card.querySelector('[data-el="task"]')?.classList.add('just-done');
        card.querySelector('.step-meta').innerHTML = `<span class="step-count">Langkah ${stepIndex + 1} dari ${N}</span>${dotsHtml()}`;
      }
      const all = taskSteps.every((x) => taskDone(x.id));
      toast(all ? 'Semua tugas selesai. Pelajaran ini tuntas!' : 'Tugas selesai. Lanjutkan ke langkah berikutnya.', { tone: 'ok' });
      return true;
    },
    completeLesson() {
      if (progress.markComplete(id)) updateLessonProgress();
    },
    createLoop({ update = null, render = null, step } = {}) {
      const loop = new Loop({
        update,
        render,
        step,
        speed,
        paused,
        onError: (err) => {
          console.error(err);
          showError('Simulasi berhenti karena ada kesalahan. Tekan Ulangi untuk mencoba lagi.');
        },
      });
      loop.onChange(() => {
        if (syncing) return;
        // pelajaran mengubah jeda/kecepatan sendiri: samakan tombol dan loop lain
        if (loop.paused !== paused) setPaused(loop.paused);
        if (loop.speed !== speed) setSpeed(loop.speed);
      });
      loops.add(loop);
      loop.start();
      syncButtons();
      return loop;
    },
    createView(opts = {}) {
      const v = new View(stage, { label: `Simulasi ${lesson.title || entry.title}`, ...opts });
      views.add(v);
      return v;
    },
    keys(bindings) {
      const off = bindKeys(bindings);
      cleanups.push(off);
      return off;
    },
    listen(target, type, fn, opts = {}) {
      target.addEventListener(type, fn, { ...opts, signal: abort.signal });
      return () => target.removeEventListener(type, fn, opts);
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    rng: (seed = 1) => new Rng(seed),
  };

  // ---------- mount ----------
  const finishMount = (inst) => {
    instance = inst || {};
    syncButtons();
    if (hasSteps) goTo(stepIndex);
    updateLessonProgress();
    hooks.setState({ lessonStatus: 'ready', stepCount: N });
  };
  try {
    const result = lesson.mount(ctx);
    if (result && typeof result.then === 'function') {
      result.then(
        (inst) => {
          if (!abort.signal.aborted) finishMount(inst);
        },
        (err) => {
          console.error(err);
          if (!abort.signal.aborted) showError('Simulasi gagal dimuat. Coba muat ulang halaman.');
        },
      );
    } else finishMount(result);
  } catch (err) {
    console.error(err);
    instance = {};
    showError('Simulasi gagal dimuat. Coba muat ulang halaman.');
    renderCard();
  }
  if (!hasSteps) hooks.setState({ stepIndex: null });

  return function teardown() {
    try {
      instance?.destroy?.();
    } catch (err) {
      console.error(err);
    }
    for (const l of loops) l.destroy();
    loops.clear();
    for (const v of views) v.destroy();
    views.clear();
    abort.abort();
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
    styleEl?.remove();
  };
}
