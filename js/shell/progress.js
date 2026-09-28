// Penyimpanan progres belajar di localStorage (kunci simotonom.progress.v1).
// Bila localStorage tidak tersedia (mode privat tertentu), progres disimpan di memori saja.

import { LESSONS } from '../lessons/index.js';

const KEY = 'simotonom.progress.v1';
const listeners = new Set();

function readStorage() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && data.lessons ? data : null;
  } catch {
    return null;
  }
}

let state = readStorage() || { version: 1, lessons: {} };

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // penyimpanan penuh atau diblokir: progres tetap ada di memori selama sesi ini
  }
  for (const fn of listeners) fn();
}

function record(id) {
  if (!state.lessons[id]) state.lessons[id] = { done: [], tasks: null, lastStep: 0, complete: false, visited: false };
  return state.lessons[id];
}

/** Hitung ulang status tuntas: semua tugas yang dikenal sudah selesai. */
function refreshComplete(rec) {
  if (rec.tasks && rec.tasks.length > 0) {
    const done = rec.tasks.filter((t) => rec.done.includes(t)).length;
    if (done >= rec.tasks.length) rec.complete = true;
  }
}

// perubahan dari tab lain ikut diterapkan
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  state = readStorage() || { version: 1, lessons: {} };
  for (const fn of listeners) fn();
});

export const progress = {
  KEY,

  /** Ringkasan satu pelajaran: { done, total, doneCount, lastStep, complete, visited }. */
  lesson(id) {
    const rec = state.lessons[id];
    if (!rec) return { done: [], total: null, doneCount: 0, lastStep: 0, complete: false, visited: false };
    const total = rec.tasks ? rec.tasks.length : null;
    const doneCount = rec.tasks ? rec.tasks.filter((t) => rec.done.includes(t)).length : rec.done.length;
    return { done: [...rec.done], total, doneCount, lastStep: rec.lastStep || 0, complete: !!rec.complete, visited: !!rec.visited };
  },

  isTaskDone(id, taskId) {
    return !!state.lessons[id]?.done.includes(taskId);
  },

  /** Tandai tugas selesai. Mengembalikan true bila baru saja selesai. */
  markTask(id, taskId) {
    const rec = record(id);
    if (rec.done.includes(taskId)) return false;
    rec.done.push(taskId);
    refreshComplete(rec);
    save();
    return true;
  },

  /** Simpan daftar id tugas pelajaran (dipanggil saat modul pelajaran dimuat). */
  setTasks(id, taskIds) {
    const rec = record(id);
    rec.tasks = [...taskIds];
    rec.visited = true;
    refreshComplete(rec);
    save();
  },

  setLastStep(id, index) {
    const rec = record(id);
    if (rec.lastStep === index) return;
    rec.lastStep = index;
    save();
  },

  /** Tandai pelajaran tuntas secara langsung (misalnya kuis, atau pelajaran tanpa tugas). */
  markComplete(id) {
    const rec = record(id);
    if (rec.complete) return false;
    rec.complete = true;
    save();
    return true;
  },

  /** Jumlah pelajaran di registri yang sudah tuntas. */
  completedCount() {
    return LESSONS.filter((l) => state.lessons[l.id]?.complete).length;
  },

  /** Pelajaran pertama yang belum tuntas (untuk tombol Mulai belajar). */
  nextLesson() {
    return LESSONS.find((l) => !state.lessons[l.id]?.complete) || LESSONS[0];
  },

  hasAny() {
    return Object.values(state.lessons).some((r) => r.done.length > 0 || r.complete || r.visited);
  },

  reset() {
    state = { version: 1, lessons: {} };
    save();
  },

  /** Dengarkan perubahan progres. Mengembalikan fungsi untuk berhenti. */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
