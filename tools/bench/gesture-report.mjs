// Cohérence gestes ↔ contacts (étape 6a) : descriptif moteur → animation, observation seulement.
// Usage : node tools/bench/gesture-report.mjs [graines, ex. 100-107] [racine=.]   (pas 1/96 s ; DT=…)
//
// Définitions (horloge du moteur, secondes ; précision de référence : un pas dt) :
//  - contact physique t_phys : instant du contact (fraction du pas balayé) ou de la frappe ;
//  - contact animé t_anim : instant où l'animation ACTUELLE (avant migration) représente le contact :
//    début du geste (ou du dernier réarmé) + fraction `at` × durée de l'animation ;
//    Δanim = t_anim − t_phys (positif : l'animation montre le contact APRÈS le contact physique) ;
//  - contact prévu t_plan : instant prévu par le moteur en décidant le geste ; Δplan = t_phys − t_plan.
// Catégories séparées : contacts sans geste ; contacts du diagnostic physique sans contact décrit
// (couverture) ; gestes sans contact (annulés, interrompus, feintes, sauts disputés perdus, plongeons
// battus, tacles manqués…) ; erreurs de partie du corps ; décalages temporels.
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const arg = process.argv[2] || '100-107', root = resolve(process.argv[3] || '.');
const seeds = arg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number)) : arg.split(',').map(Number);
// Partie prévue par le geste → parties de contact admises.
const COMPAT = { pied: ['pied'], jambe: ['jambe', 'pied'], tête: ['tête'], mains: ['mains', 'corps'], corps: ['pied', 'cuisse', 'poitrine', 'tête', 'corps', 'jambe'] };
if (process.env.WORKER) {
  const { cfgFor, runLive } = await import(pathToFileURL(root + '/tools/bench/common.mjs').href);
  const { Diag } = await import(pathToFileURL(root + '/js/engine/diag.js').href);
  const dt = +(process.env.DT || 1 / 96);
  const T = { matches: 0, minutes: 0, steps: 0, g: {}, out: {}, c: {}, role: {}, noG: 0, multi: 0, sameStep: 0, cSteps: 0, part: {}, partBad: {}, dA: {}, dP: {}, diag: 0, diagMatched: 0, unmatched: {}, why: {}, rearm: 0 };
  const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
  const push = (o, k, v) => { (o[k] ||= []).push(+v.toFixed(4)); };
  for (const s of process.env.WORKER.split(',').map(Number)) {
    const diagC = [];
    const { sim } = runLive(await cfgFor(s), {
      dt,
      setup(sim2) {
        sim2.gest.all = true;
        const D = sim2.diag = new Diag({ keep: 1 });
        const oc = D.contact.bind(D); D.contact = (now, c) => { diagC.push({ pid: c.pid, step: sim2._stepN, kind: c.kind }); return oc(now, c); };
      },
      onStep(sim2, m) { T.steps++; if (m.phase === 'live') T.minutes += dt / 60; },
    });
    const G = sim.gest, byId = new Map(G.gestures.map((g) => [g.id, g]));
    // Contacts : rôle, sans geste, plusieurs dans un même pas.
    const perStep = new Map();
    for (const c of G.contacts) {
      add(T.c, c.kind); add(T.role, c.gid == null ? 'sans geste' : c.role);
      if (c.gid == null) T.noG++;
      const k = c.step; perStep.set(k, (perStep.get(k) || 0) + 1);
    }
    for (const n of perStep.values()) { T.cSteps++; if (n > 1) T.sameStep++; }
    // Couverture : chaque contact du diagnostic physique a un contact décrit (même joueur, même pas).
    const have = new Set(G.contacts.map((c) => c.pid + ':' + c.step));
    for (const d of diagC) { T.diag++; if (have.has(d.pid + ':' + d.step)) T.diagMatched++; else add(T.unmatched, d.kind); }
    // Gestes.
    for (const g of G.gestures) {
      const out = g.end == null ? 'en cours à la fin' : g.outcome;
      add(T.g, g.kind); add(T.out, g.kind + ' · ' + out);
      if (g.why && out !== 'contact') add(T.why, g.kind + ' · ' + out + ' · ' + g.why.replace(/nouveau geste : .*/, 'nouveau geste'));
      if (g.rearm) T.rearm++;
      if (g.contacts.length > 1) T.multi++;
      if (g.tContact == null) continue;
      if (g.part && g.cPart) { add(T.part, g.kind); if (!(COMPAT[g.part] || [g.part]).includes(g.cPart)) add(T.partBad, `${g.kind} : prévu ${g.part}, touché ${g.cPart}`); }
      const key = g.kind + (g.reflex && g.kind !== 'contrôle' && g.kind !== 'touche de conduite' && g.kind !== 'prise de balle' && g.kind !== 'subi' && g.kind !== 'tête' && g.kind !== 'mains' ? ' (sans armé)' : '');
      if (g.anim && g.anim.at != null) push(T.dA, key, (g.t0re ?? g.t0) + g.anim.at * g.anim.dur - g.tContact);
      if (g.tPlan != null) push(T.dP, key, g.tContact - g.tPlan);
    }
    void byId;
    T.matches++;
  }
  for (const o of [T.dA, T.dP]) for (const k of Object.keys(o)) o[k] = o[k].slice(0, 20000);
  process.send(T, () => process.exit(0));
} else {
  const P = Math.min(4, seeds.length), groups = [...Array(P)].map((_, i) => seeds.filter((_, j) => j % P === i));
  const parts = await Promise.all(groups.map((g) => new Promise((res) => { const c = fork(new URL(import.meta.url).pathname, process.argv.slice(2), { env: { ...process.env, WORKER: g.join(',') } }); c.on('message', res); })));
  const T = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number') T[k] = (T[k] || 0) + v;
    else { T[k] ||= {}; for (const [a, b] of Object.entries(v)) T[k][a] = Array.isArray(b) ? (T[k][a] || []).concat(b) : (T[k][a] || 0) + b; }
  }
  const dt = +(process.env.DT || 1 / 96), n = T.matches, pm = (v) => (v / n).toFixed(1);
  const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  console.log(`${n} matchs, ${root}, pas ${dt.toFixed(4)} s (précision de référence : un pas) · ${pm(T.minutes)} min de jeu / match`);
  const nc = Object.values(T.c).reduce((a, b) => a + b, 0);
  console.log(`contacts décrits : ${pm(nc)} / match · ` + Object.entries(T.c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pm(v)}`).join(' · '));
  console.log(`  rôle : ` + Object.entries(T.role).map(([k, v]) => `${k} ${pm(v)}`).join(' · ') + ` · contacts sans geste ${T.noG}`);
  console.log(`  pas avec plusieurs contacts (joueurs différents) : ${T.sameStep} sur ${T.cSteps} pas avec contact — identifiants distincts`);
  console.log(`couverture : contacts du diagnostic physique ${T.diag}, décrits ${T.diagMatched} (${(100 * T.diagMatched / Math.max(1, T.diag)).toFixed(2)} %)` + (Object.keys(T.unmatched).length ? ' · non décrits : ' + JSON.stringify(T.unmatched) : ''));
  console.log(`gestes (par match) et issue :`);
  for (const [k, v] of Object.entries(T.g).sort((a, b) => b[1] - a[1])) {
    const outs = Object.entries(T.out).filter(([x]) => x.startsWith(k + ' · ')).map(([x, w]) => `${x.slice(k.length + 3)} ${(100 * w / v).toFixed(1)} %`).join(' · ');
    console.log(`  ${pm(v).padStart(7)}  ${k.padEnd(24)} ${outs}`);
  }
  console.log(`  gestes réarmés (frappe suspendue, ballon hors de portée) : ${pm(T.rearm)} / match · gestes à plusieurs contacts : ${pm(T.multi)} / match`);
  console.log('gestes sans contact : motifs (par match) :');
  for (const [k, v] of Object.entries(T.why).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${pm(v).padStart(7)}  ${k}`);
  const nb = Object.values(T.partBad).reduce((a, b) => a + b, 0), np = Object.values(T.part).reduce((a, b) => a + b, 0);
  console.log(`partie du corps : ${np} gestes à partie prévue, ${nb} contacts d'une autre partie (${(100 * nb / Math.max(1, np)).toFixed(2)} %)` + (nb ? ' : ' + Object.entries(T.partBad).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' · ') : ''));
  console.log(`décalage contact ANIMÉ − contact physique (s), animation actuelle : médiane · p5 · p95 · part |Δ| ≤ 1 pas`);
  for (const [k, a] of Object.entries(T.dA).sort((x, y) => y[1].length - x[1].length)) console.log(`  ${k.padEnd(24)} n=${String(a.length).padStart(6)}  ${q(a, 0.5).toFixed(3).padStart(7)} · ${q(a, 0.05).toFixed(3).padStart(7)} · ${q(a, 0.95).toFixed(3).padStart(7)} · ${(100 * a.filter((x) => Math.abs(x) <= dt + 1e-9).length / a.length).toFixed(1).padStart(5)} %`);
  console.log(`écart contact physique − contact PRÉVU par le moteur (s) : médiane · p5 · p95 · part dans [0, 1 pas]`);
  for (const [k, a] of Object.entries(T.dP).sort((x, y) => y[1].length - x[1].length)) console.log(`  ${k.padEnd(24)} n=${String(a.length).padStart(6)}  ${q(a, 0.5).toFixed(3).padStart(7)} · ${q(a, 0.05).toFixed(3).padStart(7)} · ${q(a, 0.95).toFixed(3).padStart(7)} · ${(100 * a.filter((x) => x >= -1e-9 && x <= dt + 1e-9).length / a.length).toFixed(1).padStart(5)} %`);
}
