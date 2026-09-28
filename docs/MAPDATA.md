# Map data: `js/sim3d/data/machung-city.json`

This file is the street map of the area around Universitas Ma Chung (Malang) used by Shuttle 3D
Ma Chung. It is generated from OpenStreetMap and also holds the official list of LiveShuttle halte,
so the 2D shuttle lesson can reuse the same stops and street names.

- Source: `data/osm/machung_raw.json` (Overpass API, fetched 28 September 2026, ODbL).
- Generator: `tools/osm_to_city.py` (plain Python 3, no packages). Run it from the project root:
  `python3 tools/osm_to_city.py`. Add `--png file.png` (needs Pillow) for a preview image that also
  draws the halte loop. The output is deterministic: the same input gives the same bytes.
- Size: about 0,9 MB (about 260 KB gzip). Loaded once by `js/sim3d/city.js` (`loadCityData()`).
- Attribution "© Kontributor OpenStreetMap" with a link to https://www.openstreetmap.org/copyright
  must be visible wherever this data is drawn (`meta.attribution`, `meta.attributionUrl`).

## 1. Coordinates

Local equirectangular projection around the centroid of the Universitas Ma Chung polygon
(`meta.projection`):

```
x = (lon - lon0) * mPerDegLon     east is positive
z = (lat0 - lat) * mPerDegLat     south is positive
lat0 = -7.95723, lon0 = 112.58947, mPerDegLat = 110595.5871, mPerDegLon = 110254.711
```

Units are meters, rounded to 0,1 m. In 3D the ground is the x,z plane and y points up. The ground
is flat in the simulator (the real area is hilly).

The origin is exactly the same as in `js/data/machung-2d.json` (used by the 2D lessons through
`js/engine/osm2d.js`). A 2D lesson can use every point here directly: 3D `(x, z)` is 2D `(x, y)`
(y down on screen). Headings `h` are radians with `0` = east (+x) and growing toward +z (south), so
the forward vector is `(cos h, sin h)` in both worlds, and the driver's left side is
`(sin h, -cos h)`.

The crop (`meta.bounds`) is x from -390 to 610 and z from -450 to 590 (about 1 km x 1 km): Jalan
Karangampel Timur (tertiary) in the north, the campus in the middle, the one way boulevards and
roundabouts of Villa Puncak Tidar in the south and east.

## 2. Top level

```js
{
  format: 'liveshuttle-city/1',
  meta,          // source, license, projection, bounds, what was estimated, statistics
  roads,         // road pieces between junctions (OSM geometry, smoothed)
  lanes,         // lane center lines (vehicles drive on these)
  connectors,    // curves inside junctions from one lane to another
  junctions,     // regular junctions ('x'), roundabout entry points ('ring'), dead end turn areas ('dead')
  roundabouts,   // ring center, radius and width
  signals,       // simulated traffic lights
  crossings,     // zebra crossings
  halte,         // LiveShuttle stops, in loop order
  walks,         // sidewalk network for pedestrians
  buildings, areas, trees, labels,   // scenery
}
```

Ids are array indices (`roads[i].id === i` is not guaranteed for roads, use the `id` field; for
lanes, connectors, junctions, roundabouts, signals, crossings the `id` equals the index).

## 3. `meta`

| field | meaning |
| --- | --- |
| `title`, `source`, `rawFile`, `tool` | where the data comes from |
| `attribution`, `attributionUrl`, `license` | must be shown with the map |
| `projection` | see section 1 |
| `bounds` | `{ minX, minZ, maxX, maxZ }` of the crop |
| `driving` | `'kiri'`: Indonesia drives on the left |
| `droppedWays` | OSM ways left out on purpose, with the reason |
| `snappedGaps` | OSM road ends that stopped a few meters short of another road and were joined |
| `roundaboutDirection` | all 11 roundabouts circulate clockwise seen from above, as drawn in OSM |
| `estimated` | plain sentences (Indonesian) about everything that is estimated; show them in an info panel |
| `stats` | counts, plus `loopLength` (m) and `loopLegs` (m per leg) of the halte loop |

## 4. Roads and lanes

### `roads[]`

| field | meaning |
| --- | --- |
| `id` | road id (lanes refer to it with `e`) |
| `name` | OSM street name or `null` (never invented) |
| `cls` | OSM class: `tertiary`, `residential`, `unclassified`, `living_street`, `service` |
| `ow` | 1 if one way |
| `nf`, `nb` | number of lanes forward (along `p`) and backward |
| `lw` | estimated lane width (m) |
| `half` | half width of the asphalt (m): lanes plus a 0,3 m shoulder |
| `p` | smoothed center line `[[x, z], ...]` (corners are filleted; hairpins are simplified first so the curve radius stays drivable) |
| `t0`, `t1` | length trimmed at the start and end for the junction area (m) |
| `f0`, `f1` | same, including room for a zebra crossing and stop line at signals |
| `ja`, `jb` | what is at each end: `'simpang'` (junction), `'bundaran'`, `'buntu'` (dead end), `'batas'` (map edge) |
| `priv` | 1 for private access roads (routing avoids them) |
| `route` | 1 if vehicles drive on it (0 for pieces that are drawn only) |
| `sw` | sidewalk on the left and right side `[left, right]` |
| `osm` | OSM way ids |

Estimates (OSM has no `lanes` or `width` tags here): two way residential and service roads get one
lane per direction of 2,75 m (about 3 m; the residential streets here are narrow and close together),
the tertiary Jalan Karangampel Timur and Jalan Raya Candi V get one lane per direction of 3,5 m.
One way carriageways (the boulevards of Villa Puncak Tidar) are measured against the opposite
carriageway: two lanes of 3 m when there are at least 6 m of room, two lanes of 2,75 m from 5,5 m,
otherwise one lane of 3 to 3,5 m. One way service roads get one lane of 3,5 m. Ring lanes are 4 m.

### `lanes[]`

| field | meaning |
| --- | --- |
| `id` | lane id |
| `e` | road id (`-1` for ring lanes) |
| `d` | `1` along the road polyline, `-1` against it |
| `i` | lane index from the left: `0` is the kerb lane (Indonesia drives on the left), `1` the right lane of a two lane carriageway |
| `w` | lane width (m) |
| `v` | simulator speed limit (km/jam) by class: tertiary 40, residential and unclassified 30, service 20, living street 15 |
| `j0`, `j1` | junction id at the start and end (`-1` at the map edge) |
| `p` | center line in driving direction |
| `rb` | roundabout id for lanes on a ring |
| `portal` | `'in'` or `'out'` for lanes that start or end at the map edge |
| `core` | 1 if the lane is in the largest strongly connected part of the network that does not need the map edge (routing between halte uses only core links) |
| `name` | street name, if any |
| `priv` | 1 on private roads |

## 5. Junctions and connectors

### `connectors[]`

A connector joins the end of one lane (`f`) to the start of another (`t`) inside a junction.

| field | meaning |
| --- | --- |
| `id`, `j` | connector id and junction id |
| `f`, `t` | from lane, to lane |
| `m` | move: `'L'` left, `'S'` straight, `'R'` right, `'U'` U turn (only at dead ends) |
| `r` | priority rank: `0` has priority (main road, circulating traffic on a ring), `1` main road turning right across oncoming traffic, `2` must yield (minor road, roundabout entry) |
| `b` | cubic Bezier control points `[p0, p1, p2, p3]` (most connectors) |
| `p` | polyline instead of `b` (ring arcs, dead end turns) |
| `ringc`, `entry`, `exit` | 1 for circulating arcs, roundabout entries and exits |
| `core` | as for lanes |

In the simulator (`js/sim3d/city.js`) a link id is the lane id for lanes and `lanes.length +
connector id` for connectors.

### `junctions[]`

| field | meaning |
| --- | --- |
| `id`, `k` | id and kind: `'x'` regular junction, `'ring'` one arm of a roundabout, `'dead'` turning bulb at a dead end |
| `x`, `z` | center |
| `c` | connector ids |
| `poly` | asphalt outline of the junction area (drawn and used as road surface) |
| `sig` | signal id, if signalized |
| `rb` | roundabout id for `'ring'` junctions |
| `bulb` | `[x, z, r]` turning circle of a dead end |

### `roundabouts[]`

`{ id, x, z, r, w, j }`: center, radius of the ring lane center line, asphalt width, junction ids.

### How the simulator uses this

The JSON holds geometry and priorities only. `js/sim3d/city.js` derives the rest when it loads:
conflict zones between connectors of one junction, "lane zones" where a connector passes very close
to the end of another lane (vehicles wait a little before such a zone), speed limits in curves
(`v = sqrt(2 m/s² x R)`), the swept path of the longest vehicle in curves (extra asphalt and the
shield corridor), and a 0,5 m raster of the road surface used by the off road check.
`js/sim3d/junctions.js` hands out junction reservations (all or nothing along chains of junctions
that are too close to stop between, first come first served per conflict zone, exit lane must have
room, roundabout entries yield to circulating traffic, minor roads yield to the main road).

## 6. Signals and crossings (simulated)

OSM has no traffic signals in this area. The generator adds fixed time signals at two busy junctions
on Jalan Karangampel Timur, east of the campus gate (x 216, z -234) and west of it (x -66, z -277).
The info panel must say they are simulated.

### `signals[]`

| field | meaning |
| --- | --- |
| `id`, `j`, `x`, `z` | id, junction, center |
| `xw` | crossing ids that belong to this signal (they get the pedestrian phase) |
| `arms[]` | `{ lanes, name, cls, x, z, h, half }`: lanes that stop at this arm, street name, stop line center and direction of travel, road half width |
| `plan` | `{ green, greenMinor, yellow, allRed, walk, pedClear }` in seconds |

The controller in `js/sim3d/signals.js` gives each arm its own green (tertiary arms `green`, other
arms `greenMinor`), then yellow, then an all red clearance, and after all arms an exclusive
pedestrian phase (`walk`, then `pedClear` long enough to finish the longest crossing at 1,1 m/s,
then all red). Yellow must be at least reaction time + v_max / (2 x a_comfort) + margin =
1,0 + 11,1 / 4,4 + 0,5 = 4,0 s; the data uses 4,5 s.

### `crossings[]`

| field | meaning |
| --- | --- |
| `id`, `x`, `z` | id and center of the zebra |
| `h` | direction of the road at the crossing (pedestrians walk across it) |
| `len`, `w` | length across the road and width along the road (m) |
| `e` | road id |
| `walk` | index of the matching `walks.edges` entry (kind `'x'`) |
| `sig`, `j` | signal and junction for crossings at signals |
| `note` | reason for crossings without signals (campus gate, near a halte) |

Crossings are only created where the waiting spots at both ends are on a proper sidewalk, clear of
turning vehicles. Four are at the signals, three are mid block without signals: near the campus gate
(Gerbang Ma Chung), near Villa Puncak Lawu and near Jalan Raya Candi V.

## 7. Halte (shared with the 2D shuttle lesson)

`halte[]` is in loop order. The shuttle serves them in this order and starts again at the first one.

| field | meaning |
| --- | --- |
| `id` | stable id (`gerbang`, `karangampel`, `tidar`, `lawu`, `candi`) |
| `name` | name shown to the learner |
| `street` | real OSM street name the stop is on |
| `lane`, `s` | lane id and distance along it (m) where the shuttle center stops |
| `x`, `z`, `h` | stop point and direction of travel |
| `side` | `'kiri'`: the stop is on the left kerb, the side of the shuttle's door |
| `shelter` | `[x, z]` of the shelter on the sidewalk |
| `road` | road id |

Current list (generated, loop about 3,1 km without U turns):

| # | id | name | street | x | z | heading |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | gerbang | Gerbang Ma Chung | Jalan Karangampel Timur | 85,6 | -209,8 | west |
| 2 | karangampel | Jalan Karangampel Timur | Jalan Karangampel Timur | -15,0 | -250,6 | west |
| 3 | tidar | Jalan Puncak Tidar | Jalan Puncak Tidar | 331,7 | 214,2 | east |
| 4 | lawu | Villa Puncak Lawu | Villa Puncak Lawu | 472,2 | 21,2 | north |
| 5 | candi | Jalan Raya Candi V | Jalan Raya Candi V | 419,7 | -231,3 | west |

Legs (shortest drivable route on core lanes, no U turn): Gerbang Ma Chung to Jalan Karangampel
Timur 109 m; to Jalan Puncak Tidar 1.415 m (west through the signal, around the block north of
Jalan Karangampel Timur, back through the east signal and down to the Villa Puncak Tidar
roundabouts); to Villa Puncak Lawu 392 m; to Jalan Raya Candi V 796 m; back to Gerbang Ma Chung
390 m. The numbers are in `meta.stats.loopLegs`.

To reuse the stops in 2D: draw each stop at `(x, z)` as `(x, y)` in `machung-2d.json` coordinates;
the stop is on the left side of the road in the direction `h`. The halte names are real street names
from OSM except "Gerbang Ma Chung", which is the campus entrance.

## 8. Sidewalks: `walks`

| field | meaning |
| --- | --- |
| `nodes` | `[[x, z], ...]` |
| `edges[]` | `{ a, b, k, p, x? }`: node ids, kind `'w'` (sidewalk) or `'x'` (zebra crossing, `x` = crossing id), polyline from `a` to `b` |
| `deco` | extra sidewalk strips that are drawn only (pieces too close to turning vehicles, and the original kerb line where a walking path was moved outward) |

Sidewalks follow both sides of each road at `half + 0,9 m` (1,8 m wide). Around junction corners the
walking path is pushed away from turning vehicles until it is at least 2,3 m + 0,15 m plus the local
swept path of the shuttle from every lane and connector center line (the swept path is computed
exactly like `js/sim3d/city.js` does, on the rounded output geometry). Pedestrians walk up to 0,45 m
beside the path, so a pedestrian on the sidewalk is never inside the shield corridor of any vehicle
(half width 1,05 m + 0,45 m margin + 0,3 m body + swept path). `tests/sim3d_peta_walkclear.py`
checks this for every sidewalk point. Small gaps are stitched when the joining segment is clear. The graph is not one
single network (the area has many short dead end streets and roads that run very close together),
but both ends of every zebra crossing connect to sidewalks.

## 9. Scenery

| array | item |
| --- | --- |
| `buildings[]` | `{ p, f, k, r, c, obb? }`: footprint polygon (counter clockwise), floors (estimated, 3,2 m each), kind `'house'`, `'campus'`, `'mosque'`, `'commercial'`, roof `'hip'` or `'flat'`, color index, oriented box `[x, z, len, wid, h]` for hip roofs. Houses have 1 or 2 floors from a seeded random, campus buildings 3 to 5. Buildings that covered a road were dropped or pushed back a little. |
| `areas[]` | `{ p, k }`: green and other areas (`grass`, `park`, `garden`, `wood`, `scrub`, `orchard`, `farmland`, `pitch`, `water`, `cemetery`, and one `campus` polygon) |
| `trees[]` | `[x, z, scale, kind]`, kind `0` tree, `1` bush |
| `labels[]` | `{ t, x, z, h, k }`: text, position, direction, `'campus'` or `'street'` |

## 10. Checks

`tools/osm_to_city.py` prints warnings when a halte cannot be placed or a halte leg has no route
without a U turn. The simulator tests in `tests/sim3d_peta_*.py` run the traffic on this map for a
long time and check that no vehicle leaves the road surface, no two vehicles overlap, nobody stays
stuck, and the safety counters (red light, pedestrian contact) stay at 0.
