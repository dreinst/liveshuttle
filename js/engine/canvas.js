// View: kanvas 2D yang mengisi wadahnya, tajam di layar retina, dengan kamera dalam meter.
//
//   const view = ctx.createView({ bounds: { minX: -10, minY: -8, maxX: 60, maxY: 8 } });
//   // di render():
//   const g = view.begin();      // bersihkan layar, transformasi dunia (meter) aktif
//   g.fillRect(0, 0, 4, 2);      // menggambar dalam meter
//   view.screen();               // pindah ke piksel CSS untuk teks atau HUD
//
// Kamera: camera.x/y = titik dunia di tengah layar, camera.scale = piksel CSS per meter.

import { COLORS } from './theme.js';

export class View {
  /**
   * @param {HTMLElement} container wadah dengan ukuran tetap (position relatif). Kanvas mengisi penuh.
   * @param {object} [opts]
   * @param {object|Function} [opts.bounds] area dunia yang harus terlihat {minX, minY, maxX, maxY},
   *        atau fungsi (view) => bounds yang dievaluasi ulang setiap ukuran berubah
   * @param {number} [opts.padding=16] jarak tepi dalam piksel saat fit
   * @param {string|null} [opts.background] warna latar saat begin(); null = transparan
   * @param {string} [opts.label] teks aria-label kanvas
   * @param {number} [opts.maxDpr=2] batas device pixel ratio demi performa
   */
  constructor(container, opts = {}) {
    const { bounds = null, padding = 16, background = COLORS.ground, label = 'Simulasi', maxDpr = 2 } = opts;
    this.container = container;
    this.background = background;
    this.maxDpr = maxDpr;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sim-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', label);
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = 0; // piksel CSS
    this.height = 0;
    this.dpr = 1;
    this.camera = { x: 0, y: 0, scale: 10 };
    this.pointer = null; // posisi penunjuk terakhir {x, y, sx, sy} atau null bila di luar
    this._fit = bounds;
    this._padding = padding;
    this._resizeFns = new Set();
    this._handlers = new Set();
    this._abort = new AbortController();
    this._down = null;
    this._destroyed = false;

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._bindPointer();
    this.resize();
  }

  // ---------- ukuran dan kamera ----------

  /** Rasio lebar / tinggi area kanvas. */
  get aspect() {
    return this.height > 0 ? this.width / this.height : 1;
  }

  resize() {
    if (this._destroyed) return;
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this._fit) this._applyFit();
    for (const fn of this._resizeFns) fn(this);
  }

  /** Dengarkan perubahan ukuran. Mengembalikan fungsi untuk berhenti. */
  onResize(fn) {
    this._resizeFns.add(fn);
    return () => this._resizeFns.delete(fn);
  }

  /**
   * Atur kamera agar area `bounds` terlihat utuh. Diingat dan diterapkan ulang saat ukuran berubah.
   * bounds boleh berupa fungsi (view) => bounds, misalnya untuk memilih area berbeda di layar tegak.
   * fit(null) mematikan penyesuaian otomatis.
   */
  fit(bounds, padding = this._padding) {
    this._fit = bounds;
    this._padding = padding;
    if (bounds) this._applyFit();
    return this;
  }

  _applyFit() {
    const b = typeof this._fit === 'function' ? this._fit(this) : this._fit;
    if (!b) return;
    const pad = this._padding;
    const aw = Math.max(20, this.width - 2 * pad);
    const ah = Math.max(20, this.height - 2 * pad);
    const bw = Math.max(1e-3, b.maxX - b.minX);
    const bh = Math.max(1e-3, b.maxY - b.minY);
    this.camera.scale = Math.min(aw / bw, ah / bh);
    this.camera.x = (b.minX + b.maxX) / 2;
    this.camera.y = (b.minY + b.maxY) / 2;
  }

  /** Pusatkan kamera ke titik dunia (skala tetap). */
  centerOn(x, y) {
    this.camera.x = x;
    this.camera.y = y;
    return this;
  }

  /** Ubah skala kamera (piksel per meter). */
  setScale(scale) {
    this.camera.scale = Math.max(0.05, scale);
    return this;
  }

  /** Ubah panjang n piksel CSS menjadi meter. Pakai untuk lebar garis yang konstan di layar. */
  px(n = 1) {
    return n / this.camera.scale;
  }

  worldToScreen(x, y) {
    const { camera } = this;
    return {
      x: (x - camera.x) * camera.scale + this.width / 2,
      y: (y - camera.y) * camera.scale + this.height / 2,
    };
  }

  screenToWorld(sx, sy) {
    const { camera } = this;
    return {
      x: (sx - this.width / 2) / camera.scale + camera.x,
      y: (sy - this.height / 2) / camera.scale + camera.y,
    };
  }

  /** Area dunia yang sedang terlihat. */
  visibleBounds() {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.width, this.height);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  // ---------- menggambar ----------

  /**
   * Mulai frame baru: bersihkan kanvas (dengan warna latar) lalu aktifkan transformasi dunia.
   * @param {string|null} [background] warna latar, null untuk transparan
   * @returns {CanvasRenderingContext2D}
   */
  begin(background = this.background) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.setLineDash([]);
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.world();
    return g;
  }

  /** Aktifkan transformasi dunia (satuan meter). */
  world() {
    const { camera, dpr } = this;
    const s = camera.scale * dpr;
    this.ctx.setTransform(s, 0, 0, s, (this.width / 2 - camera.x * camera.scale) * dpr, (this.height / 2 - camera.y * camera.scale) * dpr);
    return this.ctx;
  }

  /** Aktifkan transformasi layar (satuan piksel CSS, titik 0,0 di kiri atas). */
  screen() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return this.ctx;
  }

  /** Perbarui aria-label kanvas (deskripsi singkat isi simulasi). */
  setLabel(text) {
    this.canvas.setAttribute('aria-label', text);
  }

  setCursor(cursor) {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ---------- penunjuk (mouse, sentuh, pena) ----------

  /**
   * Daftarkan penangan penunjuk. Semua event membawa koordinat dunia.
   * handlers: { down(e), move(e), up(e), tap(e), drag(e), leave() }
   * e = { x, y, sx, sy, pointerType, hitRadius, startX, startY, dx, dy, original }
   *   x, y      posisi dunia (m);  sx, sy posisi layar (px)
   *   hitRadius toleransi klik dalam meter (lebih besar untuk sentuhan)
   * tap: tekan dan lepas tanpa banyak bergeser. drag: bergerak sambil ditekan.
   * Bila ada drag, sentuhan di kanvas tidak menggulir halaman (touch-action: none).
   * Mengembalikan fungsi untuk melepas penangan.
   */
  onPointer(handlers) {
    this._handlers.add(handlers);
    this._updateTouchAction();
    return () => {
      this._handlers.delete(handlers);
      this._updateTouchAction();
    };
  }

  _updateTouchAction() {
    const wantsDrag = [...this._handlers].some((h) => h.drag);
    this.canvas.style.touchAction = wantsDrag ? 'none' : 'manipulation';
  }

  _event(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const w = this.screenToWorld(sx, sy);
    const touch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
    return {
      x: w.x,
      y: w.y,
      sx,
      sy,
      pointerType: ev.pointerType,
      hitRadius: this.px(touch ? 22 : 10),
      original: ev,
    };
  }

  _emitPointer(name, e) {
    for (const h of this._handlers) h[name]?.(e);
  }

  _bindPointer() {
    const c = this.canvas;
    const signal = this._abort.signal;
    c.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button > 0) return;
        const e = this._event(ev);
        this._down = { sx: e.sx, sy: e.sy, x: e.x, y: e.y, time: performance.now(), id: ev.pointerId, moved: false };
        if ([...this._handlers].some((h) => h.drag)) c.setPointerCapture?.(ev.pointerId);
        this._emitPointer('down', e);
      },
      { signal },
    );
    c.addEventListener(
      'pointermove',
      (ev) => {
        const e = this._event(ev);
        this.pointer = { x: e.x, y: e.y, sx: e.sx, sy: e.sy };
        const d = this._down;
        if (d && d.id === ev.pointerId) {
          if (Math.hypot(e.sx - d.sx, e.sy - d.sy) > 6) d.moved = true;
          if (d.moved) this._emitPointer('drag', { ...e, startX: d.x, startY: d.y, dx: e.x - d.x, dy: e.y - d.y });
        }
        this._emitPointer('move', e);
      },
      { signal },
    );
    const finish = (ev, cancelled) => {
      const d = this._down;
      if (!d || d.id !== ev.pointerId) return;
      this._down = null;
      const e = this._event(ev);
      this._emitPointer('up', e);
      if (!cancelled && !d.moved && performance.now() - d.time < 700) this._emitPointer('tap', e);
    };
    c.addEventListener('pointerup', (ev) => finish(ev, false), { signal });
    c.addEventListener('pointercancel', (ev) => finish(ev, true), { signal });
    c.addEventListener(
      'pointerleave',
      () => {
        this.pointer = null;
        this._emitPointer('leave', null);
      },
      { signal },
    );
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._ro.disconnect();
    this._abort.abort();
    this._handlers.clear();
    this._resizeFns.clear();
    this.canvas.remove();
  }
}
