// Intensité par type d'intention (étape 5b) : distance, temps par allure réelle, pleine vitesse,
// demandes de sprint non atteintes. Usage : [PACE0=1] node tools/bench/intensity-report.mjs [matchs=16] [graine=100]
// PACE0=1 rejoue les anciens plafonds (comportement 5a exact) dans le même code. Observation seulement.
import { fork } from 'node:child_process';
const FAM = (sim, p) => {
  if (p === sim.holder) return 'porteur';
  const r = p.role, src = p._intent?.src;
  if (r === 'recover') return 'repli';
  if (r === 'press' || r === 'press2') return 'pressing';
  if (r === 'run' || r === 'hold') return 'appel';
  if (r === 'mark') return 'marquage';
  if (['formation', 'soutien', 'couverture', 'contenir', 'espacement', 'remise en jeu', 'engagement'].includes(src) && !(p._intent?.pri >= 4)) return 'replacement';
  return 'autres (' + (src || '—') + ')';
};
if (process.env.WORKER) {
  if (process.env.PACE0) globalThis.__X = { pace0: 1 };
  const { cfgFor, createMatch, LiveSim } = await import('./common.mjs');
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = 1 / 96;
  const R = { T: 0, outfield: 0, f: {} };
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m);
    for (let k = 0; k < 2e6 && m.phase !== 'ft'; k++) {
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      if (m.phase !== 'live' || sim.restart || sim.celebrate > 0) continue;
      for (const p of sim.players.values()) {
        if (p.gk) continue;
        let fam = FAM(sim, p); if (fam.startsWith('autres')) fam = 'autres';
        const o = (R.f[fam] ||= { t: 0, d: 0, marche: 0, trot: 0, course: 0, sprint: 0, full: 0, reqS: 0, reqSmiss: 0 });
        const sp = p.speed || 0, vit = p.mp?.p?.attrs?.vit ?? 60, en = p.mp?.energy ?? 100;
        const vmax = (6.2 + vit * 0.03) * (m.wx?.speed || 1) * (en > 70 ? 1 - (100 - en) * 0.002 : 0.94 - (70 - en) * 0.006);
        o.t += dt; o.d += sp * dt; R.T += dt;
        o[sp < 2 ? 'marche' : sp < 4 ? 'trot' : sp < 5.5 ? 'course' : 'sprint'] += dt;
        if (sp >= 0.9 * vmax) o.full += dt;
        const rq = p._pace?.pace; if (rq === 'sprint' || rq === 'à fond') { o.reqS += dt; if (sp < 5.5) o.reqSmiss += dt; }
      }
    }
    R.outfield += 20;
  }
  process.send(R, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 16), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const A = { T: 0, outfield: 0, f: {} };
  for (const p of parts) { A.T += p.T; A.outfield += p.outfield; for (const [k, o] of Object.entries(p.f)) { const a = (A.f[k] ||= {}); for (const [x, v] of Object.entries(o)) a[x] = (a[x] || 0) + v; } }
  const per90 = 5400 / (A.T / A.outfield), km = (d) => (d / A.outfield / 1000 * per90).toFixed(2), pc = (x, t) => (100 * x / t).toFixed(1);
  const tot = Object.values(A.f).reduce((s, o) => s + o.d, 0), sprT = Object.values(A.f).reduce((s, o) => s + o.sprint, 0);
  console.log(`${N} matchs ${process.env.PACE0 ? '(5a : anciens plafonds)' : '(5b)'} — distance / joueur / 90 min ${km(tot)} km · sprint réel ${pc(sprT, A.T)} % du temps`);
  console.log('intention          temps   km/j/90  marche  trot course sprint | sprint (% du temps total) | pleine vitesse | demandes sprint/à fond · dont < 5,5 m/s');
  for (const [k, o] of Object.entries(A.f).sort((a, b) => b[1].d - a[1].d))
    console.log(`${k.padEnd(16)} ${pc(o.t, A.T).padStart(5)} %  ${km(o.d).padStart(6)}   ${pc(o.marche, o.t).padStart(5)} ${pc(o.trot, o.t).padStart(5)} ${pc(o.course, o.t).padStart(5)} ${pc(o.sprint, o.t).padStart(5)} | ${pc(o.sprint, A.T).padStart(5)} % | ${pc(o.full, A.T).padStart(5)} % | ${pc(o.reqS, A.T).padStart(5)} % · ${o.reqS ? pc(o.reqSmiss, o.reqS) : '—'} %`);
}
