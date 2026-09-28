# SimOtonom engine and lesson API

This is the reference for everyone who writes a lesson. Read `docs/SPEC.md` first for the rules
(language, writing style, left-hand traffic, accessibility). Then read `js/lessons/sensor.js`
and `js/lessons/sensor/scene.js`: that lesson is the worked example of everything below.

Lesson authors must not edit `js/engine/*`, `js/main.js`, `js/shell/*` or `css/style.css`. If you
find an engine bug, work around it inside your lesson and report it.

Contents

1. Conventions
2. Lesson module contract
3. The `ctx` object
4. Engine modules
5. How to write a lesson (walkthrough of sensor.js)
6. Testing (`tests/smoke.py`, `window.__simotonom`)
7. Pitfalls checklist

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
- Progress lives in `localStorage` under `simotonom.progress.v1`.

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
| `ctx.setStatus(text)` | Updates the status line under the stage (`role="status"`, `aria-live="polite"`). Identical text is ignored, so calling it often is cheap. Keep it short: it is clamped to 2 lines on desktop and 3 on mobile. Write whole sentences. |
| `ctx.toast(text, { tone, duration })` | Small notification at the bottom. `tone`: `'info'` (default), `'ok'`, `'warn'`. Use sparingly; the shell already toasts task completion. |
| `ctx.completeTask(taskId)` | Marks a task done and returns `true` if it was newly completed. Returns `false` (and does nothing) when the task is already done or when it does not belong to the CURRENT step. Unknown ids log one console warning. |
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

---

## 4. Engine modules

Import from single modules (`'../engine/sensors.js'`) or from `'../engine/index.js'`, which
re-exports everything and exposes the widgets as `ui` (`import { ui } from '../engine/index.js'`).

### 4.1 `theme.js`

- `COLORS`: UI colors (`bg panel raised border text muted accent accentInk warn danger ok`),
  canvas colors (`ground groundAlt asphalt asphaltDark asphaltLight sidewalk curb laneMark
  centerLine building roof roofEdge tree treeLight wall wallDark`), actors (`ego egoDark
  vehicles[6] bus shuttle pedestrian cyclist cone cardboard`), sensors (`kamera lidar radar
  ultrasonik`), lights (`lightRed lightYellow lightGreen lightOff`), paths (`path pathAlt target`).
- `SENSOR_COLORS`, `SIZES` (`laneWidth 3.5`, `car {4.5, 1.8, wheelbase 2.7}`, `suv`, `bus`,
  `shuttle`, `cyclist`, `pedestrian {radius 0.35}`, `sidewalk`), `FONT`, `MONO`.
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
  `headingError(heading, s)`.

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
- `followingSpeed(gap, leaderSpeed, { cruise, minGap = 2.5, timeGap = 1.2, decel = 3 })`.
- `shouldStopForYellow(distance, speed, comfortDecel)`.
- `laneTargetSpeed(agent, stops, { leaderGap, leaderSpeed, decel = 3, margin = 0.8 })`: target
  speed for a background `PathAgent` that has stop lines `[{ s, light }]` on its path and an
  optional leader. On a closed path, pass stops that are already behind the agent as `s + path.length`
  (see `js/shell/ambient.js`).

### 4.8 `road.js`

- `makeRoad({ id, points, lanesPerDir = 1, laneWidth = 3.5, twoWay = true, sidewalk = 0, trimStart = 0, trimEnd = 0 })`
  returns `{ id, points, path, length, width, laneWidth, lanesPerDir, lanesTotal, twoWay, sidewalk,
  lanes, leftEdge, rightEdge, polygon, sidewalkPolygon, markings }`.
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
- Actors: `drawCar(g, car, { color, ego, braking, highlight, headlights, alpha, view })` (ego gets the
  teal body and glow), `drawBus`, `drawShuttle(g, s, { ego })`, `drawPedestrian(g, p, { phase, view, minPx = 9 })`,
  `drawCyclist(g, c, { view, minPx = 15 })`.
- Infrastructure: `drawTrafficLight(g, light, { view, minPx = 26, glow, alpha })`, `drawSpeedSign(g, { x, y, text }, { view })`,
  `drawBuilding(g, box)`, `drawTree(g, x, y, r)`, `drawWall(g, box)`, `drawCone(g, { x, y }, { view })`,
  `drawCardboard(g, box)`, `drawHalte(g, box)`.
- Paths and markers: `drawPath(g, pts, { color, width, view, dash, arrows })` (`arrows` = spacing in m),
  `drawArrow(g, from, to, { view })`, `drawRing(g, x, y, r, { color, width, view, dash, fill })`, `drawMarker(g, x, y, { view })`.
- Text: `drawLabel(g, view, x, y, text, { color, bg, size, dx, dy, align, mono })` draws a pill in
  screen pixels at a world point. When several labels can overlap use
  `const labels = createLabelLayer(); labels.add(x, y, text, opts); ... labels.draw(g, view)` once at
  the end of `render()`; overlapping labels are nudged up or down.
- `drawScaleBar(g, view)` (bottom left, picks a round length).
- Sensors: `drawSensorCone(g, origin, heading, fov, range, color, { view, fillAlpha, strokeAlpha })`
  (full circle when `fov >= 2 PI`), `drawRays(g, origin, points, color, { view, alpha, every })`,
  `drawPointCloud(g, points, color, { view, size })`, `drawBracketBox(g, obj, color, { view, pad })`.
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
- `ultrasonicArray(vehicle)` (8 sensors, groups `'depan'` and `'belakang'`),
  `standardSensors(vehicle, overrides)` (kamera, lidar, radar and the 8 ultrasonic sensors).
- `new SensorRig(vehicle, sensors, { seed })`: `update(dt, objects, weather)` scans each sensor at its
  own `rate`; `scanNow(objects, weather)` (use it after a change while paused); `setEnabled(idOrTypeOrGroup, on)`;
  `isEnabled`; `select`; `get(id)`; `reading(id)`; `detections(idOrTypeOrGroup)`; `detectedIds(...)`; `clear()`.

### 4.11 `planning.js`

- `PriorityQueue` (`push(item, priority) pop() size peekPriority()`).
- `new GridMap({ cols, rows, cellSize = 1, originX = 0, originY = 0, diagonal = false })`: nodes are
  cell indices; `index(col, row) cell(i) inBounds setBlocked(col, row, b) isBlocked setCost(col, row, c)
  toWorld(i) fromWorld(x, y) neighbors(i) heuristic(a, b)`. Diagonal moves never cut corners.
- `new Graph()`: `addNode(id, { x, y })`, `addEdge(a, b, { cost, twoWay = true, multiplier = 1, data })`,
  `edge(a, b)`, `setBlocked(a, b, blocked, twoWay)`, `setMultiplier(a, b, m, twoWay)` (congestion),
  `neighbors`, `heuristic` (straight line, admissible while cost >= length), `allEdges()`.
- `createSearch(space, start, goal, { algorithm: 'astar' | 'dijkstra', heuristic, weight })` returns a
  search you can animate: call `step()` a few times per frame; read `open closed current g cameFrom
  expanded done found path cost`, `pathTo(node)`; `run(maxSteps)`.
- `findPath(space, start, goal, opts)` gives `{ found, path, cost, expanded }`.

### 4.12 `control.js`

- `purePursuit(vehicle, path, { lookahead = 6, gain = 0, hintS })` returns
  `{ steer, target, alpha, s, ld, crossTrack }` with `delta = atan(2 L sin(alpha) / ld)` measured from
  the rear axle; `ld = lookahead + gain * speed`.
- `crossTrackError(x, y, path, hintS)`: positive when the point is RIGHT of the path.
- `new PID({ kp, ki, kd, min, max, integralLimit, derivativeFilter })`: `update(error, dt)`,
  `reset()`, fields `terms { p, i, d }`, `integral`, `output`. Anti-windup stops integrating while saturated.

### 4.13 `ui.js` (widgets)

Every widget appends itself to `parent` and returns handles. No global listeners, so removing the
DOM is enough. Styling comes from `css/style.css`.

- `el(tag, attrs, ...children)` tiny hyperscript (`class text html style dataset on<event>`,
  `style` accepts CSS variables such as `{ '--c': COLORS.radar }`). `uniqueId(prefix)`.
- `group(parent, { title, hint, wide, className })` returns the section element.
- `slider(parent, { label, min, max, step, value, unit, digits, format, hint, onInput })`
  gives `{ el, input, value, set(v, silent = true), setDisabled }`.
- `toggle(parent, { label, checked, color, hint, onChange })` gives `{ el, checked, set(on, silent = true), setHint(text), setDisabled }`.
- `segmented(parent, { label, ariaLabel, options: [{ value, label, icon }], value, onChange })`
  gives `{ el, value, set(v, silent = true), setDisabled }` (radio group with arrow key navigation).
- `button(parent, { label, onClick, variant: 'primary' | 'secondary' | 'ghost' | 'danger', icon, kbd, title, small })` returns the button.
- `holdButton(parent, { label, icon, kbd, variant, onChange(active) })` gives `{ el, active, setActive }`;
  active while pressed by mouse, touch, Space or Enter. Pair it with `ctx.keys` by calling `setActive`.
- `buttonRow(parent, { className })`, `readoutGrid(parent)`,
  `readout(parent, { label, value, color, big })` gives `{ el, set(text), setTone('' | 'ok' | 'warn' | 'danger' | 'off') }`.
- `legend(parent, [{ color, label, shape: 'dot' | 'line' | 'square' }])`.
- `dataTable(parent, { columns: [{ key, label, html, align, className, rowHeader }], rows, caption, empty })`
  gives `{ el, table, setRows(rows) }`. Cell values are text or `{ html }`; a row may have `_class`.
  `setRows` only touches the DOM when the content changed.
- `note(parent, html, { tone: 'info' | 'warn' | 'ok' })` returns the callout element (its text lives in the inner `div`).
- `hudChip(ctx.hud, { label, color })` gives `{ el, set(text), show(bool), setTone(tone) }`.
- `timeChart(parent, { label, series: [{ label, color }], span = 10, min, max, unit, digits, height })`
  gives `{ el, push(t, ...values), clear(), draw() }`; redraws itself once per frame after `push`.
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

Serve the project on your own port and run the smoke test:

```
python3 -m http.server 8123 --bind 127.0.0.1 --directory /Users/mcdonny/Downloads/ndur/driverless-sim
python3 tests/smoke.py --port 8123 --route "#/pelajaran/<id>" --out tests/shots/<name>/<id>-desktop
python3 tests/smoke.py --port 8123 --route "#/pelajaran/<id>" --out tests/shots/<name>/<id>-mobile --mobile
```

`tests/smoke.py` options:

| Option | Meaning |
| --- | --- |
| `--port P` (required) | Port of the running static server. `--host` defaults to `127.0.0.1`. |
| `--route "#/..."` | Hash route to open (default `#/`). |
| `--out PATH` (required) | Screenshot path prefix; `.png` is appended unless present. Folders are created. |
| `--mobile` | 390 by 844 viewport, touch, `device_scale_factor = 2`. Default is 1366 by 900. |
| `--wait-ms N` | Wait after load before checking (default 2500). |
| `--full-page` | Full page screenshot. |
| `--webgl` | Software WebGL flags (automatic for `#/simulator` routes). |
| `--ignore REGEX` | Ignore matching console messages (repeatable), for example `--ignore "404"` while another lesson module does not exist yet. |
| `--allow-warnings` | Do not fail on console warnings. |
| `--min-variance X` | Blank canvas threshold (default 12). |

It collects console errors and warnings plus page errors, checks that the largest visible canvas
is not blank (pixel variance of an element screenshot), saves the screenshot and prints a JSON
summary that includes the `window.__simotonom` snapshot. Exit code 0 means no problems.
Driver messages containing `GPU stall due to ReadPixels` are ignored automatically, because the
test itself triggers them when it reads a WebGL canvas. A lesson route whose module does not exist
yet logs a 404 from the browser; that one is expected until the module is written.

`window.__simotonom` (read only) for your own Playwright scripts:
`route routeName lessonId lessonStatus ('loading' | 'ready' | 'missing' | 'error') stepIndex stepCount
completedTasks paused speed simStatus simMode activeLoops`.

Useful selectors: `.step-nav .btn-primary` (Lanjut), `.step-dot[data-go="3"]`,
`[data-act="pause"]`, `[data-act="reset"]`, `.speed-wrap .seg-btn`, `.ctl-toggle`, `.seg-btn`,
`.btn-hold`, `.sim-canvas`. Toasts can cover buttons for a few seconds; in scripts use
`locator.dispatch_event("click")` for the step buttons. See `tests/foundation_sensor_qa.py` for a
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
