// Pintasan papan ketik. Tidak aktif saat fokus ada di kolom isian. Setiap pintasan juga punya
// tombol di layar.
import { CAMERA_MODES } from './cameras.js';

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const DRIVE = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };

export function bindKeys(app) {
  const d = app.disposer;
  d.on(window, 'keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (TYPING.has(t.tagName) || t.isContentEditable)) return;
    const k = ev.key;
    const hud = app.hud;
    const dk = DRIVE[k.length === 1 ? k.toLowerCase() : k];
    if (dk && app.ego.mode === 'manual' && hud.help.hidden && hud.about.hidden) {
      app.ego.input[dk] = 1;
      ev.preventDefault();
      return;
    }
    if (k === 'Escape') {
      if (!hud.help.hidden) app.toggleHelp(false);
      else if (!hud.about.hidden) hud.showAbout(false);
      else if (hud.tool) hud.setTool(null);
      else return;
      ev.preventDefault();
      return;
    }
    if (!hud.help.hidden || !hud.about.hidden) {
      if (k === '?') {
        app.toggleHelp(false);
        ev.preventDefault();
      }
      return;
    }
    if (ev.repeat) return;
    let handled = true;
    switch (k) {
      case '1':
      case '2':
      case '3':
      case '4':
        app.setCamera(CAMERA_MODES[Number(k) - 1]);
        break;
      case ' ':
        if (t && t.tagName === 'BUTTON') {
          handled = false;
          break;
        }
        app.togglePause();
        break;
      case '?':
        app.toggleHelp(true);
        break;
      case 'm':
      case 'M':
        app.toggleManual();
        break;
      case 'y':
      case 'Y':
        app.ego.requestCrossing();
        break;
      case 'l':
      case 'L':
        app.sensors.setRays(!app.sensors.rays);
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  });
  d.on(window, 'keyup', (ev) => {
    const dk = DRIVE[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key];
    if (dk) app.ego.input[dk] = 0;
  });
  d.on(window, 'blur', () => Object.assign(app.ego.input, { up: 0, down: 0, left: 0, right: 0 }));
}
