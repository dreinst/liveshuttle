// Peta rute langsung: satu panel yang memadukan petunjuk belok ala aplikasi navigasi, kartu
// perjalanan ala ojek daring, dan ikon kejadian di jalan. Digambar dengan Canvas 2D dari data OSM
// yang sama dengan kota 3D. Gambar dasar (jalan, taman, gedung) dibuat sekali; rute, halte, ikon,
// dan panah shuttle digambar ulang tiap bingkai. Di kamera Peta rute juga tampil sebagai pita 3D.
import * as THREE from '../vendor/three.bundle.min.js';
import { el, fmt, wrapAngle } from './util.js';
import { fmtDist } from './nav.js';

const K = 1.5; // piksel gambar dasar per meter
const DASH = [7, 11];
const NO_DASH = [];
const ICON = {
  kiri: '<path d="M16 21v-8a4 4 0 0 0-4-4H5M9 5 5 9l4 4"/>',
  kanan: '<path d="M8 21v-8a4 4 0 0 1 4-4h7M15 5l4 4-4 4"/>',
  lurus: '<path d="M12 21V4M6 10l6-6 6 6"/>',
  putar: '<path d="M8 21V10a4 4 0 0 1 8 0v6M12 12l4 4 4-4"/>',
  bundaran: '<circle cx="12" cy="10" r="4.5"/><path d="M12 21v-6.5M15.2 6.8 19 3M15 3h4v4"/>',
  tiba: '<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  manual: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M4 12h6M14 12h6M12 14v6"/>',
};
const INC = { tutup: ['#dc2626', '×'], galian: ['#ea580c', '!'], parkir: ['#7c3aed', 'P'], pejalan: ['#ca8a04', ''] };

export class RouteMap {
  constructor(app) {
    this.app = app;
    this.headingUp = true;
    this.rot = 0;
    this.ver = -1;
    this.drawT = 1;
    this.dash = 0;
    this.T = { cx: 0, cy: 0, z: 1, c: 1, s: 0, ex: 0, ez: 0 };
    this.base = buildBase(app.city.data);

    this.canvas = el('canvas', { class: 's3d-map-canvas', role: 'img', 'aria-label': 'Peta rute: panah toska adalah shuttle, garis biru rute ke halte berikutnya, garis tipis putaran semua halte.' });
    this.ctx = this.canvas.getContext('2d');
    this.bIcon = el('span', { class: 's3d-nav-icon', 'aria-hidden': 'true' });
    this.bText = el('span', { class: 's3d-nav-text' });
    this.bDist = el('span', { class: 's3d-nav-dist' });
    this.banner = el('div', { class: 's3d-nav', role: 'status' }, this.bIcon, el('span', { class: 's3d-nav-main' }, this.bDist, this.bText));
    this.compass = el('button', { type: 'button', class: 's3d-map-btn', 'aria-pressed': 'true', title: 'Arah peta: mengikuti arah shuttle atau utara di atas' }, el('span', { class: 's3d-compass', 'aria-hidden': 'true' }, 'U'));
    this.bigBtn = el('button', { type: 'button', class: 's3d-map-btn', 'aria-pressed': 'false', 'aria-label': 'Perbesar peta', title: 'Perbesar atau perkecil peta' }, el('span', { 'aria-hidden': 'true' }, '⤢'));
    this.tStatus = el('p', { class: 's3d-trip-status' });
    this.tMeta = el('p', { class: 's3d-trip-meta' });
    this.tStops = el('div', { class: 's3d-stops', 'aria-hidden': 'true' });
    this.stopEls = app.city.halte.map((h) => this.tStops.appendChild(el('span', { title: `Halte ${h.name}` })));
    this.root = el(
      'section',
      { class: 's3d-card s3d-map', 'aria-label': 'Peta rute langsung', dataset: { tab: 'peta' } },
      this.banner,
      el('div', { class: 's3d-map-view' }, this.canvas, el('div', { class: 's3d-map-btns' }, this.compass, this.bigBtn)),
      el('div', { class: 's3d-trip' }, this.tStatus, this.tMeta, this.tStops),
    );
    const d = app.disposer;
    d.on(this.compass, 'click', () => {
      this.headingUp = !this.headingUp;
      this.compass.setAttribute('aria-pressed', String(this.headingUp));
    });
    d.on(this.bigBtn, 'click', () => this.setBig(!this.big));
    d.on(this.canvas, 'click', (ev) => {
      if (!app.hud.tool) return;
      const r = this.canvas.getBoundingClientRect();
      const T = this.T;
      const u = (ev.clientX - r.left - T.cx) / T.z;
      const v = (ev.clientY - r.top - T.cy) / T.z;
      app.hud.applyTool(T.ex + T.c * u + T.s * v, T.ez - T.s * u + T.c * v);
    });
    this.ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.dpr = dpr;
    });
    this.ro.observe(this.canvas);
    d.add(() => this.ro.disconnect());

    // pita rute 3D untuk kamera Peta
    this.ribbon = new THREE.Mesh(app.res.add(new THREE.BufferGeometry()), app.res.add(new THREE.MeshBasicMaterial({ color: '#1a73e8', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })));
    this.ribbon.renderOrder = 3;
    this.ribbon.frustumCulled = false;
    app.scene.add(this.ribbon);
  }

  setBig(on) {
    this.big = on;
    this.bigBtn.setAttribute('aria-pressed', String(on));
    this.bigBtn.setAttribute('aria-label', on ? 'Perkecil peta' : 'Perbesar peta');
    this.app.hud.root.dataset.mapBig = String(on);
  }

  buildRibbon(R) {
    const n = R.length / 2;
    const pos = new Float32Array(n * 6);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 2;
      const b = Math.min(n - 1, i + 1) * 2;
      let dx = R[b] - R[a];
      let dz = R[b + 1] - R[a + 1];
      const l = Math.hypot(dx, dz) || 1;
      dx = (dx / l) * 1.1;
      dz = (dz / l) * 1.1;
      pos.set([R[i * 2] - dz, 0.3, R[i * 2 + 1] + dx, R[i * 2] + dz, 0.3, R[i * 2 + 1] - dx], i * 6);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    }
    const g = this.ribbon.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
  }

  /** Gambar peta (tiap bingkai, hanya bila panelnya terlihat). */
  draw(dt) {
    const app = this.app;
    const nav = app.ego.nav;
    const R = nav.route;
    const cum = nav.routeCum;
    if (nav.version !== this.ver) {
      if (this.ver >= 0) this.drawT = 0;
      this.ver = nav.version;
      this.buildRibbon(R);
    }
    this.drawT = Math.min(1, this.drawT + dt / 0.9);
    // bagian rute yang sudah dilalui: indeks titik pertama di depan shuttle
    let k = 0;
    const manual = app.ego.mode === 'manual';
    while (k < cum.length - 1 && cum[k + 1] <= nav.progress) k++;
    this.ribbon.visible = app.cameras.mode === 'peta' && !manual && R.length > 2;
    this.ribbon.geometry.setDrawRange(k * 6, Infinity);
    if (!this.w || !this.root.offsetParent) return;

    const g = this.ctx;
    const e = app.egoPose;
    const T = this.T;
    const target = this.headingUp ? -Math.PI / 2 - e.h : 0;
    this.rot += wrapAngle(target - this.rot) * Math.min(1, dt * 4);
    this.dash = (this.dash - dt * 22) % 18;
    T.z = this.big ? 1.25 : 0.95;
    T.cx = this.w / 2;
    T.cy = this.headingUp ? this.h * 0.66 : this.h / 2;
    T.c = Math.cos(this.rot);
    T.s = Math.sin(this.rot);
    T.ex = e.x;
    T.ez = e.z;
    const z = T.z;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#ece8df';
    g.fillRect(0, 0, this.w, this.h);
    g.translate(T.cx, T.cy);
    g.rotate(this.rot);
    g.scale(z, z);
    g.translate(-e.x, -e.z);
    const B = this.base;
    g.drawImage(B.canvas, B.x, B.z, B.canvas.width / K, B.canvas.height / K);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // seluruh putaran halte (tipis)
    line(g, nav.loop, 0, nav.loop.length / 2, 3 / z, 'rgba(13, 148, 136, 0.45)');
    if (!manual && R.length > 2) {
      const n = R.length / 2;
      line(g, R, 0, k + 2, 5 / z, '#a8adb5');
      const end = k + 1 + Math.ceil((n - k - 1) * this.drawT * this.drawT * (3 - 2 * this.drawT));
      line(g, R, k, end, 8 / z, '#0b4fb3');
      line(g, R, k, end, 5.5 / z, '#1a73e8');
      g.setLineDash(DASH);
      g.lineDashOffset = this.dash;
      line(g, R, k, end, 2 / z, 'rgba(255, 255, 255, 0.85)');
      g.setLineDash(NO_DASH);
    }
    // teks dan ikon digambar tegak di koordinat layar
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.font = '600 10.5px system-ui, sans-serif';
    for (const L of app.city.data.labels) {
      const p = this.toScreen(L.x, L.z);
      if (p.x < -40 || p.y < 0 || p.x > this.w + 40 || p.y > this.h) continue;
      g.fillStyle = L.k === 'campus' ? '#0f766e' : '#4b5563';
      g.strokeText(L.t, p.x, p.y);
      g.fillText(L.t, p.x, p.y);
    }
    const H = app.city.halte;
    g.font = '700 10px system-ui, sans-serif';
    for (let i = 0; i < H.length; i++) {
      const p = this.toScreen(H[i].x, H[i].z);
      const next = i === app.ego.halteIdx && !manual;
      pin(g, p.x, p.y, next ? 9 : 7, next ? '#0f766e' : '#14b8a6', 'H');
    }
    g.font = '800 11px system-ui, sans-serif';
    for (const inc of nav.incidents) {
      const p = this.toScreen(inc.x, inc.z);
      const [col, ch] = INC[inc.kind];
      pin(g, p.x, p.y, 9, col, ch);
      if (!ch) walker(g, p.x, p.y - 12);
    }
    // panah shuttle
    g.translate(T.cx, T.cy);
    g.rotate(this.rot + e.h + Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 8);
    g.lineTo(0, 4);
    g.lineTo(-8, 8);
    g.closePath();
    g.fillStyle = '#0d9488';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.stroke();
    g.fill();
  }

  toScreen(x, z) {
    const T = this.T;
    const dx = x - T.ex;
    const dz = z - T.ez;
    P.x = T.cx + T.z * (T.c * dx - T.s * dz);
    P.y = T.cy + T.z * (T.s * dx + T.c * dz);
    return P;
  }

  /** Teks petunjuk dan kartu perjalanan (dipanggil HUD beberapa kali per detik). */
  updateText() {
    const ego = this.app.ego;
    const nav = ego.nav;
    const manual = ego.mode === 'manual';
    const nx = manual ? null : nav.next();
    const kind = manual ? 'manual' : nx ? nx.kind : 'lurus';
    if (this.iconKind !== kind) {
      this.iconKind = kind;
      this.bIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICON[kind]}</svg>`;
    }
    set(this.bText, manual ? 'Kamu yang mengemudi. Rute ditunda sampai autopilot aktif lagi.' : nx ? nx.text : 'Mencari rute');
    set(this.bDist, nx ? fmtDist(Math.max(0, nx.dist)) : '');
    set(this.tStatus, ego.statusText());
    const eta = Number.isFinite(nav.etaSec) ? `Tiba sekitar ${Math.max(1, Math.round(nav.etaSec / 60))} menit` : 'Waktu tiba belum ada';
    const dist = Number.isFinite(nav.remaining) && !manual ? `, ${fmtDist(nav.remaining)} lagi` : '';
    set(this.tMeta, `${eta}${dist}. ${ego.pax.onboard.length} dari ${ego.pax.capacity} kursi terisi, ${fmt(Math.abs(ego.vs) * 3.6, 0)} km/jam.`);
    this.stopEls.forEach((s, i) => {
      const st = i < ego.halteIdx ? 'lewat' : i === ego.halteIdx ? 'tuju' : '';
      if (s.dataset.st !== st) s.dataset.st = st;
    });
  }
}

const P = { x: 0, y: 0 };

function set(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function line(g, R, i0, i1, w, color) {
  const n = Math.min(i1, R.length / 2);
  if (n - i0 < 2) return;
  g.beginPath();
  g.moveTo(R[i0 * 2], R[i0 * 2 + 1]);
  for (let i = i0 + 1; i < n; i++) g.lineTo(R[i * 2], R[i * 2 + 1]);
  g.lineWidth = w;
  g.strokeStyle = color;
  g.stroke();
}

function pin(g, x, y, r, color, ch) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#fff';
  g.stroke();
  if (ch) {
    g.fillStyle = '#fff';
    g.fillText(ch, x, y + 0.5);
  }
}

function walker(g, x, y) {
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(x, y + 8, 1.8, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x, y + 10);
  g.lineTo(x, y + 14);
  g.moveTo(x - 2.5, y + 17);
  g.lineTo(x, y + 14);
  g.lineTo(x + 2.5, y + 17);
  g.stroke();
}

/** Gambar dasar: latar, area hijau, kampus, gedung, dan jalan dengan garis tepi. */
function buildBase(data) {
  const B = data.meta.bounds;
  const c = document.createElement('canvas');
  c.width = Math.ceil((B.maxX - B.minX) * K);
  c.height = Math.ceil((B.maxZ - B.minZ) * K);
  const g = c.getContext('2d');
  g.fillStyle = '#f1efe9';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(K, 0, 0, K, -B.minX * K, -B.minZ * K);
  const path = (p, close = true) => {
    g.beginPath();
    p.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    if (close) g.closePath();
  };
  for (const a of data.areas) {
    path(a.p);
    g.fillStyle = a.k === 'water' ? '#aad3f5' : a.k === 'campus' ? '#d7f0ea' : a.k === 'farmland' ? '#e6ecc9' : '#cfe8c0';
    g.fill();
    if (a.k === 'campus') {
      g.lineWidth = 2.5;
      g.strokeStyle = '#5ec7b4';
      g.stroke();
    }
  }
  for (const b of data.buildings) {
    path(b.p);
    g.fillStyle = b.k === 'campus' ? '#9ed6ca' : '#e0dad0';
    g.fill();
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const tert = (r) => r.cls === 'tertiary';
  for (const pass of [0, 1]) {
    for (const r of data.roads) {
      path(r.p, false);
      g.lineWidth = r.half * 2 + (pass ? 0 : 1.8);
      g.strokeStyle = pass ? (tert(r) ? '#ffe7a3' : '#ffffff') : tert(r) ? '#e3b95a' : '#cfcac0';
      g.stroke();
    }
    for (const rb of data.roundabouts) {
      g.beginPath();
      g.arc(rb.x, rb.z, rb.r, 0, Math.PI * 2);
      g.lineWidth = rb.w + (pass ? 0 : 1.8);
      g.strokeStyle = pass ? '#ffffff' : '#cfcac0';
      g.stroke();
    }
  }
  g.fillStyle = '#ffffff';
  for (const j of data.junctions) {
    if (!j.poly) continue;
    path(j.poly);
    g.fill();
  }
  g.fillStyle = '#cfe8c0';
  for (const rb of data.roundabouts) {
    g.beginPath();
    g.arc(rb.x, rb.z, Math.max(1, rb.r - rb.w / 2 - 0.3), 0, Math.PI * 2);
    g.fill();
  }
  return { canvas: c, x: B.minX, z: B.minZ };
}
