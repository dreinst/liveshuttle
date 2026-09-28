// Rute #/simulator/tutorial dan #/simulator/bebas: memuat js/sim3d/index.js secara malas
// sesuai kontrak di docs/SPEC.md. Bila modul belum ada atau gagal, tampilkan pesan ramah.

import { icon } from '../engine/icons.js';

function isMissingModule(err) {
  return err instanceof TypeError && /fetch|import|module/i.test(String(err.message));
}

export function renderSimulator(main, mode, hooks) {
  const host = document.createElement('div');
  host.className = 'sim3d-host';
  host.innerHTML = `<div class="sim3d-loading"><span class="spinner" aria-hidden="true"></span><span>Memuat Simulator Kota 3D...</span></div>`;
  const title = document.createElement('h1');
  title.className = 'visually-hidden';
  title.tabIndex = -1;
  title.textContent = `Simulator Kota 3D, ${mode === 'bebas' ? 'Mode Bebas' : 'Mode Tutorial'}`;
  main.append(title, host);
  hooks.setState({ simStatus: 'loading', simMode: mode });

  let destroyed = false;
  let instance = null;

  const fallback = (heading, text) => {
    host.innerHTML = `
      <div class="sim3d-fallback">
        <div class="fallback-card">
          <div class="fallback-icon">${icon('cube')}</div>
          <p class="eyebrow">Simulator Kota 3D</p>
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

  (async () => {
    let mod;
    try {
      mod = await import('../sim3d/index.js');
    } catch (err) {
      if (destroyed) return;
      if (!isMissingModule(err)) console.error(err);
      fallback('Simulator 3D sedang disiapkan', 'Bagian ini belum bisa dibuka. Sambil menunggu, kamu bisa belajar lewat simulasi 2D di setiap pelajaran.');
      hooks.setState({ simStatus: 'missing' });
      return;
    }
    if (destroyed) return;
    if (typeof mod?.mount !== 'function') {
      console.error('js/sim3d/index.js harus mengekspor fungsi mount(container, { mode, navigate }).');
      fallback('Simulator 3D belum siap', 'Modul simulator belum lengkap. Coba lagi nanti.');
      hooks.setState({ simStatus: 'error' });
      return;
    }
    host.textContent = '';
    try {
      const inst = await mod.mount(host, {
        mode,
        navigate: (hash) => {
          location.hash = hash;
        },
      });
      if (destroyed) {
        inst?.destroy?.();
        return;
      }
      instance = inst;
      hooks.setState({ simStatus: 'ready' });
    } catch (err) {
      console.error(err);
      if (destroyed) return;
      fallback('Simulator 3D tidak bisa dijalankan', 'Browser atau perangkat ini mungkin tidak mendukung WebGL. Kamu tetap bisa belajar lewat pelajaran interaktif.');
      hooks.setState({ simStatus: 'error' });
    }
  })();

  return {
    focusTarget: () => title,
    destroy() {
      destroyed = true;
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
