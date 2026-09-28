# LiveShuttle engine and lesson API

This is the reference for everyone who writes a lesson. Read `docs/SPEC.md` first for the rules
(language, writing style, left-hand traffic, safety rule, accessibility). Then read
`js/lessons/sensor.js` and `js/lessons/sensor/scene.js`: that lesson is the worked example of the
basics below. Section 8 describes the Malang toolkit (real OpenStreetMap maps, Malang traffic,
calm LiDAR drawing) that every lesson should now use to set its scene in and around Malang.

Lesson authors must not edit `js/engine/*`, `js/main.js`, `js/shell/*` or `css/style.css`. If you
find an engine bug, work around it inside your lesson and report it.

Contents

1. Conventions
2. Lesson module contract
3. The `ctx` object
4. Engine modules
5. How to write a lesson (walkthrough of sensor.js)
6. Testing (`tests/serve.py`, `tests/smoke.py`, `window.__simotonom`)
7. Pitfalls checklist
8. Malang toolkit: OSM maps (`osm2d.js`), data files, Malang traffic, calm LiDAR
9. Shell routes and the 3D mounting contract
10. What changed in this update (for existing lessons)

---

## 1. Conventions

**World coordinates.** Meters. `x` to the right, `y` DOWN (same as the screen). Headings are radians,
`0` faces `+x`, and they grow clockwise on screen. Forward vector `(cos h, sin h)`. The left side of
a vehicle is `(sin h, -cos h)`. Consequences:

- a positive steering angle turns RIGHT (clockwise on screen);
- `math.toLocal(pose, p)` returns `{ x: forward, y: right }` (positive `y` is to the right);
- `geometry.offsetPolyline(points, d)` with positive `d` offsets to the LEFT of travel.

**Left-hand traffic.** Vehicles keep left. Heading east (`h = 0`) the travel lane is on the north
side (smaller `y`). Heading south (`h = PI/2`) the travel lane is on the east side (larger `x`).
Overtaking happens on the right. Tight turns are left turns. `road.makeRoad` already places lanes
this way.

**Units and numbers.** Speeds inside the engine are m/s. Show km/jam to the learner with
`fmtSpeed()` or `fmt(msToKmh(v), 0, 'km/jam')`. Every number shown to the learner goes through
`fmt()` (decimal comma, thousands dot). Units: `m`, `km/jam`, `m/s`, `detik`.

**Time.** Simulation time advances only inside `update(dt)`; `dt` is fixed (1/60 s of simulated
time) and the shell's speed buttons change how many updates run per frame, never `dt` itself.

---

## 2. Lesson module contract

```js
// js/lessons/<id>.js
export default {
  id: 'sensor',                 // must equal the id in js/lessons/index.js
  title: 'Sensor Kendaraan',
  layout: 'sim',                // 'sim' (default) or 'full'
  intro: '<p>...</p>',          // shown above step 1 (sim) or under the title (full)
  steps: [
    { title: '...', body: '<p>...</p>', task: { id: 'kamera-lampu', text: 'Nyalakan ...' } },
    { title: '...', body: '<p>...</p>' },            // a step without task
  ],
  summary: '<p>...</p>',       // shown after the last step
  styles: `.lesson-sensor .x { ... }`,              // optional, every selector starts with .lesson-<id>
  mount(ctx) {
    // build everything, then return the instance:
    return {
      onStep(index) {},         // optional, called on every step change (0 .. steps.length - 1)
      reset() {},               // optional, shell "Ulangi" button
      destroy() {},             // optional, only for things NOT created through ctx
    };
  },
};
```

Lifecycle, in order:

1. The shell imports the module lazily when the learner opens `#/pelajaran/<id>`. A missing or
   broken module shows the friendly "Pelajaran ini sedang disiapkan" page.
2. The shell builds the layout, injects `styles` in a `<style data-lesson="<id>">` tag and records
   the task ids for progress.
3. `mount(ctx)` runs once. It may return a Promise; the shell waits for it.
4. `onStep(i)` runs right after mount with the step the learner last visited (stored per lesson),
   and again every time the step changes (Kembali, Lanjut, the step dots, summary links).
   The summary screen (`ctx.currentStep() === steps.length`) does NOT call `onStep`.
5. `reset()` runs when the learner presses Ulangi. After it, every managed loop gets
   `resetTime()`, is restarted if it had stopped because of an error, and is un-paused.
6. `destroy()` runs when the learner leaves. After it the shell destroys every managed loop and
   view, aborts `ctx.signal`, runs `ctx.onCleanup` callbacks, releases `ctx.keys` bindings and
   removes the injected styles.

Rules for the texts:

- Everything is trusted HTML written by you. Allowed helpers inside `body`, `intro`, `summary`
  and `task.text`: `<p> <ul> <ol> <li> <strong> <em> <code> <kbd>`,
  `<span class="chip chip-kamera|chip-lidar|chip-radar|chip-ultrasonik|chip-ok|chip-warn|chip-danger|chip-accent">`,
  `<p class="note">` (callout), `<p class="note is-warn">`, `<div class="formula">` (monospace block).
- Keep `task.text` to one or two sentences that say exactly what to do.

Progress rules (enforced by the shell):

- Lanjut is always allowed. A step counts as done only when its task is completed.
- A lesson is complete when all of its tasks are done. A lesson without any task is complete
  when the learner reaches the summary, or when you call `ctx.completeLesson()`.
- Progress lives in `localStorage` under `liveshuttle.progress.v1`. Old progress stored under
  `simotonom.progress.v1` is moved to the new key once, automatically.

`layout: 'full'` (for example the quiz): no Jeda/Ulangi/speed bar and no fixed stage height.
`ctx.stage` is a normal block that grows with its content, `ctx.controls` sits below it and is
hidden while empty. If `steps` is empty the page becomes a single centered column; otherwise the
step card is shown as in `sim`. `ctx.createLoop` and `ctx.createView` still work (give the view a
container with a height, for example a div inside `ctx.stage` with `style.height = '320px'` and
`position: relative`).

---

## 3. The `ctx` object

| Member | Description |
| --- | --- |
| `ctx.lesson` | Frozen `{ id, title, number, steps: [{ title, taskId }] }`. `taskId` is `null` for steps without task. |
| `ctx.stage` | The simulation area (`position: relative`, fixed height in `sim` layout). Canvases from `ctx.createView` go here. Any overlay you add yourself must be `position: absolute`. |
| `ctx.hud` | Absolutely positioned flex row on top of the stage (top left). Put `ui.hudChip()` items here. Pointer events pass through. |
| `ctx.controls` | Grid container under the stage. Add `ui.group()` sections to it. Columns are `minmax(250px, 1fr)`; a group with `wide: true` spans the full row. Single column on mobile. |
| `ctx.root` | The lesson page element (has class `lesson-<id>`). |
| `ctx.signal` | `AbortSignal` aborted on teardown. Pass it to `addEventListener(..., { signal })` or `fetch`. |
| `ctx.reducedMotion` | `true` when the user prefers reduced motion. Simulations may still run; skip purely decorative animation. |
| `ctx.isMobile` | Getter, `true` at widths up to 900px. Prefer `view.aspect` for layout decisions inside the canvas. |
| `ctx.stepCount` | Number of steps. |
| `ctx.currentStep()` | Current step index. Equals `stepCount` on the summary screen. |
| `ctx.goToStep(i)` | Change step programmatically (rarely needed). |
| `ctx.lastStep`, `ctx.setLastStep(i)` | The step the learner lands on when they come back (0 to `stepCount - 1`). `setLastStep` stores it without changing the current step, for example a quiz that should reopen on its question step while the learner is on the summary. |
| `ctx.setStatus(text)` | Updates the status line under the stage (`role="status"`, `aria-live="polite"`). Identical text is ignored, so calling it often is cheap. Keep it short: it is clamped to 2 lines on desktop and 3 on mobile. Write whole sentences. |
| `ctx.toast(text, { tone, duration })` | Small notification at the bottom. `tone`: `'info'` (default), `'ok'`, `'warn'`. Use sparingly; the shell already toasts task completion. Toasts never catch clicks (`pointer-events: none`), so they cannot block the controls under them. |
| `ctx.completeTask(taskId, { anyStep = false, toast = true })` | Marks a task done and returns `true` if it was newly completed. By default it returns `false` (and does nothing) when the task is already done or when it does not belong to the CURRENT step. `anyStep: true` also accepts tasks of other steps (a quiz graded at the end), `toast: false` skips the shell toast. The step dots, the progress bar and the summary list update in every case. Unknown ids log one console warning. |
| `ctx.isTaskDone(taskId)` | Boolean. |
| `ctx.completeLesson()` | Marks the lesson complete without tasks (quiz style). |
| `ctx.createLoop({ update, render, step })` | Creates, registers and starts a `Loop` (section 4.4). The shell's Jeda/Lanjutkan, Ulangi and 0,5x/1x/2x buttons drive every managed loop. Returns the `Loop`. If `update` or `render` throws, the loop stops, the error is logged, and the stage shows a message until Ulangi. |
| `ctx.createView(opts)` | Creates a `View` (section 4.5) inside `ctx.stage`. Destroyed automatically. |
| `ctx.keys(bindings)` | Keyboard shortcuts on `window`, released automatically. See `ui.bindKeys`. Every key must also have an on-screen button. |
| `ctx.listen(target, type, fn, opts)` | `addEventListener` that is removed automatically. Returns a remover. |
| `ctx.onCleanup(fn)` | Run `fn` during teardown. |
| `ctx.paused`, `ctx.speed` | Current shell state (getters). |
| `ctx.pause()`, `ctx.resume()` | Pause or resume every managed loop and update the shell buttons (for example pause on a collision). Calling `loop.pause()` on a managed loop has the same effect. |
| `ctx.rng(seed)` | New seeded `Rng`. Use seeds so that Ulangi reproduces the same scenario. |
| `ctx.loadMap(id)` | `osm2d.loadMap(id, { signal: ctx.signal })` without importing `osm2d.js` yourself (section 8). Rejects with `AbortError` when the learner leaves while it loads; the shell ignores that rejection if it comes out of an async `mount`. |

---

## 4. Engine modules

Import from single modules (`'../engine/sensors.js'`) or from `'../engine/index.js'`, which
re-exports everything and exposes the widgets as `ui` (`import { ui } from '../engine/index.js'`).

### 4.1 `theme.js`

- `COLORS`: UI colors (`bg panel raised border text muted accent accentInk warn danger ok`),
  canvas colors (`ground groundAlt asphalt asphaltDark asphaltLight sidewalk curb laneMark
  centerLine building roof roofEdge tree treeLight wall wallDark`), actors (`ego egoDark
  vehicles[6] bus shuttle pedestrian cyclist cone`), Malang traffic (`angkot` light blue,
  `motor`, `helmets[6]`, `hijab[6]`, `halte`), sensors (`kamera lidar radar ultrasonik`), lights
  (`lightRed lightYellow lightGreen lightOff`), paths (`path pathAlt target`).
- `SENSOR_COLORS`, `SIZES` (`laneWidth 3.5`, `car {4.5, 1.8, wheelbase 2.7}`, `suv`, `bus`,
  `shuttle`, `cyclist`, `pedestrian {radius 0.35}`, `sidewalk`, and for Malang traffic
  `city` (same as `cityCar`) `{3.7, 1.65}`, `mpv {4.4, 1.73}`, `angkot {4.1, 1.62}`, `motor {1.9, 0.72}`,
  `minibus {7.5, 2.2}`), `FONT`, `MONO`. The keys match the `kind` names of `drawVehicle`, so
  `new PathAgent({ kind: 'angkot', ... })` gets the right size automatically.
- `withAlpha(hex, alpha)` returns an `rgba()` string.

### 4.2 `math.js`

- Scalars: `clamp lerp invLerp remap smoothstep approach(current, target, maxDelta) round(v, digits)`.
- Angles: `degToRad radToDeg wrapAngle(a)` (to `(-PI, PI]`), `angleDiff(a, b)` (shortest `a - b`), `TAU`.
- Units: `kmhToMs msToKmh`, `G = 9.81`.
- Vectors (plain `{x, y}`, never mutated): `vec add sub scale dot cross length dist dist2 normalize
  rotate fromAngle angleOf leftOf rightOf lerpVec toLocal(pose, p) toWorld(pose, p)`.
- Random: `mulberry32(seed)` returns `() => [0, 1)`; `gaussian(rand, mean, sd)`;
  `new Rng(seed)` with `next() range(min, max) int(min, max) chance(p) pick(arr) gaussian(mean, sd) reseed(seed)`.
- Formatting (Indonesian): `fmt(value, digits = 0, unit = '')` gives `fmt(12.345, 1, 'm')` = `"12,3 m"`,
  `fmt(1500)` = `"1.500"`, `NaN` or `null` gives `"-"`. `fmtSigned` adds `+` to positives.
  Shortcuts: `fmtSpeed(ms, digits = 0)` (km/jam), `fmtDist(m, digits = 1)`, `fmtTime(s, digits = 1)` (detik),
  `fmtPercent(ratio, digits = 0)`.

### 4.3 `geometry.js`

Shapes understood by ray casts and hit tests: box `{ x, y, heading, length, width }` (center,
`length` along heading), circle `{ x, y, radius }`, polygon `{ points: [...] }` (treated as static;
its centroid is cached). `shapeType(obj)` tells which. `Vehicle`, `PathAgent` and `TrafficLight`
instances are valid shapes.

- Rays (direction should be a unit vector, result is the distance or `Infinity`):
  `raySegment(ox, oy, dx, dy, ax, ay, bx, by)`, `rayCircle(ox, oy, dx, dy, cx, cy, r)`,
  `rayBox(ox, oy, dx, dy, box)`, `rayPolygon(ox, oy, dx, dy, points)`, `rayShape(ox, oy, dx, dy, obj)`.
  A ray starting inside a circle or box returns `0`.
- `castRay(objects, ox, oy, dx, dy, maxRange, { ignore, filter })` returns the nearest
  `{ t, x, y, object }` or `null`. `ignore` is an object or an id. Uses a bounding circle
  broadphase; you may set `obj._br` (bounding radius) on static objects to skip recomputing it.
- `lineOfSight(objects, ax, ay, bx, by, { target, ignore, filter })` boolean.
- Boxes: `boxCorners(box)` (front-left, front-right, rear-right, rear-left), `pointInBox(px, py, box, margin)`,
  `boxesOverlap(a, b, margin)` (SAT), `distanceToBox`, `distanceToShape(px, py, obj)`, `hitTest(px, py, obj, margin)`.
- Polygons and segments: `pointInPolygon polygonCentroid closestPointOnSegment(px, py, ax, ay, bx, by)
  segmentIntersection(a, b, c, d)`.
- Polylines: `polylineLength cumulativeLengths arcPoints(cx, cy, r, a0, a1, segments)
  bezierPoints(p0, p1, p2, p3 = null, segments)` (quadratic when `p3` is null),
  `joinPolylines(...parts)`, `offsetPolyline(points, offset)`, `resamplePolyline(points, spacing)`.
- `new Path(points, { closed })`: `length`, `points`, `cum`; `sample(s)` gives `{ x, y, heading, s, index }`
  (s is clamped, or wrapped when closed); `closest(px, py, hintS, window)` gives
  `{ x, y, s, dist, heading, lateral, index }` with `lateral > 0` meaning the point is LEFT of the path;
  `headingError(heading, s)`; `segmentHeading(i)`. Zero length segments (duplicate points) no longer
  report heading 0: they take the heading of the nearest segment that has a length. On closed paths
  `closest` ignores `hintS` and scans every segment (always correct, a bit slower on very long loops).
- `shapeCenter(obj)`: centroid for polygons (cached in `obj._centroid`), otherwise `obj` itself.

### 4.4 `loop.js`

`new Loop({ update, render, step = 1/60, speed = 1, paused = false, maxSteps = 8, onError })`.
Inside lessons always use `ctx.createLoop` instead.

- `update(dt, loop)` runs zero or more times per frame with the fixed `dt`. `render(alpha, loop)`
  runs once per animation frame, also while paused, so UI changes are always visible.
- `loop.time` simulated seconds since start or `resetTime()`, `loop.frame`, `loop.paused`,
  `loop.speed`, `loop.running`.
- `start() stop() destroy() pause() resume() toggle() setPaused(b) setSpeed(x) resetTime() stepOnce() onChange(fn)`.
- Hidden tabs: no frames run and no time accumulates; there is no time jump when the tab returns.
- `Loop.activeCount` counts running loops on the page (used by the leak test).

### 4.5 `canvas.js` (`View`)

`ctx.createView({ bounds, padding = 16, background = COLORS.ground, label, maxDpr = 2 })`.
The canvas fills the stage, is sharp on high DPR screens, has `role="img"` and follows resizes.

- Camera: `view.camera = { x, y, scale }` (world point at the center, CSS pixels per meter).
- `view.fit(bounds, padding)`: show the whole `{ minX, minY, maxX, maxY }` area. It is remembered
  and re-applied on every resize. `bounds` may be a function `(view) => bounds`, which is the easy
  way to use a different area on portrait phones: `(v) => (v.aspect < 1.4 ? narrow : wide)`.
  `fit(null)` turns auto fitting off. `centerOn(x, y)` and `setScale(pxPerMeter)` move the camera manually.
- `view.width`, `view.height` (CSS px), `view.aspect`, `view.dpr`, `view.visibleBounds()`,
  `worldToScreen(x, y)`, `screenToWorld(sx, sy)`, `px(n)` (n CSS pixels in meters, use it for line widths).
- Drawing: `const g = view.begin(background)` clears and sets the world transform (meters).
  `view.world()` and `view.screen()` switch transforms (screen = CSS pixels, origin top left).
- `view.onPointer({ down, move, up, tap, drag, leave })`: events carry `{ x, y }` in meters,
  `{ sx, sy }` in pixels, `pointerType`, `hitRadius` (tap tolerance in meters, larger for touch),
  and for `drag` also `startX startY dx dy`. When a `drag` handler exists the canvas stops page
  scrolling under the finger (`touch-action: none`); otherwise touch scrolling still works.
- `view.setCursor(css)`, `view.setLabel(text)` (aria-label), `view.onResize(fn)`, `view.pointer`.

### 4.6 `vehicle.js`

`new Vehicle({ id, kind = 'car', x, y, heading, speed, length, width, wheelbase, maxSteer = 0.6,
steerRate = 1.2, maxAccel = 3, maxBrake = 8, maxSpeed = 25, maxReverse = 0, color, ego, label })`

- `(x, y)` is the body center. Kinematic bicycle model at the center of mass (`lr = wheelbase / 2`).
- `step(dt, { accel = 0, brake = 0, steer })`: `accel` is signed (m/s², along the heading),
  `brake >= 0` pushes speed toward 0 without crossing it, `steer` is the requested wheel angle
  (rate limited by `steerRate`, clamped by `maxSteer`). Speed is clamped to `[-maxReverse, maxSpeed]`,
  so vehicles cannot reverse unless you set `maxReverse`.
- `accelToward(targetSpeed, gain = 1.5)`, `setPose(x, y, heading)` (also stops it),
  `brakingDistance(decel)`, getters `kmh vx vy`, `forward() rearAxle() frontAxle() front() rear() corners()`,
  fields `accel braking odometer steer`.

`new PathAgent({ path, kind = 'car', s = 0, speed = 0, cruise = 8, accel = 2, decel = 4, loop = false,
length, width, radius, color, label, id })`

- Moves along a `Path` (or point array). `kind: 'pedestrian'` or a `radius` makes it a circle.
- `step(dt, targetSpeed = cruise)` approaches the target with `accel` / `decel`. At the end of the
  path it stops and sets `done = true`, or jumps back to `s = 0` when `loop` is true (keep both
  ends off screen). `setPath(path, s)`, `setS(s)`, `remaining`, pose fields `x y heading vx vy speed braking`.

### 4.7 `traffic.js`

- `new TrafficLight({ id, x, y, heading, state = 'red', radius = 0.25, label })`: `heading` is the
  direction the lamp faces (toward the approaching traffic). `kind = 'trafficLight'`, `selfLit = true`,
  `timeLeft`, `isGreen`.
- `new SignalPlan([{ lights: [...], green: 12 }, ...], { yellow = 3, allRed = 1.5, offset = 0 })`:
  phases rotate green, yellow, all red. `update(time)` sets every light's `state` and `timeLeft`.
  `phaseIndex`, `phaseTime`, `cycle`, `timeInPhase(i)`.
- `speedToStop(distance, decel)` = `sqrt(2 a d)`.
- `followingSpeed(gap, leaderSpeed, { cruise, minGap = 2.5, timeGap = 1.2, decel = 3, strict = false })`.
  Honest note: with the default the steady following gap is `minGap + 0.5 * v * timeGap` (half the
  time gap, kept for the existing lessons). Pass `strict: true` for `minGap + v * timeGap`.
- `shouldStopForYellow(distance, speed, comfortDecel)`.
- `laneTargetSpeed(agent, stops, { leaderGap, leaderSpeed, decel = 3, margin = 0.8, timeGap, strict })`: target
  speed for a background `PathAgent` that has stop lines `[{ s, light }]` on its path and an
  optional leader. On a closed path, pass stops that are already behind the agent as `s + path.length`
  (see `js/shell/ambient.js`).

### 4.8 `road.js`

- `makeRoad({ id, points, lanesPerDir = 1, laneWidth = 3.5, twoWay = true, sidewalk = 0, trimStart = 0, trimEnd = 0, closed = false })`
  returns `{ id, points, path, length, width, laneWidth, lanesPerDir, lanesTotal, twoWay, sidewalk,
  closed, lanes, leftEdge, rightEdge, polygon, sidewalkPolygon, markings }`. `closed: true` makes a
  loop (test track): lanes, edges and markings become closed rings and lane paths are closed `Path`s.
  `lanes[i] = { id, dir, index, offset, points, path }`. `dir = 1` follows the point order and lies
  LEFT of the center line; `dir = -1` runs the other way. `index 0` is the leftmost (curb) lane.
  `trimStart` and `trimEnd` leave the ends without markings (where the road enters an intersection).
- `straightRoad({ from, to, ...same options })`, `getLane(road, dir, index)`, `slicePolyline(points, s0, s1)`.
- `intersection({ id, x, y, width, height })`, `crosswalk({ x, y, heading, length, width = 3 })`
  (`heading` is the walking direction), `stopLine({ x, y, heading, length })` (`heading` is the
  driving direction), `connector(p0, h0, p1, h1, { tension, segments })` smooth turn path.

### 4.9 `draw.js`

All functions take the canvas context `g` in WORLD transform. Pass `view` when you want sizes in
screen pixels (`width` options are pixels then) or a minimum on-screen size (`minPx`).

- Helpers: `mix lighten darken roundRectPath polygonPath polylinePath fillBox rectBox(x0, y0, x1, y1, extra)`.
- Background: `drawGround(g, view, { color, grid })`, `drawGrid(g, view, { spacing, color })`.
- Roads: `drawRoad(g, road, opts)` = `drawSidewalk` + `drawRoadSurface` + `drawRoadMarkings`
  (when several roads meet, draw all sidewalks, then all surfaces and intersections, then all
  markings), `drawIntersection`, `drawCrosswalk(g, cw, { alpha })`, `drawStopLine`,
  `drawLine(g, pts, { color, width, view, dash, alpha })`.
- Actors: `drawCar(g, car, { color, ego, braking, highlight, headlights, alpha, view, minPx, variant })` (ego gets the
  teal body and glow; `variant`: `'sedan'` default, `'city'`, `'mpv'`), `drawBus(g, bus, { braking, code, minPx, view })`,
  `drawShuttle(g, s, { ego, braking, minPx, view })` (now with brake lights),
  `drawPedestrian(g, p, { phase, view, minPx = 9, variant, accent })`, `drawCyclist(g, c, { view, minPx = 15 })`.
  `minPx` on cars, buses and shuttles scales the vehicle up so it is at least that many pixels long.
  Malang traffic (angkot, sepeda motor, city car, MPV, halte sign, 3D style traffic light) is in section 8.3.
- Infrastructure: `drawTrafficLight(g, light, { view, minPx = 26, glow, alpha })`, `drawSpeedSign(g, { x, y, text }, { view })`,
  `drawBuilding(g, box)`, `drawTree(g, x, y, r)`, `drawWall(g, box)`, `drawCone(g, { x, y }, { view })`,
  `drawHalte(g, box)`.
- Paths and markers: `drawPath(g, pts, { color, width, view, dash, arrows })` (`arrows` = spacing in m),
  `drawArrow(g, from, to, { view })`, `drawRing(g, x, y, r, { color, width, view, dash, fill })`, `drawMarker(g, x, y, { view })`.
- Text: `drawLabel(g, view, x, y, text, { color, bg, size, dx, dy = -18, align, mono, offscreen })` draws a pill in
  screen pixels at a world point (default 18 px above it). A label whose world point is OFF screen is
  now hidden (`offscreen: 'hide'`, the default). Pass `offscreen: 'clamp'` for the old behavior
  (pinned to the edge). A label whose point is visible but whose pill crosses the edge is still
  shifted inside. When several labels can overlap use
  `const labels = createLabelLayer(); labels.add(x, y, text, opts); ... labels.draw(g, view)` once at
  the end of `render()`; overlapping labels are nudged up or down. Extra per label options:
  `priority` (higher is placed first, default 0, ties keep insertion order), `nudge: 'both' | 'up' | 'down' | 'none'`,
  `maxNudge` (steps, default 3), `optional: true` (skip the label when there is no free spot).
  The layer also has `size` and `clear()`.
- `drawScaleBar(g, view)` (bottom left, picks a round length).
- Sensors: `drawSensorCone(g, origin, heading, fov, range, color, { view, fillAlpha, strokeAlpha })`
  (full circle when `fov >= 2 PI`), `drawRays(g, origin, points, color, { view, alpha, every })`,
  `drawPointCloud(g, points, color, { view, size })`, `drawBracketBox(g, obj, color, { view, pad })`.
  For LiDAR use the calm helpers of section 8.4 instead of `drawRays`: the user found flickering ray
  lines distracting.
- Weather: `drawWeather(g, view, weather, time, { lights })` overlays `'hujan'` (streaks),
  `'kabut'` (veil) or `'malam'` (darkness with light sources cut out:
  `{ type: 'cone', x, y, heading, fov, range }` or `{ type: 'point', x, y, radius }`). Draw it after
  the world and before sensor visuals so the sensor overlays stay readable.

### 4.10 `sensors.js`

Honest 2D models. Every detection keeps `targetId` and `target` (the true object) so the teaching
UI can show ground truth; treat them as an answer key, not as something the sensor knows.

- `WEATHER` (`{ cerah, hujan, kabut, malam }` with `label`), `WEATHER_IDS`,
  `WEATHER_EFFECTS[type][weather]` (`range litRange noise dropout clutter confidence`),
  `weatherEffect(type, weather)`, `RADAR_REFLECTIVITY[kind]` (range multiplier per object kind),
  `SENSOR_DEFAULTS` (in-sim ranges: kamera 65 m, 90 deg; LiDAR 45 m, 360 deg, 720 rays, 10 Hz;
  radar 90 m, 24 deg; ultrasonik 5 m, 60 deg). The ranges are shortened so they fit the screen; say so in your text.
- `new Sensor(type, { id, mount: { forward, left, yaw }, enabled, ...overrides })`;
  `pose(vehicle)`, `effectiveRange(weather, target)`, `sense(vehicle, objects, { weather, rng, time })`
  returns `{ sensorId, type, time, pose, range, detections, points? , nearest? }`.
- Detection fields: `sensor sensorId targetId target kind range trueRange bearing x y`, plus
  kamera: `kind` (only the camera classifies), `label`, `confidence`, `rangeSd`, `color`
  (`'red' | 'yellow' | 'green'` for a traffic light facing the camera, else `null`), `text` (signs);
  LiDAR: `points` (hits on that object) and the reading's `points: [{ x, y, range, angle, targetId, clutter? }]`;
  radar: `relSpeed` (m/s along the line of sight, negative = approaching), `trueRelSpeed`, `merged`,
  `ghost` (only when `ghostRate > 0`); ultrasonik: `hitX hitY`, reading `nearest`.
- Objects can opt out of a sensor type with a flag, for example `{ lidar: false }`, or out of all
  sensors with `sensorIgnore: true`. `selfLit: true` objects stay visible to the camera at night.
- Plain polygons `{ points }` without `x, y` now work as sensor targets (their centroid is used).
  Before this fix they were silently skipped by LiDAR and ultrasonic. OSM buildings from
  `osm2d.js` also carry `x, y` (centroid), a string `id` and `kind: 'building'`, so
  `map.buildingsNear(x, y, r)` can go straight into `SensorRig.update()`.
- `ultrasonicArray(vehicle)` (8 sensors, groups `'depan'` and `'belakang'`),
  `standardSensors(vehicle, overrides)` (kamera, lidar, radar and the 8 ultrasonic sensors).
- `new SensorRig(vehicle, sensors, { seed })`: `update(dt, objects, weather)` scans each sensor at its
  own `rate`; `scanNow(objects, weather)` (use it after a change while paused); `setEnabled(idOrTypeOrGroup, on)`;
  `isEnabled`; `select`; `get(id)`; `reading(id)`; `detections(idOrTypeOrGroup)`; `detectedIds(...)`; `clear()`.

### 4.11 `planning.js`

- `PriorityQueue` (`push(item, priority, tie = 0) pop() size peekPriority()`; equal priorities pop the
  smaller `tie` first).
- `new GridMap({ cols, rows, cellSize = 1, originX = 0, originY = 0, diagonal = false })`: nodes are
  cell indices; `index(col, row) cell(i) inBounds setBlocked(col, row, b) isBlocked setCost(col, row, c)
  toWorld(i) fromWorld(x, y) neighbors(i) heuristic(a, b)`. Diagonal moves never cut corners.
- `new Graph()`: `addNode(id, { x, y })`, `addEdge(a, b, { cost, twoWay = true, multiplier = 1, data })`,
  `edge(a, b)`, `setBlocked(a, b, blocked, twoWay)`, `setMultiplier(a, b, m, twoWay)` (congestion),
  `neighbors`, `heuristic` (straight line, admissible while cost >= length), `allEdges()`.
- `createSearch(space, start, goal, { algorithm: 'astar' | 'dijkstra', heuristic, weight, tieBreak })` returns a
  search you can animate: call `step()` a few times per frame, or iterate `for (const node of search.steps())`
  (a generator that yields every expanded node); read `open closed current g cameFrom expanded done
  found path cost`, `pathTo(node)`; `run(maxSteps)`. `tieBreak: 'g'` expands, among nodes with equal
  f, the one with the larger g first (closer to the goal). Routes stay optimal; on grids with many
  equally short routes A* then expands far fewer nodes than Dijkstra.
- `findPath(space, start, goal, opts)` gives `{ found, path, cost, expanded }`.

### 4.12 `control.js`

- `purePursuit(vehicle, path, { lookahead = 6, gain = 0, hintS, target = 'arc' })` returns
  `{ steer, target, alpha, s, ld, crossTrack }` with `delta = atan(2 L sin(alpha) / ld)` measured from
  the rear axle; `ld = lookahead + gain * speed`. `vehicle` may also be a plain pose
  `{ x, y, heading, speed, wheelbase, maxSteer }` (for example an estimated pose from localization);
  the rear axle is then `wheelbase / 2` behind `(x, y)`. `target: 'circle'` uses the classic
  circle intersection (first path point at straight distance `ld`), better on tight curves;
  the default `'arc'` takes the point `ld` meters further along the path.
- `crossTrackError(x, y, path, hintS)`: positive when the point is RIGHT of the path.
- `new PID({ kp, ki, kd, min, max, integralLimit, derivativeFilter, derivativeOnMeasurement })`:
  `update(error, dt, measured)`, `reset()`, fields `terms { p, i, d }`, `integral`, `output`.
  Anti-windup stops integrating while saturated. With `derivativeOnMeasurement: true` and the measured
  value passed as third argument, D uses `-d(measured)/dt`, so a setpoint step gives no derivative kick.

### 4.13 `ui.js` (widgets)

Every widget appends itself to `parent` and returns handles. No global listeners, so removing the
DOM is enough. Styling comes from `css/style.css`.

- `el(tag, attrs, ...children)` tiny hyperscript (`class text html style dataset on<event>`,
  `style` accepts CSS variables such as `{ '--c': COLORS.radar }`). `uniqueId(prefix)`.
- `group(parent, { title, hint, wide, className })` returns the section element.
- `slider(parent, { label, min, max, step, value, unit, digits, format, hint, onInput })`
  gives `{ el, input, value, set(v, silent = true), setDisabled, setHint(text), setLabel(text), setRange(min, max, step) }`.
  The range input is 40 px tall (touch target); the visible track stays thin.
- `toggle(parent, { label, checked, color, hint, onChange })` gives `{ el, checked, set(on, silent = true), setHint(text), setDisabled }`.
- `segmented(parent, { label, ariaLabel, options: [{ value, label, icon }], value, onChange })`
  gives `{ el, value, set(v, silent = true), setDisabled }` (radio group with arrow key navigation,
  buttons 40 px tall). After a mouse or touch click the button gives up focus, so the arrow keys go
  back to your `ctx.keys` bindings; keyboard users who Tab into the group keep arrow navigation.
  The old workaround (blurring `.seg-btn` yourself) is no longer needed but does no harm.
- `button(parent, { label, onClick, variant: 'primary' | 'secondary' | 'ghost' | 'danger', icon, kbd, title, small })` returns the button.
- `holdButton(parent, { label, icon, kbd, variant, onChange(active) })` gives `{ el, active, setActive, setDisabled, setLabel }`;
  active while pressed by mouse, touch, Space or Enter. Pair it with `ctx.keys` by calling `setActive`.
  `setDisabled(true)` releases a held button first (so `onChange(false)` fires).
- `buttonRow(parent, { className })`, `readoutGrid(parent)`,
  `readout(parent, { label, value, color, big })` gives `{ el, set(text), setTone('' | 'ok' | 'warn' | 'danger' | 'off') }`.
- `legend(parent, [{ color, label, shape: 'dot' | 'line' | 'square' }])`.
- `dataTable(parent, { columns: [{ key, label, html, align, className, rowHeader }], rows, caption, empty })`
  gives `{ el, table, setRows(rows) }`. Cell values are text or `{ html }`; a row may have `_class`.
  `setRows` only touches the DOM when the content changed.
- `note(parent, html, { tone: 'info' | 'warn' | 'ok' })` returns the callout element (its text lives in the inner `div`).
  The element also has `node.setTone(tone)` and `node.setHtml(html)`.
- `hudChip(ctx.hud, { label, color })` gives `{ el, set(text), show(bool), setTone(tone), setLabel(text), setColor(css) }`.
  `setLabel` also works on a chip created without a label.
- `timeChart(parent, { label, series: [{ label, color }], span = 10, min, max, unit, digits, height, scale })`
  gives `{ el, push(t, ...values), clear(), draw(), setRange(min, max) }`; redraws itself once per frame after `push`.
  Push `null` or `NaN` for a series that is switched off: the line now breaks there instead of
  joining the gap with a straight line. `scale: 'log'` plots log10 (values <= 0 are gaps). Automatic
  ranges only look at the visible window.
- `bindKeys(bindings, { target })` (used by `ctx.keys`): keys are `KeyboardEvent.key` values, letters in
  lower case; a value is either `(e) => {}` (key down) or `{ down(e), up(e) }`. Auto repeat is ignored,
  keys are ignored while typing in inputs or with Ctrl/Alt/Meta, and held keys are released when the window loses focus.

### 4.14 `icons.js`

`icon(name, label = '')` returns inline SVG markup sized `1em` in `currentColor`. `ICON_NAMES` lists
the names (`play pause reset chevronLeft chevronRight chevronDown arrowUp arrowDown arrowLeft arrowRight
check close menu info alert home book cube car eye sensor brain route steering target bolt sparkle lock gauge trash hand`).

---

## 5. How to write a lesson (walkthrough of `sensor.js`)

1. **Split model and lesson.** Put the world (roads, actors, `update`, `draw`) in
   `js/lessons/<id>/scene.js` and keep `js/lessons/<id>.js` for the texts, the controls, task
   detection and the glue. `sensor/scene.js` builds a dead-end street, a signal plan, paths for
   the other road users and exposes `update(dt, time)`, `draw(g, { view, night })` and `reset()`.
2. **Create the view with portrait-aware bounds.**
   `ctx.createView({ bounds: (v) => (v.aspect < 1.4 ? narrowBounds : wideBounds) })`.
   The stage is about 900 by 540 px on a 1366 px desktop and about 358 by 400 px on a phone.
3. **One managed loop.** `update(dt)` advances the model and the sensors; `render()` draws.
   Read `loop.time` for the simulation clock. Never use `setInterval` or your own
   `requestAnimationFrame`.
4. **Draw order.** World, then `drawWeather`, then sensor overlays, then selection, then
   `labels.draw(g, view)`, then `drawScaleBar`.
5. **Panels.** Build `ui.group`s in `ctx.controls`. Refresh DOM (tables, readouts, HUD chips, status)
   from `render()` at most about 8 times per second (sensor.js uses `performance.now()`), not every
   update step. Because `render()` also runs while paused, panels stay correct after a click on a
   paused simulation. When a control changes something while paused, re-run what the panel
   depends on (sensor.js calls `rig.scanNow()`).
6. **Tasks.** Keep a map `taskId -> { hold, test }`. Only check the task of the current step
   (`ctx.lesson.steps[ctx.currentStep()].taskId`), require the condition to hold for a short time,
   then call `ctx.completeTask(id)`. The shell ignores tasks of other steps anyway.
7. **Step presets.** `onStep(i)` puts the simulation in a state where the task needs a real action
   (sensor.js switches the relevant sensor OFF so the learner has to switch it on) and resets hold
   timers. Update the UI widgets together with the model (`toggle.set`, `segmented.set`).
8. **reset().** Restore the scenario (positions, timers, random seeds), keep the learner's choices
   such as toggles, and refresh the panels.
9. **destroy().** Usually empty. Everything created through `ctx` is cleaned up for you.
10. **Input.** Every keyboard shortcut has a button (`ui.holdButton` + `ctx.keys`). Canvas clicks use
    `view.onPointer({ tap })` with `e.hitRadius`; also offer another way to pick things (sensor.js lets
    you pick objects from the table).
11. **Status line.** Describe the state in one or two short sentences with `ctx.setStatus()`.
    Also update `view.setLabel()` if the scene changes meaningfully.
12. **Styles.** Only when needed, via the `styles` export, every selector prefixed with `.lesson-<id>`.

Writing checklist: Bahasa Indonesia, address the learner as "kamu", short sentences, no em dash,
en dash or double hyphen in prose, ranges as "0 sampai 5", numbers through `fmt()`, simplifications
stated honestly. Before finishing, run `python3 tests/foundation_dashcheck.py js/lessons/<id>.js js/lessons/<id>` and fix every hit in prose.

---

## 6. Testing

Serve the project on your own port with the threaded test server (the plain `http.server` drops
connections when many modules load at once) and run the smoke test:

```
python3 tests/serve.py 8123
python3 tests/smoke.py --port 8123 --route "#/pelajaran/<id>" --out tests/shots/<name>/<id>-desktop
python3 tests/smoke.py --port 8123 --route "#/pelajaran/<id>" --out tests/shots/<name>/<id>-mobile --mobile
```

`tests/situs_smoke_all.py` runs the smoke test over every route (home, all lessons, both 3D modes)
on desktop and mobile, including the old `#/simulator/*` redirects (`PORT=8123 python3 tests/situs_smoke_all.py`).
`tests/situs_gallery.html` shows every Malang toolkit primitive (maps, routes, vehicles, calm LiDAR,
widgets) on one page, and `tests/situs_actors.html` shows the Malang road users close up and at lesson
scale (a two lane road with 3D style traffic lights). `tests/situs_example.html` runs the code examples
of section 8 (an animated A* search on the Ma Chung map and a shuttle that follows a route with calm
LiDAR) with a small stand-in `ctx`; copy from it when you start.

`tests/smoke.py` options:

| Option | Meaning |
| --- | --- |
| `--port P` (required) | Port of the running static server. `--host` defaults to `127.0.0.1`. |
| `--route "#/..."` | Hash route to open (default `#/`). |
| `--out PATH` (required) | Screenshot path prefix; `.png` is appended unless present. Folders are created. |
| `--mobile` | 390 by 844 viewport, touch, `device_scale_factor = 2`. Default is 1366 by 900. |
| `--wait-ms N` | Wait after load before checking (default 2500). |
| `--full-page` | Full page screenshot. |
| `--webgl` | Software WebGL flags (automatic for `#/shuttle-3d` and the old `#/simulator` routes). |
| `--ignore REGEX` | Ignore matching console messages (repeatable), for example `--ignore "404"` while another lesson module does not exist yet. |
| `--allow-warnings` | Do not fail on console warnings. |
| `--min-variance X` | Blank canvas threshold (default 12). |

It collects console errors and warnings plus page errors, checks that the largest visible canvas
is not blank (pixel variance of an element screenshot), saves the screenshot and prints a JSON
summary that includes the `window.__simotonom` snapshot. Exit code 0 means no problems.
Driver messages containing `GPU stall due to ReadPixels` are ignored automatically, because the
test itself triggers them when it reads a WebGL canvas. A lesson route whose module does not exist
yet logs a 404 from the browser; that one is expected until the module is written.

`window.__simotonom` (read only, the name is kept for the tests) for your own Playwright scripts:
`route routeName lessonId lessonStatus ('loading' | 'ready' | 'missing' | 'error') stepIndex stepCount
completedTasks paused speed simStatus simMode activeLoops`.

Useful selectors: `.step-nav .btn-primary` (Lanjut), `.step-dot[data-go="3"]`,
`[data-act="pause"]`, `[data-act="reset"]`, `.speed-wrap .seg-btn`, `.ctl-toggle`, `.seg-btn`,
`.btn-hold`, `.sim-canvas`. Toasts no longer catch clicks, so a normal `click()` works even while a
toast is visible. The Dijeda badge (`.stage-badge`) sits in the top right corner of the stage, or just below the HUD chips when they reach that corner. See `tests/foundation_sensor_qa.py` for a
complete UI walkthrough (all tasks, pause, speed, reset, repeated navigation leak check) and
`tests/foundation_gallery.html` for every drawing primitive and widget on one page.

---

## 7. Pitfalls checklist

- No console errors or warnings. `completeTask` with an unknown id logs a warning.
- Do not attach listeners to `window` or `document` yourself; use `ctx.keys`, `ctx.listen` or `ctx.signal`.
- Do not keep references to DOM outside your lesson or to `ctx` after `destroy()`.
- Keep the status text short, it is clamped to 2 lines on desktop and 3 on mobile.
- `drawLabel` and label layers draw in screen space; call them after world drawing.
- `PathAgent` with `loop: true` teleports from the end to the start; keep both ends off screen.
- Polygons used as sensor targets are assumed static (their centroid is cached).
- `Vehicle` cannot reverse unless `maxReverse > 0`.
- The fixed stage height is set by the shell. Choose bounds for both wide and narrow stages instead of changing it.
- Test desktop 1366 by 900 and mobile 390 by 844, and look at the screenshots yourself.
- LiDAR: never draw one line per ray. Use `createLidarTrail`, `drawSoftPoints`, `drawLidarRange`
  and, if you want motion, a slow `drawLidarSweep` (section 8.4).
- Every map from `js/data/` must show "© Kontributor OpenStreetMap". `createMapRenderer` draws the
  badge for you; keep it visible (draw it last with `renderer.drawAttribution(g, view)` when overlays
  could cover the bottom right corner, and do not put DOM overlays there).
- Say what is estimated. Lane counts, road widths, speeds and building heights in the data are
  mostly estimates, and there are NO real traffic lights around Ma Chung in OSM: any light you place
  there is simulated and must be labelled (for example `drawTrafficSignal(..., { simulated: true })`
  or a sentence in the step text).
- Safety rule (SPEC rule 9): whatever the learner does, no vehicle in your simulation may run a red
  light or hit a pedestrian. Enforce it with a final safety check before you apply acceleration,
  plus gap acceptance for pedestrians, not by luck.

---

## 8. Malang toolkit

Everything here lives in `js/engine/osm2d.js` (maps, routing, map drawing) and `js/engine/draw.js`
(Malang traffic and calm LiDAR). Both are re-exported by `js/engine/index.js`. The raw OpenStreetMap
data (ODbL, fetched 28 September 2026) is in `data/osm/` and is NOT deployed; the compact files in
`js/data/` are generated from it by `python3 tools/osm_to_2d.py` (add `--check` to only print the
statistics).

### 8.1 Data files (`js/data/`)

All coordinates are meters in a local equirectangular projection per file: `x` east, `y` SOUTH (the
engine convention), `x = (lon - lon0) * mPerDegLon`, `y = (lat0 - lat) * mPerDegLat`, with
`mPerDegLat` and `mPerDegLon` from the WGS84 series at `lat0` (error under 0,1 percent at this size).
Every file stores its projection in `meta.projection`; `map.project(lat, lon)` and
`map.unproject(x, y)` use it. `machung-2d.json` and `malang-roads.json` share the same origin, so
their coordinates overlay directly; `malang-center.json` has its own origin (use `map.toMap(other, x, y)`).

| File (id for `loadMap`) | Size | Origin (0, 0) | Contents |
| --- | --- | --- | --- |
| `machung-2d.json` (`'machung'`) | 215 KB, 69 KB gzip | centroid of the Universitas Ma Chung polygon, lat -7.95723, lon 112.58947, 0,1 m precision | Area around the campus (bbox lat -7.9625 to -7.9510, lon 112.5840 to 112.5960, bounds x -603 to 720, y -689 to 583). 1.112 road edges and 894 nodes with class, one way, name and estimated width; 151 extra connector roads from the Malang network just outside the bbox so the north (Jalan Karangampel Timur, Jalan Raya Candi V) and the south (Villa Puncak Tidar, Jalan Dieng Atas) are connected as in reality; 12 roundabouts (9 inside the bbox, mostly on the Villa Puncak Tidar boulevards, and 3 on the connector roads); 1.728 buildings (heights estimated); 74 green areas; 25 waterways; 36 named places; the campus polygon. No traffic signals exist in OSM here. |
| `malang-roads.json` (`'malang-roads'`) | 653 KB, 185 KB gzip | same as `machung` | Routing network from Ma Chung in the west to the city center (bbox lat -7.995 to -7.940, lon 112.580 to 112.640, bounds x -1.044 to 5.571, y -1.906 to 4.177), 1 m precision, geometry simplified (Douglas-Peucker 1,5 m), lengths from the full geometry. 10.674 intersection nodes and 13.453 edges (the largest connected component, 748 km) of classes trunk, primary, secondary, tertiary, unclassified, residential, living_street and their links; 69 real traffic signals. Main streets include Jalan Semeru, Jalan Jaksa Agung Suprapto, Jalan Besar Ijen, Jalan Kawi, Jalan Jenderal Basuki Rachmat, Jalan Soekarno-Hatta, Jalan Veteran, Jalan Sumbersari, Jalan Terusan Dieng. Alun-alun Merdeka is near (4559, 2808) in this file. No buildings. |
| `malang-center.json` (`'malang-center'`) | 382 KB, 120 KB gzip | centroid of the Alun-Alun Merdeka park, lat -7.98256, lon 112.63085, 0,1 m precision | Around Alun-alun Merdeka (bbox lat -7.9880 to -7.9770, lon 112.6250 to 112.6370, bounds x -645 to 678, y -615 to 602). 1.389 road edges (Jalan Merdeka Utara/Selatan/Barat/Timur, Jalan Jenderal Basuki Rachmat, Jalan Kauman, Jalan Majapahit, Jalan Tugu, Jalan Kertanegara, Jalan Trunojoyo and more), 3.816 buildings with height (only 18 from OSM tags, the rest ESTIMATED: 3,5 m per level plus 1 m, level count guessed from building type and footprint, places of worship 12 m; `heightFromOsm` tells which), 34 green areas, 158 named places (Alun-Alun Merdeka, Masjid Agung Jami' Malang, Kantor Bupati Malang, Sarinah Mall, Pertokoan Kayutangan, Gereja Katolik Hati Kudus Yesus Kayutangan, Gajah Mada Plaza; a place mapped twice in OSM, as grounds and as building, is listed once), 12 real traffic signals and 35 crossings. |

Estimates, per road: `width` comes from the OSM `width` tag, else `lanes * 3.25` m, else a per class
guess (residential 5 m, tertiary 7 m, secondary 8 m, primary 10 m, trunk 14 m, narrower for one way
roads). `lanes` is from OSM or guessed from the width. `speed` (m/s) is an estimated AVERAGE urban
traffic speed per class (`meta.speedKmh`: trunk 40, primary 35, secondary 30, tertiary 25,
residential 20, living_street 10 km/jam), not a legal limit; a real `maxspeed` tag wins when present.
Flags `widthFromOsm`, `lanesFromOsm`, `maxspeedFromOsm` tell you which values are real. One way
edges are always stored in the direction of travel (a to b). If you show any of these values to
learners, say they are estimates.

### 8.2 `osm2d.js`: loading, hit testing, routing, drawing

```js
import { createMapRenderer, highlightRoad, drawSearch, shortStreetName } from '../engine/osm2d.js';
import { COLORS } from '../engine/theme.js';
import { drawVehicle, drawTrafficSignal } from '../engine/draw.js';

export default {
  // ...
  async mount(ctx) {
    const map = await ctx.loadMap('machung');            // or loadMap('machung', { signal: ctx.signal })
    const campus = map.campus;                             // { name, x, y, points, bbox }
    const view = ctx.createView({
      bounds: (v) => (v.aspect < 1.2 ? map.boundsAround(40, 150, 170, 210) : map.boundsAround(40, 150, 260, 150)),
    });
    const renderer = createMapRenderer(map, { layers: { places: true } });
    const graph = map.graph({ cost: 'time' });             // RoadGraph, see below
    const a = graph.nearestNode(-130, 109).id;             // bundaran barat daya kampus
    const b = graph.nearestNode(223, 254).id;              // bundaran Villa Puncak Tidar
    const search = graph.search(a, b, { algorithm: 'astar' });
    view.onPointer({ tap: (e) => { const hit = graph.nearestEdge(e.x, e.y, { maxDist: 25 }); if (hit) graph.closeRoad(hit.road); } });
    ctx.createLoop({
      update: () => { for (let i = 0; i < 3 && !search.done; i++) search.step(); },
      render: () => {
        const g = view.begin();
        renderer.draw(g, view, { attribution: false });     // map from cache
        drawSearch(g, view, graph, search);                 // explored edges, open nodes, best path
        renderer.drawAttribution(g, view);                  // "© Kontributor OpenStreetMap", always last
      },
    });
    return {};
  },
};
```

Loading

- `loadMap(id, { signal })` returns a Promise of an `OsmMap`. `id` is `'machung'`, `'malang-roads'`,
  `'malang-center'` or a URL of a file in the same format. Results are cached per page, so several
  lessons (and the home page) share one download. Inside a lesson prefer `ctx.loadMap(id)`.
  After `await`, the learner may already have left: if you do not use the signal, check
  `ctx.signal.aborted` before building anything.
- `parseMap(json)` builds a map from an object you already have (tests, Node scripts:
  `node` can import `osm2d.js` directly).

`OsmMap` (treat everything as read only, it is shared)

- `id title meta attribution projection bounds speedKmh names`.
- `nodes[i] = { id, x, y, roads, degree }` (intersections and dead ends).
- `roads[i] = { id, a, b, cls, rank, classLabel, name, oneway, roundabout, bridge, drivable, width,
  lanes, maxspeed, speed (m/s), length (m), points, bbox, widthFromOsm, lanesFromOsm, maxspeedFromOsm, osm }`.
  One entry per edge between two nodes; `points` runs from node `a` to node `b`. `classLabel` is an
  Indonesian name for the class (`'jalan perumahan'`, `'jalan kolektor'`, `'gang'`, ...), `rank` is
  the index in `ROAD_CLASSES` (0 = trunk).
- `buildings[i] = { id ('machung-gedung-12'), index, kind: 'building', label: 'Gedung', x, y (centroid),
  points, type (OSM building value), name, height (m), heightFromOsm, area (m2), bbox }`.
- `green[i] = { points, kind: 'park' | 'grass' | 'wood' | 'farm' | 'pitch' | 'cemetery', name, bbox }`,
  `water[i] = { points (polyline), kind, name, bbox }`, `places[i] = { name, kind ('amenity:university',
  'shop:mall', ...), x, y, area }` (largest first), `campus` (machung only),
  `roundabouts[i] = { x, y, radius, closed, name, roads }`,
  `signals[i] = { x, y, node, road, s, osm }` (real OSM traffic signals: `node` is the nearest
  intersection, `road` and `s` the edge and distance along it when the signal sits mid edge),
  `crossings[i]` (same shape, center only, plus `type`).
- `project(lat, lon)`, `unproject(x, y)`, `toMap(otherMap, x, y)`.
- Hit testing: `nearestRoad(x, y, { maxDist = 80, drivable, filter })` gives
  `{ road, x, y, dist, s, heading, lateral }` (`lateral > 0` = left of the a to b direction) or `null`;
  `nearestNode(x, y, { maxDist, filter })` gives `{ node, dist }`; `buildingAt(x, y)`;
  `buildingsNear(x, y, radius)` (array, ready as sensor targets). All use a grid index, so calling them
  on every pointer move is fine. Pass `e.hitRadius` from `view.onPointer` as part of `maxDist` on touch.
- `roadsNamed('Jalan Semeru')`, `findPlace('Alun')`, `streets()` (named roads chained into long
  polylines, sorted by importance), `boundsOf(items, pad)`, `boundsAround(x, y, halfW, halfH)`.
- `lanePath(road, { forward = true, lane = 0 })`: a `Path` along the center of a lane with left-hand
  traffic (lane 0 is the curb lane).
- `graph(opts)`: a new `RoadGraph`.

`RoadGraph` (extends `planning.Graph`, so `createSearch`, `findPath`, `setBlocked` and `setMultiplier` work)

- Options: `classes` (default `DRIVABLE_CLASSES`), `cost: 'length'` (meters, default) or `'time'`
  (seconds from the class speed estimate), `respectOneway = true`, `filter(road)`,
  `component: 'largest'` (default: only the largest strongly connected part, so every node in the
  graph can reach every other node; the map edges keep one way streets that lead out of the area,
  and those nodes are dropped from the graph) or `'all'`. `droppedNodes` tells how many were dropped.
- Node ids are the map node ids (numbers); `graph.nodes.get(id)` has `x, y`. Each edge's `data` is
  `{ road, forward }`. Parallel roads between the same two nodes become one edge (the cheaper one).
- `heuristic(a, b)`: straight line distance (divided by the fastest class speed when cost is time),
  always admissible, so A* stays optimal.
- `nearestNode(x, y)` gives `{ node, id, dist }` (only nodes in the graph), `nearestRoad(x, y, opts)`,
  `nearestEdge(x, y, opts)` gives `{ edge, road, forward, x, y, dist }` (direction from the side of the
  road that was clicked, left-hand traffic), `edgeFor(road, forward)`.
- Changing costs: `closeRoad(road, closed = true)` (both directions), `isClosed(road)`,
  `setRoadMultiplier(road, m)` (congestion, keep `m >= 1` so the heuristic stays admissible).
- Searching: `search(start, goal, { algorithm: 'astar' | 'dijkstra', tieBreak, weight })` is
  `createSearch` (animate with `step()` or `for (const n of s.steps())`), `findRoute(start, goal, opts)`
  gives `{ found, path, cost, expanded }`. Example on `malang-roads` with time cost, from the campus to
  Alun-alun Merdeka: about 6 km, A* expands about 3.400 nodes, Dijkstra about 5.600, both find the
  same cost.
- Using a route: `routeRoads(nodes)` (`[{ road, forward, edge }]`), `routeLength(nodes)` (m),
  `routeTime(nodes)` (s, includes multipliers), `routePoints(nodes, { keepLeft, lane, smooth })` and
  `routePath(nodes, same)` (a `Path` for `PathAgent` or `purePursuit`; `keepLeft: true` shifts it to the
  center of the left lane, `smooth: 5` rounds corners with about 5 m radius). For a closed loop, join
  two routes and build `new Path(points, { closed: true })` (see `js/shell/ambient.js`).
- `edgePoints(edge)`: the edge's road points in travel direction.

Drawing (the site's 2D style)

- `createMapRenderer(map, opts)` gives `{ draw(g, view, { attribution }), drawAttribution(g, view), set(opts), invalidate(), map }`.
  Call `renderer.draw(g, view)` right after `view.begin()`. It also paints the attribution badge, so
  anything you draw later can cover it. When your overlays (routes, markers, lights, labels) may reach
  the bottom right corner, call `renderer.draw(g, view, { attribution: false })` first and
  `renderer.drawAttribution(g, view)` as the very last line of `render()`. Static layers are painted once into a
  hidden canvas 25 percent larger than the view and only copied each frame; the cache repaints by
  itself when the scale or size changes or the camera leaves the cached area, so a camera that follows
  a vehicle works. Options: `layers: { green, water, campus, footways, roads, islands, markings,
  arrows, buildings, labels, places }` (all on except `places`), `style` (overrides `MAP_STYLE`),
  `roadFilter(road)`, `labelRank` (lowest class rank that gets a street name; default depends on the
  zoom: trunk to secondary when far out, all named roads when close; the most important named class
  in the map and the one after it are always labelled, so the tertiary streets around Ma Chung keep
  their names in an overview), `abbreviate` (Jalan to Jl.,
  default true), `attribution` (`true`, `false` or options for `drawAttribution`), `cache`.
  If `roadFilter` depends on your state, call `renderer.invalidate()` after changing it.
- Scale behavior: below `STREET_SCALE` (1,2 px per m) roads are colored lines per class (overview);
  above it roads are asphalt with a lighter casing at their estimated width, roundabout islands are
  green, one way roads get arrows from 1,6 px per m and dashed center or lane lines from 3 px per m.
  Buildings get a shadow that grows with their (estimated) height.
- `drawMap(g, view, map, opts)` paints without cache (fine for a still picture).
- `drawAttribution(g, view, { text, corner = 'bottom-right', margin, offsetY, alpha })`: the
  "© Kontributor OpenStreetMap" badge. Required on every canvas that shows this data.
- `highlightRoad(g, view, roadOrPoints, { color, width (px), alpha, dash, casing })` for routes,
  closed roads (`dash: [6, 4]`, `color: COLORS.danger`) and selections.
- `drawSearch(g, view, graph, search, { exploredColor, openColor, pathColor, width, showPath, dotPx })`.
- `drawSignalDots(g, view, map.signals)`: small markers for the REAL signals on an overview map.
- Helpers: `shortStreetName(name)`, `laneOffset(road, lane)`, `offsetPolylineVar(points, offsets)`,
  `smoothCorners(points, radius)`, `metersPerDegree(lat)`, `project`, `unproject`,
  `ROAD_CLASSES`, `DRIVABLE_CLASSES`, `ROAD_CLASS_LABELS`, `MAP_STYLE`, `MAP_FILES`, `OSM_ATTRIBUTION`.

Performance: loading `machung` takes a few tens of milliseconds after download; `malang-roads` builds
13.453 roads and its graph in well under a second on a laptop. Painting a full view is a few
milliseconds and only happens when the cache is invalid. For a phone, prefer `machung` or
`malang-center` unless you really need the city network.

### 8.3 Malang traffic (`draw.js`)

All take a world object `{ x, y, heading }` (center of the vehicle) plus options, and accept `view`
and `minPx` so they stay readable when the map is zoomed out. Sizes come from `SIZES`.

- `drawAngkot(g, a, { code, color = COLORS.angkot, view, minPx, braking, highlight, alpha, doorOpen })`:
  light blue mikrolet with its route code on a white roof board (text needs `view`; real Malang codes
  look like `'AL'`, `'ADL'`, `'GL'`). The sliding door is on the left, the curb side.
- `drawMotor(g, m, { passenger = false, color, jacket, helmet, passengerHelmet, passengerJacket, view,
  minPx = 12, braking, highlight, alpha })`: sepeda motor with rider seen from above, optionally with
  a passenger (boncengan). Use `COLORS.helmets[i]` for variety. At true size a motorbike is only
  about 23 px long at 12 px per m (1,9 m), which reads as a thin sliver; pass `minPx: 30` or so at lesson
  scale so the rider and helmet are recognizable (drawing only, keep the physics size).
- `drawCityCar(g, car, opts)` (hatchback, `SIZES.city`), `drawMPV(g, car, opts)` (long roof with rails,
  `SIZES.mpv`), `drawCar(g, car, { variant })`.
- `drawBus(g, bus, { code, braking, minPx, view })`: city bus or minibus (`SIZES.minibus`); roof panels
  follow the length. `drawShuttle(g, s, { ego, braking, minPx, view })`: the autonomous shuttle.
- `drawPedestrian(g, p, { variant: 'default' | 'hijab' | 'backpack' | 'umbrella', accent, color, phase, view, minPx })`:
  `accent` is the hijab, bag or umbrella color (`COLORS.hijab[i]` for hijab colors). At lesson scale
  (about 10 to 15 px per m) pass `minPx: 14` or more, otherwise the variants are too small to tell apart.
- `drawVehicle(g, v, opts)`: draws by `v.kind` (`'car' | 'city' | 'mpv' | 'angkot' | 'motor' | 'bus' |
  'minibus' | 'shuttle' | 'cyclist' | 'pedestrian'`), handy for mixed traffic with `PathAgent`s:
  `new PathAgent({ kind: 'motor', path, cruise: 8 })` then `drawVehicle(g, agent, { view, minPx: 10 })`.
- `drawHalteSign(g, { x, y, label }, { view, minPx = 18, color, highlight })`: blue halte plate with a
  white bus on a pole; `label` (needs `view`) is drawn under it.
- `drawTrafficSignal(g, { x, y, heading, state }, { arm = 2.6, view, minPx = 22, glow, simulated })`:
  top-down traffic light that matches the one in Shuttle 3D (same lamp colors, `SIGNAL_LAMPS`):
  a pole on the left curb, an arm over the lanes, a three lamp head. `heading` is the direction the
  lamps face (toward the approaching traffic, like `TrafficLight`), so the arm reaches over the lanes
  of that traffic. Shuttle 3D puts the pole about 0,7 m beyond the left curb and 1,2 m before the stop
  line, with a 2,6 m arm; do the same so both views look alike. `arm: 0` draws only the head. `simulated: true` adds a small "simulasi" tag: use it
  for every light near Ma Chung, where no real signal exists. A `TrafficLight` from `traffic.js` can
  be passed directly as the first argument.

### 8.4 Calm LiDAR (`draw.js`)

The user said the busy LiDAR ray lines distract. For LiDAR, draw points, not rays, and let them fade.

```js
import { createLidarTrail, drawLidarRange, drawLidarSweep, lidarSweepAngle } from '../engine/draw.js';
const trail = createLidarTrail({ fade: 1.5, decimate: 1, max: 4000 });
// update(dt, loop): after rig.update(...); only a NEW scan is added, so calling it every step is fine
trail.addReading(rig.reading('lidar'), loop.time);
// render(): after the world, before labels
const pose = lidarSensor.pose(ego);
drawLidarRange(g, pose, lidarSensor.range, COLORS.lidar, { view });           // still, soft circle
if (!ctx.reducedMotion) drawLidarSweep(g, pose, lidarSweepAngle(loop.time, { period: 8 }), lidarSensor.range);
trail.draw(g, loop.time, COLORS.lidar, { view, size: 2.2 });
// reset(): trail.clear();
```

- `createLidarTrail({ fade = 1.2, max = 4000, decimate = 1 })` (fade in seconds, max in points) gives
  `{ addReading(reading, time, { skipClutter }), add(points, time), draw(g, time, color, opts), clear(), count }`.
  `addReading` takes `rig.reading('lidar')` (or a `Sensor.sense()` result) and ignores a reading it has
  already added; `skipClutter: true` drops rain clutter points. Points stay in
  world coordinates and fade out over `fade` seconds, so nothing flickers when a new scan arrives.
  Scans from the "future" (after a reset of `loop.time`) are dropped automatically.
- `trail.draw(g, time, color, { view, size = 2.2, alpha = 0.85, halo = 0.6, merge = true, spacing = 1.5 })`.
  A new point keeps full brightness for about a third of `fade`, then dims along a smooth curve.
  With `merge: true` (default) the trail keeps one dot per small world cell (about `size * spacing`
  px wide on screen). A cell remembers the position of the FIRST hit that landed in it and the time
  of the NEWEST hit, so a wall that keeps being scanned shows as a calm row of dots that neither
  brightens into a solid line nor jitters from scan to scan, and a moving object leaves a short
  fading trail. Without merging, the overlapping scans would stack into a bright solid line (this is
  what the user found distracting). Raise `spacing` (for example 1.8) for sparser dots on an overview
  map. Cells are rebuilt when the zoom changes by more than 25 percent. `merge: false` draws every
  point of every scan at its exact position.
- `drawSoftPoints(g, points, color, { view, size = 2.4, alpha, halo })`: round points (size in px) with a faint halo
  (`halo`: `true`, `false` or a strength from 0 to 1).
- `drawLidarRange(g, origin, range, color, { view, alpha, edgeAlpha, dash })`: a still coverage disc.
- `drawLidarSweep(g, origin, angle, range, color, { width = 0.9, alpha = 0.18 })` (width in radians) with
  `lidarSweepAngle(time, { period = 8, offset })`: a soft wedge that turns once every `period`
  seconds. It has no hard edge: it fades in from the tail, fades out again just before the leading
  edge and dims toward the rim, so nothing reads as a rotating line. Keep the period at 8 seconds or
  more, keep `alpha` at 0,18 or lower, and skip it when `ctx.reducedMotion` is true.
- Home page settings, as a calm reference: `Sensor('lidar', { range: 55, rays: 180, rate: 5 })`,
  `createLidarTrail({ fade: 2.4 })`, `trail.draw(..., { size: 2, alpha: 0.6, halo: 0.5, spacing: 1.8 })`,
  sweep `period: 10, alpha: 0.1`.
- `drawPointCloud` still works for a single frozen scan; `drawRays` is fine for one or two teaching
  rays (for example the ray that hits a pedestrian), never for a full LiDAR sweep.

---

## 9. Shell routes and the 3D mounting contract

- `#/` home, `#/pelajaran` (home scrolled to the lesson list), `#/pelajaran/<id>`,
  `#/shuttle-3d/panduan` and `#/shuttle-3d/jelajah` (Shuttle 3D Ma Chung). `#/shuttle-3d` and the old
  `#/simulator`, `#/simulator/tutorial` redirect to `#/shuttle-3d/panduan`; `#/simulator/bebas`
  redirects to `#/shuttle-3d/jelajah`. Link to the new hashes in lesson text.
- The page title follows the route: `LiveShuttle · Belajar transportasi tanpa pengemudi`,
  `<lesson title> · LiveShuttle`, `Shuttle 3D Ma Chung, Panduan · LiveShuttle`.
- `js/sim3d/index.js` exports `mount(container, { mode, navigate, onModeChange })` with `mode`
  `'panduan'` or `'jelajah'`. Both modes share one route key, so changing the hash between them never
  remounts the simulator: the shell calls `instance.setMode(mode)` when the returned instance has it;
  otherwise the module switches itself from its own `hashchange` listener (as `js/sim3d/index.js`
  does). When the module switches mode with its own buttons plus `history.replaceState`, it may call
  `onModeChange(mode)`; the shell also checks the hash twice a second, so the page title, the header
  and `__simotonom.simMode` follow either way. Only if the hash changes while the module is still
  mounting and the instance has no `setMode` does the shell remount once with the new mode.

---

## 10. What changed in this update (for existing lessons)

All changes are backward compatible unless noted.

- Labels whose world point is off screen are now hidden (was: pinned to the edge). Pass
  `offscreen: 'clamp'` to keep the old behavior for an edge hint whose anchor is outside the view.
  Anchors exactly on the edge (for example `view.visibleBounds().maxX`) still count as visible.
- `Path.sample` and `Path.closest` no longer return heading 0 on duplicate points.
- `ui.segmented` releases focus after a pointer click; arrow keys reach `ctx.keys` again.
- Touch targets: segmented buttons and sliders are 40 px tall, step dots are 40 px tall (and 40 px
  wide on touch screens). Lessons with tight custom layouts should check their controls panel.
- The Dijeda badge moved to the top right of the stage. When a HUD chip reaches into that corner
  (common on phones, where the chip row wraps across the full width), the shell moves the badge just
  below that chip row; the chips themselves never move. Set `--stage-badge-top` on `ctx.stage` to
  place it yourself. A lesson that still sets `bottom` on `.stage-badge` is harmless: the badge has a
  fixed height and stays on top.
- Toasts are click-through.
- New setters: `slider.setHint/setLabel/setRange`, `holdButton.setDisabled/setLabel`,
  `hudChip.setLabel/setColor`, `note(...).setTone/setHtml`, `timeChart.setRange`, log scale and gaps.
- New options: `createSearch(..., { tieBreak: 'g' })` and `search.steps()`, `purePursuit` with a plain
  pose and `target: 'circle'`, `PID({ derivativeOnMeasurement })`, `makeRoad({ closed })`,
  `followingSpeed(..., { strict })`, `drawCar/drawBus/drawShuttle({ minPx })`, brake lights on the
  shuttle and glow on braking buses.
- Sensors accept plain polygons as targets (centroid).
- `ctx.completeTask(id, { anyStep, toast })`, `ctx.lastStep`, `ctx.setLastStep(i)`, `ctx.loadMap(id)`.
- Progress key `liveshuttle.progress.v1` (migrated automatically).
- New: the Malang toolkit of section 8 (`osm2d.js`, the files in `js/data/`, Malang road users,
  `drawTrafficSignal` in the Shuttle 3D style and the calm LiDAR helpers). Every lesson now draws
  LiDAR with `createLidarTrail`; do not draw one line per ray.
