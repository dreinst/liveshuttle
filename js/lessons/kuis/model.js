// Model Kuis Akhir tanpa DOM: mengacak soal dan pilihan, mencatat jawaban, dan menghitung skor.
//
// Skor = persentase jawaban benar, dibulatkan ke bawah (0 sampai 100). Pembulatan ke bawah dipakai
// supaya skor yang tampil tidak pernah terlihat lulus padahal belum: lulus berarti skor >= PASS_SCORE.

export const PASS_SCORE = 70;

/** Skor 0 sampai 100 dari jumlah benar. */
export const scoreOf = (correct, total) => (total > 0 ? Math.floor((100 * correct) / total + 1e-9) : 0);

/** Jumlah jawaban benar paling sedikit untuk lulus. */
export const neededCorrect = (total, pass = PASS_SCORE) => Math.ceil((pass * total) / 100 - 1e-9);

/** Salinan daftar dengan urutan acak (Fisher-Yates). rng punya next() yang memberi [0, 1). */
export function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Buat kuis dari bank soal. Panggil start() untuk memulai percobaan (sudah dipanggil sekali).
 * @param {Array} bank soal { id, topic, q, options, answer, explain }
 * @param {{ next(): number }} rng
 */
export function createQuiz(bank, rng) {
  let items = [];
  let index = 0;
  let attempt = 0;
  let best = null;
  let last = null;
  const history = [];

  const keyOfAnswer = (it) => it.q.answer;
  const correctSlot = (it) => it.options.findIndex((o) => o.key === keyOfAnswer(it));
  const isCorrect = (it) => it.chosen != null && it.options[it.chosen].key === keyOfAnswer(it);
  const answeredCount = () => items.filter((it) => it.chosen != null).length;
  const correctCount = () => items.filter(isCorrect).length;

  function summary() {
    const correct = correctCount();
    const total = items.length;
    const score = scoreOf(correct, total);
    return { attempt, correct, wrong: answeredCount() - correct, total, score, passed: score >= PASS_SCORE };
  }

  function start() {
    attempt += 1;
    index = 0;
    last = null;
    items = shuffled(bank, rng).map((q) => ({
      q,
      options: shuffled(
        q.options.map((text, key) => ({ text, key })),
        rng,
      ),
      chosen: null,
    }));
  }

  function finish() {
    last = summary();
    history.push(last);
    if (!best || last.score > best.score) best = last;
  }

  const quiz = {
    start,
    get items() {
      return items;
    },
    get index() {
      return index;
    },
    get current() {
      return items[index] || null;
    },
    get total() {
      return items.length;
    },
    get attempt() {
      return attempt;
    },
    get answered() {
      return answeredCount();
    },
    get correct() {
      return correctCount();
    },
    /** Semua soal percobaan ini sudah dijawab. */
    get finished() {
      return items.length > 0 && answeredCount() === items.length;
    },
    /** Ringkasan percobaan terakhir yang selesai, atau null. */
    get last() {
      return last;
    },
    /** Percobaan dengan skor tertinggi sejauh ini, atau null. */
    get best() {
      return best;
    },
    get history() {
      return history.slice();
    },
    isCorrect,
    correctSlot,

    /**
     * Pilih jawaban untuk soal sekarang. Jawaban tidak bisa diganti.
     * @returns {{ item, correct, correctSlot, finished }} atau null bila tidak berlaku
     */
    choose(slot) {
      const it = items[index];
      if (!it || it.chosen != null || !(slot >= 0 && slot < it.options.length)) return null;
      it.chosen = slot;
      const done = answeredCount() === items.length;
      if (done) finish();
      return { item: it, correct: isCorrect(it), correctSlot: correctSlot(it), finished: done };
    },

    /** Pindah ke soal berikutnya bila soal sekarang sudah dijawab. */
    next() {
      if (index < items.length - 1 && items[index].chosen != null) {
        index += 1;
        return true;
      }
      return false;
    },

    /** Jumlah benar per topik, mengikuti urutan `order`. */
    topicStats(order) {
      const map = new Map(order.map((t) => [t, { topic: t, correct: 0, total: 0 }]));
      for (const it of items) {
        if (!map.has(it.q.topic)) map.set(it.q.topic, { topic: it.q.topic, correct: 0, total: 0 });
        const s = map.get(it.q.topic);
        s.total += 1;
        if (isCorrect(it)) s.correct += 1;
      }
      return [...map.values()].filter((s) => s.total > 0);
    },
  };

  start();
  return quiz;
}
