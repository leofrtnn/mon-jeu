// Hors-jeu (étape 5b) : type d'action, position de l'attaquant et de la ligne au choix de la passe
// et au départ du ballon, avance de l'attaquant, synchronisation appel / passeur.
// Usage : [PACE0=1] node tools/bench/offside-report.mjs [matchs=16] [graine=100] [exemples=0]. Observation seulement.
import { fork } from 'node:child_process';
const L = 105;
if (process.env.WORKER) {
  if (process.env.PACE0) globalThis.__X = { pace0: 1 };
  const { cfgFor, createMatch, LiveSim } = await import('./common.mjs');
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = 1 / 96;
  const rows = [], runsAll = [];
  const line = (sim, side) => { const dir = sim.dir(side); return sim.list(1 - side).map((q) => sim.X(q) * dir).sort((a, b) => b - a)[1]; };
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m);
    const po = sim.passOption.bind(sim);
    sim.passOption = (h, r) => { const o = po(h, r); if (o) { const dir = sim.dir(h.side); o._t = sim.now; o._gap = sim.X(r) * dir - line(sim, h.side); o._role = r.role || '-'; o._since = r._roleT != null ? sim.now - r._roleT : null; o._vf = (r.vx || 0) * dir; o._lineBall = line(sim, h.side) - sim.P.x * dir; o._goRun = !!r.goRun; } return o; };
    const dp = sim.doPass.bind(sim);
    sim.doPass = (h, o, out) => {
      const A = h.team, before = A.stats.offsides, r = o.r, dir = sim.dir(h.side);
      const rec = o.offside ? { seed: base + g, t: sim.now, min: m.minute, role: o._role, goRun: o._goRun, delay: o._t != null ? sim.now - o._t : null, gapDec: o._gap, gapKick: sim.X(r) * dir - line(sim, h.side), since: o._since, vfDec: o._vf, vfKick: (r.vx || 0) * dir, pace: r._pace?.pace || '—', lineBall: o._lineBall, type: o.through ? 'en profondeur' : o.lofted ? 'levée' : 'au sol', len: Math.hypot(o.tx - sim.X(h), o.ty - sim.Y(h)) } : null;
      if (!o.offside && (o._role === 'run' || o._role === 'hold')) runsAll.push({ gapDec: o._gap, since: o._since });
      const res = dp(h, o, out);
      if (rec) { rec.whistled = A.stats.offsides > before; rows.push(rec); }
      return res;
    };
    for (let k = 0; k < 2e6 && m.phase !== 'ft'; k++) {
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      for (const p of sim.players.values()) { if (p.role !== p._roleSeen) { p._roleSeen = p.role; p._roleT = sim.now; } }
    }
  }
  process.send({ rows, runsAll }, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 16), base0 = +(process.argv[3] || 100), NEX = +(process.argv[4] || 0), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const rows = parts.flatMap((p) => p.rows), runs = parts.flatMap((p) => p.runsAll), W = rows.filter((r) => r.whistled);
  const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1].toFixed(2) : '—'; };
  const cnt = (a, f) => { const c = {}; a.forEach((r) => { const k = f(r); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v / N).toFixed(2)}`).join(' · '); };
  console.log(`${N} matchs ${process.env.PACE0 ? '(5a : anciens plafonds)' : '(5b)'} — passes vers un joueur hors-jeu ${(rows.length / N).toFixed(2)} / match · sifflées ${(W.length / N).toFixed(2)}`);
  console.log('  par rôle du receveur :', cnt(W, (r) => (r.goRun ? 'une-deux' : r.role)));
  console.log('  par type de passe   :', cnt(W, (r) => r.type));
  console.log('  par phase de l\'appel :', cnt(W, (r) => (r.role !== 'run' && r.role !== 'hold' ? 'hors appel' : r.since == null ? '?' : r.since < 0.5 ? 'départ < 0,5 s' : r.since < 1.5 ? '0,5-1,5 s' : '> 1,5 s')));
  console.log(`  avance de l'attaquant sur l'avant-dernier défenseur : au choix de la passe ${med(W.map((r) => r.gapDec))} m · au départ du ballon ${med(W.map((r) => r.gapKick))} m · délai choix → départ ${med(W.map((r) => r.delay))} s`);
  console.log(`  vitesse vers l'avant de l'attaquant : au choix ${med(W.map((r) => r.vfDec))} · au départ ${med(W.map((r) => r.vfKick))} m/s · ligne − ballon ${med(W.map((r) => r.lineBall))} m · longueur de passe ${med(W.map((r) => r.len))} m`);
  console.log(`  temps depuis le début du rôle (appel) au choix de la passe : ${med(W.map((r) => r.since))} s · allure demandée au départ :`, cnt(W, (r) => r.pace));
  console.log(`  passes NON hors-jeu vers un appel : ${(runs.length / N).toFixed(1)} / match · avance au choix ${med(runs.map((r) => r.gapDec))} m · temps depuis le début de l'appel ${med(runs.map((r) => r.since))} s`);
  console.log('  par graine (sifflés) :', [...Array(N)].map((_, i) => W.filter((r) => r.seed === base0 + i).length).join(' '));
  for (const r of W.slice(0, NEX)) console.log(`   graine ${r.seed} ${r.min}' ${r.goRun ? 'une-deux' : r.role} · ${r.type} ${r.len.toFixed(0)} m · avance ${r.gapDec.toFixed(2)} → ${r.gapKick.toFixed(2)} m en ${r.delay?.toFixed(2)} s · v ${r.vfDec.toFixed(1)} → ${r.vfKick.toFixed(1)} m/s · appel depuis ${r.since?.toFixed(2)} s · ${r.pace}`);
}
