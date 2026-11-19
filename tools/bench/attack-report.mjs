// Entonnoir offensif par profil d'équipes : d'où viennent (ou pas) les tirs et les buts ?
//   possessions → entrées dans le dernier tiers → entrées dans la surface → décisions en position
//   de tir → tirs choisis → tirs → xG → occasions franches (xG ≥ 0,3) → cadrés → buts.
// Usage : node tools/bench/attack-report.mjs [matchsParProfil=4] [profils=ref,court,direct,offdef,ecart]
// Instrumentation neutre (aucun hasard consommé) : on observe seulement.
import { fork } from 'node:child_process';
import { world, createMatch, LiveSim, matchCfgFor, L, W } from './common.mjs';
const { Diag } = await import(new URL('../../js/engine/diag.js', import.meta.url).href);

const PROFILES = {
  ref: { label: 'référence (clubs moyens)', pair: (i, n) => [(i * 5) % n, (i * 11 + 3) % n] },
  court: { label: 'jeu court des deux côtés', pair: (i, n) => [(i * 5) % n, (i * 11 + 3) % n], tac: [{ passing: 'short' }, { passing: 'short' }] },
  direct: { label: 'jeu direct des deux côtés', pair: (i, n) => [(i * 5) % n, (i * 11 + 3) % n], tac: [{ passing: 'direct' }, { passing: 'direct' }] },
  offdef: { label: 'offensif contre défensif', pair: (i, n) => [(i * 5) % n, (i * 11 + 3) % n], tac: [{ mentality: 'offensive' }, { mentality: 'defensive' }] },
  ecart: { label: 'gros contre petit', pair: (i, n) => [i % 3, n - 1 - (i % 3)] },
};

async function cfgOf(prof, i) {
  const st = await world();
  const l1 = st.clubs.filter((c) => c.div === 5).sort((a, b) => b.rep - a.rep);
  const [h, a] = PROFILES[prof].pair(i, l1.length);
  const cfg = matchCfgFor(st, { h: l1[h].id, a: l1[a === h ? (a + 1) % l1.length : a].id, comp: 'league', div: 5 });
  cfg.seed = 1000 + i; cfg.home.isAI = cfg.away.isAI = true;
  const t = PROFILES[prof].tac;
  if (t) { Object.assign(cfg.home.tactics, t[0]); Object.assign(cfg.away.tactics, t[1]); }
  return cfg;
}

function runOne(cfg, dt) {
  const m = createMatch(cfg); const sim = new LiveSim(m); sim.diag = new Diag({ keep: 4, keepPasses: true });
  const ends = {}; let lastRs = null, lastCrossT = -9, lastClearT = -9, lastOffT = -9, lastShotT = -9, lastTackleT = -9, lastStealT = -9, possT0 = 0, lastPick = null;
  const T = [0, 1].map(() => ({ poss: 0, third: 0, box: 0, shotPos: 0, shotPick: 0, decideNear: 0, shots: 0, xg: 0, big: 0, bigGoals: 0, onT: 0, goals: 0, xgPerShot: 0 }));
  let possSide = -1, seqThird = false, seqBox = false;
  let lastLooseT = -9, lastAerialT = -9;
  const lp0 = sim.loosePickup.bind(sim); sim.loosePickup = (dt, out) => { const h0 = sim.holder; lp0(dt, out); if (sim.holder && sim.holder !== h0) lastLooseT = sim.now; };
  const d0 = sim.decide.bind(sim);
  sim.decide = (h, out) => {
    const gx = sim.goalX(h.side), dg = Math.hypot(gx - sim.X(h), W / 2 - sim.Y(h));
    const xg = dg < 25 ? sim.xg(h, 'open') : 0;
    d0(h, out); lastPick = h.lastPick;
    if (dg < 25) { T[h.side].decideNear++; if (xg >= 0.1) T[h.side].shotPos++; if (h.lastPick === 'shot') T[h.side].shotPick++; }
  };
  for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
    const evs = sim.step(dt);
    if (m.phase === 'ht') sim.resumeHT = true;
    for (const e of evs) (globalThis.__ev ||= []).push({ t: sim.now, type: e.type });
    if ((globalThis.__ev?.length || 0) > 200) globalThis.__ev.splice(0, 100);
    for (const e of evs) { if (e.type === 'cross') lastCrossT = sim.now; if (e.type === 'aerial' || e.type === 'header') lastAerialT = sim.now; if (e.type === 'clearance') lastClearT = sim.now; if (e.type === 'offside') lastOffT = sim.now; if (e.type === 'tackle' || e.type === 'foul') lastTackleT = sim.now; if (e.type === 'interception' && e.pid2 && !sim.diag.passes.some((r) => r.t > sim.now - 3 && r.contact && r.contact.side !== r.side)) lastStealT = sim.now; }
    for (const e of evs) if (e.type === 'shot') { lastShotT = sim.now;
      const t = T[e.side]; t.shots++; t.xg += e.xg || 0;
      if ((e.xg || 0) >= 0.3) { t.big++; if (e.outcome === 'goal') t.bigGoals++; }
      if (e.outcome === 'goal' || e.outcome === 'saved') t.onT++;
      if (e.outcome === 'goal') t.goals++;
    }
    if (sim.restart && sim.restart !== lastRs?.rs) lastRs = { rs: sim.restart, kind: sim.restart.kind, side: sim.restart.side, t: sim.now };
    if (sim.restart || m.phase !== 'live') continue;
    const side = sim.holder ? sim.holder.side : sim.pending ? sim.pending.from.side : -1;
    if (side >= 0 && side !== possSide) {
      if (possSide >= 0 && seqThird) {
        // Comment s'est terminée une possession arrivée dans le dernier tiers ?
        const lp = [...sim.diag.passes].reverse().find((r) => r.side === possSide && r.t >= possT0);
        let why = 'autre';
        if (lastShotT >= possT0) why = 'tir';
        else if (lastOffT >= possT0) why = 'hors-jeu';
        else if (lastRs && lastRs.t >= possT0 && lastRs.side !== possSide) why = lastRs.kind === 'freekick' ? 'faute offensive / coup franc adverse' : 'ballon sorti (' + lastRs.kind + ')';
        else if (lastCrossT >= possT0 && lastCrossT > sim.now - 4) why = 'centre perdu';
        else if (lp && lp.t > sim.now - 3.5 && lp.outcome && lp.outcome !== 'reçue') why = 'passe : ' + lp.outcome;
        else if (lastTackleT > sim.now - 1.5) why = 'tacle / faute';
        else if (lastLooseT > sim.now - 0.2) why = lastAerialT > sim.now - 5 ? 'second ballon perdu (après une tête)' : 'ballon libre récupéré par l\'adversaire';
        else if (sim.inHands) why = 'ballon capté par le gardien';
        else if (lastStealT > sim.now - 1.5) why = 'ballon chipé au porteur';
        else if (lp && lp.t > sim.now - 3.5) why = 'après passe reçue (contrôle/conduite perdus)';
        if (why === 'autre' && process.env.DUMP && (globalThis.__dump = (globalThis.__dump || 0) + 1) <= 12) console.error(`[autre] t=${sim.now.toFixed(1)} durée ${(sim.now - possT0).toFixed(1)} s, gagné par ${sim.holder ? (sim.holder.gk ? 'GARDIEN' : 'joueur') + (sim.inHands ? ' (mains)' : '') : 'passe'} à ${sim.P.x.toFixed(0)},${sim.P.y.toFixed(0)} ; dernière passe : ${lp ? lp.outcome + ' il y a ' + (sim.now - lp.t).toFixed(1) + ' s' : 'aucune'} ; derniers événements : ${(globalThis.__ev || []).filter((e) => e.t > sim.now - 4).map((e) => e.type).join(',')}`);
        ends[why] = (ends[why] || 0) + 1;
      }
      possSide = side; T[side].poss++; seqThird = seqBox = false; possT0 = sim.now;
    }
    if (possSide >= 0) {
      const P = sim.P, gx = sim.goalX(possSide);
      if (!seqThird && Math.abs(P.x - gx) < 35) { seqThird = true; T[possSide].third++; }
      if (!seqBox && Math.abs(P.x - gx) < 16.5 && Math.abs(P.y - W / 2) < 20.15 && sim.holder?.side === possSide) { seqBox = true; T[possSide].box++; }
    }
  }
  T[0].ends = ends; return T;
}

if (process.env.WORKER) {
  const { prof, from, n, dt } = JSON.parse(process.env.WORKER);
  const acc = {};
  for (let i = from; i < from + n; i++) {
    const T = runOne(await cfgOf(prof, i), dt);
    for (const t of T) for (const [k, v] of Object.entries(t)) if (k !== 'ends') acc[k] = (acc[k] || 0) + v;
    acc.ends = acc.ends || {}; for (const [k, v] of Object.entries(T[0].ends)) acc.ends[k] = (acc.ends[k] || 0) + v;
    acc.teams = (acc.teams || 0) + 2;
  }
  process.send(acc); process.exit(0);
} else {
  const N = +(process.argv[2] || 4), profs = (process.argv[3] || 'ref,court,direct,offdef,ecart').split(','), dt = +(process.env.DT || 0.05);
  const jobs = [];
  for (const prof of profs) { const per = Math.ceil(N / 2); for (let w = 0; w < 2; w++) jobs.push({ prof, from: w * per, n: Math.min(per, N - w * per), dt }); }
  const run = (j) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: JSON.stringify(j) } }); c.on('message', (a) => res({ j, a })); });
  const res = []; for (let i = 0; i < jobs.length; i += 4) res.push(...await Promise.all(jobs.slice(i, i + 4).filter((j) => j.n > 0).map(run)));
  const ENDS = {};
  const rows = [['', 'possessions', 'dernier tiers', 'surface', 'décisions <25 m', 'en position de tir', 'tir choisi', 'tirs', 'xG', 'xG/tir', 'occasions franches', 'cadrés', 'buts']];
  for (const prof of profs) {
    const A = {}, E = {}; for (const { j, a } of res) if (j.prof === prof) for (const [k, v] of Object.entries(a)) { if (k === 'ends') { for (const [e, n] of Object.entries(v)) E[e] = (E[e] || 0) + n; } else A[k] = (A[k] || 0) + v; }
    ENDS[prof] = E;
    const per = (k) => (A[k] / A.teams);   // par équipe et par match
    rows.push([PROFILES[prof].label, per('poss'), per('third'), per('box'), per('decideNear'), per('shotPos'), per('shotPick'), per('shots'), per('xg'), A.xg / Math.max(1, A.shots), per('big'), per('onT'), per('goals')]);
  }
  rows.push(['réel (par équipe)', '100-130', '45-60', '20-28', '—', '—', '—', '12-13', '1,3-1,45', '0,10-0,12', '1,5-2', '4,3-4,5', '1,35-1,45']);
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => String(typeof r[c] === 'number' ? r[c].toFixed(c === 9 ? 3 : 1) : r[c]).length)));
  for (const r of rows) console.log(r.map((v, c) => String(typeof v === 'number' ? v.toFixed(c === 9 ? 3 : 1) : v).padEnd(w[c])).join(' | '));
  console.log('\nFin des possessions arrivées dans le dernier tiers (%) :');
  for (const prof of profs) { const E = ENDS[prof], n = Object.values(E).reduce((a, b) => a + b, 0); console.log('  ' + PROFILES[prof].label + ' :', Object.entries(E).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}`).join(' · ')); }
  console.log(`(${N} matchs par profil, valeurs par équipe et par match, pas de simulation ${dt} s)`);
}
