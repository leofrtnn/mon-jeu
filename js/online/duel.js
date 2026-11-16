/**
 * MATCH ENTRE DEUX MANAGERS, EN DIRECT (carrière en ligne)
 * ------------------------------------------------------------------
 * Les deux appareils font tourner LE MÊME match : même configuration, même graine, moteur
 * déterministe au pas fixe. Pour qu'ils restent identiques, chaque décision d'un coach
 * (changement, tactique, cri depuis le banc…) doit être appliquée au même pas de simulation
 * sur les deux appareils. Principe (« lockstep », comme les jeux de stratégie en réseau) :
 *
 *  - chaque appareil annonce régulièrement jusqu'où il a simulé (« prog ») ;
 *  - un appareil ne peut pas avoir plus de K pas d'avance sur l'autre (sinon il attend) ;
 *  - une décision prise au pas s est programmée pour le pas s + 2K, sur les deux appareils
 *    (l'autre ne peut pas encore l'avoir dépassé) ;
 *  - « Compo & tactique » met le match en pause CHEZ LES DEUX au même pas P ; chacun fait ses
 *    changements ; le match reprend quand les deux ont fini (leurs décisions sont échangées
 *    et appliquées au pas P). Idem à la mi-temps (causerie de chacun).
 *  - les décisions qui tirent au sort (causeries, cris) sont appliquées dans un ordre fixe
 *    (domicile puis extérieur) pour que le tirage soit le même partout.
 *
 * Le transport est fourni de l'extérieur : send(msg) ; les messages reçus passent par onMessage.
 * Aucune dépendance au navigateur : testé en Node (tests/duel.test.js).
 */

import { makeSub, changeFormation, swapSlots, moveSlot, setRole, setTactic, applyPlan, teamTalk, teamShout, playerShout } from '../engine/match.js';

/**
 * Applique une décision de coach au match (même code pour ses décisions, celles de l'autre,
 * et les matchs revus en différé). live : simulation en direct (pour annoncer les changements).
 * Retourne les événements produits (changements) et le texte éventuel (cris, causerie).
 */
export function execOp(m, live, op, a) {
  let evs = [], r = null;
  if (op === 'sub') { r = makeSub(m, a.side, a.out, a.in); if (r.ok) { evs = r.events; live?.handle(r.events, []); } }
  else if (op === 'form') changeFormation(m, a.side, a.f);
  else if (op === 'swap') swapSlots(m, a.side, a.x, a.y);
  else if (op === 'move') moveSlot(m, a.side, a.slot, a.x, a.y);
  else if (op === 'role') setRole(m, a.side, a.slot, a.role);
  else if (op === 'pi') { const T = m.teams[a.side]; T.pi[a.slot] = { ...(T.pi[a.slot] || {}), [a.k]: a.v }; }
  else if (op === 'ti') setTactic(m, a.side, a.k, a.v);
  else if (op === 'plan') applyPlan(m, a.side, a.plan);
  else if (op === 'talk') r = teamTalk(m, a.side, a.kind);
  else if (op === 'shout') r = teamShout(m, a.side, a.kind);
  else if (op === 'pshout') r = playerShout(m, a.side, a.pid, a.kind);
  return { evs, r };
}

/** Écart maximal entre les deux appareils, en pas de simulation (1/96 s de jeu chacun) : assez grand pour que le match ne ralentisse pas à cause du délai d'Internet, même en accéléré. */
export const DUEL_K = 1536;
/** Décisions qui utilisent le hasard du match : ordre fixe à la reprise. */
export const RNG_OPS = new Set(['talk', 'shout', 'pshout']);
/**
 * Décisions de pause appliquées à la reprise, dans l'ordre domicile puis extérieur
 * (hasard, ou effets sur la simulation partagée comme les changements de joueurs).
 * Les autres (compo, tactique) ne touchent que son équipe : appliquées tout de suite.
 */
export const DEFER_OPS = new Set([...RNG_OPS, 'sub']);

export class DuelSync {
  /** side : 0 (domicile) ou 1 (extérieur). send(msg) : envoi à l'autre appareil. */
  constructor(side, send) {
    this.side = side;
    // Messages numérotés : traités dans l'ordre d'envoi, même s'ils arrivent dans le désordre.
    this.outQ = 0; this.inQ = 0; this.early = new Map();
    this.send = (msg) => send({ ...msg, q: this.outQ++ });
    this.peerStep = -1;        // dernier pas annoncé par l'autre
    this.peerGone = false;     // l'autre a quitté (on continue seul)
    this.sched = [];           // décisions programmées { n, side, seq, op, a }
    this.seq = 0;
    this.lastProg = -Infinity;
    this.halt = null;          // pause commune en cours { id, n, by }
    this.pauseOps = [];        // mes décisions prises pendant la pause
    this.resumes = {};         // id de pause -> { [side]: ops }
    this.lastHeard = Date.now();
  }

  /** Peut-on simuler le pas n ? (sinon : attendre l'autre) */
  canStep(n) {
    if (this.halt) return false;
    return this.peerGone || n < this.peerStep + DUEL_K;
  }
  /** En attente de l'autre appareil (pas de pause en cours) ? */
  waiting(n) { return !this.halt && !this.peerGone && n >= this.peerStep + DUEL_K; }

  /** À appeler après chaque pas simulé (annonce régulière de la progression). */
  progress(n, force = false) {
    if (force || n - this.lastProg >= DUEL_K / 4) { this.lastProg = n; this.send({ t: 'prog', n }); }
  }

  /** Décision prise pendant le jeu (au pas courant n) : programmée pour plus tard, chez les deux. */
  schedule(op, a, n) {
    const e = { n: n + 2 * DUEL_K, side: this.side, seq: this.seq++, op, a };
    this.insert(e);
    this.send({ t: 'op', e });
    return e;
  }
  insert(e) {
    this.sched.push(e);
    this.sched.sort((x, y) => x.n - y.n || x.side - y.side || x.seq - y.seq);
  }
  /** Prochaine décision à appliquer avant le pas n (retirée de la file), ou null. */
  next(n) { return this.sched.length && this.sched[0].n <= n ? this.sched.shift() : null; }

  /** Demande de pause commune (au pas courant n) : elle aura lieu au pas n + 2K chez les deux. */
  requestPause(n) { return this.schedule('pause', { by: this.side }, n); }
  /** La pause programmée est atteinte (appelé par l'exécution de l'op « pause » au pas n). */
  startHalt(id, n, by) {
    this.halt = { id, n, by };
    this.pauseOps = [];
    this.progress(n, true);
  }
  /**
   * Décision prise pendant la pause : envoyée à la reprise. Les décisions de DEFER_OPS ne
   * doivent PAS être appliquées tout de suite (elles le seront par readyToResume).
   */
  record(op, a) { this.pauseOps.push({ op, a }); }
  /** Fin de MES changements : j'envoie mes décisions ; reprise quand l'autre a aussi fini. */
  finishHalt() {
    if (!this.halt) return;
    const id = this.halt.id;
    (this.resumes[id] ||= {})[this.side] = this.pauseOps;
    this.send({ t: 'resume', id, ops: this.pauseOps });
  }
  /** Les deux ont fini : décisions de l'autre à appliquer + décisions à tirage, dans l'ordre. */
  readyToResume() {
    if (!this.halt) return null;
    const r = this.resumes[this.halt.id] || {};
    if (!r[this.side] || (!r[1 - this.side] && !this.peerGone)) return null;
    const mine = r[this.side], theirs = r[1 - this.side] || [];
    const peerPlain = theirs.filter((x) => !DEFER_OPS.has(x.op));
    const ordered = [0, 1].flatMap((sd) => (sd === this.side ? mine : theirs).filter((x) => DEFER_OPS.has(x.op)));
    return { peer: peerPlain, deferred: ordered };
  }
  endHalt() { if (this.halt) delete this.resumes[this.halt.id]; this.halt = null; this.pauseOps = []; }

  /** Message reçu de l'autre appareil. */
  onMessage(msg) {
    this.lastHeard = Date.now();
    if (msg.q == null) return this.handle(msg);
    if (msg.q < this.inQ) return; // doublon
    this.early.set(msg.q, msg);
    while (this.early.has(this.inQ)) { const x = this.early.get(this.inQ); this.early.delete(this.inQ++); this.handle(x); }
  }
  handle(msg) {
    if (msg.t === 'prog') this.peerStep = Math.max(this.peerStep, msg.n);
    else if (msg.t === 'op') this.insert(msg.e);
    else if (msg.t === 'resume') (this.resumes[msg.id] ||= {})[1 - this.side] = msg.ops || [];
    else if (msg.t === 'bye') this.peerGone = true;
  }
}
