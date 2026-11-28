/**
 * Sonde 6d (outil de mesure, inactif en jeu) : moteurs jumeaux SANS interface.
 *
 * Activé seulement si `globalThis.__twin6` existe (sonde anim-probe.cjs, CE=1). Deux copies du moteur sont
 * créées à partir de la même configuration et du même état de match que le moteur affiché, puis avancent pas
 * à pas en même temps que lui :
 *   - « pur »   : aucune intervention de l'interface (moteur seul) ;
 *   - « miroir » : reçoit les mêmes écritures de l'interface dans l'état des joueurs que le moteur affiché
 *     (champs `F`), sauf celles listées dans `__twin6.noMirror` (par défaut `celeb`).
 * Après chaque pas, l'état complet (joueurs, ballon, générateur aléatoire, score, événements) est comparé.
 * Le jumeau miroir isole l'effet des écritures exclues : s'il reste identique au moteur affiché, ces
 * écritures n'ont aucun effet sur le moteur.
 * Les jumeaux ont leurs propres joueurs et leur propre ballon : ils ne touchent jamais au moteur affiché.
 * Décisions de l'entraîneur prises hors du moteur (causerie, remplacements, consignes : l'état du match change
 * entre deux pas) : recopiées dans les jumeaux au pas suivant (état du match ; joueur entrant : son état de départ,
 * fixé par la vue), et relevées (`resync`).
 */
import { createMatch, snapshotMatch, restoreMatch } from '../engine/match.js';
import { LiveSim } from '../engine/live.js';

const F = ['jump', 'appeal', 'headHands', 'hurt', 'fall', 'celeb', 'celebType'];
const PF = ['x', 'y', 'tx', 'ty', 'vx', 'vy', 'face', 'speed', 'celeb', 'fall', 'hurt', 'jump', 'kick', 'slide', 'dive', 'appeal', 'headHands'];

/** Écart d'état entre deux moteurs (null si identiques). */
function diff(A, B, evA, evB) {
  const out = [];
  if (A.m.rng.getState() !== B.m.rng.getState()) out.push('rng');
  if (A.now !== B.now) out.push('now');
  if (A.m.score.join() !== B.m.score.join()) out.push('score');
  if (A.celebrate !== B.celebrate) out.push('celebrate');
  const ea = evA.map((e) => e.type + ':' + (e.pid ?? '')).join(), eb = evB.map((e) => e.type + ':' + (e.pid ?? '')).join();
  if (ea !== eb) out.push('évts ' + ea + ' ≠ ' + eb);
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) if (A.P[k] !== B.P[k]) { out.push('ballon.' + k); break; }
  if ((A.holder?.mp.id ?? null) !== (B.holder?.mp.id ?? null)) out.push('porteur');
  for (const [id, p] of A.players) {
    const q = B.players.get(id); if (!q) { out.push('joueur absent ' + id); continue; }
    for (const k of PF) if ((p[k] ?? 0) !== (q[k] ?? 0)) out.push(`${id}.${k} ${typeof p[k] === 'number' ? +p[k].toFixed(4) : p[k]}/${typeof q[k] === 'number' ? +q[k].toFixed(4) : q[k]}`);
    if ((p.celebType ?? null) !== (q.celebType ?? null)) out.push(`${id}.celebType ${p.celebType}/${q.celebType}`);
  }
  if (B.players.size !== A.players.size) out.push('effectif');
  return out.length ? out : null;
}

export function attachTwin(view, T, snap0) {
  const L = view.live, noM = new Set(T.noMirror || ['celeb']);
  const mk = () => { const m = createMatch(JSON.parse(JSON.stringify(T.cfg))); restoreMatch(m, JSON.parse(JSON.stringify(snap0))); for (const k of ['big', 'live']) if (k in view.m) m[k] = view.m[k]; return new LiveSim(m); };
  const tw = { pure: mk(), mirror: mk() };
  const R = T.res = { steps: 0, writes: {}, mirrored: {}, pure: null, mirror: null, pureN: 0, mirrorN: 0, init: { pure: diff(L, tw.pure, [], []), mirror: diff(L, tw.mirror, [], []) } };
  const pend = [];
  const sig = () => L.m.rng.getState() + '|' + L.m.teams.map((t) => t.onPitch.map((mp) => (mp ? mp.id + (mp.red ? 'r' : '') + (mp.injured ? 'i' : '') : '-')).join(',') + JSON.stringify(t.tactics || null) + (t.formation || '')).join('|');
  let last = sig(); R.resync = [];
  // Écritures de l'interface : relevées autour de chaque traitement d'événement (entre deux pas du moteur).
  for (const fn of ['liveEvent', 'syncPlayers']) {
    const f0 = view[fn].bind(view);
    view[fn] = (...a) => {
      const before = new Map(); for (const [id, p] of L.players) before.set(id, F.map((k) => p[k]));
      const r = f0(...a);
      for (const [id, p] of L.players) {
        const b = before.get(id); if (!b) { R.writes['nouveau joueur'] = (R.writes['nouveau joueur'] || 0) + 1; continue; }
        F.forEach((k, i) => { if (p[k] !== b[i]) { R.writes[k] = (R.writes[k] || 0) + 1; (T.log ||= []).push({ t: L.now, pid: id, k, from: b[i], to: p[k], via: fn }); if (!noM.has(k)) pend.push([id, k, p[k]]); } });
      }
      return r;
    };
  }
  const st0 = L.step.bind(L);
  L.step = (dt) => {
    const rh = L.resumeHT, now = sig();
    if (now !== last) {
      R.resync.push({ t: +L.now.toFixed(3), minute: L.m.minute });
      const snap = JSON.parse(JSON.stringify(snapshotMatch(L.m)));
      for (const S of Object.values(tw)) {
        const had = new Set(S.players.keys()); restoreMatch(S.m, JSON.parse(JSON.stringify(snap))); S.sync();
        for (const [id, q] of S.players) if (!had.has(id)) { const p = L.players.get(id); if (p) for (const k in p) if (k[0] !== '_' && ['number', 'string', 'boolean'].includes(typeof p[k])) q[k] = p[k]; }
      }
    }
    for (const [id, k, x] of pend) { const q = tw.mirror.players.get(id); if (q) { q[k] = x; R.mirrored[k] = (R.mirrored[k] || 0) + 1; } }
    pend.length = 0;
    const ev = st0(dt); last = sig();
    for (const name of ['pure', 'mirror']) {
      const S = tw[name]; S.resumeHT = rh;
      const e2 = S.step(dt);
      const d = diff(L, S, ev, e2);
      if (d) { R[name + 'N']++; if (!R[name]) R[name] = { step: R.steps, t: +L.now.toFixed(3), minute: L.m.minute, d: d.slice(0, 12), lastEv: (T.evLog || []).slice(-4) }; }
    }
    if (ev.length) { (T.evLog ||= []).push(...ev.map((e) => `${L.now.toFixed(2)} ${e.type}:${e.pid ?? ''}`)); if (T.evLog.length > 50) T.evLog.splice(0, 25); }
    R.steps++;
    return ev;
  };
}
