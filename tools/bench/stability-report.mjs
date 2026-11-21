// Stabilité des cibles (étape 5d) : les sauts de cible > 3 m de move-report / jump-report, séparés
// en familles explicites, avec volumes bruts, taux par joueur et par minute et dispersion par joueur.
// Usage : node tools/bench/stability-report.mjs [matchs=16] [graine=100] [racine=.]   (pas 1/96 s)
// Observation seulement (aucun hasard consommé, aucun diagnostic branché).
//
// Mesure de base, IDENTIQUE à move-report et jump-report : joueurs de champ, jeu en cours (hors
// arrêt de jeu et célébration), cible comparée à celle du dernier pas de jeu observé ; un « saut »
// est un déplacement de la cible de plus de 3 m d'un pas au suivant. Chaque saut est classé :
//  A. CHANGEMENT RÉEL D'INTENTION ARBITRÉE : à ce pas, l'arbitre a changé d'intention retenue
//     (début, préemption, remplacement à priorité égale, retour, fin d'une intention et reprise
//     d'une autre), hors cas C ;
//  B. ACTUALISATION À INTENTION CONSTANTE : même intention retenue, son point a bougé de plus de
//     3 m : urgence ou action sur le ballon (P4-P5, point mis à jour à chaque proposition : ballon,
//     trajectoire, porteur en mouvement), suivi d'un adversaire (marquage, contenir, repli…),
//     ou intention lissée (glissement) ;
//  C. RÉVISION DU PLACEMENT COLLECTIF (étape 7) : l'intention change à l'intérieur du créneau du
//     placement collectif sans qu'aucune intention ne soit abandonnée — le placement d'équipe a
//     réattribué le rôle du joueur (formation → couverture, soutien, pressing…) ;
//  D. HORS ARBITRAGE : première comparaison après un arrêt de jeu (cible d'avant l'arrêt) et
//     début / fin d'un geste en cours (P6, hors arbitrage).
// Les changements d'intention arbitrée SANS saut de cible (< 3 m) sont comptés à part.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[4] || '.');
if (process.env.WORKER) {
  const { cfgFor, createMatch, LiveSim, L, W } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const [base, n] = process.env.WORKER.split(',').map(Number), dt = 1 / 96;
  const R = { t: 0, jumps: 0, fam: {}, sub: {}, slotsC: {}, chg: 0, chgFam: {}, players: [] };
  const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
  for (let g = 0; g < n; g++) {
    const m = createMatch(await cfgFor(base + g)); const sim = new LiveSim(m);
    const prev = new Map(), per = new Map();
    for (let k = 0; k < 2_000_000 && m.phase !== 'ft'; k++) {
      for (const p of sim.players.values()) { p._g0 = sim.inGesture(p); p._c0 = p._arb.cur ? { ...p._arb.cur, src: p._intent?.src } : null; }
      sim.step(dt); if (m.phase === 'ht') sim.resumeHT = true;
      if (m.phase !== 'live' || sim.restart || sim.celebrate > 0) { prev.forEach((q) => { q.gap = true; }); continue; }
      for (const p of sim.players.values()) {
        if (p.gk) continue;
        R.t += dt;
        const P = per.get(p) || { t: 0, A: 0, B: 0, C: 0, D: 0, chg: 0 }; P.t += dt; per.set(p, P);
        const q = prev.get(p), tx = p.tx * L, ty = p.ty * W, A = p._arb, cur = p._intent, c0 = p._c0;
        const gesture = p._g0 || sim.inGesture(p);
        // Classement de l'évènement d'arbitrage de ce pas (même règle que jump-report).
        let fam = null, sub = null;
        if (q?.gap) { fam = 'D'; sub = 'première comparaison après un arrêt de jeu'; }
        else if (gesture) { fam = 'D'; sub = 'geste en cours P6 (début ou fin)'; }
        else if (A.event) {
          const why = (A.dropped || []).map((d) => d.why).sort().join('+');
          if (c0 && cur && !why && c0.slot === cur.slot) { fam = 'C'; sub = 'rôle réattribué par le placement collectif'; }
          else { fam = 'A'; sub = A.event === 'préemption' ? 'préemption par une priorité supérieure' : A.event === 'remplacement' ? 'remplacement à priorité égale' : why ? 'fin de l\'intention précédente (' + why + ') → reprise d\'une autre' : 'changement : ' + A.event; }
        } else { fam = 'B'; sub = cur?.track ? 'suivi d\'un adversaire ou du porteur (non lissé)' : cur && cur.pri >= 4 ? 'urgence / action sur le ballon P4-P5 (non lissé)' : 'intention lissée (glissement)'; }
        // Changements d'intention (toute distance) : familles A et C.
        if (!q?.gap && !gesture && A.event && (fam === 'A' || fam === 'C')) { R.chg++; add(R.chgFam, fam); P.chg++; }
        if (q && Math.hypot(tx - q.x, ty - q.y) > 3) {
          R.jumps++; add(R.fam, fam); add(R.sub, fam + ' · ' + sub); P[fam]++;
          if (fam === 'C') add(R.slotsC, `${c0.slot} : ${c0.src} → ${cur.src}`);
        }
        prev.set(p, { x: tx, y: ty, gap: false });
      }
    }
    for (const P of per.values()) if (P.t > 300) R.players.push(P);   // joueurs présents au moins 5 min de jeu
  }
  process.send(R, () => process.exit(0));
} else {
  const N = +(process.argv[2] || 16), base0 = +(process.argv[3] || 100), P = Math.min(4, N), per = Math.ceil(N / P);
  const parts = await Promise.all([...Array(P)].map((_, i) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: `${base0 + i * per},${Math.min(per, N - i * per)}` } }); c.on('message', res); })));
  const A = { t: 0, jumps: 0, chg: 0, fam: {}, sub: {}, slotsC: {}, chgFam: {}, players: [] };
  for (const p of parts) { A.t += p.t; A.jumps += p.jumps; A.chg += p.chg; A.players.push(...p.players); for (const k of ['fam', 'sub', 'slotsC', 'chgFam']) for (const [a, b] of Object.entries(p[k])) A[k][a] = (A[k][a] || 0) + b; }
  const min = A.t / 60, rate = (v) => (v / min).toFixed(2);
  const NAME = { A: 'A. changements réels d\'intention arbitrée', B: 'B. actualisations à intention constante', C: 'C. révisions du placement collectif (étape 7)', D: 'D. hors arbitrage (reprise après arrêt, geste P6)' };
  console.log(`${N} matchs (graines ${base0}…), ${root} · ${(min).toFixed(0)} minutes-joueur de jeu (joueurs de champ)`);
  console.log(`sauts de cible > 3 m : ${A.jumps} au total · ${rate(A.jumps)} / joueur / minute (mesure de move-report)`);
  for (const f of ['A', 'B', 'C', 'D']) {
    const v = A.fam[f] || 0;
    console.log(`  ${NAME[f].padEnd(52)} ${String(v).padStart(8)} sauts · ${rate(v).padStart(5)} / joueur / min · ${(100 * v / A.jumps).toFixed(1).padStart(5)} %`);
    for (const [k, w] of Object.entries(A.sub).filter(([k]) => k.startsWith(f + ' · ')).sort((a, b) => b[1] - a[1])) console.log(`      ${k.slice(4).padEnd(60)} ${String(w).padStart(8)} · ${rate(w).padStart(5)} / min`);
  }
  console.log('révisions du placement collectif (C), créneau : rôle quitté → rôle attribué (les plus fréquentes) :');
  for (const [k, v] of Object.entries(A.slotsC).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${rate(v).padStart(6)} / min  ${k}`);
  console.log(`changements d'intention arbitrée, toute distance : ${A.chg} · ${rate(A.chg)} / joueur / minute (A ${rate(A.chgFam.A || 0)} · C ${rate(A.chgFam.C || 0)}) ; dont avec saut de cible > 3 m : A ${rate(A.fam.A || 0)} · C ${rate(A.fam.C || 0)}`);
  // Dispersion par joueur (au moins 5 min de jeu) de l'indicateur A.
  const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  const rA = A.players.map((p) => p.A / (p.t / 60)), rAC = A.players.map((p) => (p.A + p.C) / (p.t / 60));
  console.log(`par joueur (n = ${A.players.length}) — sauts A / min : médiane ${q(rA, 0.5).toFixed(2)} · p90 ${q(rA, 0.9).toFixed(2)} · max ${q(rA, 1).toFixed(2)} · joueurs > 5 : ${rA.filter((x) => x > 5).length}`);
  console.log(`                     sauts A + C / min : médiane ${q(rAC, 0.5).toFixed(2)} · p90 ${q(rAC, 0.9).toFixed(2)} · max ${q(rAC, 1).toFixed(2)} · joueurs > 5 : ${rAC.filter((x) => x > 5).length}`);
}
