// Déplacements et cohérence des comportements (étape 5) : stabilité des cibles, arbitrage des
// intentions, allures, distances, orientation, pressing, marquage, appels, ballon libre.
// Usage : node tools/bench/move-report.mjs [matchs=4] [graine=100]   (pas 1/96 s par défaut ; DT=… pour changer)
// Observation seulement : aucun hasard consommé, aucun effet sur le match.
import { fork } from 'node:child_process';
import { cfgFor, createMatch, LiveSim, L, W } from './common.mjs';

if (process.env.WORKER) {
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = +(process.env.DT || 1 / 96);
  const A = { t: 0, ticks: 0, jumps: 0, rev: 0, back: 0, crab: 0, walk: 0, jog: 0, run: 0, sprint: 0, dist: 0, osc: 0, switches: 0, maxArb: 0, viol: 0,
    pressD: [], pressT: [], markD: [], runs: 0, runsOk: 0, looseT: [], byPri: {}, events: {}, outfield: 0, req: {}, paceSw: 0, why: {} };
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m);
    const prev = new Map(); let lostT = null, lostSide = -1, looseT0 = null, lastPoss = -1;
    for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      if (m.phase !== 'live' || sim.restart || sim.celebrate > 0) { prev.forEach((q) => { q.key = null; q.key2 = null; }); continue; }   // (les transitions autour d'un arrêt de jeu ne sont pas des oscillations)
      A.ticks++;
      const P = sim.P, h = sim.holder && !sim.inHands ? sim.holder : null;
      // Pressing : distance du défenseur le plus proche au porteur ; délai de mise sous pression après une perte.
      if (sim.poss !== lastPoss) { lostT = sim.now; lostSide = lastPoss; lastPoss = sim.poss; }
      if (h) {
        let d = 99; for (const o of sim.players.values()) if (o.side !== h.side && !o.gk) d = Math.min(d, sim.dist(o, sim.X(h), sim.Y(h)));
        if (k % 24 === 0) A.pressD.push(d);
        if (lostT != null && d < 3) { A.pressT.push(sim.now - lostT); lostT = null; }
      }
      // Ballon libre : temps avant le premier contact.
      if (!sim.holder && !sim.pending && !sim.shot) { if (looseT0 == null) looseT0 = sim.now; } else if (looseT0 != null) { A.looseT.push(sim.now - looseT0); looseT0 = null; }
      for (const p of sim.players.values()) {
        if (p.gk) continue;
        const q = prev.get(p) || {}, tx = p.tx * L, ty = p.ty * W, sp = p.speed || 0, mv = Math.atan2(p.vy || 0, p.vx || 0);
        if (q.tx != null && Math.hypot(tx - q.tx, ty - q.ty) > 3) A.jumps++;
        if (sp > 2.5 && q.sp > 2.5) { if (sim.now - (q.t0 ?? 0) > 0.5) { if (Math.abs(Math.atan2(Math.sin(mv - q.mv0), Math.cos(mv - q.mv0))) > 2.1) A.rev++; q.mv0 = mv; q.t0 = sim.now; } }
        else { q.mv0 = mv; q.t0 = sim.now; }
        if (sp > 2) { const rel = Math.abs(Math.atan2(Math.sin(mv - (p.face || 0)), Math.cos(mv - (p.face || 0)))); if (rel > 2.2) A.back += dt; else if (rel > 0.9) A.crab += dt; }
        A[sp < 2 ? 'walk' : sp < 4 ? 'jog' : sp < 5.5 ? 'run' : 'sprint'] += dt; A.dist += sp * dt; A.t += dt;
        // Intentions (étape 5a) : changements et oscillations A → B → A en moins d'1 s.
        const it = p._intent;
        if (it) {
          const key = it.slot + '/' + it.id;
          if (q.key && key !== q.key) { A.switches++; if (q.key2 === key && sim.now - q.kt < 1) A.osc++; q.key2 = q.key; q.kt = sim.now; }
          q.key = key; A.byPri[it.pri] = (A.byPri[it.pri] || 0) + dt;
        }
        // Allure demandée (étape 5b) → allure réellement atteinte.
        if (p._pace) { const rq = p._pace.pace, ac = sp < 2 ? 'marche' : sp < 4 ? 'trot' : sp < 5.5 ? 'course' : 'sprint'; A.req[rq + ' → ' + ac] = (A.req[rq + ' → ' + ac] || 0) + dt; if (q.rq && q.rq !== rq) A.paceSw++; q.rq = rq; const wk = rq + ' · ' + (p._pace.why || '?'); A.why[wk] = (A.why[wk] || 0) + dt; }
        if (p.role === 'mark' && p._markOf != null && k % 24 === 0) { const a = sim.players.get(p._markOf); if (a) A.markD.push(sim.dist(p, sim.X(a), sim.Y(a))); }
        if (p.goRun && p.goRun !== q.run) { A.runs++; q.run = p.goRun; q.runOk = false; }
        if (p.goRun && !q.runOk && sim.dist(p, p.goRun.x, p.goRun.y) < 2) { A.runsOk++; q.runOk = true; }
        Object.assign(q, { tx, ty, sp }); prev.set(p, q);
      }
    }
    A.outfield += 20; A.viol += sim.targetViolations || 0;
    if (sim.intentStats) for (const [k2, v] of Object.entries(sim.intentStats.events)) A.events[k2] = (A.events[k2] || 0) + v;
  }
  process.send(A, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 4), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const A = { pressD: [], pressT: [], markD: [], looseT: [], byPri: {}, events: {} };
  for (const p of parts) for (const [k, v] of Object.entries(p)) { if (Array.isArray(v)) A[k] = (A[k] || []).concat(v); else if (typeof v === 'object') { A[k] = A[k] || {}; for (const [a, b] of Object.entries(v)) A[k][a] = (A[k][a] || 0) + b; } else A[k] = (A[k] || 0) + v; }
  const min = A.t / 60, pc = (x) => (100 * x / A.t).toFixed(1) + ' %', med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  console.log(`${N} matchs (graines ${base0}…), pas ${(+(process.env.DT || 1 / 96)).toFixed(4)} s`);
  console.log(`  sauts de cible > 3 m : ${(A.jumps / min).toFixed(1)} / joueur / minute`);
  console.log(`  changements d'intention : ${(A.switches / min).toFixed(1)} / joueur / minute · oscillations A→B→A < 1 s : ${(A.osc / min).toFixed(2)} / joueur / minute`);
  console.log(`  écritures de cible hors arbitre : ${A.viol}`);
  if (Object.keys(A.byPri).length) { const T = Object.values(A.byPri).reduce((a, b) => a + b, 0); console.log('  temps par priorité :', Object.entries(A.byPri).map(([k, v]) => `P${k} ${(100 * v / T).toFixed(1)} %`).join(' · ')); }
  if (Object.keys(A.events).length) console.log('  évènements d\'arbitrage (par match) :', Object.entries(A.events).map(([k, v]) => `${k} ${(v / N).toFixed(0)}`).join(' · '));
  console.log(`  demi-tours brusques : ${(A.rev / min).toFixed(2)} / joueur / minute · à reculons ${pc(A.back)} · en crabe ${pc(A.crab)}`);
  console.log(`  allures : marche ${pc(A.walk)} · trot ${pc(A.jog)} · course ${pc(A.run)} · sprint ${pc(A.sprint)}   (indicateur réel ≈ 60-70 / 20-25 / 7-10 / 3-5)`);
  console.log(`  distance / joueur de champ / 90 min : ${(A.dist / A.outfield / 1000 * (5400 / (A.t / A.outfield))).toFixed(2)} km   (indicateur réel 10-11,5)`);
  console.log(`  pressing : défenseur le plus proche du porteur ${med(A.pressD).toFixed(2)} m (médiane) · mise sous pression après une perte ${med(A.pressT).toFixed(2)} s (médiane)`);
  console.log(`  marquage : distance au joueur marqué ${med(A.markD).toFixed(2)} m (médiane, n=${A.markD.length})`);
  console.log(`  appels : ${(A.runs / N).toFixed(0)} par match, point d'appel atteint ${(100 * A.runsOk / Math.max(1, A.runs)).toFixed(0)} %`);
  if (Object.keys(A.req).length) {
    const by = {}; for (const [k, v] of Object.entries(A.req)) { const [rq, ac] = k.split(' → '); (by[rq] ||= {})[ac] = v; }
    console.log(`  allure demandée → allure réelle (part du temps de la demande) · changements de demande ${(A.paceSw / min).toFixed(1)} / joueur / minute :`);
    for (const rq of ['petits pas', 'marche', 'trot', 'course', 'sprint', 'à fond']) if (by[rq]) { const T = Object.values(by[rq]).reduce((a, b) => a + b, 0); console.log(`    ${rq.padEnd(10)} ${(100 * T / A.t).toFixed(1).padStart(5)} % du temps → ` + ['marche', 'trot', 'course', 'sprint'].map((ac) => `${ac} ${(100 * (by[rq][ac] || 0) / T).toFixed(0)} %`).join(' · ')); }
  }
  if (Object.keys(A.why).length) console.log('  motifs des demandes (part du temps) :', Object.entries(A.why).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(100 * v / A.t).toFixed(1)} %`).join(' · '));
  console.log(`  ballon libre : ${(med(A.looseT)).toFixed(2)} s avant le premier contact (médiane)`);
}
