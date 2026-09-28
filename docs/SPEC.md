# LiveShuttle: spec for the driverless transport tutorial simulator

Project root: `/Users/mcdonny/Downloads/ndur/driverless-sim`

## Goal

A static website (no build step, no framework, no npm dependencies) that teaches how driverless
transport works through guided, interactive simulations. Each lesson pairs short step by step
explanations with a live top-down canvas simulation and small tasks the learner completes by
using the simulation. It will be deployed as plain static files on Vercel.

The audience is Indonesian university students. All user-facing text is Bahasa Indonesia.

Everything is grounded in the real surroundings of Universitas Ma Chung and the city of Malang
using OpenStreetMap data (raw files in `data/osm/`, compact files in `js/data/` and
`js/sim3d/data/`): real street and place names, local traffic (angkot, sepeda motor), and honest
labels for anything estimated (lanes, building heights, simulated traffic lights). LiDAR and other
sensor drawings stay calm (no flickering ray lines). The 3D part has one live route map that mixes
Google Maps style turn instructions, a Gojek/Grab style trip card and Waze style incident icons.

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
9. SAFETY RULE (set by the user, non negotiable): in every simulation, 2D and 3D, no vehicle can
   ever run a red light or hit a pedestrian, whatever the learner does (manual driving, full
   throttle, maximum speed, fast forward, bad weather, spawning pedestrians). This is enforced by
   a final safety layer before actuation plus pedestrian gap acceptance, not by luck. Collisions
   with other things (a parked car, a lead car in the braking lesson) may still be shown.
10. Not a copy of the reference: the user once pasted a description of another site
   ("Simulator Kendaraan Otonom"). Our site must not reuse its name, tagline, mode names, panel
   titles, camera set or feature framing. See the list under Branding.
11. Local test server: use `python3 tests/serve.py PORT` (threaded, large accept queue) instead
   of `python3 -m http.server`, which drops connections when many modules load at once.

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

Name "LiveShuttle" (also the GitHub repo name). Tagline:
"Pelajari teknologi transportasi tanpa pengemudi, lalu lihat shuttle otonom beraksi di jalanan
sekitar Universitas Ma Chung." The 3D part is called "Shuttle 3D Ma Chung" and runs on real
OpenStreetMap streets around the campus (attribution "© Kontributor OpenStreetMap" always shown).
The site teaches the chain sensor → persepsi → perencanaan → kendali.

Never use these phrases from the reference anywhere: "Simulator Kendaraan Otonom", "Belajar cara
mobil tanpa pengemudi melihat, berpikir, dan bergerak", "Mode Tutorial", "Mode Bebas",
"Apa yang dilihat mobil", "Objek pembatas", "Uji skenario", "Kota pintar", lampu adaptif as a
feature, the camera set Orbit / Kejar / Atas / Kokpit, key J for pedestrians, the obstacle trio
kerucut / kardus / mobil mogok as a placement tool, the indicator row "TTC, simpangan lajur,
tabrakan, rem darurat, menyalip", "jangkauan deteksi 60 m", default target speed 50 km/jam.
(The 2D lessons may still teach TTC, AEB and sensor ranges as concepts in their own words.)

## Routes

- `#/` home: name and tagline, a short explanation of what driverless transport is and how to
  use the site, an ambient animated canvas (the real Ma Chung map with a shuttle and Malang
  traffic, calm, reduced motion aware), a pipeline strip (Sensor → Persepsi → Perencanaan → Kontrol), a prominent card for
  Shuttle 3D Ma Chung with two buttons (Panduan, Jelajah), the lesson cards in order with
  progress, a "Mulai belajar" button, and a reset progress button.
- `#/pelajaran/<id>` lesson page.
- `#/shuttle-3d/panduan` (guided) and `#/shuttle-3d/jelajah` (free) the 3D simulator
  (`#/shuttle-3d` redirects to panduan; the old `#/simulator/*` hashes redirect too). The header
  nav always has links to Beranda, Shuttle 3D and Pelajaran.
- Unknown routes fall back to home.

## Shared CSS variables (defined in css/style.css on :root, used by every page)

`--bg --panel --raised --border --text --muted --accent --accent-ink --warn --danger --ok`
`--kamera --lidar --radar --ultrasonik --radius --radius-sm --shadow --font --mono --header-h`

## 3D simulator mounting contract

`js/sim3d/index.js` exports `async function mount(container, { mode, navigate })` and returns
`{ destroy() }`. `mode` is `'panduan'` or `'jelajah'`; `navigate(hash)` changes route. The shell
creates `container` filling the viewport below the header (height `calc(100dvh - var(--header-h))`),
lazy imports the module on `#/shuttle-3d/*`, and calls `destroy()` when leaving. Switching between
panduan and jelajah may be handled inside the module without remounting (update the hash with
`history.replaceState` so the shell does not remount). The module loads its own stylesheet
`css/sim3d.css` by adding a `<link>` on mount and removing it on destroy. If mounting fails
(no WebGL), the module shows a friendly message with a link to the lessons.

## Lesson page layout

Desktop: header bar (logo "LiveShuttle" linking home, lesson number and title, overall progress),
then two columns. Left column (about 380px): step card with "Langkah n dari N", step title,
body HTML, task box ("Tugas" plus the task text and a done state), Kembali / Lanjut buttons.
After the last step: the lesson summary and a button to the next lesson. Right column: the
stage (canvas area, with a small HUD overlay and the text status line) and below it the
controls panel. The shell provides standard simulation buttons: Jeda/Lanjutkan, Ulangi (reset),
and speed 0,5x / 1x / 2x. Mobile: single column, stage first, then controls, then step card.

Lanjut is always allowed (learners may skip), but a step only counts as done when its task is
completed. A lesson is complete when all its tasks are done. Progress is stored in
localStorage under `liveshuttle.progress.v1`.

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
   minimal risk maneuver) on a trip from Universitas Ma Chung to Alun-alun Merdeka.
2. `sensor` Sensor Kendaraan (kamera, LiDAR, radar, ultrasonik, weather effects) on Jalan
   Karangampel Timur north of the campus.
3. `persepsi` Persepsi dan Fusi Sensor (raw detections, fusion, tracking, ghost rejection,
   motion prediction) on Jalan Karangampel Timur with mixed Malang traffic.
4. `lokalisasi` Lokalisasi (GPS noise and urban canyon, odometry drift, fusion filter, landmark
   and map matching with an HD map) around the Kayutangan block north of Alun-alun Merdeka.
5. `rute` Perencanaan Rute (A* vs Dijkstra on the real Malang road graph from Ma Chung to the city
   centre, road closures, congestion cost).
6. `kontrol` Kendali Kemudi dan Kecepatan (pure pursuit lookahead, PID speed, error plots) on the
   Villa Puncak Tidar boulevard with a roundabout at each end.
7. `keputusan` Pengambilan Keputusan (behavior state machine: traffic light incl. yellow
   dilemma, pedestrian crossing, overtaking a stopped angkot on the right) on Jalan Kawi, Malang.
8. `jarak-aman` Jarak Aman dan Rem Darurat (time gap, ACC, FCW and AEB, stopping distance
   = reaction distance + v^2 / (2 mu g), road conditions, human vs system reaction time) on Jalan
   Soekarno-Hatta and a toll road.
9. `shuttle` Misi Shuttle Otonom (sandbox on the OSM streets around Ma Chung with the same five
   halte as Shuttle 3D: passengers, simulated traffic lights, pedestrians, road closures with
   rerouting, mission stats).
10. `kuis` Kuis Akhir (multiple choice across all lessons and Shuttle 3D Ma Chung, feedback with
    explanations, score, retry; layout 'full').

Each simulation lesson has 4 to 6 steps, most with a task that is detected automatically from
the simulation state (for example "ubah cuaca ke kabut lalu nyalakan radar").

## Shuttle 3D Ma Chung (js/sim3d)

A 3D city built from `js/sim3d/data/machung-city.json` (about 1 km x 1 km of OSM around the campus,
format in `docs/MAPDATA.md`). LiveShuttle, a 6 m electric shuttle with 12 seats, drives a loop of
five halte (Gerbang Ma Chung, Jalan Karangampel Timur, Jalan Puncak Tidar, Villa Puncak Lawu,
Jalan Raya Candi V) among cars, MPVs, pickups, angkot, motorbikes and pedestrians.

- Modes: Panduan (ten guided steps with automatic tasks, ending in a button to Jelajah) and
  Jelajah (free). Cameras Kabin, Drone, Sinematik and Peta (keys 1 to 4).
- HUD: Lapisan otonomi strip (Indra, Pahami, Rencana, Gerak with live sentences), Perisai
  keselamatan panel (the two counters, interventions, log), Kendali dan alat panel, one live route
  map (turn banner, trip card, flowing route line, incident icons, reroute animation, expand,
  compass), time control (pause, 1x, 2x, 4x) and the OSM attribution. Mobile uses a bottom sheet
  with tabs.
- Tools: take the wheel (M, arrows or WASD, on-screen pad), crossing pedestrian (Y), LiDAR rays
  (L, off by default), sensor view Tenang (default) or Detail, parked vehicle, roadworks, close a
  road (click the 3D view or the map), call passengers, traffic density, speed limit 10 to 40 km/jam.
- Weather changes by itself every 5 minutes of simulated time (Cerah, Hujan, Kabut, Malam) with a
  countdown. There is no weather control. Rain lowers road friction, fog shortens camera and LiDAR
  range, and the shuttle caps its own speed per weather and explains why.
- Traffic lights near the campus are simulated (OSM has none there) and labelled as such.
- Safety rule 9 is enforced by `shield.js` and `egoshield.js` for every vehicle every 1/60 s tick,
  with pedestrian gap acceptance in `pedestrians.js`. `window.__sim3d.invariants` exposes the
  counters `redLight` and `pedContact`, which must stay 0. A pedestrian within 0,6 m of a vehicle body
  never moves closer to it (every step and every edge change is checked). `tests/qa-akhir_safety3d.py`
  attacks the rule in all four weathers and checks it with its own geometric monitor.

