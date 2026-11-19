// Rapport des duels au sol (étape 4e) : tacles (debout / glissé) et leur résultat réel, fautes,
// contacts sans faute, ballons chipés, dribbles, duels de corps, ballons coincés — par qualité des
// joueurs et par consigne tactique. Usage : node tools/bench/duel-report.mjs [matchsParProfil=4] [profils=ref,dur,doux,pressing]
import { fork } from 'node:child_process';
import { world, createMatch, LiveSim, matchCfgFor } from './common.mjs';
const { Diag } = await import(new URL('../../js/engine/diag.js', import.meta.url).href);
const PROFILES = {
  ref: { label: 'référence' }, dur: { label: 'tacles durs (les deux)', tac: { tackling: 'hard' } },
  doux: { label: 'tacles prudents (les deux)', tac: { tackling: 'soft' } }, pressing: { label: 'pressing haut (les deux)', tac: { pressing: 'high' } },
};
async function cfgOf(prof, i) {
  const st = await world(); const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);
  const cfg = matchCfgFor(st, { h: l1[(i * 5) % l1.length].id, a: l1[(i * 11 + 3) % l1.length].id, comp: 'league', div: 5 });
  cfg.seed = 2000 + i; cfg.home.isAI = cfg.away.isAI = true;
  const t = PROFILES[prof].tac; if (t) { Object.assign(cfg.home.tactics, t); Object.assign(cfg.away.tactics, t); }
  return cfg;
}
if (process.env.WORKER) {
  const { prof, from, n, dt } = JSON.parse(process.env.WORKER);
  const acc = { duels: [], st: {}, matches: 0, stall: 0, drop: 0 };
  for (let i = from; i < from + n; i++) {
    const m = createMatch(await cfgOf(prof, i)); const sim = new LiveSim(m); sim.diag = new Diag({ keep: 5, keepPasses: true });
    const defOf = new Map(); for (const p of sim.players.values()) defOf.set(p.mp.id, { def: p.mp.p.attrs.def, dri: p.mp.p.attrs.dri, phy: p.mp.p.attrs.phy });
    for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) { sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true; }
    for (const d of sim.diag.duels) { const a = defOf.get(d.pid) || {}, b = defOf.get(d.vs) || {}; acc.duels.push({ ...d, def: a.def, dri: a.dri, phy: a.phy, vsDri: b.dri, vsPhy: b.phy }); }
    for (const t of m.teams) for (const k of ['fouls', 'tackles', 'yellows', 'reds', 'dribbles']) acc.st[k] = (acc.st[k] || 0) + (t.stats[k] || 0);
    acc.stall += sim.stallN || 0; acc.drop += sim.stallDrop || 0; acc.matches++;
  }
  process.send(acc, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 4), profs = (process.argv[3] || 'ref,dur,doux,pressing').split(','), dt = +(process.env.DT || 0.05);
  const jobs = []; for (const prof of profs) { const per = Math.ceil(N / 2); for (let w = 0; w < 2; w++) jobs.push({ prof, from: w * per, n: Math.min(per, N - w * per), dt }); }
  const run = (j) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: JSON.stringify(j) } }); c.on('message', (a) => res({ j, a })); });
  const res = []; for (let i = 0; i < jobs.length; i += 4) res.push(...await Promise.all(jobs.slice(i, i + 4).filter((j) => j.n > 0).map(run)));
  for (const prof of profs) {
    const R = res.filter((r) => r.j.prof === prof).map((r) => r.a); const M = R.reduce((a, r) => a + r.matches, 0);
    const D = R.flatMap((r) => r.duels), st = {}; for (const r of R) for (const [k, v] of Object.entries(r.st)) st[k] = (st[k] || 0) + v;
    const pm = (x) => (x / M).toFixed(1), pc = (a, f) => a.length ? (100 * a.filter(f).length / a.length).toFixed(0) + ' %' : '—';
    const dist = (a) => { const o = {}; for (const x of a) o[x.result] = (o[x.result] || 0) + 1; return Object.entries(o).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${(100 * v / a.length).toFixed(0)} %`).join(' · '); };
    console.log(`\n=== ${PROFILES[prof].label} (${M} matchs) — par match : fautes ${pm(st.fouls)} (réel 20-23) · tacles réussis ${pm(st.tackles)} (réel 28-35) · jaunes ${pm(st.yellows)} · rouges ${pm(st.reds || 0)} · dribbles réussis ${pm(st.dribbles || 0)} · ballons coincés ${pm(R.reduce((a, r) => a + r.stall, 0))} (balles à terre ${R.reduce((a, r) => a + r.drop, 0)})`);
    for (const kind of ['stand', 'slide']) { const a = D.filter((d) => d.kind === kind); console.log(`  tacle ${kind === 'stand' ? 'debout' : 'glissé'} : ${pm(a.length)} par match — ${dist(a)}`); }
    const tk = D.filter((d) => d.kind === 'stand' || d.kind === 'slide');
    for (const [lab, f] of [['défense < 60', (d) => d.def < 60], ['défense 60-74', (d) => d.def >= 60 && d.def < 75], ['défense ≥ 75', (d) => d.def >= 75]]) { const a = tk.filter(f); console.log(`    ${lab.padEnd(14)} n=${String(a.length).padStart(4)}  ballon gagné ${pc(a, (d) => d.result === 'ballon gagné')}  touché (gagné/poussé/disputé) ${pc(a, (d) => /ballon/.test(d.result))}  faute ${pc(a, (d) => d.result === 'faute')}  raté ${pc(a, (d) => d.result === 'raté')}`); }
    for (const [lab, f] of [['porteur dribble < 60', (d) => d.vsDri < 60], ['porteur dribble ≥ 75', (d) => d.vsDri >= 75]]) { const a = tk.filter(f); console.log(`    ${lab.padEnd(22)} n=${String(a.length).padStart(4)}  ballon gagné ${pc(a, (d) => d.result === 'ballon gagné')}  le porteur garde ${pc(a, (d) => d.result === 'le porteur garde')}`); }
    const st2 = D.filter((d) => d.kind === 'ballon chipé'); console.log(`  ballons chipés (touche trop longue anticipée) : ${pm(st2.length)} par match — ${dist(st2)}`);
    const dr = D.filter((d) => d.kind === 'dribble'); console.log(`  dribbles : défenseur éliminé ${pm(dr.length)} par match, feinte moyenne ${(dr.reduce((a, d) => a + (d.feint || 0), 0) / Math.max(1, dr.length)).toFixed(2)} s`);
    const bd = D.filter((d) => d.kind === 'duel de corps');
    console.log(`  duels de corps : ${pm(bd.length)} par match — ${dist(bd)} ; le plus « physique » gagne ${pc(bd.filter((d) => d.phy != null && d.vsPhy != null && d.phy !== d.vsPhy), (d) => d.phy > d.vsPhy)}`);
  }
}
