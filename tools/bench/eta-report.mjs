// Temps d'arrivée EN MATCH (étape 5c) : arrivée prédite par les plans de réception / d'interception
// (instant du ballon − marge, réaction comprise) contre arrivée réelle du joueur à 0,3 m du point.
// Distingue les plans stables, modifiés en route (nouveau point > 0,5 m) et interrompus (ballon joué
// avant). Usage : node tools/bench/eta-report.mjs [matchs=8] [graine=100] [racine=.]. Observation seulement.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[4] || '.');
if (process.env.WORKER) {
  const { cfgFor, createMatch, LiveSim, L, W } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const { Diag } = await import(pathToFileURL(root + '/js/engine/diag.js').href);
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = 1 / 96;
  const out = [];
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m); sim.diag = new Diag();
    const open = new Map(); let seen = 0;
    for (let k = 0; k < 2e6 && m.phase !== 'ft'; k++) {
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      const plans = sim.diag.plans;
      if (plans.length < seen) seen = 0;
      for (; seen < plans.length; seen++) {
        const pl = plans[seen]; if (pl.margin == null || pl.margin < 0) continue;
        const prev = open.get(pl.pid);
        if (prev) { if (Math.hypot(prev.x - pl.x, prev.y - pl.y) > 0.5) { prev.kind = 'modifié'; out.push(prev); open.delete(pl.pid); } else continue; }
        open.set(pl.pid, { t0: pl.t, x: pl.x, y: pl.y, pred: pl.eta - pl.margin, cut: !!pl.cut, kind: 'stable', pd: sim.pending });
      }
      for (const [pid, o] of open) {
        const p = sim.players.get(pid);
        if (!p) { open.delete(pid); continue; }
        if (Math.hypot(p.x * L - o.x, p.y * W - o.y) <= 0.3) { o.real = sim.now - o.t0; out.push(o); open.delete(pid); }
        else if (sim.pending !== o.pd || sim.now - o.t0 > 5) { o.kind = 'interrompu'; out.push(o); open.delete(pid); }
      }
    }
  }
  process.send(out.map(({ pd, ...r }) => r), () => process.exit(0));
} else {
  const N = +(process.argv[2] || 8), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const all = parts.flat();
  const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(3) : '—'; };
  console.log(`${N} matchs, ${root} — ${all.length} plans (réception + interception) avec marge ≥ 0`);
  const cnt = {}; all.forEach((o) => { cnt[o.kind] = (cnt[o.kind] || 0) + 1; });
  console.log('  ', Object.entries(cnt).map(([k, v]) => `${k} ${(100 * v / all.length).toFixed(1)} %`).join(' · '));
  for (const [name, f] of [['réceptions', (o) => !o.cut], ['interceptions', (o) => o.cut]]) {
    const S = all.filter((o) => f(o) && o.kind === 'stable' && o.real != null), e = S.map((o) => o.real - o.pred), ae = e.map(Math.abs);
    console.log(`  ${name} — plans stables arrivés : ${S.length} · erreur réel − prédit : médiane ${q(e, 0.5)} s, p10 ${q(e, 0.1)}, p90 ${q(e, 0.9)} · |erreur| < 0,1 s : ${(100 * ae.filter((x) => x < 0.1).length / Math.max(1, ae.length)).toFixed(0)} %, < 0,2 s : ${(100 * ae.filter((x) => x < 0.2).length / Math.max(1, ae.length)).toFixed(0)} %`);
  }
}
