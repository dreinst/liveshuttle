// Uji model mandiri pelajaran Persepsi tanpa browser.
// Pemakaian: node tests/persepsi_indep_model.mjs [detik simulasi] [derau]
// Meniru lem di js/lessons/persepsi.js: scene.update tiap 1/60 detik, perc.tick tiap 0,1 detik,
// lalu memeriksa klaim teknis pelajaran dengan kunci jawaban (truth).

import { createScene, LANE_Y } from '../js/lessons/persepsi/scene.js';
import {
  createPerception,
  SCAN_DT,
  HORIZON,
  findConflict,
  predictable,
  trackMotion,
} from '../js/lessons/persepsi/perception.js';

const SIM = Number(process.argv[2] || 240);
const NOISE = Number(process.argv[3] || 1);
const DT = 1 / 60;
const CORRIDOR_LEN = 35;

const scene = createScene({ seed: 11 });
const perc = createPerception({ seed: 23 });
perc.setNoise(NOISE);
perc.tick(scene.world());

const stats = {
  scans: 0,
  rejectedReal: 0,
  rejectedTotal: 0,
  mixedGroups: 0,
  fusedGroups: 0,
  wrongClass: 0,
  camDets: 0,
  conflictScans: 0,
  falseConflictScans: 0,
  falseConflictWho: {},
  crossings: {},
  minGapPedInLane: Infinity,
  thrScans: 0,
  thrFeasibleScans: 0,
  adInView: 0,
  adReported25: 0,
  confirmedMax: 0,
  idAtEnd: 0,
  predictableCrosserScans: 0,
  crosserScans: 0,
  inPathNonCrossing: 0,
};

let acc = 0;
let t = 0;
const halfWidth = (cls, size) => (cls === 'pedestrian' || cls === 'cyclist' ? 0.35 : size.width / 2);
const byId = () => new Map(scene.world().relevant.map((o) => [o.id, o]));

while (t < SIM) {
  scene.update(DT);
  t += DT;
  acc += DT;
  while (acc >= SCAN_DT - 1e-9) {
    acc -= SCAN_DT;
    perc.tick(scene.world(), SCAN_DT);
    stats.scans++;
    const L = perc.last;
    const ego = scene.ego;
    const objs = byId();

    // hantu: deteksi nyata yang ikut ditolak
    for (const r of L.rejected) {
      stats.rejectedTotal++;
      if (r.members.some((d) => d.truth != null)) stats.rejectedReal++;
    }
    // asosiasi salah: satu kelompok berisi deteksi dari objek berbeda
    for (const f of L.fused) {
      stats.fusedGroups++;
      const truths = new Set(f.members.map((d) => d.truth));
      if (truths.size > 1) stats.mixedGroups++;
    }
    for (const d of L.camera.dets) {
      stats.camDets++;
      if (d.truth != null && objs.get(d.truth) && objs.get(d.truth).kind !== d.cls) stats.wrongClass++;
    }

    // ambang 90% seperti langkah 4 (fusi tanpa pelacakan), daerah layar desktop
    stats.thrScans++;
    const vis = (o) => o.x > ego.x && o.x < ego.x + 44 && o.y > -10.5 && o.y < 8.5;
    if (L.fused.some((f) => f.truth != null && Math.round(f.conf * 100) < 90 && vis(f))) stats.thrFeasibleScans++;

    // positif palsu iklan halte pada ambang 25%
    const adsAhead = scene.world().adPanels.filter((a) => a.x - ego.x > 6 && a.x - ego.x < 36);
    if (adsAhead.length) {
      stats.adInView++;
      if (L.fused.some((f) => f.fake === 'iklan' && Math.round(f.conf * 100) >= 25)) stats.adReported25++;
    }

    // prediksi dan konflik (ambang 50%)
    const confirmed = perc.tracks.filter((tr) => tr.confirmed);
    stats.confirmedMax = Math.max(stats.confirmedMax, confirmed.length);
    const cands = confirmed
      .filter((tr) => Math.round(tr.conf * 100) >= 50 && predictable(tr))
      .map((tr) => ({ track: tr, cls: tr.cls, halfWidth: halfWidth(tr.cls, tr.size) }));
    const x0 = ego.x + ego.length / 2;
    const c = findConflict(cands, { x0, x1: x0 + CORRIDOR_LEN, y: LANE_Y, half: ego.width / 2 + 0.6 }, HORIZON);
    for (const a of scene.actors) {
      if (a.role !== 'crosser' || a.state === 'wait') continue;
      if (a.state === 'cross') {
        stats.crosserScans++;
        const tr = confirmed.find((x) => x.truth === a.id);
        if (tr && predictable(tr)) stats.predictableCrosserScans++;
      }
      const rec = (stats.crossings[a.id] ||= { start: +t.toFixed(1), warnAt: null, tau: null, inLaneAt: null, minGap: Infinity, egoStopped: false });
      const inLane = a.y < -0.2 && a.y > -3.3;
      if (inLane && rec.inLaneAt == null) rec.inLaneAt = +t.toFixed(1);
      if (inLane) {
        const gap = a.x - a.radius - (ego.x + ego.length / 2);
        if (gap > -3) rec.minGap = Math.min(rec.minGap, +gap.toFixed(2));
        if (ego.speed < 0.1) rec.egoStopped = true;
      }
    }
    if (c) {
      stats.conflictScans++;
      const truth = c.track.truth;
      const actor = scene.actors.find((a) => a.id === truth);
      const legit = actor && actor.role === 'crosser' && actor.state === 'cross';
      if (!legit) {
        stats.falseConflictScans++;
        const key = `${c.cls}:${actor ? actor.role + '/' + (actor.state || '') : truth}:${c.inPath ? 'inPath' : 'pred'}`;
        stats.falseConflictWho[key] = (stats.falseConflictWho[key] || 0) + 1;
      } else if (!c.inPath) {
        const rec = stats.crossings[truth];
        if (rec && rec.warnAt == null) {
          rec.warnAt = +t.toFixed(1);
          rec.tau = +c.tau.toFixed(1);
        }
      }
    }
  }
}
stats.idAtEnd = perc.tracks.reduce((m, tr) => Math.max(m, tr.id), 0);

const crossings = Object.entries(stats.crossings).map(([id, r]) => ({ id, ...r }));
const summary = {
  simSeconds: SIM,
  noise: NOISE,
  scans: stats.scans,
  rejectedTotal: stats.rejectedTotal,
  rejectedReal: stats.rejectedReal,
  mixedGroupsPct: +((100 * stats.mixedGroups) / stats.fusedGroups).toFixed(2),
  cameraWrongClassPct: +((100 * stats.wrongClass) / stats.camDets).toFixed(2),
  thresholdFeasiblePct: +((100 * stats.thrFeasibleScans) / stats.thrScans).toFixed(1),
  adFalsePositiveAt25Pct: stats.adInView ? +((100 * stats.adReported25) / stats.adInView).toFixed(1) : null,
  conflictScans: stats.conflictScans,
  falseConflictScans: stats.falseConflictScans,
  falseConflictWho: stats.falseConflictWho,
  crosserPredictablePct: +((100 * stats.predictableCrosserScans) / Math.max(1, stats.crosserScans)).toFixed(1),
  crossingsTotal: crossings.length,
  crossingsWarned: crossings.filter((c) => c.warnAt != null).length,
  crossingsEgoStopped: crossings.filter((c) => c.egoStopped).length,
  minGapInLane: Math.min(...crossings.map((c) => c.minGap)),
  trackIdsPerMinute: +((stats.idAtEnd / SIM) * 60).toFixed(1),
  confirmedMax: stats.confirmedMax,
  crossings,
};
console.log(JSON.stringify(summary, null, 1));
