// Rapport des passes (étape 4c) : précision d'exécution, trajectoires réelles, interceptions,
// contrôle final — ventilé par qualité du passeur, distance, pied, pression, profil d'équipes.
// Usage : node tools/bench/pass-report.mjs [matchs=8] [graine=100]   (4 processus en parallèle)
// Le diagnostic est neutre (aucun hasard) : il observe les passes, il ne les change pas.
import { fork } from 'node:child_process';
import { cfgFor, runLive } from './common.mjs';
const R = new URL('../../js/', import.meta.url).href;
const { Diag } = await import(R + 'engine/diag.js');

if (process.env.WORKER) {
  const [base, n] = process.env.WORKER.split(',').map(Number);
  const recs = [];
  for (let g = 0; g < n; g++) {
    runLive(await cfgFor(base + g), { dt: +(process.env.DT || 0.05), setup(sim) { sim.diag = new Diag({ keep: 5, keepPasses: true }); },
      onStep(sim, m) { if (m.phase === 'ft') for (const r of sim.diag.passes) recs.push({ ...r, interceptors: r.interceptors.length, cutWon: r.contact && r.contact.side !== r.side, contact: r.contact ? { side: r.contact.side, q: r.contact.q, reacted: r.contact.reacted, part: r.contact.part } : null }); } });
  }
  process.send(recs, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 8), base0 = +(process.argv[3] || 100), P = 4, per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, [], { env: { ...process.env, WORKER: `${base0 + i * 100},${per}` } }); c.on('message', res); })));
  const all = parts.flat();
  const crosses = all.filter((r) => r.cross); const cw = {}; for (const r of crosses) cw[r.outcome || '(en cours)'] = (cw[r.outcome || '(en cours)'] || 0) + 1;
  const ok = (r) => r.outcome === 'reçue' || r.outcome === 'contrôle raté' || r.outcome === 'tête';
  const line = (label, a) => {
    if (!a.length) return console.log(label.padEnd(34), '—');
    const pc = (f) => (100 * a.filter(f).length / a.length).toFixed(1).padStart(5) + ' %';
    const mean = (f) => a.reduce((s, r) => s + f(r), 0) / a.length;
    console.log(label.padEnd(34), String(a.length).padStart(6), ' réussies', pc(ok), ' interceptées', pc((r) => r.outcome === 'interceptée'), ' déviées', pc((r) => r.outcome === 'déviée'),
      ' manquées', pc((r) => /destinataire/.test(r.outcome || '')), ' sorties sans contact', pc((r) => r.outcome === 'sortie sans contact'), ' contrôle raté', pc((r) => r.outcome === 'contrôle raté'), ' |erreur| moy.', mean((r) => Math.abs(r.dAng)).toFixed(2) + '°', ' écart au point visé', mean((r) => Math.hypot(r.exec.x - r.aim.x, r.exec.y - r.aim.y)).toFixed(2) + ' m');
  };
  console.log(`passes analysées : ${all.length} (${N} matchs, ${(all.length / N).toFixed(0)} par match)\n`);
  line('toutes', all);
  console.log('\n— qualité du passeur (passe) —');
  line('  < 55', all.filter((r) => r.pas < 55)); line('  55-69', all.filter((r) => r.pas >= 55 && r.pas < 70)); line('  70-79', all.filter((r) => r.pas >= 70 && r.pas < 80)); line('  ≥ 80', all.filter((r) => r.pas >= 80));
  console.log('\n— distance —');
  line('  < 10 m', all.filter((r) => r.len < 10)); line('  10-20 m', all.filter((r) => r.len >= 10 && r.len < 20)); line('  20-30 m', all.filter((r) => r.len >= 20 && r.len < 30)); line('  ≥ 30 m', all.filter((r) => r.len >= 30));
  console.log('\n— type, pied, conditions —');
  line('  centres', all.filter((r) => r.cross)); line('  au sol', all.filter((r) => !r.lofted)); line('  aérienne', all.filter((r) => r.lofted)); line('  dans la course (profondeur)', all.filter((r) => r.through));
  line('  pied fort', all.filter((r) => !r.weak && !r.awk)); line('  pied faible', all.filter((r) => r.weak)); line('  bon pied, ballon du mauvais côté', all.filter((r) => r.awk));
  line('  adversaire < 1,5 m', all.filter((r) => r.pressure < 1.5)); line('  adversaire 1,5-3 m', all.filter((r) => r.pressure >= 1.5 && r.pressure < 3)); line('  libre (> 5 m)', all.filter((r) => r.pressure >= 5));
  line('  passeur lancé (> 5 m/s)', all.filter((r) => r.speed > 5)); line('  passe à contre-sens de sa course', all.filter((r) => r.speed > 2 && r.turn > 1.6));
  console.log('\n— qualité du passeur à difficulté égale —');
  for (const [lab, f] of [['passes ≥ 25 m', (r) => r.len >= 25], ['passes sous pression (< 3 m)', (r) => r.pressure < 3], ['passes libres 10-25 m au sol', (r) => r.pressure >= 5 && r.len >= 10 && r.len < 25 && !r.lofted]]) {
    const a = all.filter(f);
    line(`  ${lab}, passe < 60`, a.filter((r) => r.pas < 60)); line(`  ${lab}, passe 60-74`, a.filter((r) => r.pas >= 60 && r.pas < 75)); line(`  ${lab}, passe ≥ 75`, a.filter((r) => r.pas >= 75));
  }
  console.log('\n— défenseurs —');
  const tried = all.filter((r) => r.interceptors > 0);
  console.log(`  passes où au moins un défenseur a tenté de couper : ${(100 * tried.length / all.length).toFixed(1)} %   dont coupées (contact adverse) : ${(100 * tried.filter((r) => r.cutWon).length / Math.max(1, tried.length)).toFixed(1)} %`);
  console.log(`  contacts adverses sans avoir réagi (ballon qui rebondit sur lui) : ${all.filter((r) => r.contact && r.cutWon && r.contact.reacted === false).length}`);
  const rec = all.filter((r) => r.contact && !r.cutWon && r.contact.q != null);
  console.log(`  qualité moyenne du contrôle du destinataire : ${(rec.reduce((s, r) => s + r.contact.q, 0) / Math.max(1, rec.length)).toFixed(2)}`);
  const out = {}; for (const r of all) out[r.outcome || '(en cours à la fin)'] = (out[r.outcome || '(en cours à la fin)'] || 0) + 1;
  console.log('\nissues :', out);
  console.log('issues des centres :', cw);
}
