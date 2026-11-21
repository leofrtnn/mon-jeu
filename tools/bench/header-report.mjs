// Origine des tirs de la tête et du pied (diagnostic) : corner, coup franc, centre en jeu, passe
// longue levée, second ballon / jeu au sol. Usage : node tools/bench/header-report.mjs [matchs=16] [graine=100] [racine=.]
// Observation seulement.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[4] || '.');
if (process.env.WORKER) {
  const { cfgFor, runLive } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const [base, n] = process.env.WORKER.split(',').map(Number);
  const T = {}; const add = (k, v = 1) => { T[k] = (T[k] || 0) + v; };
  for (let g = 0; g < n; g++) {
    let lastRs = null, rsT = -99, rsKind = null, lastPd = null, pdT = -99, pdKind = null;
    runLive(await cfgFor(base + g), {
      dt: 0.05,
      onStep(sim, m, evs) {
        // Origine coup de pied arrêté : tir dans les 8 s qui suivent la remise JOUÉE (et non son apparition :
        // la mise en place d'un corner dure ~30 s, l'ancienne mesure ne voyait presque aucun tir sur corner).
        if (sim.restart && sim.restart !== lastRs) { lastRs = sim.restart; rsKind = sim.restart.kind; rsT = -99; }
        if (!sim.restart && lastRs && rsT < 0) rsT = sim.now;
        if (sim.pending && sim.pending !== lastPd) { lastPd = sim.pending; pdT = sim.now; pdKind = sim.pending.cross ? 'centre' : sim.pending.lofted ? 'passe levée' : 'passe au sol'; if (sim.pending.cross) add('centres'); }
        for (const e of evs) if (e.type === 'shot') {
          const k = e.kind === 'header' ? 'tête' : 'pied';
          const fromRs = sim.now - rsT < 8 && (rsKind === 'corner' || rsKind === 'freekick') ? (rsKind === 'corner' ? 'corner' : 'coup franc') : null;
          const o = fromRs || (sim.now - pdT < 3.5 ? (pdKind === 'centre' ? 'centre en jeu' : pdKind === 'passe levée' ? 'passe longue levée' : 'passe au sol') : 'second ballon / conduite');
          add(k); add(k + ' · ' + o); if (e.ax >= 1 - 16.5 / 105) add(k + ' dans la surface'); add(k + ' xG', e.xg || 0);
        }
      },
    });
  }
  process.send(T, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 16), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const T = {}; for (const p of parts) for (const [k, v] of Object.entries(p)) T[k] = (T[k] || 0) + v;
  const pm = (k) => ((T[k] || 0) / N).toFixed(2);
  console.log(`${N} matchs, ${root}`);
  console.log(`tirs : tête ${pm('tête')} · pied ${pm('pied')} par match → part de la tête ${(100 * (T['tête'] || 0) / ((T['tête'] || 0) + (T['pied'] || 0))).toFixed(1)} % · centres ${pm('centres')} · tirs de la tête par centre ${((T['tête · centre en jeu'] || 0) / (T['centres'] || 1)).toFixed(3)}`);
  console.log(`xG moyen : tête ${((T['tête xG'] || 0) / (T['tête'] || 1)).toFixed(3)} · pied ${((T['pied xG'] || 0) / (T['pied'] || 1)).toFixed(3)} · pied dans la surface ${pm('pied dans la surface')} / match`);
  for (const k of ['tête', 'pied']) console.log(`  ${k} :`, ['corner', 'coup franc', 'centre en jeu', 'passe longue levée', 'passe au sol', 'second ballon / conduite'].map((o) => `${o} ${pm(k + ' · ' + o)}`).join(' · '));
}
