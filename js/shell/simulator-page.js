// Rute #/shuttle-3d/panduan dan #/shuttle-3d/jelajah: memuat js/sim3d/index.js secara malas
// sesuai kontrak di docs/SPEC.md. Bila modul belum ada atau gagal, tampilkan pesan ramah.
//
// Pindah mode tanpa memasang ulang (kedua mode memakai kunci rute yang sama di main.js):
// - Rute berganti (misalnya tautan di kepala halaman): shell memanggil instance.setMode(mode) bila
//   modul menyediakannya. Bila tidak, modul diharapkan mendengar hashchange sendiri (seperti
//   js/sim3d/index.js). Shell hanya memperbarui judul, kepala halaman, dan simMode.
// - Modul berganti mode sendiri (tombol di dalam simulator, lalu history.replaceState): modul boleh
//   memanggil onModeChange(mode) dari opsi mount. Shell juga memeriksa hash secara berkala, jadi
//   judul tetap benar walaupun modul tidak memanggilnya.

import { icon } from '../engine/icons.js';

const MODE_NAME = { panduan: 'Panduan', jelajah: 'Jelajah' };

function isMissingModule(err) {
  return err instanceof TypeError && /fetch|import|module/i.test(String(err.message));
}

export function renderSimulator(main, mode, hooks) {
  const host = document.createElement('div');
  host.className = 'sim3d-host';
  host.innerHTML = `<div class="sim3d-loading"><span class="spinner" aria-hidden="true"></span><span>Memuat Shuttle 3D Ma Chung...</span></div>`;
  const title = document.createElement('h1');
  title.className = 'visually-hidden';
  title.tabIndex = -1;
  main.append(title, host);

  let destroyed = false;
  let instance = null;
  let mod = null;
  let mountedMode = null; // mode yang sedang terpasang di modul
  let wanted = mode; // mode yang diminta rute terakhir
  let busy = false;

  const showMode = (m) => {
    title.textContent = `Shuttle 3D Ma Chung, ${MODE_NAME[m] || MODE_NAME.panduan}`;
  };
  showMode(mode);
  hooks.setState({ simStatus: 'loading', simMode: mode });

  const fallback = (heading, text) => {
    host.innerHTML = `
      <div class="sim3d-fallback">
        <div class="fallback-card">
          <div class="fallback-icon">${icon('cube')}</div>
          <p class="eyebrow">Shuttle 3D Ma Chung</p>
          <h2 class="fallback-title">${heading}</h2>
          <p class="muted">${text}</p>
          <div class="fallback-actions">
            <a class="btn btn-primary" href="#/pelajaran">${icon('book')}<span>Buka pelajaran</span></a>
            <a class="btn btn-ghost" href="#/">${icon('home')}<span>Beranda</span></a>
          </div>
          <p class="fallback-note muted">Koneksi terputus? <button type="button" class="link-btn" data-act="reload">Muat ulang halaman</button></p>
        </div>
      </div>`;
    host.querySelector('[data-act="reload"]').addEventListener('click', () => location.reload());
  };

  // dipanggil modul bila ia berganti mode sendiri
  const onModeChange = (m) => {
    if (destroyed || !MODE_NAME[m]) return;
    mountedMode = m;
    wanted = m;
    showMode(m);
    hooks.onModeChange?.(m);
  };

  async function mountWith(m) {
    host.textContent = '';
    mountedMode = m;
    showMode(m);
    hooks.setState({ simStatus: 'loading', simMode: m });
    try {
      const inst = await mod.mount(host, {
        mode: m,
        navigate: (hash) => {
          location.hash = hash;
        },
        onModeChange,
      });
      if (destroyed) {
        inst?.destroy?.();
        return;
      }
      instance = inst || {};
      hooks.setState({ simStatus: 'ready' });
    } catch (err) {
      console.error(err);
      if (destroyed) return;
      fallback('Shuttle 3D tidak bisa dijalankan', 'Browser atau perangkat ini mungkin tidak mendukung WebGL. Kamu tetap bisa belajar lewat pelajaran interaktif.');
      hooks.setState({ simStatus: 'error' });
    }
  }

  // Samakan mode terpasang dengan mode yang diminta rute. Pasang ulang hanya bila rute berganti
  // saat modul masih dipasang (modul belum sempat mendengar hashchange) dan modul tidak punya setMode.
  async function sync() {
    if (busy || destroyed || !mod || !instance || wanted === mountedMode) return;
    const m = wanted;
    if (typeof instance.setMode === 'function') {
      try {
        instance.setMode(m);
      } catch (err) {
        console.error(err);
      }
      onModeChange(m);
      return;
    }
    busy = true;
    try {
      instance.destroy?.();
    } catch (err) {
      console.error(err);
    }
    instance = null;
    await mountWith(m);
    busy = false;
    if (!destroyed) {
      hooks.onModeChange?.(m);
      sync();
    }
  }

  (async () => {
    try {
      mod = await import('../sim3d/index.js');
    } catch (err) {
      if (destroyed) return;
      if (!isMissingModule(err)) console.error(err);
      fallback('Shuttle 3D sedang disiapkan', 'Bagian ini belum bisa dibuka. Sambil menunggu, kamu bisa belajar lewat simulasi 2D di setiap pelajaran.');
      hooks.setState({ simStatus: 'missing' });
      return;
    }
    if (destroyed) return;
    if (typeof mod?.mount !== 'function') {
      console.error('js/sim3d/index.js harus mengekspor fungsi mount(container, { mode, navigate }).');
      fallback('Shuttle 3D belum siap', 'Modul simulator belum lengkap. Coba lagi nanti.');
      hooks.setState({ simStatus: 'error' });
      return;
    }
    busy = true;
    await mountWith(wanted);
    busy = false;
    sync();
  })();

  // mode yang diganti modul lewat history.replaceState tidak memicu hashchange: periksa hash sesekali
  const HASH_MODE = /^#\/shuttle-3d\/(panduan|jelajah)$/;
  const poll = setInterval(() => {
    const m = HASH_MODE.exec(location.hash)?.[1];
    if (m && instance && !busy && m !== mountedMode) onModeChange(m);
  }, 500);

  return {
    focusTarget: () => title,
    /** Dipanggil router saat hash berganti antara panduan dan jelajah. */
    setMode(m) {
      if (!MODE_NAME[m] || destroyed) return;
      wanted = m;
      showMode(m);
      hooks.onModeChange?.(m);
      if (!instance || busy) return; // masih memuat: sync() menyusul setelah modul terpasang
      if (typeof instance.setMode === 'function') {
        try {
          instance.setMode(m);
        } catch (err) {
          console.error(err);
        }
      }
      // tanpa setMode, modul berganti mode sendiri lewat pendengar hashchange-nya
      mountedMode = m;
    },
    destroy() {
      destroyed = true;
      clearInterval(poll);
      try {
        instance?.destroy?.();
      } catch (err) {
        console.error(err);
      }
      title.remove();
      host.remove();
    },
  };
}
