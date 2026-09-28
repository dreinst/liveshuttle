# SimOtonom: spec for the driverless transport tutorial simulator

Project root: `/Users/mcdonny/Downloads/ndur/driverless-sim`

## Goal

A static website (no build step, no framework, no npm dependencies) that teaches how driverless
transport works through guided, interactive simulations. Each lesson pairs short step by step
explanations with a live top-down canvas simulation and small tasks the learner completes by
using the simulation. It will be deployed as plain static files on Vercel.

The audience is Indonesian university students. All user-facing text is Bahasa Indonesia.

## Hard rules for everyone

1. Plain HTML, CSS and modern JavaScript ES modules only. No bundler, no npm packages, no CDN
   scripts. Canvas 2D for the lesson simulations. The one exception is the 3D city simulator,
   which uses Three.js r186 vendored locally at `js/vendor/three.bundle.min.js` (a single ESM
   file exporting everything from `three` plus `OrbitControls`; MIT license next to it). Import
   it with a relative path, only from `js/sim3d/`, so it loads only on the simulator route.
   Everything must work when served by `python3 -m http.server` from the project root.
2. User-facing copy in Bahasa Indonesia, addressed to the reader as "kamu", friendly and clear.
   Never use em dash, en dash, or `--` as punctuation in any prose (UI text, lesson text,
   comments, docs). Use commas, periods, or parentheses instead. Write ranges as "0 sampai 5".
   Avoid AI writing tells: "bukan hanya X, tetapi Y" contrasts, one-line recap closers, forced
   lists of three, bold labels on every item, inflated claims, filler words. Normal Indonesian
   hyphenated words (kendaraan-kendaraan, pelan-pelan) are fine.
3. Numbers shown to the user use Indonesian formatting (decimal comma): use the `fmt()` helper
   from the engine. Units: m, km/jam, m/s, detik.
4. Indonesia drives on the LEFT. Every road scene uses left-hand traffic: vehicles keep to the
   left lane, overtaking happens on the right.
5. Technical content must be correct (SAE J3016 levels, sensor properties, stopping distance
   physics, A*, pure pursuit, PID, Kalman style fusion). When you simplify, simplify honestly and
   say it is a simplification.
6. No console errors or warnings on any route. Simulations pause when the tab is hidden and are
   fully torn down (loops stopped, listeners removed) when the learner leaves a lesson.
7. Responsive: works at 1366x900 desktop and 390x844 mobile. Touch friendly controls (min 40px
   targets). Every keyboard control also has an on-screen button.
8. Accessibility: semantic HTML, labelled controls, visible focus, canvas has `role="img"` and an
   `aria-label`, and a text status line that describes what is happening. Respect
   `prefers-reduced-motion` for decorative animation (the simulations themselves may run).

## File layout

```
index.html              app shell
css/style.css           all shared styles
js/main.js              boot, hash router, layout, progress store
js/engine/*.js          shared simulation engine (see below)
js/lessons/index.js     lesson registry (already written, do not reorder ids)
js/lessons/<id>.js      one module per lesson, default export follows the lesson contract
js/lessons/<id>/*       optional helper files private to one lesson
docs/ENGINE.md          engine API reference (written by the foundation builder)
tests/smoke.py          Playwright smoke test helper (written by the foundation builder)
```

Lesson modules must not edit engine files, `main.js`, `style.css` or other lessons. If a lesson
needs extra styles it exports a `styles` string (the shell injects and removes it) scoped under
`.lesson-<id>`. If a lesson finds an engine bug it works around it locally and reports it.

## Branding

Short name "SimOtonom". Full name "Simulator Kendaraan Otonom". Tagline:
"Belajar cara mobil tanpa pengemudi melihat, berpikir, dan bergerak."
The site teaches the AV pipeline sensing (sensor) → persepsi → perencanaan → kontrol.

## Routes

- `#/` home: name and tagline, a short explanation of what driverless transport is and how to
  use the site, an ambient animated canvas (cars on a small road grid, calm, reduced motion
  aware), a pipeline strip (Sensor → Persepsi → Perencanaan → Kontrol), a prominent card for
  the 3D simulator with two buttons (Mode Tutorial, Mode Bebas), the lesson cards in order with
  progress, a "Mulai belajar" button, and a reset progress button.
- `#/pelajaran/<id>` lesson page.
- `#/simulator/tutorial` and `#/simulator/bebas` the 3D city simulator (`#/simulator` redirects
  to the tutorial). The header nav always has links to Beranda, Simulator 3D and Pelajaran.
- Unknown routes fall back to home.

## Shared CSS variables (defined in css/style.css on :root, used by every page)

`--bg --panel --raised --border --text --muted --accent --accent-ink --warn --danger --ok`
`--kamera --lidar --radar --ultrasonik --radius --radius-sm --shadow --font --mono --header-h`

## 3D simulator mounting contract

`js/sim3d/index.js` exports `async function mount(container, { mode, navigate })` and returns
`{ destroy() }`. `mode` is `'tutorial'` or `'bebas'`; `navigate(hash)` changes route. The shell
creates `container` filling the viewport below the header (height `calc(100dvh - var(--header-h))`),
lazy imports the module on `#/simulator/*`, and calls `destroy()` when leaving. Switching between
tutorial and bebas may be handled inside the module without remounting (update the hash with
`history.replaceState` so the shell does not remount). The module loads its own stylesheet
`css/sim3d.css` by adding a `<link>` on mount and removing it on destroy. If mounting fails
(no WebGL), the module shows a friendly message with a link to the lessons.

## Lesson page layout

Desktop: header bar (logo "SimOtonom" linking home, lesson number and title, overall progress),
then two columns. Left column (about 380px): step card with "Langkah n dari N", step title,
body HTML, task box ("Tugas" plus the task text and a done state), Kembali / Lanjut buttons.
After the last step: the lesson summary and a button to the next lesson. Right column: the
stage (canvas area, with a small HUD overlay and the text status line) and below it the
controls panel. The shell provides standard simulation buttons: Jeda/Lanjutkan, Ulangi (reset),
and speed 0,5x / 1x / 2x. Mobile: single column, stage first, then controls, then step card.

Lanjut is always allowed (learners may skip), but a step only counts as done when its task is
completed. A lesson is complete when all its tasks are done. Progress is stored in
localStorage under `simotonom.progress.v1`.

## Lesson contract

```js
// js/lessons/<id>.js
export default {
  id: 'sensor',
  title: 'Sensor Kendaraan',
  layout: 'sim',            // 'sim' (default) or 'full' (no sim controls, e.g. the quiz)
  intro: '<p>...</p>',
  steps: [
    { title: '...', body: '<p>...</p>', task: { id: 'lidar-on', text: 'Nyalakan LiDAR ...' } },
    { title: '...', body: '<p>...</p>' },        // step without task
  ],
  summary: '<p>...</p><ul>...</ul>',
  styles: '',               // optional, scoped under .lesson-<id>
  mount(ctx) {
    // build the sim inside ctx.stage and its widgets inside ctx.controls
    return {
      onStep(index) {},     // called when the learner changes step (adapt highlights, presets)
      reset() {},           // shell Ulangi button
      destroy() {},         // stop everything, remove listeners
    };
  },
};
```

The exact `ctx` shape is defined by the foundation builder and documented in `docs/ENGINE.md`.
It must at least offer: `stage`, `controls`, `setStatus(text)`, `completeTask(taskId)`,
`isTaskDone(taskId)`, `toast(text)`, `currentStep()`, and a managed loop helper so the shell's
pause / reset / speed buttons work for every lesson without each lesson re-implementing them.

## Engine (js/engine)

The foundation builder writes these; lessons reuse them. Suggested modules:

- `math.js`: vectors, clamp, lerp, angle wrap, seeded RNG (mulberry32), gaussian noise, `fmt()`
  for id-ID number formatting.
- `loop.js`: fixed timestep loop (60 Hz update, render on rAF), pause, speed multiplier,
  auto pause when `document.hidden`.
- `canvas.js`: DPR aware canvas that fills its container and follows resizes, a camera in world
  meters (worldToScreen, screenToWorld, fit to bounds), pointer events in world coordinates.
- `geometry.js`: ray vs segment, ray vs circle, ray vs oriented box, closest point on polyline,
  polyline length and sampling, point in polygon.
- `vehicle.js`: kinematic bicycle model vehicle (x, y, heading, speed, steer, wheelbase, size,
  limits), `step(dt, {accel, steer})`, corners for collision.
- `road.js`: helpers to define straight and curved road segments, lanes as polylines with
  left-hand traffic, intersections, crosswalks, stop lines.
- `draw.js`: consistent drawing of roads, lane markings, cars (ego highlighted), buses/shuttles,
  pedestrians, cyclists, traffic lights, buildings, trees, paths, arrows, labels, sensor cones,
  rays and point clouds.
- `sensors.js`: camera, LiDAR, radar, ultrasonic models with range, field of view, resolution
  and weather effects (cerah, hujan, kabut, malam) producing detections.
- `planning.js`: grid and graph A* and Dijkstra, with a step iterator for animating the search.
- `control.js`: pure pursuit steering and a PID controller.
- `ui.js`: small DOM widget helpers: group, slider (with value and unit), toggle, segmented
  control, button, readout, legend, and a tiny time series chart.
- `theme.js`: shared palette and sizes.

## Visual style

Dark "control room" theme with high contrast and generous spacing.

- UI: background `#0b1220`, panels `#111a2e`, raised `#17223b`, borders `#24314f`, text
  `#e2e8f0`, muted `#94a3b8`, accent teal `#2dd4bf` (ego vehicle, primary buttons), warning
  `#f59e0b`, danger `#ef4444`, success `#22c55e`.
- Canvas: ground `#13261f`, asphalt `#2b3240`, lane markings `#e5e7eb`, center line `#facc15`,
  buildings `#1e293b` with lighter roofs, other cars in muted blues and grays.
- Sensor colors: kamera `#a78bfa`, LiDAR `#22d3ee`, radar `#fbbf24`, ultrasonik `#a3e635`.
- Fonts: system UI stack for text, `ui-monospace` for readouts. No web font downloads.
- Rounded corners 10 to 14px, subtle shadows, clear hierarchy. It should look like a polished
  product, not a homework template.

## Lessons (ids fixed in js/lessons/index.js)

1. `level-otomasi` Level Otomasi (SAE J3016 levels 0 to 5, who drives, ODD, takeover request,
   minimal risk maneuver).
2. `sensor` Sensor Kendaraan (kamera, LiDAR, radar, ultrasonik, weather effects).
3. `persepsi` Persepsi dan Fusi Sensor (raw detections, fusion, tracking, ghost rejection,
   motion prediction).
4. `lokalisasi` Lokalisasi (GPS noise and urban canyon, odometry drift, fusion filter, landmark
   and map matching).
5. `rute` Perencanaan Rute (grid city, A* vs Dijkstra, road closures, congestion cost).
6. `kontrol` Kendali Kemudi dan Kecepatan (pure pursuit lookahead, PID speed, error plots).
7. `keputusan` Pengambilan Keputusan (behavior state machine: traffic light incl. yellow
   dilemma, pedestrian crossing, stalled vehicle overtake on the right).
8. `jarak-aman` Jarak Aman dan Rem Darurat (time gap, ACC, FCW and AEB, stopping distance
   = reaction distance + v^2 / (2 mu g), road conditions, human vs system reaction time).
9. `shuttle` Misi Shuttle Otonom (sandbox: campus road network, halte, passengers, traffic
   lights, pedestrians, road closures with rerouting, mission stats).
10. `kuis` Kuis Akhir (multiple choice across all lessons, feedback with explanations, score,
    retry; layout 'full').

Each simulation lesson has 4 to 6 steps, most with a task that is detected automatically from
the simulation state (for example "ubah cuaca ke kabut lalu nyalakan radar").
