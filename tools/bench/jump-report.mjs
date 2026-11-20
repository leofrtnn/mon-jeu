// Ventilation des sauts de cible > 3 m (étape 5a) : par cause, priorité et source.
// Mesure IDENTIQUE à move-report (joueurs de champ, jeu en cours, hors arrêt de jeu et célébration,
// cible comparée à celle du dernier pas de jeu observé). Observation seulement.
// Usage : node tools/bench/jump-report.mjs [matchs=4] [graine=100] [racine=.]
//   Avec un moteur sans arbitre (avant 5a), la cause est la fonction qui a écrit la cible.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[4] || '.');
if (process.env.WORKER) {
  const { cfgFor, createMatch, LiveSim, L, W } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = 1 / 96;
  const R = { t: 0, jumps: 0, cat: {}, pri: {}, src: {}, tr: {} };
  const add = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m);
    const arb = [...sim.players.values()][0]._arb !== undefined;
    if (!arb) {
      // Moteur sans arbitre : on note la fonction qui fait sauter la cible (écriture > 3 m de la cible du début du pas).
      for (const p of sim.players.values()) {
        let tx = p.tx, ty = p.ty;
        const chk = () => { if (p._t0 && Math.hypot((tx - p._t0.x) * L, (ty - p._t0.y) * W) > 3) { const st = new Error().stack.split('\n'); let w = '?'; for (const l of st.slice(2, 10)) { const mm = l.match(/LiveSim\.(\w+)/); if (mm) { w = mm[1]; break; } } p._jw = w; } };
        Object.defineProperty(p, 'tx', { get: () => tx, set: (v) => { tx = v; chk(); }, configurable: true, enumerable: true });
        Object.defineProperty(p, 'ty', { get: () => ty, set: (v) => { ty = v; chk(); }, configurable: true, enumerable: true });
      }
    }
    const prev = new Map();   // (q.gap : 1re comparaison après un arrêt de jeu)
    for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
      for (const p of sim.players.values()) { p._t0 = { x: p.tx, y: p.ty }; p._jw = null; p._g0 = arb && sim.inGesture(p); p._c0 = arb && p._arb.cur ? { ...p._arb.cur, src: p._intent?.src } : null; }
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      if (m.phase !== 'live' || sim.restart || sim.celebrate > 0) { prev.forEach((q) => { q.gap = true; }); continue; }
      for (const p of sim.players.values()) {
        if (p.gk) continue;
        R.t += dt;
        const q = prev.get(p), tx = p.tx * L, ty = p.ty * W;
        if (q && Math.hypot(tx - q.x, ty - q.y) > 3) {
          R.jumps++;
          let c;
          if (q.gap) c = 'reprise après arrêt de jeu (cible comparée à celle d\'avant l\'arrêt)';
          else if (!arb) c = 'écrit par ' + (p._jw || 'inconnu (écart cumulé)');
          else {
            const A = p._arb, cur = p._intent;
            if (p._g0 || sim.inGesture(p)) c = 'geste en cours P6 (début ou fin)';
            else if (A.event) {
              const why = (A.dropped || []).map((d) => d.why).sort().join('+'), c0 = p._c0;
              if (c0 && cur && !why && c0.slot === cur.slot) c = 'changement de rôle dans le même créneau (révision du placement collectif)';
              else if (A.event === 'préemption') c = 'préemption par une priorité supérieure';
              else if (A.event === 'remplacement') c = 'remplacement à priorité égale (0,6 s, +25 %)';
              else if (why) c = 'fin de l\'intention précédente (' + why + ') → reprise d\'une autre';
              else c = 'changement : ' + A.event;
              add(R.tr, `${c0 ? 'P' + c0.pri + ' ' + c0.src : '—'} → P${cur?.pri} ${cur?.src}`);
            } else c = 'actualisation de la même intention' + (cur?.track ? ' (suivi, non lissé)' : cur && cur.pri >= 4 ? ' (P4-P5, non lissé)' : ' (lissée)');
            if (cur) { add(R.pri, 'P' + cur.pri); add(R.src, cur.src); }
          }
          add(R.cat, c);
        }
        prev.set(p, { x: tx, y: ty, gap: false });
      }
    }
  }
  process.send(R, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 4), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const A = { t: 0, jumps: 0, cat: {}, pri: {}, src: {}, tr: {} };
  for (const p of parts) { A.t += p.t; A.jumps += p.jumps; for (const k of ['cat', 'pri', 'src', 'tr']) for (const [a, b] of Object.entries(p[k])) A[k][a] = (A[k][a] || 0) + b; }
  const min = A.t / 60, f = (v) => `${(v / min).toFixed(2).padStart(6)} / min  ${(100 * v / A.jumps).toFixed(1).padStart(5)} %`;
  console.log(`${N} matchs (graines ${base0}…), ${root}`);
  console.log(`sauts de cible > 3 m : ${(A.jumps / min).toFixed(1)} / joueur / minute`);
  console.log('par cause :'); for (const [k, v] of Object.entries(A.cat).sort((a, b) => b[1] - a[1])) console.log('  ', f(v), ' ', k);
  if (Object.keys(A.pri).length) { console.log('par priorité de la cible après le saut :'); for (const [k, v] of Object.entries(A.pri).sort()) console.log('  ', f(v), ' ', k); }
  if (Object.keys(A.tr).length) { console.log('changements d\'intention les plus fréquents (de → vers) :'); for (const [k, v] of Object.entries(A.tr).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log('  ', f(v), ' ', k); }
  if (Object.keys(A.src).length) { console.log('par source :'); for (const [k, v] of Object.entries(A.src).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log('  ', f(v), ' ', k); }
}
