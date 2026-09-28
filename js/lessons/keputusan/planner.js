// Perencana perilaku mobil otonom: mesin keadaan (state machine) dengan tujuh keadaan.
//
//   melaju     MELAJU             jalan normal di lajur kiri dengan kecepatan target
//   mengikuti  MENGIKUTI          ada kendaraan di depan di lajur yang sama, jaga jarak
//   lampu      BERHENTI DI LAMPU  lampu merah (atau kuning yang masih sempat), berhenti di garis henti
//   pejalan    MEMBERI JALAN      pejalan kaki di zebra cross, berhenti dan tunggu
//   celah      MENUNGGU CELAH     kendaraan di depan mogok, tunggu lajur kanan cukup kosong
//   salip      MENYALIP           pindah ke lajur kanan dan lewati kendaraan mogok
//   kembali    KEMBALI KE LAJUR   masuk lagi ke lajur kiri
//
// Setiap perpindahan keadaan mengirim event berisi alasan dalam bahasa sehari-hari.
// Penyederhanaan: persepsi dianggap sempurna. Dalam jangkauan RANGE (80 m) mobil tahu posisi
// dan jenis semua objek dengan tepat, dan radar jarak jauh melihat mobil lawan sampai RANGE_FAR.

import { Path } from '../../engine/geometry.js';
import { purePursuit } from '../../engine/control.js';
import { clamp, lerp, fmt, kmhToMs, toLocal } from '../../engine/math.js';
import { L, EGO_Y, ONC_Y, STOP_E, ZEBRA_HALF, YIELD_GAP, STALL_X, RANGE, RANGE_FAR, ONC_CRUISE } from './world.js';

export const A_LIGHT = 2; // perlambatan rencana untuk lampu merah (m/s^2)
export const A_PED = 1.5; // perlambatan rencana untuk pejalan kaki
export const A_FOLLOW = 1.5; // perlambatan rencana di belakang kendaraan
export const A_COMFORT = 3; // batas pengereman nyaman untuk dilema lampu kuning
export const GAP_STALL = 8; // jarak berhenti di belakang mobil mogok (m)
export const V_OT_MAX = kmhToMs(30); // kecepatan saat menyalip
export const A_OT = 2; // percepatan saat menyalip
export const LC1 = 10; // panjang manuver keluar ke lajur kanan (m)
export const LC2 = 24; // panjang manuver kembali ke lajur kiri (m)
export const PASS_CLEAR = 3; // jarak bebas di depan mobil mogok sebelum kembali (m)
export const T_SAFE = 2; // cadangan waktu celah (detik)
export const T_STALL = 1.5; // lama mobil di depan harus tetap diam sebelum dianggap mogok (detik)

/** Waktu (detik) untuk menempuh jarak D mulai dari kecepatan v0, percepatan a, sampai vmax. */
export function timeToCover(D, v0, a, vmax) {
  if (D <= 0) return 0;
  v0 = Math.max(0, v0);
  if (v0 >= vmax) return D / Math.max(0.1, v0);
  const tAcc = (vmax - v0) / a;
  const dAcc = ((v0 + vmax) / 2) * tAcc;
  if (D <= dAcc) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * D)) / a;
  return tAcc + (D - dAcc) / vmax;
}

const brakeStart = (v, A) => (v * v) / (2 * A) + 2;

function manY(m, x) {
  if (x <= m.x0) return EGO_Y;
  if (x < m.x0 + LC1) return lerp(EGO_Y, ONC_Y, (1 - Math.cos((Math.PI * (x - m.x0)) / LC1)) / 2);
  if (x <= m.x1) return ONC_Y;
  if (x < m.x2) return lerp(ONC_Y, EGO_Y, (1 - Math.cos((Math.PI * (x - m.x1)) / LC2)) / 2);
  return EGO_Y;
}

const COLOR_WORD = { red: 'merah', yellow: 'kuning', green: 'hijau' };

export function createPlanner(world) {
  const ego = world.ego;
  const events = [];
  const P = {
    state: 'melaju',
    prev: null,
    stateTime: 0,
    changedAt: 0,
    short: 'Mobil melaju di lajur kiri.',
    targetSpeed: kmhToMs(40),
    commitA: A_LIGHT,
    stopShift: 0,
    stillTime: 0,
    per: null,
    limit: null,
    yieldTo: null,
    yieldStopped: false,
    yellowSeen: -1,
    yellowFarNoted: -1,
    yellow: null,
    goCommit: null,
    man: null,
    gap: null,
    blockLogged: null,
    blockLoggedAt: -10,
    aeb: false,
    aebLoggedAt: -10,
    refPts: [],
  };

  const emit = (e) => events.push({ time: world.time, ...e });

  function go(to, text, short) {
    const from = P.state;
    P.prev = from;
    P.state = to;
    P.stateTime = 0;
    P.stillTime = 0;
    P.changedAt = world.time;
    P.short = short || text;
    emit({ type: 'transisi', from, to, text });
  }

  function reset() {
    Object.assign(P, {
      state: 'melaju',
      prev: null,
      stateTime: 0,
      changedAt: 0,
      short: 'Mobil melaju di lajur kiri.',
      commitA: A_LIGHT,
      stopShift: 0,
      stillTime: 0,
      limit: null,
      yieldTo: null,
      yieldStopped: false,
      yellowSeen: world.signal.yellowId,
      yellowFarNoted: world.signal.yellowId,
      yellow: null,
      goCommit: null,
      man: null,
      gap: null,
      blockLogged: null,
      blockLoggedAt: -10,
      aeb: false,
      aebLoggedAt: -10,
    });
    events.length = 0;
    P.per = perceive();
    P.refPts = refPoints();
  }

  // ---------- persepsi (disederhanakan: data benar dalam jangkauan) ----------

  function perceive() {
    const front = ego.x + ego.length / 2;
    // garis henti arah timur berikutnya yang belum dilewati bemper depan
    const k = Math.ceil((front - 0.2 - STOP_E) / L);
    const lx = STOP_E + k * L;
    const dLine = lx - 0.2 - front;
    const line = { x: lx, dLine, dStop: dLine - 0.6, seen: dLine < RANGE };
    // pejalan kaki di zebra cross di depan
    let ped = null;
    for (const p of world.peds) {
      if (p.state === 'selesai') continue;
      const dStop = p.zx - ZEBRA_HALF - YIELD_GAP - 0.3 - front;
      if (dStop < -1.5 || dStop > RANGE) continue;
      if (!ped || dStop < ped.dStop) ped = { p, dStop, dZebra: p.zx - ZEBRA_HALF - front };
    }
    // mobil mogok di lajur sendiri
    let lead = null;
    if (world.stalled.active) {
      const k2 = Math.max(world.stalled.fromK, Math.floor((front - 0.5 + 2.25 - STALL_X) / L) + 1);
      const sx = STALL_X + k2 * L;
      const d = sx - 2.25 - front;
      if (d < RANGE) lead = { x: sx, d };
    }
    return { front, line, ped, lead };
  }

  // ---------- celah di lajur kanan ----------

  function evaluateGap(lead) {
    const v0 = Math.max(0, ego.speed);
    const vOt = Math.min(P.targetSpeed, V_OT_MAX);
    const x0 = ego.x;
    const x1 = lead.x + 2.25 + PASS_CLEAR + ego.length / 2;
    const x2 = x1 + LC2;
    const T = timeToCover(x2 - x0, v0, A_OT, vOt);
    const need = T + T_SAFE;
    const zoneEnd = x2 + ego.length / 2 + 3;
    let minT = Infinity;
    let block = null;
    let dist = Infinity;
    const egoFront = ego.x + ego.length / 2;
    for (const c of world.oncoming) {
      if (c.x + c.length / 2 < ego.x - ego.length / 2 - 0.5) continue; // sudah lewat
      if (c.x - c.length / 2 - egoFront > RANGE_FAR) continue; // di luar jangkauan radar
      const dd = c.x - c.length / 2 - zoneEnd;
      const t = dd <= 0 ? 0 : timeToCover(dd, c.speed, 2, c.cruise);
      if (t < minT) {
        minT = t;
        block = c;
        dist = dd;
      }
    }
    return { ok: minT >= need, minT, need, T, x0, x1, x2, zoneEnd, vOt, sx: lead.x, blockId: block ? block.id : null, dist, vOnc: block ? block.cruise : ONC_CRUISE };
  }

  // ---------- pengereman darurat sederhana (jaring pengaman) ----------

  function guardDistance() {
    let best = Infinity;
    let what = null;
    const half = ego.width / 2 + 0.3;
    const check = (o, hl, hw, name) => {
      const q = toLocal(ego, o);
      if (q.x <= 0 || q.x > 60 || Math.abs(q.y) > half + hw) return;
      const d = q.x - ego.length / 2 - hl;
      if (d < best) {
        best = d;
        what = name;
      }
    };
    if (ego.y > -1.2) for (const c of world.oncoming) check(c, c.length / 2, c.width / 2, 'mobil dari arah berlawanan');
    for (const p of world.peds) if (p.state === 'menyeberang') check(p, p.radius, p.radius, 'pejalan kaki');
    return { d: best, what };
  }

  // ---------- jalur referensi untuk setir ----------

  function refY(x) {
    return P.man ? manY(P.man, x) : EGO_Y;
  }

  function refPoints() {
    const pts = [];
    for (let x = ego.x - 6; x <= ego.x + 46; x += 1.5) pts.push({ x, y: refY(x) });
    return pts;
  }

  // ---------- langkah keputusan dan kendali ----------

  function update(dt) {
    const s = world.signal;
    const v = ego.speed;
    const per = perceive();
    P.per = per;
    P.stateTime += dt;
    const { front, line, ped, lead } = per;
    const light = s.main;

    // keputusan "terus" saat kuning selesai begitu bemper depan melewati garis henti
    if (P.goCommit && front > P.goCommit.lineX + 0.2) {
      const rec = P.yellow;
      if (rec && rec.id === P.goCommit.id && !rec.result) {
        rec.result = { kind: 'go', left: s.yellowLeft(), red: light === 'red' };
        emit({ type: 'kuning-selesai', record: rec });
      }
      P.goCommit = null;
    }

    // lampu kuning yang mulai saat persimpangan masih di luar jangkauan pandang
    if (light === 'yellow' && s.yellowId !== P.yellowSeen && s.yellowId !== P.yellowFarNoted && !line.seen && line.dLine > 0) {
      P.yellowFarNoted = s.yellowId;
      emit({
        type: 'catatan',
        tag: 'keputusan',
        text: `Lampu berubah kuning saat garis henti masih ${fmt(line.dLine, 0)} m di depan, di luar jangkauan pandang ${fmt(RANGE)} m. Belum ada yang perlu diputuskan.`,
      });
    }

    // dilema lampu kuning: diputuskan sekali saat kuning pertama terlihat
    if (P.state === 'melaju' && light === 'yellow' && line.seen && line.dLine > -0.2 && P.yellowSeen !== s.yellowId) {
      P.yellowSeen = s.yellowId;
      const d = Math.max(0, line.dLine);
      const sd = (v * v) / (2 * A_COMFORT);
      const stop = d > sd;
      const rec = { id: s.yellowId, time: world.time, v, d, sd, stop, lineX: line.x, frontX: front, result: null, maxDecel: 0 };
      P.yellow = rec;
      emit({ type: 'kuning', record: rec });
      if (stop) {
        // Biasanya mobil berhenti 0,6 m sebelum garis. Kalau d hanya sedikit lebih besar dari
        // jarak henti nyaman, titik berhentinya digeser mendekati garis (tetap sebelum garis)
        // supaya perlambatannya tidak melewati 3 m/s².
        const target = Math.max(line.dStop, Math.min(sd, d - 0.05));
        P.stopShift = target - line.dStop;
        P.commitA = Math.max(A_LIGHT, (v * v) / (2 * Math.max(0.3, target)));
        go(
          'lampu',
          `Lampu kuning, garis henti ${fmt(d, 1)} m di depan. Jarak henti nyaman ${fmt(sd, 1)} m lebih pendek, jadi mobil berhenti.`,
          'Lampu kuning, mobil masih sempat berhenti dengan nyaman.',
        );
      } else {
        P.goCommit = { id: rec.id, lineX: line.x };
        emit({
          type: 'catatan',
          tag: 'keputusan',
          text: `Lampu kuning, garis henti ${fmt(d, 1)} m di depan. Jarak henti nyaman ${fmt(sd, 1)} m lebih panjang, jadi mobil terus melaju.`,
        });
        P.short = 'Lampu kuning, mobil terus melaju melewati persimpangan.';
      }
    }

    switch (P.state) {
      case 'melaju': {
        const cands = [];
        const followRange = Math.min(RANGE, Math.max(35, (v * v) / (2 * A_FOLLOW) + GAP_STALL + 6));
        if (lead && lead.d <= followRange) cands.push({ to: 'mengikuti', d: lead.d - GAP_STALL });
        if (ped && ped.dStop <= brakeStart(v, A_PED) + 4) cands.push({ to: 'pejalan', d: ped.dStop });
        const committedGo = P.goCommit && P.goCommit.lineX === line.x;
        if (line.seen && line.dLine > -0.2 && !committedGo && light === 'red' && line.dStop <= brakeStart(v, A_LIGHT)) cands.push({ to: 'lampu', d: line.dStop });
        if (!cands.length) {
          if (!P.goCommit) P.short = v < 0.5 ? 'Mobil mulai melaju.' : 'Mobil melaju di lajur kiri.';
          break;
        }
        cands.sort((a, b) => a.d - b.d);
        const c = cands[0];
        if (c.to === 'mengikuti') {
          P.commitA = Math.max(A_FOLLOW, (v * v) / (2 * Math.max(0.5, c.d)));
          go(
            'mengikuti',
            `Ada mobil berhenti ${fmt(lead.d, 0)} m di depan di lajur yang sama. Mobil melambat dan menjaga jarak.`,
            `Ada mobil berhenti ${fmt(lead.d, 0)} m di depan, mobil melambat.`,
          );
        } else if (c.to === 'pejalan') {
          P.commitA = Math.max(A_PED, (v * v) / (2 * Math.max(0.3, c.d)));
          P.yieldTo = ped.p.id;
          P.yieldStopped = false;
          const act = ped.p.state === 'menunggu' ? 'menunggu' : 'sedang menyeberang';
          go(
            'pejalan',
            `Pejalan kaki ${act} di zebra cross ${fmt(Math.max(0, ped.dZebra), 0)} m di depan. Sesuai Pasal 106 ayat (2), pejalan kaki didahulukan, jadi mobil mulai melambat.`,
            'Ada pejalan kaki di zebra cross, mobil melambat untuk memberi jalan.',
          );
        } else {
          P.commitA = Math.max(A_LIGHT, (v * v) / (2 * Math.max(0.3, c.d)));
          P.stopShift = 0;
          go('lampu', `Lampu merah ${fmt(Math.max(0, line.dLine), 0)} m di depan, mulai mengerem.`, 'Lampu merah, mobil mengerem ke garis henti.');
        }
        break;
      }
      case 'lampu': {
        const rec = P.yellow;
        if (rec && rec.stop && !rec.result && rec.lineX === line.x) {
          // tahap akhir (di bawah 1 m/s) hanya menahan mobil tetap diam, jadi tidak dihitung
          if (v > 1) rec.maxDecel = Math.max(rec.maxDecel, -ego.accel);
          if (v < 0.05) {
            rec.result = { kind: 'stop', gap: Math.max(0, line.dLine), maxDecel: rec.maxDecel };
            emit({ type: 'kuning-selesai', record: rec });
          }
        }
        if (light === 'green') go('melaju', 'Lampu hijau, jalan lagi.', 'Lampu hijau, mobil jalan lagi.');
        else if (line.dLine < -0.2) go('melaju', 'Mobil sudah melewati garis henti, lanjut melaju.');
        else P.short = v > 0.1 ? `Lampu ${COLOR_WORD[light]}, mobil mengerem ke garis henti.` : `Lampu ${COLOR_WORD[light]}, mobil menunggu di belakang garis henti.`;
        break;
      }
      case 'pejalan': {
        const tp = world.peds.find((q) => q.id === P.yieldTo);
        if (tp && tp.state === 'menyeberang' && v < 0.3) P.yieldStopped = true;
        if (!tp || tp.state === 'selesai') {
          const stopped = P.yieldStopped;
          P.yieldTo = null;
          go('melaju', 'Pejalan kaki sudah sampai di trotoar seberang, lanjut jalan.', 'Pejalan kaki sudah menyeberang, mobil jalan lagi.');
          if (stopped) emit({ type: 'yield-selesai' });
        } else if (tp.state === 'menyeberang') P.short = 'Pejalan kaki sedang menyeberang, mobil menunggu.';
        else P.short = v > 0.3 ? 'Pejalan kaki menunggu di tepi zebra cross, mobil melambat.' : 'Mobil berhenti dan mempersilakan pejalan kaki menyeberang.';
        break;
      }
      case 'mengikuti':
        // Mobil otonom berhenti di belakangnya dulu, lalu mengamati: mobil yang tetap diam
        // selama T_STALL detik dengan lampu hazard menyala dianggap mogok.
        P.stillTime = lead && v < 0.2 && lead.d < GAP_STALL + 2.5 ? P.stillTime + dt : 0;
        if (!lead) go('melaju', 'Mobil di depan sudah disingkirkan, lanjut melaju.');
        else if (P.stillTime >= T_STALL) {
          P.blockLogged = null;
          P.stillTime = 0;
          go(
            'celah',
            `Mobil di depan tetap diam selama ${fmt(T_STALL, 1)} detik dan lampu hazard-nya menyala, jadi dianggap mogok. Mobil memeriksa lajur kanan.`,
            'Mobil di depan mogok. Mobil memeriksa celah di lajur kanan.',
          );
        } else if (P.stillTime > 0) P.short = 'Mobil berhenti dan mengamati apakah mobil di depan mogok.';
        else P.short = `Ada mobil berhenti ${fmt(lead.d, 0)} m di depan, mobil melambat dan menjaga jarak.`;
        break;
      case 'celah': {
        if (!lead) {
          P.gap = null;
          go('melaju', 'Mobil mogok sudah disingkirkan, lanjut melaju.');
          break;
        }
        const gap = evaluateGap(lead);
        P.gap = gap;
        if (P.stateTime > 1.2 && gap.ok && v < 2) {
          P.man = { x0: gap.x0, x1: gap.x1, x2: gap.x2, sx: gap.sx, vOt: gap.vOt, need: gap.need, zoneEnd: gap.zoneEnd };
          const why = Number.isFinite(gap.minT)
            ? `Celah cukup: mobil lawan terdekat tiba dalam ${fmt(gap.minT, 1)} detik, menyalip butuh ${fmt(gap.need, 1)} detik.`
            : `Tidak ada mobil lawan dalam jangkauan radar ${fmt(RANGE_FAR)} m.`;
          go('salip', `${why} Mobil menyalip lewat lajur kanan sesuai Pasal 109 ayat (1).`, 'Celah cukup, mobil menyalip lewat lajur kanan.');
        } else if (!gap.ok) {
          const inZone = gap.minT < 0.05;
          P.short = inZone
            ? 'Mobil lawan sedang di zona salip, mobil menunggu.'
            : `Mobil lawan tiba ${fmt(gap.minT, 1)} detik lagi, menyalip butuh ${fmt(gap.need, 1)} detik. Mobil menunggu.`;
          if (gap.blockId !== P.blockLogged && world.time - P.blockLoggedAt > 2.5) {
            P.blockLogged = gap.blockId;
            P.blockLoggedAt = world.time;
            emit({
              type: 'catatan',
              tag: 'cek celah',
              text: inZone
                ? 'Mobil dari arah berlawanan sedang melintas di zona salip, jadi tunggu.'
                : `Mobil dari arah berlawanan tiba di zona salip dalam ${fmt(gap.minT, 1)} detik. Menyalip butuh ${fmt(gap.need, 1)} detik termasuk cadangan ${fmt(T_SAFE)} detik, jadi tunggu.`,
            });
          }
        } else P.short = 'Lajur kanan kosong, mobil memastikan sekali lagi.';
        break;
      }
      case 'salip':
        P.short = 'Mobil menyalip mobil mogok lewat lajur kanan.';
        if (ego.x >= P.man.x1) go('kembali', `Mobil mogok sudah terlewati dengan jarak ${fmt(PASS_CLEAR)} m, kembali ke lajur kiri.`, 'Mobil kembali ke lajur kiri.');
        break;
      case 'kembali':
        if (ego.x >= P.man.x2 - 0.5 && Math.abs(ego.y - EGO_Y) < 0.2) {
          P.man = null;
          P.gap = null;
          go('melaju', 'Sudah kembali di lajur kiri, lanjut melaju.', 'Mobil sudah kembali di lajur kiri.');
          emit({ type: 'salip-selesai' });
        }
        break;
      default:
        break;
    }

    // ---------- kecepatan ----------
    let vDes = P.targetSpeed;
    let limit = null;
    if (P.state === 'lampu') limit = { d: line.dStop + P.stopShift, A: P.commitA, kind: 'lampu' };
    else if (P.state === 'pejalan') {
      const tp = world.peds.find((q) => q.id === P.yieldTo);
      if (tp) limit = { d: tp.zx - ZEBRA_HALF - YIELD_GAP - 0.3 - front, A: P.commitA, kind: 'pejalan' };
    } else if ((P.state === 'mengikuti' || P.state === 'celah') && lead) limit = { d: lead.d - GAP_STALL, A: P.commitA, kind: 'jarak' };
    if ((P.state === 'salip' || P.state === 'kembali') && P.man) vDes = Math.min(vDes, P.man.vOt);
    P.limit = limit;

    let vCmd = vDes;
    let ff = 0;
    if (limit) {
      const vl = limit.d <= 0.05 ? 0 : Math.sqrt(2 * limit.A * limit.d);
      // toleransi kecil: tepat saat keputusan diambil vl sama dengan kecepatan jelajah, dan
      // pengereman harus mulai di langkah itu juga (tanpa telat satu langkah)
      if (vl < vCmd + 0.05) {
        vCmd = Math.min(vCmd, vl);
        if (vl > 0.05 && v > vl - 0.3) ff = -limit.A;
      }
    }
    let accel = ff + 2 * (vCmd - v);
    // perubahan kecepatan target biasa memakai perlambatan nyaman, rem keras hanya untuk hambatan
    if (!ff && vCmd === vDes) accel = Math.max(accel, -A_LIGHT);
    const guard = guardDistance();
    P.aeb = guard.d < (v * v) / (2 * 6) + 1.5 && v > 0.05;
    if (P.aeb) {
      accel = -ego.maxBrake;
      if (v > 1 && world.time - P.aebLoggedAt > 3) {
        P.aebLoggedAt = world.time;
        emit({ type: 'bahaya', text: `Rem darurat: ada ${guard.what} ${fmt(Math.max(0, guard.d), 1)} m di depan.` });
      }
    }
    accel = clamp(accel, -ego.maxBrake, ego.maxAccel);
    if (limit && limit.d <= 0.15 && v < 0.4) accel = -Math.max(1.5, limit.A); // tahan mobil tetap diam

    // ---------- setir: pure pursuit ke jalur referensi ----------
    P.refPts = refPoints();
    const pp = purePursuit(ego, new Path(P.refPts), { lookahead: 3.5, gain: 0.45 });
    ego.step(dt, { accel, steer: pp.steer });
  }

  function shift(dx) {
    if (P.man) {
      P.man.x0 += dx;
      P.man.x1 += dx;
      P.man.x2 += dx;
      P.man.sx += dx;
      P.man.zoneEnd += dx;
    }
    if (P.goCommit) P.goCommit.lineX += dx;
    if (P.yellow) {
      P.yellow.lineX += dx;
      P.yellow.frontX += dx;
    }
    if (P.gap) {
      for (const k of ['x0', 'x1', 'x2', 'zoneEnd', 'sx']) P.gap[k] += dx;
    }
    P.refPts = refPoints();
  }

  function setTarget(v) {
    P.targetSpeed = v;
  }

  function drainEvents() {
    return events.splice(0);
  }

  reset();
  return {
    P,
    update,
    reset,
    shift,
    setTarget,
    drainEvents,
    get yieldTo() {
      return P.yieldTo;
    },
  };
}
