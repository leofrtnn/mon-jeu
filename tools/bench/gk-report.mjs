// Rapport gardien / tirs / têtes (étape 4d) : tirs cadrés, arrêts, prises de balle, parades,
// déviations, sorties aériennes, têtes, buts encaissés — tout constaté après l'interaction physique.
// Usage : node tools/bench/gk-report.mjs [matchs=8] [graine=100]   (4 processus en parallèle)
import { fork } from 'node:child_process';
import { cfgFor, runLive } from './common.mjs';
const R = new URL('../../js/', import.meta.url).href;
const { Diag } = await import(R + 'engine/diag.js');

if (process.env.WORKER) {
  const [base, n] = process.env.WORKER.split(',').map(Number);
  const acc = { shots: [], gks: [], aerials: [], goals: [], ev: {}, matches: 0 };
  for (let g = 0; g < n; g++) {
    runLive(await cfgFor(base + g), { dt: +(process.env.DT || 0.05), setup(sim) { sim.diag = new Diag({ keep: 5, keepPasses: true }); sim.diag.keepPasses = true; },
      onStep(sim, m, evs) {
        for (const e of evs) { const k = e.type === 'save' ? 'save:' + e.how : e.type === 'goal' ? 'goal:' + (e.og ? 'csc' : e.kind) : e.type === 'shot' ? 'shot:' + e.kind : null; if (k) acc.ev[k] = (acc.ev[k] || 0) + 1; }
        if (m.phase === 'ft') { acc.shots.push(...sim.diag.shots); acc.gks.push(...sim.diag.gks.map((r) => ({ ...r }))); acc.aerials.push(...sim.diag.aerials); acc.matches++; }
      } });
  }
  process.send(acc, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 8), base0 = +(process.argv[3] || 100), P = 4, per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * 100},${per}` } }); c.on('message', res); })));
  const S = parts.flatMap((p) => p.shots), G = parts.flatMap((p) => p.gks), A = parts.flatMap((p) => p.aerials), M = parts.reduce((a, p) => a + p.matches, 0);
  const ev = {}; for (const p of parts) for (const [k, v] of Object.entries(p.ev)) ev[k] = (ev[k] || 0) + v;
  const pc = (a, f) => a.length ? (100 * a.filter(f).length / a.length).toFixed(1) + ' %' : '—';
  const pm = (x) => (x / M).toFixed(2);
  console.log(`${M} matchs`);
  console.log('\n— TIRS (par match ; réel : 24-26 tirs, 8,5-9 cadrés, 2,7-2,9 buts, ~70 % d\'arrêts sur tirs cadrés) —');
  const on = S.filter((s) => s.onTarget);
  console.log(`  tirs ${pm(S.length)}   cadrés ${pm(on.length)} (${pc(S, (s) => s.onTarget)})   buts ${pm(S.filter((s) => s.outcome === 'goal').length)}   xG ${pm(S.reduce((a, s) => a + s.xg, 0))}`);
  const out = {}; for (const s of S) out[s.outcome] = (out[s.outcome] || 0) + 1;
  console.log('  issues :', Object.entries(out).map(([k, v]) => `${k} ${pm(v)}`).join(' · '));
  console.log(`  tirs cadrés arrêtés : ${pc(on, (s) => s.outcome !== 'goal')}   touchés par le gardien : ${pc(on, (s) => s.gk)}   buts malgré une main du gardien : ${on.filter((s) => s.outcome === 'goal' && s.gk).length}`);
  for (const [lab, f] of [['xG < 0,05', (s) => s.xg < 0.05], ['xG 0,05-0,15', (s) => s.xg >= 0.05 && s.xg < 0.15], ['xG 0,15-0,35', (s) => s.xg >= 0.15 && s.xg < 0.35], ['xG ≥ 0,35', (s) => s.xg >= 0.35]]) {
    const a = S.filter(f); console.log(`  ${lab.padEnd(13)} n=${String(a.length).padStart(4)}  cadrés ${pc(a, (s) => s.onTarget)}  buts ${pc(a, (s) => s.outcome === 'goal')}  (xG moyen ${(a.reduce((x, s) => x + s.xg, 0) / Math.max(1, a.length)).toFixed(3)})`);
  }
  for (const k of ['open', 'header', 'freekick', 'penalty']) { const a = S.filter((s) => s.kind === k); if (a.length) console.log(`  ${k.padEnd(9)} n=${String(a.length).padStart(4)}  cadrés ${pc(a, (s) => s.onTarget)}  buts ${pc(a, (s) => s.outcome === 'goal')}  erreur moyenne ${(a.reduce((x, s) => x + Math.hypot(s.errH, s.errV), 0) / a.length).toFixed(2)}°`); }
  console.log('\n— GARDIEN —');
  const shotG = G.filter((g) => g.cross);
  console.log(`  ballons lus (trajectoire vers le but) : ${pm(shotG.length)} par match   réaction moyenne ${(shotG.reduce((a, g) => a + g.react, 0) / Math.max(1, shotG.length)).toFixed(3)} s   vue masquée ${pc(shotG, (g) => g.screened)}`);
  const act = {}; for (const g of shotG) act[g.action || 'aucun geste (ballon passé avant)'] = (act[g.action || 'aucun geste (ballon passé avant)'] || 0) + 1;
  console.log('  gestes :', Object.entries(act).map(([k, v]) => `${k} ${(100 * v / shotG.length).toFixed(0)} %`).join(' · '));
  const res = {}; for (const g of G) if (g.result) res[g.result] = (res[g.result] || 0) + 1;
  console.log('  contacts (tous ballons) :', Object.entries(res).map(([k, v]) => `${({ catch: 'capté', parry: 'repoussé', tip: 'effleuré', punch: 'boxé', block: 'dans le corps' })[k] || k} ${pm(v)}`).join(' · '), '(par match)');
  const dives = shotG.filter((g) => g.action === 'plongeon');
  console.log(`  plongeons : ${pm(dives.length)} par match, mains au contact ${pc(dives, (g) => g.contact)}`);
  console.log('  événements :', Object.entries(ev).sort().map(([k, v]) => `${k} ${pm(v)}`).join(' · '));
  if (A.length) {
    console.log('\n— DUELS AÉRIENS / TÊTES —');
    const t = {}; for (const a of A) t[a.type] = (t[a.type] || 0) + 1;
    console.log(`  têtes ${pm(A.length)} par match :`, Object.entries(t).map(([k, v]) => `${k} ${pm(v)}`).join(' · '));
    console.log(`  disputées (adversaire à < 1,5 m) ${pc(A, (a) => a.contested)}   qualité moyenne ${(A.reduce((x, a) => x + a.q, 0) / A.length).toFixed(2)}   saut mal synchronisé ${pc(A, (a) => a.timing > 0.15)}`);
  }
}
