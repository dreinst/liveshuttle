// Pintasan papan ketik. Tidak aktif saat fokus ada di kolom isian.
const TYPING = new Set(['INPUT', 'TEXTAREA']);
// Tombol yang tetap dipakai pilihan (select) itu sendiri: panah, Enter, Spasi, Tab, Home, End.
const SELECT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Escape']);

export function bindKeys(app) {
  const d = app.disposer;
  // Pada pilihan Kualitas, huruf tidak dipakai untuk mencari pilihan, jadi pintasan tetap jalan
  // (H membuka bantuan, bukan memilih Hemat). Panah dan Enter tetap mengatur pilihannya.
  const typing = (t, key) => t && (TYPING.has(t.tagName) || t.isContentEditable || (t.tagName === 'SELECT' && SELECT_KEYS.has(key)));
  const driveKey = {
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
  };

  d.on(window, 'keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // Kolom range boleh dikendalikan panah, jadi pintasan juga dilewati di sana.
    if (typing(ev.target, ev.key)) return;
    const k = ev.key;
    const code = ev.code;
    if (!app.help.hidden && (k === 'Escape' || k === 'h' || k === 'H' || k === '?')) {
      app.toggleHelp(false);
      ev.preventDefault();
      return;
    }
    if (!app.help.hidden) return;
    if (driveKey[code] && !app.autopilot) {
      app.control.keys[driveKey[code]] = true;
      ev.preventDefault();
      return;
    }
    if (ev.repeat) return;
    const onButton = ev.target && ev.target.tagName === 'BUTTON';
    let handled = true;
    switch (k) {
      case '1':
      case '2':
      case '3':
      case '4':
        app.setCamera(['orbit', 'kejar', 'atas', 'kokpit'][Number(k) - 1]);
        break;
      case 'c':
      case 'C':
        app.cycleCamera();
        break;
      case ' ':
        if (onButton) {
          handled = false;
          break;
        }
        app.togglePause();
        break;
      case 'p':
      case 'P':
        app.togglePause();
        break;
      case '[':
      case '-':
        app.changeSpeed(-1);
        break;
      case ']':
      case '+':
      case '=':
        app.changeSpeed(1);
        break;
      case 'h':
      case 'H':
      case '?':
        app.toggleHelp(true);
        break;
      case 'j':
      case 'J':
        app.jaywalker();
        break;
      case 'o':
      case 'O':
        app.placeObstacle();
        break;
      case 'b':
      case 'B':
        app.emergencyBrake();
        break;
      case 'm':
      case 'M':
        app.toggleAutopilot();
        break;
      case 'l':
      case 'L':
        app.toggleLidar();
        break;
      case 'k':
      case 'K':
        app.toggleBoxes();
        break;
      case 'Escape':
        if (app.scen.clickArmed) app.armClick(false);
        else handled = false;
        break;
      default:
        handled = false;
    }
    // huruf lain di pilihan Kualitas juga tidak boleh diam-diam mengganti pilihan
    if (handled || (ev.target && ev.target.tagName === 'SELECT' && k.length === 1)) ev.preventDefault();
  });

  d.on(window, 'keyup', (ev) => {
    const code = ev.code;
    if (driveKey[code]) app.control.keys[driveKey[code]] = false;
  });

  d.on(window, 'blur', () => {
    for (const key of Object.keys(app.control.keys)) app.control.keys[key] = false;
  });
}
