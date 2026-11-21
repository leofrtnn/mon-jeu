// Journal des intentions (étape 5d) : épisodes d'intention par joueur, durées, transitions,
// concurrence arbitrée, abandons (expiration / fin), allers-retours et intentions « éclair ».
// Usage : node tools/bench/intent-report.mjs [graines, ex. 100-115] [racine=.]   (pas 1/96 s ; DT=…)
// Observation seulement : le journal du diagnostic ne change pas le match (test de déterminisme).
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const arg = process.argv[2] || '100-115', root = resolve(process.argv[3] || '.');
const seeds = arg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number)) : arg.split(',').map(Number);
const PRI = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5' };
if (process.env.WORKER) {
  const { cfgFor, runLive } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const { Diag } = await import(pathToFileURL(root + '/js/engine/diag.js').href);
  const dt = +(process.env.DT || 1 / 96);
  const T = { ev: {}, epi: {}, dur: {}, short: {}, tr: {}, drop: {}, rivals: 0, rivalsSame: 0, rivalsHigher: 0, switches: 0, aba: 0, liveMin: 0, matches: 0, durs: {} };
  const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
  for (const s of process.env.WORKER.split(',').map(Number)) {
    const cur = new Map();   // pid → { key, t0, prevKey, prevT }
    let live = false;
    runLive(await cfgFor(s), {
      dt,
      setup(sim) {
        const D = sim.diag = new Diag({ keep: 1 });
        D.intent = (now, r) => {
          if (!live) return;
          add(T.ev, r.event);
          for (const d of r.dropped || []) add(T.drop, `${PRI[d.pri]} ${d.src} · ${d.why}`);
          const key = r.id == null ? null : `${PRI[r.pri]} ${r.src}${r.src !== r.id && !/[#@]/.test(String(r.id)) ? ' (' + r.id + ')' : ''}`;   // (missions numérotées regroupées par source)
          const c = cur.get(r.pid);
          if (c && c.key) {   // fin de l'épisode précédent
            const d = now - c.t0; add(T.epi, c.key); add(T.dur, c.key, d); if (d < 0.3) add(T.short, c.key);
            (T.durs[c.key] ||= []).push(+d.toFixed(2));
          }
          if (key) {
            T.switches++;
            if (r.rivals?.length) { T.rivals++; if (r.rivals.some((q) => q.pri === r.pri)) T.rivalsSame++; if (r.rivals.some((q) => q.pri > r.pri)) T.rivalsHigher++; }
            if (c?.key) add(T.tr, `${c.key} → ${key}`);
            if (c?.prevKey === key && now - c.t0 < 1) T.aba++;
          }
          cur.set(r.pid, { key, t0: now, prevKey: c?.key ?? null });
        };
      },
      onStep(sim, m) {
        const was = live;
        live = m.phase === 'live' && !sim.restart && !(sim.celebrate > 0);
        if (live) T.liveMin += dt / 60;
        if (was && !live) cur.clear();   // (un arrêt de jeu met fin à toutes les intentions : pas d'épisode à cheval)
      },
    });
    T.matches++;
  }
  for (const k of Object.keys(T.durs)) T.durs[k] = T.durs[k].slice(0, 4000);
  process.send(T, () => process.exit(0));
} else {
  const P = Math.min(4, seeds.length), groups = [...Array(P)].map((_, i) => seeds.filter((_, j) => j % P === i));
  const parts = await Promise.all(groups.map((g) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: g.join(',') } }); c.on('message', res); })));
  const T = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number') T[k] = (T[k] || 0) + v;
    else { T[k] ||= {}; for (const [a, b] of Object.entries(v)) T[k][a] = Array.isArray(b) ? (T[k][a] || []).concat(b) : (T[k][a] || 0) + b; }
  }
  const perPM = (x) => (x / (T.liveMin * 22)).toFixed(2);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  console.log(`${T.matches} matchs, ${root}, pas ${(+(process.env.DT || 1 / 96)).toFixed(4)} s · jeu effectif ${(T.liveMin / T.matches).toFixed(1)} min / match`);
  console.log(`changements d'intention ${perPM(T.switches)} / joueur / minute de jeu · évènements : ` + Object.entries(T.ev).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${perPM(v)}`).join(' · '));
  console.log(`allers-retours A → B → A en moins d'1 s : ${perPM(T.aba)} / joueur / minute · intentions retenues face à une proposition concurrente : ${(100 * T.rivals / T.switches).toFixed(1)} % (de même priorité ${(100 * T.rivalsSame / T.switches).toFixed(1)} %, de priorité supérieure ${(100 * T.rivalsHigher / T.switches).toFixed(1)} %)`);
  console.log('épisodes par intention (par match) · durée médiane · part < 0,3 s :');
  for (const [k, n] of Object.entries(T.epi).sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`  ${(n / T.matches).toFixed(0).padStart(6)}  ${k.padEnd(44)} ${med(T.durs[k] || []).toFixed(2).padStart(6)} s  ${(100 * (T.short[k] || 0) / n).toFixed(1).padStart(5)} %`);
  console.log('transitions les plus fréquentes (par match) :');
  for (const [k, n] of Object.entries(T.tr).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${(n / T.matches).toFixed(0).padStart(6)}  ${k}`);
  console.log('intentions abandonnées (par match) :');
  for (const [k, n] of Object.entries(T.drop).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(n / T.matches).toFixed(0).padStart(6)}  ${k}`);
}
