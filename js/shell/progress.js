// Penyimpanan progres belajar di localStorage (kunci liveshuttle.progress.v1).
// Progres lama dari kunci simotonom.progress.v1 dipindahkan sekali secara otomatis.
// Bila localStorage tidak tersedia (mode privat tertentu), progres disimpan di memori saja.

import { LESSONS } from '../lessons/index.js';

const KEY = 'liveshuttle.progress.v1';
const OLD_KEY = 'simotonom.progress.v1';
const listeners = new Set();

function parse(raw) {
  try {
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' && data.lessons && typeof data.lessons === 'object' ? data : null;
  } catch {
    return null;
  }
}

function readStorage() {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Pindahkan progres dari kunci lama bila kunci baru belum ada. */
function migrate() {
  try {
    const ls = window.localStorage;
    if (ls.getItem(KEY) != null) return null;
    const old = parse(ls.getItem(OLD_KEY));
    if (!old) return null;
    ls.setItem(KEY, JSON.stringify(old));
    ls.removeItem(OLD_KEY);
    return old;
  } catch {
    return null;
  }
}

let state = readStorage() || migrate() || { version: 1, lessons: {} };

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
  /** Ringkasan satu pelajaran: { total, doneCount, lastStep, complete, visited }. */
  lesson(id) {
    const rec = state.lessons[id];
    if (!rec) return { total: null, doneCount: 0, lastStep: 0, complete: false, visited: false };
    const total = rec.tasks ? rec.tasks.length : null;
    const doneCount = rec.tasks ? rec.tasks.filter((t) => rec.done.includes(t)).length : rec.done.length;
    return { total, doneCount, lastStep: rec.lastStep || 0, complete: !!rec.complete, visited: !!rec.visited };
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
