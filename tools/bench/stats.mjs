// Statistiques d'un match moyen (33 indicateurs) comparées aux moyennes réelles des grands championnats.
// Usage : node stats.mjs [nbMatchs=8] [graineDépart=100]   (lance 4 processus en parallèle)
import { fork } from 'node:child_process';
import { cfgFor, runLive } from './common.mjs';
const L = 105;
if (process.env.WORKER) {
  const [base, n] = process.env.WORKER.split(',').map(Number);
  const T = {}; const add = (k, v = 1) => { T[k] = (T[k] || 0) + v; };
  for (let g = 0; g < n; g++) {
    const cfg = await cfgFor(base + g);
    let lastSide = -1, seqN = 0, lastRs = null, lastPd = null;
    const { m } = runLive(cfg, {
      dt: 0.05,
      setup(sim) {
        const oE = sim.execute.bind(sim); sim.execute = (h, pick, out) => { if (pick.k === 'takeon') add('dribbles tentés'); return oE(h, pick, out); };
        const oP = sim.doPass.bind(sim); sim.doPass = (h, o, out) => { const d = Math.hypot(o.tx - sim.X(h), o.ty - sim.Y(h)); add('longueur passes (m)', d); if (d > 30) add('longs ballons'); return oP(h, o, out); };
      },
      onStep(sim, m2, evs) {
        for (const e of evs) {
          if (e.type === 'interception') add('interceptions');
          if (e.type === 'clearance') add('dégagements');
          if (e.type === 'cross') add('centres');
          if (e.type === 'aerial') add('duels aériens');
          if (e.type === 'penalty') add('penaltys');
          if (e.type === 'shot') { if (e.ax >= 1 - 16.5 / L) add('tirs dans la surface'); if (e.kind === 'header') add('tirs de la tête'); if (e.outcome === 'blocked') add('tirs contrés'); }
        }
        if (sim.restart && sim.restart !== lastRs) { lastRs = sim.restart; add('remise:' + sim.restart.kind); }
        if (m2.phase === 'live' && !sim.restart && !(sim.celebrate > 0) && !(sim.varT > 0)) add('temps de jeu effectif (min)', 0.05 / 60);
        for (const p of sim.players.values()) add('distance (km)', (p.speed || 0) * 0.05 / 1000);
        if (sim.pending && sim.pending !== lastPd) { lastPd = sim.pending; seqN++; }
        const side = sim.restart ? sim.restart.side : sim.holder ? sim.holder.side : -1;
        if (side >= 0 && side !== lastSide) { if (lastSide >= 0) { add('possessions'); add('_seq', seqN); } seqN = 0; lastSide = side; }
      },
    });
    for (const t of m.teams) {
      const s = t.stats;
      add('buts', m.score[t.side]); add('tirs', s.shots); add('tirs cadrés', s.onTarget); add('xG', s.xg); add('passes', s.passes); add('passes réussies', s.passesOk);
      add('fautes', s.fouls); add('corners', s.corners); add('jaunes', s.yellows); add('rouges', s.reds); add('hors-jeu', s.offsides); add('arrêts', s.saves); add('tacles réussis', s.tackles);
    }
    add('matchs');
  }
  process.send(T); process.exit(0);
} else {
  const N = +(process.argv[2] || 8), base0 = +(process.argv[3] || 100), P = 4, per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * 100},${per}` } }); c.on('message', res); })));
  const T = {}; for (const p of parts) for (const [k, v] of Object.entries(p)) T[k] = (T[k] || 0) + v;
  const n = T.matchs, a = (k) => (T[k] || 0) / n;
  const REF = [
    ['buts', a('buts'), '2,7-2,9'], ['tirs', a('tirs'), '24-26'], ['tirs cadrés', a('tirs cadrés'), '8,5-9'], ['xG', a('xG'), '2,6-2,9'],
    ['% tirs dans la surface', 100 * a('tirs dans la surface') / a('tirs'), '60-65'], ['% tirs de la tête', 100 * a('tirs de la tête') / a('tirs'), '12-16'], ['tirs contrés', a('tirs contrés'), '6-8'], ['arrêts', a('arrêts'), '5,5-6,5'],
    ['passes', a('passes'), '850-1000'], ['% passes réussies', 100 * T['passes réussies'] / T.passes, '80-84'], ['longueur moyenne passe (m)', T['longueur passes (m)'] / T.passes, '16-19'], ['longs ballons (>30 m)', a('longs ballons'), '90-120'],
    ['centres', a('centres'), '30-40'], ['passes par possession', T._seq / T.possessions, '3,5-5'], ['possessions', a('possessions'), '200-260'], ['dribbles tentés', a('dribbles tentés'), '30-40'],
    ['tacles réussis', a('tacles réussis'), '28-35'], ['interceptions (passes coupées)', a('interceptions'), '—'], ['dégagements', a('dégagements'), '35-45'], ['duels aériens', a('duels aériens'), '35-50'],
    ['fautes', a('fautes'), '20-23'], ['jaunes', a('jaunes'), '3,5-4'], ['rouges', a('rouges'), '0,1-0,15'], ['hors-jeu', a('hors-jeu'), '3,5-4,5'], ['corners', a('corners'), '9,5-10,5'],
    ['touches', a('remise:throw'), '38-45'], ['six mètres', a('remise:goalkick'), '14-18'], ['coups francs', a('remise:freekick'), '24-28'], ['penaltys', a('penaltys'), '0,25-0,32'],
    ['temps de jeu effectif (min)', a('temps de jeu effectif (min)'), '55-60'], ['distance 22 joueurs (km)', a('distance (km)'), '215-235'],
  ];
  console.log('matchs', n);
  for (const [k, v, r] of REF) console.log(k.padEnd(32), (Number.isFinite(v) ? v.toFixed(1) : '-').padStart(7), '  réel', r);
  if (process.env.JSON) console.log(JSON.stringify(Object.fromEntries(REF.map(([k, v]) => [k, +(+v).toFixed(2)]))));
}
