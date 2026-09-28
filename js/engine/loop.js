// Loop simulasi dengan langkah waktu tetap.
//
// update(dt) dipanggil dengan dt tetap (default 1/60 detik waktu simulasi), bisa 0 sampai
// beberapa kali per frame tergantung kecepatan. render() dipanggil sekali per frame layar
// (requestAnimationFrame), juga saat dijeda, supaya perubahan dari tombol tetap terlihat.
// Saat tab disembunyikan, loop berhenti menghitung waktu dan melanjutkan tanpa lompatan.
//
// Di dalam pelajaran, JANGAN membuat Loop langsung. Pakai ctx.createLoop() supaya tombol
// Jeda, Ulangi, dan kecepatan di shell ikut mengendalikan loop dan loop dihentikan otomatis.

const running = new Set();

export class Loop {
  /** Jumlah loop yang sedang berjalan di seluruh halaman (untuk uji kebocoran). */
  static get activeCount() {
    return running.size;
  }

  /**
   * @param {object} opts
   * @param {(dt:number, loop:Loop) => void} [opts.update] langkah simulasi, dt dalam detik
   * @param {(alpha:number, loop:Loop) => void} [opts.render] gambar satu frame
   * @param {number} [opts.step=1/60] panjang langkah tetap (detik)
   * @param {number} [opts.speed=1] pengali kecepatan awal
   * @param {boolean} [opts.paused=false]
   * @param {number} [opts.maxSteps=8] batas langkah per frame agar tidak tertinggal terus
   * @param {(err:Error, loop:Loop) => void} [opts.onError] dipanggil bila update/render melempar galat
   */
  constructor({ update = null, render = null, step = 1 / 60, speed = 1, paused = false, maxSteps = 8, onError = null } = {}) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.maxSteps = maxSteps;
    this.onError = onError;
    this.time = 0; // waktu simulasi (detik) sejak dibuat atau resetTime()
    this.frame = 0;
    this.error = null;
    this._speed = speed;
    this._paused = paused;
    this._acc = 0;
    this._last = null;
    this._raf = 0;
    this._destroyed = false;
    this._listeners = new Set();
    this._tick = this._tick.bind(this);
    this._onVisibility = () => {
      this._last = null; // hindari lompatan waktu setelah tab kembali terlihat
    };
  }

  get running() {
    return this._raf !== 0;
  }
  get paused() {
    return this._paused;
  }
  get speed() {
    return this._speed;
  }

  start() {
    if (this._destroyed || this._raf) return this;
    this.error = null;
    this._last = null;
    running.add(this);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._raf = requestAnimationFrame(this._tick);
    return this;
  }

  /** Hentikan frame (state tetap). Bisa dimulai lagi dengan start(). */
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    running.delete(this);
    document.removeEventListener('visibilitychange', this._onVisibility);
    return this;
  }

  destroy() {
    this.stop();
    this._destroyed = true;
    this._listeners.clear();
    this.update = null;
    this.render = null;
  }

  pause() {
    return this.setPaused(true);
  }
  resume() {
    return this.setPaused(false);
  }
  toggle() {
    return this.setPaused(!this._paused);
  }
  setPaused(paused) {
    paused = !!paused;
    if (paused === this._paused) return this;
    this._paused = paused;
    this._acc = 0;
    this._emit();
    return this;
  }

  /** Pengali kecepatan simulasi, misalnya 0.5, 1, atau 2. */
  setSpeed(speed) {
    speed = Math.max(0.05, Math.min(8, Number(speed) || 1));
    if (speed === this._speed) return this;
    this._speed = speed;
    this._emit();
    return this;
  }

  /** Set waktu simulasi kembali ke 0 (dipakai saat Ulangi). */
  resetTime() {
    this.time = 0;
    this._acc = 0;
    return this;
  }

  /** Jalankan tepat satu langkah update, berguna saat dijeda. */
  stepOnce() {
    this._safe(() => {
      this.update?.(this.step, this);
      this.time += this.step;
    });
    return this;
  }

  /** Dengarkan perubahan jeda atau kecepatan. Mengembalikan fungsi untuk berhenti mendengar. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }

  _safe(fn) {
    try {
      fn();
      return true;
    } catch (err) {
      this.error = err;
      this.stop();
      if (this.onError) this.onError(err, this);
      else console.error(err);
      return false;
    }
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    if (document.hidden) {
      this._last = null;
      return;
    }
    if (this._last == null) this._last = now;
    const frameDt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    const ok = this._safe(() => {
      if (!this._paused && this.update) {
        this._acc += frameDt * this._speed;
        let n = 0;
        while (this._acc >= this.step && n < this.maxSteps) {
          this.update(this.step, this);
          if (!this._raf) return; // loop dihentikan dari dalam update
          this.time += this.step;
          this._acc -= this.step;
          n++;
        }
        if (n >= this.maxSteps) this._acc = 0;
      }
      this.render?.(this._paused ? 0 : this._acc / this.step, this);
    });
    if (ok) this.frame++;
  }
}
