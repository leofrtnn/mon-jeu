/**
 * MOTEUR DE MATCH EN DIRECT
 * ------------------------------------------------------------------
 * Les 22 joueurs prennent leurs décisions en temps réel, selon leurs positions et leurs
 * attributs (pas de scénario écrit à l'avance) :
 *  - le porteur évalue ses options : passe à chaque coéquipier (ligne de passe, adversaires
 *    capables de couper la trajectoire, marquage du receveur, gain de terrain), conduite de balle
 *    dans l'espace, frappe (xG selon distance, angle, pression), centre, dégagement ;
 *  - la défense presse le porteur (selon le pressing demandé), couvre, marque les attaquants
 *    dans sa zone, le gardien se place sur la ligne de tir ;
 *  - duels (tacle réussi, dribble, faute, cartons), interceptions, ballons libres disputés,
 *    jeu de tête, hors-jeu, touches, six mètres, corners, coups francs, penalties, engagements.
 * Le ballon obéit à la physique (ballPhysics.js). L'issue d'une passe ou d'un tir est tirée au
 * sort À PARTIR de la géométrie réelle (qui peut couper, qui est démarqué), puis jouée
 * physiquement : ce que l'on voit est ce qui s'est passé.
 *
 * La gestion du temps (minutes, mi-temps, temps additionnel, fatigue, remplacements de l'IA,
 * blessures) est celle du moteur classique (match.js), comme les statistiques, les notes et
 * les événements : l'écran de match, les commentaires et la fin de match fonctionnent à l'identique.
 * Aucune dépendance au navigateur : testable et calibrable en Node.
 */
import { SKILL_MOVES, movesFor } from '../game/stars.js';
import { refereeProfile } from '../game/referee.js';
import { createBall, stepBall, solveKick, predict, cloneBall, R as BR, GOAL_HALF, BAR, PITCH_L as L, PITCH_W as W } from '../ui/ballPhysics.js';
import { reachAt, contactPoint, sweptReach, ballPath, interceptPlan, timeToReach, touchQuality, firstTouch, passError, receivePlan, sweptBody, gauss, DIVE, diveRange, diveFrac, diveTimeFor, diveHands, sweptPoint, sweptLimb, gkHandle, shotError, TACKLE, tackleFoot, sweptTackleBall, legHits, shields, tackleQuality, bodyScore } from './contact.js';
import { formationPos } from './positions.js';
import { P as PRI, newArbiter, propose as proposeIntent, arbitrate } from './intent.js';
import { velocityStep, accelOf, topSpeed, pursue as bodyPursue } from './body.js';
import { GestureLog } from './gesture.js';
/** Allures demandées (étape 5b) : vitesse visée par niveau (m/s). « à fond » = capacité du joueur. */
/** Sortie du ballon : centre au-delà de OUT_M (m) d'une ligne. Un seul seuil pour la sortie et pour la jouabilité. */
export const OUT_M = 0.1;
const outOfPlay = (P) => P.y < -OUT_M || P.y > W + OUT_M || P.x < -OUT_M || P.x > L + OUT_M;
const PACE_LEVELS = { 'petits pas': 1.1, marche: 1.3, trot: 3.2, course: 5.0, sprint: 6.3, 'à fond': Infinity };
const PACE_ORDER = ['petits pas', 'marche', 'trot', 'course', 'sprint', 'à fond'];
const PACE_HOLD = 0.3;   // une allure plus basse doit être demandée pendant 0,3 s avant d'être adoptée
import { roleFx } from '../data/constants.js';
import { setPlanOf, cornerRoutine, setPieceEdge, directFkChance } from './setPlays.js';
import { clamp } from '../core/rng.js';
import { activePlayers, eff, addRating, emit, changePossession, momentum, setPieceTaker, sendOff, injure, kickoff as engineKickoff, minuteStart, minuteEnd, stepMinute, captainCalm } from './match.js';

const PART_FR = { foot: 'pied', thigh: 'cuisse', chest: 'poitrine', head: 'tête', hands: 'mains' };   // (descriptif de gestes)
const GS = 1.6;            // les gestes (frappe, tacle…) durent un temps « d'affichage »
export const CLOCK = 6.25; // ancienne horloge compressée (référence pour la fatigue)
const LVL = { low: -1, mid: 0, high: 1 };
const MENT = { defensive: -1, balanced: 0, offensive: 1 };
const TK = { soft: -1, normal: 0, hard: 1 };
const sig = (x) => 1 / (1 + Math.exp(-x));
const piOf = (t, mp, key, def) => (mp && t.pi?.[mp.slot]?.[key]) || def;

/** Attribut détaillé sur 20 (joueurs importés : 0 = Corners, 5 = Coups francs, 11 = Tir de pen.), sinon 0. */
const det20 = (mp, i) => (mp.p?.det ? parseInt(mp.p.det[i], 21) || 0 : 0);
/** Spécialiste de CPA : son attribut détaillé (sur 20) compte en plus du profil. */
const spec = (mp, i, base) => base + (det20(mp, i) ? (det20(mp, i) * 5 - 50) * 0.8 : 0);

/** Réglages d'équilibre (calibrés avec tests/live.test.js : buts, tirs, fautes, corners). */
export /** Le joueur (de la simulation) a-t-il ce trait ? (Magicien, Maestro… : voir game/traits.js) */
const TR = (pl, k) => !!pl?.mp?.p?.traits?.includes(k);

/** Détente (m) d'un joueur (contact.js · jumpGain). */
const jumpGainOf = (p) => 0.35 + Math.max(0, Math.min(1, ((p.mp?.p?.attrs?.phy ?? 60) - 40) / 55)) * 0.3;

/** Parties du corps qui peuvent jouer un ballon libre (la tête : seconds ballons aériens). */
const LOOSE_PARTS = ['foot', 'thigh', 'chest', 'head'];

const TUNE = {   // calibré en TEMPS RÉEL : ~2,7 buts, ~23 tirs, ~20 fautes, ~80 % de passes, ~4,5 passes par possession
  clock: 1,        // secondes de match par seconde de jeu simulé (1 = temps réel)
  shotW: 0.9,        // attrait de la frappe face aux autres options
  shotCost: 6,     // coût de la perte de balle dans le choix de tirer
  carryW: 0.5,        // attrait de la conduite de balle
  keepW: 0.6,        // valeur de garder le ballon (passe sûre à un partenaire libre)
  holdU: -0.025,       // temporiser balle au pied (négatif : seulement quand les autres options sont mauvaises)
  crossW: 0.16,
  passRisk: 0.55,      // sévérité des interceptions
  lossW: 10,         // coût de la perte de balle dans le choix des passes
  tackleRate: 0.4,    // fréquence des tentatives de tacle
  foulP: 0.2,        // part des tentatives de tacle qui finissent en faute
  xg: 0.85,          // échelle du modèle d'xG géométrique
  takeonW: 0.08,       // attrait du crochet / débordement
  hold: 2.4,            // temps de réflexion avant de jouer le ballon (×)
  recv: 3.2,            // temps de contrôle à la réception (×)
  clearCorner: 0.2,  // part des dégagements d'urgence qui finissent en corner
  loftPen: 0.3,       // coût de choix d'un ballon aérien (réalisme : surtout des passes au sol)
  passErr: 0.0024,    // imprécision des passes selon la longueur
  carryLoss: 1.5,
  carryFree: 0.15,
  longCost: 0.15,     // coût relatif d'une frappe hors de la surface
  finish: 1.25,      // réussite des frappes (buts ≈ xG sur une saison)
  onTarget: 0.31,      // précision de base des frappes
  offsideSeen: 0.86,   // à quel point le passeur voit (et évite) le hors-jeu    // part du risque de perte qui reste en conduisant sans adversaire proche     // part du coût de perte appliquée à la conduite de balle
  backKeep: 7,        // à quel point garder le ballon en reculant vaut moins (m)
  temp: 0.005,        // part de hasard dans les choix (plus bas = choix plus lucides)
};
if (globalThis.__T) Object.assign(TUNE, globalThis.__T);   // réglages de calibrage (outils)

/** Durée (s) de l'animation de chaque geste technique. */
const SKILL_DUR = { crochet: 0.35, feinte: 0.45, passement: 0.6, jongle: 0.8, petitpont: 0.4, talon: 0.4, roulette: 0.7, sombrero: 0.55, virgule: 0.45, coupdusombrero: 0.5 };

export class LiveSim {
  /**
   * m : état du moteur (createMatch). opts : { players (Map partagée avec la vue), ball (objet
   * physique partagé), sync (fonction de synchronisation des joueurs de la vue) }.
   */
  constructor(m, opts = {}) {
    this.m = m;
    m.live = true;
    this.ref = refereeProfile(m.seed);   // personnalité de l'arbitre (sévérité, tolérance au contact)
    this.rng = m.rng;
    this.players = opts.players || new Map();
    this.P = opts.ball || createBall();
    // Contrat moteur → animation (étape 6a) : descriptif des gestes et contacts, en lecture seule (jamais lu par le moteur).
    this.gest = new GestureLog(this, opts.gestures || {});
    // Météo : la surface agit sur le ballon (pluie : il fuse ; neige : il freine).
    const wx = this.m?.wx || m.wx || {};
    this.P.rollK = wx.roll || 1; this.P.skidK = wx.skid || 1;
    this.syncFn = opts.sync || null;
    this.now = 0; this.sec = 0; this.reshapeT = 1;
    this.holder = null; this.inHands = false;
    this.pending = null;      // passe en l'air vers un joueur désigné (receveur ou intercepteur)
    this.restart = null;      // remise en jeu en préparation
    this.shot = null;         // tir en cours (issue décidée)
    this.lastTouch = 0; this.poss = 0;
    this.celebrate = 0;
    this.resumeHT = false;
    this.sync(true);
  }

  /* ---------------- Instantané (reprise après rechargement) ---------------- */

  snapshot() {
    const pl = {};
    const KEEP = ['x', 'y', 'tx', 'ty', 'vx', 'vy', 'face', 'phase', 'speed', 'cd', 'next', 'celeb', 'celebType'];
    for (const [id, p] of this.players) { const o = {}; for (const k of KEEP) if (p[k] != null) o[k] = p[k]; pl[id] = o; }
    const P = this.P;
    const rs = this.restart;
    return {
      now: this.now, sec: this.sec, poss: this.poss, lastTouch: this.lastTouch, celebrate: this.celebrate, afterGoalSide: this.afterGoalSide,
      inHands: this.inHands, holder: this.holder?.mp.id ?? null, gainT: this.gainT || null, resumeHT: this.resumeHT,
      ball: { x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz: P.vz },
      restart: rs ? { kind: rs.kind, side: rs.side, x: rs.x, y: rs.y, taker: rs.taker?.mp.id ?? null, routine: rs.routine } : null,
      players: pl,
    };
  }

  restore(s) {
    this.sync();
    Object.assign(this, { now: s.now, sec: s.sec, poss: s.poss, lastTouch: s.lastTouch, celebrate: s.celebrate || 0, afterGoalSide: s.afterGoalSide, inHands: !!s.inHands, gainT: s.gainT, resumeHT: !!s.resumeHT });
    Object.assign(this.P, s.ball, { spin: 0, top: 0, inGoal: 0, hitPost: false });
    this._own = true;
    for (const [id, o] of Object.entries(s.players || {})) { const p = this.players.get(+id); if (p) Object.assign(p, o, { carry: null, prep: null, kick: 0 }); }
    this._own = false;
    this.holder = s.holder != null ? this.players.get(s.holder) || null : null;
    this.pending = null; this.shot = null;
    if (s.restart) {
      const taker = this.players.get(s.restart.taker) || this.list(s.restart.side).find((p) => !p.gk);
      this.restart = { ...s.restart, taker, t: 0 };
      this._draftStamp = (this._draftStamp || 0) + 1;
      if (this.restart.kind === 'kickoff') this.kickoffTargets(); else this.restartPositions();
      this.commitDrafts(); this.resolveIntents(0);
    } else this.restart = null;
  }

  /* ---------------- Joueurs ---------------- */

  sync(first = false) {
    if (this.syncFn) { this.syncFn(); this.tagPlayers(); return; }
    const seen = new Set();
    for (const t of this.m.teams) {
      for (const mp of t.onPitch) {
        if (!mp || !mp.onPitch || mp.red || mp.injured) continue;
        seen.add(mp.id);
        let pl = this.players.get(mp.id);
        if (!pl) {
          pl = { x: 0.5, y: t.side === 0 ? -0.03 : 1.03, tx: 0.5, ty: 0.5, vx: 0, vy: 0, face: t.side === 0 ? 0 : Math.PI, phase: 0, speed: 0,
            kick: 0, slide: 0, dive: 0, diveDir: 1, jump: 0, celeb: 0, fall: 0, touch: 0, alpha: 1 };
          if (first) { const p = formationPos(t, mp, 0.5, 0.5, false, true); pl.x = p.x; pl.y = p.y; }
          this.players.set(mp.id, pl);
        }
        pl.mp = mp; pl.team = t; pl.side = t.side; pl.gk = t.slots[mp.slot].pos === 'GB';
      }
    }
    for (const [id, pl] of this.players) if (!seen.has(id)) { this.players.delete(id); if (this.holder === pl) this.holder = null; }
    this.tagPlayers();
  }
  tagPlayers() { for (const pl of this.players.values()) { pl.cd = pl.cd || 0; pl.next = pl.next || 0; this.guardTarget(pl); } }

  /**
   * Étape 5a : la cible de déplacement (tx, ty) n'a qu'UN propriétaire, l'arbitre des intentions.
   * Toute autre écriture est une violation (comptée ; refusée en mode strict pour les tests).
   * Les systèmes de placement écrivent un BROUILLON (ptx, pty) qui devient une proposition.
   */
  guardTarget(pl) {
    if (pl._guarded) return;
    const sim = this;
    let tx = pl.tx ?? 0.5, ty = pl.ty ?? 0.5, ptx = tx, pty = ty;
    const chk = () => { if (!sim._own) { sim.targetViolations = (sim.targetViolations || 0) + 1; if (globalThis.__STRICT_TARGET) throw new Error('écriture de cible hors arbitre'); return false; } return true; };
    Object.defineProperty(pl, 'tx', { get: () => tx, set: (v) => { if (chk()) tx = v; }, enumerable: true, configurable: true });
    Object.defineProperty(pl, 'ty', { get: () => ty, set: (v) => { if (chk()) ty = v; }, enumerable: true, configurable: true });
    Object.defineProperty(pl, 'ptx', { get: () => ptx, set: (v) => { ptx = v; pl._draft = sim._draftStamp; }, enumerable: false, configurable: true });
    Object.defineProperty(pl, 'pty', { get: () => pty, set: (v) => { pty = v; pl._draft = sim._draftStamp; }, enumerable: false, configurable: true });
    pl._arb = newArbiter();
    pl._guarded = true;
  }
  /** Écriture directe de la cible, réservée au moteur : geste en cours (P6), phases sans jeu. */
  setT(p, x, y) { const o = this._own; this._own = true; p.tx = x; p.ty = y; this._own = o; }
  /** Proposition d'intention (coordonnées en mètres). */
  want(p, slot, id, pri, src, x, y, value = 0.5, extra = null) {
    proposeIntent(p._arb, this.now, { slot, id, pri, src, x, y, value: clamp(value, 0, 1), ...(extra || {}) });
  }
  /** Arrêt de jeu : condition de fin explicite de toutes les intentions en cours (réévaluation complète). */
  endIntents() { for (const p of this.players.values()) if (p._arb) { p._arb.slots.clear(); p._arb.cur = null; p._arb.prev = null; } }
  /** Le joueur est-il en plein geste (P6, hors arbitrage) ? */
  inGesture(p) { return !!(p._dive || p._tk || (p._down || 0) > this.now || p.fall > 0.3 || p.slide > 0.2 || p.hurt > 0 || (p._p6 && this.now < p._p6.until)); }

  /**
   * Arbitrage (étape 5a) : une seule intention retenue par joueur et par pas, puis écriture de la
   * cible. Le geste en cours (P6) n'est pas arbitré ; sa fin déclenche une réévaluation immédiate.
   */
  resolveIntents(dt) {
    const st = this.intentStats ||= { arbitrations: 0, players: 0, events: {}, byPri: {} };
    for (const p of this.players.values()) {
      const A = p._arb;
      // Contrôle : un seul arbitrage par joueur et par pas de jeu (la mise en place d'un engagement,
      // arbitrée hors pas avec dt = 0, n'en est pas un).
      if (dt > 0) { if (p._arbAt === this.now) st.double = (st.double || 0) + 1; p._arbAt = this.now; }
      p._idle = false;   // « à sa place » (lu par move() : petits pas en marchant), posé plus bas
      if (this.inGesture(p)) {
        A.inP6 = true;
        if (p._p6 && this.now < p._p6.until) this.setT(p, p._p6.x / L, p._p6.y / W);
        continue;
      }
      if (A.inP6) { A.inP6 = false; A.cur = null; A.prev = null; }   // fin du geste : réévaluation immédiate
      const r = arbitrate(A, this.now, dt);
      st.players++;
      if (!r) continue;
      st.arbitrations++;
      if (r.event) {
        st.events[r.event] = (st.events[r.event] || 0) + 1;
        // Journal des intentions (étape 5d, diagnostic seulement) : intention quittée, retenue (identifiant = motif)
        // Propositions concurrentes arbitrées à ce pas (autres créneaux), intentions abandonnées et pourquoi.
        if (this.diag) {
          const from = p._intent ? { id: p._intent.id, src: p._intent.src, pri: p._intent.pri } : null;
          const rivals = r.cur ? [...A.slots.values()].map((e) => e.prop).filter((q) => q.slot !== r.cur.slot).map((q) => ({ id: q.id, src: q.src, pri: q.pri, value: +q.value.toFixed(2) })) : [];
          this.diag.intent(this.now, { pid: p.mp.id, side: p.side, event: r.event, id: r.cur?.id ?? null, src: r.cur?.src ?? null, pri: r.cur?.pri ?? null, value: r.cur ? +r.cur.value.toFixed(2) : null, x: r.x, y: r.y, from, rivals, dropped: A.dropped || null, pace: p._pace?.pace ?? null });
        }
      }
      if (r.x == null) continue;
      st.byPri[r.cur.pri] = (st.byPri[r.cur.pri] || 0) + dt;
      let x = r.x, y = r.y;
      // À sa place (placement P1 ou soutien P2 atteint, hors suivi défensif), un joueur ne reste pas
      // planté : quelques pas autour, en marchant (move() lit p._idle).
      if (r.cur.pri <= PRI.SOUTIEN && A.settled && !r.cur.track && !this.restart && !p.gk) {
        p._idle = true;
        const ph = (p.mp?.id || 0) * 1.37;
        x += Math.sin(this.now * 0.21 + ph) * 1.6; y += Math.cos(this.now * 0.17 + ph * 1.9) * 1.8;
      }
      p._intent = r.cur;
      this.setT(p, clamp(x / L, 0.003, 0.997), clamp(y / W, 0.003, 0.997));
    }
  }

  /** Les brouillons du placement collectif deviennent des propositions (priorité selon le rôle). */
  commitDrafts() {
    const own = this.poss;
    for (const p of this.players.values()) {
      if (p._draft !== this._draftStamp) continue;
      const x = p.ptx * L, y = p.pty * W, role = p.role;
      if (this.restart) {
        if (p === this.restart.taker) this.want(p, 'placement', 'tireur', PRI.BALLON, 'tireur', x, y, 1, { ttl: 0.6 });
        else this.want(p, 'placement', this.restart.kind === 'kickoff' ? 'engagement' : 'remise en jeu', PRI.PLACEMENT, this.restart.kind === 'kickoff' ? 'engagement' : 'remise en jeu', x, y, 0.5, { track: true });   // arrêt de jeu : place exacte (l'allure est réglée par move())
        continue;
      }
      if (role === 'press') { const d = this.holder ? this.dist(p, this.X(this.holder), this.Y(this.holder)) : 10; this.want(p, 'placement', 'pressing', PRI.URGENCE, 'pressing', x, y, 1 - d / 15); continue; }
      // Appel : une-deux (goRun, mission datée) ou appel collectif de l'attaquant (attente à la limite
      // du hors-jeu « hold » puis départ dans le dos « run ») : une seule mission « appel » dont le point
      // suit la ligne défensive sans lissage (le décalage de ±1 m autour du dernier défenseur compte).
      const MISSION = { run: 'appel', hold: 'appel', mark: 'marquage', recover: 'repli', overlap: 'dédoublement', box: 'surface' };
      if (MISSION[role]) {
        const src = MISSION[role], gr = role === 'run' ? p.goRun : null, mk = p._markOf;
        const id = gr ? `appel@${gr.until.toFixed(2)}` : role === 'mark' ? `marquage#${mk ?? '?'}` : src;
        const side = p.side;
        const end = gr ? () => !p.goRun || this.now > p.goRun.until || this.poss !== side
          : role === 'mark' ? () => this.poss === side || p._markOf !== mk
          : role === 'recover' ? () => this.poss === side
          : () => this.poss !== side;
        // Allure de suivi propre à la mission (le marqueur suit son attaquant, l'appel est franc).
        this.want(p, 'placement', id, PRI.MISSION, src, x, y, 0.6, { end, glide: { run: 7 }[role] ?? 6, track: role === 'mark' || (src === 'appel' && !gr) });   // exceptions mesurées (étape 5a) : marquage et appel collectif non lissés ; repli : hystérésis P3
        continue;
      }
      // Contenir : lissage de l'ancien placement calme (avant 5a) — repart au-delà de 3,2 m (2 m si
      // son but est menacé), s'arrête à 1 m, glisse à 2,2 m/s (5 m/s si menacé).
      if (role === 'contain') { const ownG = this.goalX(1 - p.side), thr = own !== p.side && own >= 0 && Math.abs(this.P.x - ownG) < 45; this.want(p, 'placement', 'contenir', PRI.SOUTIEN, 'contenir', x, y, 0.5, { glide: thr ? 5 : 2.2, jump: thr ? 2 : 3.2, settle: 1 }); continue; }
      // Second presseur : intention distincte, hystérésis P2 (valeur initiale).
      if (role === 'press2') { this.want(p, 'placement', 'second presseur', PRI.SOUTIEN, 'second presseur', x, y, 0.5, { glide: 3.5 }); continue; }
      if (role && role !== 'chase') { const src = { cover: 'couverture', support: 'soutien' }[role] || 'soutien'; this.want(p, 'placement', src, PRI.SOUTIEN, src, x, y, 0.5, { glide: 3.5 }); continue; }
      // Placement de base : il se replace en marchant (vite si son but est menacé).
      const ownG = this.goalX(1 - p.side), threatened = own !== p.side && own >= 0 && Math.abs(this.P.x - ownG) < 45;
      // (Gardien : placement sur la bissectrice, validé à l'étape 4d — suivi exact, jamais lissé.)
      this.want(p, 'placement', 'formation', PRI.PLACEMENT, 'formation', x, y, 0.5, { glide: threatened ? 5 : own === p.side ? 1.8 : 2.2, track: !!p.gk });
    }
  }

  list(side = null) { const a = [...this.players.values()]; return side == null ? a : a.filter((p) => p.side === side); }
  X(p) { return p.x * L; }
  Y(p) { return p.y * W; }
  /** Joueur exprimé en mètres pour la géométrie de contact (contact.js). */
  posM(p) { return { x: p.x * L, y: p.y * W, face: p.face || 0, vx: p.vx || 0, vy: p.vy || 0 }; }
  /** Diagnostic : enregistre un contact réellement effectué et dit s'il est physiquement possible. */
  diagContact(p, kind, known = null) {
    if (!this.diag) return;
    const P = this.P;
    if (known) { this.diag.contact(this.now, { pid: p.mp.id, side: p.side, kind, x: known.x, y: known.y, z: known.z, speed: known.speed, part: known.part, dist: known.dist, stretch: known.stretch, quality: known.q, physical: true }); return; }
    const r = reachAt(this.posM(p), P, { phy: p.mp?.p?.attrs?.phy });
    const dBody = Math.hypot(p.x * L - P.x, p.y * W - P.y);
    const physical = kind === 'gk' ? dBody < 1.3 + Math.max(0, P.z - 1) * 0.3 : !!r;
    this.diag.contact(this.now, { pid: p.mp.id, side: p.side, kind, x: P.x, y: P.y, z: P.z, speed: Math.hypot(P.vx, P.vy, P.vz), part: r?.part || null, dist: r ? r.dist : dBody, stretch: r?.stretch ?? null, physical });
  }
  /** Capacités physiques d'un joueur pour la géométrie de contact (mêmes vitesses que move()). */
  reachOpts(p) {
    // Étape 5c : mêmes capacités que le déplacement réel (fatigue, météo, trait compris).
    const vit = p.mp?.p?.attrs?.vit ?? 60;
    return { phy: p.mp?.p?.attrs?.phy ?? 60, vmax: this.capacity(p), acc: accelOf(vit) };
  }

  /** Le ballon a-t-il traversé une zone d'atteinte de `p` pendant le dernier pas ? (test balayé) */
  sweepContact(p, parts = null, extra = null) {
    const b0 = this._sw0, P = this.P;
    if (!b0 || p._sx == null || p.fall > 0.3 || p.slide > 0.2 || p._dive) return null;
    const pm = this.posM(p);
    return sweptReach({ x: p._sx, y: p._sy, face: pm.face }, pm, b0, P, { phy: p.mp?.p?.attrs?.phy, ...(parts ? { parts } : {}), ...(extra || {}) });
  }

  /** Direction du premier toucher : vers l'avant, en s'écartant de l'adversaire le plus proche. */
  touchDir(r) {
    const rx = this.X(r), ry = this.Y(r), dir = this.dir(r.side);
    let vx = dir, vy = (W / 2 - ry) * 0.01;
    let best = null, bd = 4.5;
    for (const o of this.players.values()) { if (o.side === r.side) continue; const d = this.dist(o, rx, ry); if (d < bd) { bd = d; best = o; } }
    if (best) { const ax = rx - this.X(best), ay = ry - this.Y(best), al = Math.hypot(ax, ay) || 1; const k = (4.5 - bd) / 4.5 * 1.5; vx += (ax / al) * k; vy += (ay / al) * k; }
    // Près d'une ligne, le contrôle est orienté vers l'intérieur du terrain (on ne se pousse pas dehors).
    if (ry < 6) vy += (6 - ry) / 6 * 1.6; else if (ry > W - 6) vy -= (ry - (W - 6)) / 6 * 1.6;
    const toLine = dir > 0 ? L - rx : rx;
    if (toLine < 6) vx -= dir * (6 - toLine) / 6 * 1.2;
    return Math.atan2(vy, vx);
  }

  /**
   * Contrôle PHYSIQUE (étape 4b) : le ballon a touché une partie du corps pendant le pas.
   * On revient à l'instant exact du contact sur la trajectoire, on applique l'impulsion du premier
   * toucher (qualité = technique × conditions réelles), puis le ballon termine le pas librement.
   * Aucun déplacement artificiel : si le toucher est mauvais, le ballon s'échappe.
   */
  controlTouch(r, hit, kind, dt, qForce = null) {
    const P = this.P, rm = this.posM(r), part = hit.reach.part;
    const tech = eff(r.mp, 'dri') * 0.55 + eff(r.mp, 'pas') * 0.25 + eff(r.mp, 'sf') * 0.2;
    const rel = Math.hypot(P.vx - rm.vx, P.vy - rm.vy, P.vz);
    const pressure = this.pressure(r);
    // qForce : contact subi sans réaction (le ballon rebondit sur lui, il ne l'amortit pas).
    const q = qForce ?? touchQuality({ tech, stretch: hit.reach.stretch, rel, part, pressure });
    const ft = firstTouch({ incoming: { vx: P.vx, vy: P.vy, vz: P.vz }, pl: rm, dir: this.touchDir(r), push: pressure < 3 ? 1.1 : 1.9, q, rnd: [this.rand(), this.rand()] });
    const B = hit.ball;
    Object.assign(P, { x: B.x, y: B.y, z: Math.max(BR, B.z), vx: ft.vx, vy: ft.vy, vz: ft.vz, spin: 0, top: 0, knuckle: 0 });
    stepBall(P, Math.max(0, (1 - hit.t) * dt));
    r.ctrl = 0.3; r.ctrlH = B.z; r.touch = 0.2; r.touchMax = 0.2; r.ctrlPart = part;
    this.lastTouch = r.side; this._lastToucher = r; this._deflect = qForce != null;
    const info = { x: B.x, y: B.y, z: B.z, speed: rel, part, dist: hit.reach.dist, stretch: hit.reach.stretch, q };
    this.diagContact(r, kind, info);
    this.gest.contact(r, kind, PART_FR[part] || part, { frac: hit.t ?? 1, reflex: qForce != null ? 'subi' : 'contrôle', anim: { timer: 'ctrl', dur: 0.3 * GS, at: 0.5 }, src: kind });
    return { q, d: hit.reach.dist, part };
  }

  /**
   * Il laisse venir le ballon : tant que le ballon est encore à portée en fin de pas et qu'il se
   * rapproche du point de contact idéal, le toucher attend le pas suivant (sinon on toucherait
   * toujours jambe tendue, au bord de la zone). Renvoie le contact à jouer maintenant, ou null.
   */
  letItCome(p, hit, parts = null) {
    if (!hit || hit.reach.stretch <= 0.05) return hit;
    const P = this.P, rm = this.posM(p);
    const now = reachAt(rm, P, { phy: p.mp?.p?.attrs?.phy, ...(parts ? { parts } : {}) });
    if (!now) return hit;                       // le ballon ressort de la zone : c'est maintenant ou jamais
    const c = Math.cos(rm.face), sn = Math.sin(rm.face);
    const cx = rm.x + c * 0.32, cy = rm.y + sn * 0.32;
    const d0 = Math.hypot(P.x - cx, P.y - cy), d1 = Math.hypot(P.x + (P.vx - rm.vx) * 0.02 - cx, P.y + (P.vy - rm.vy) * 0.02 - cy);
    if (d1 < d0 - 0.002) return null;           // encore en approche : on attendra le pas suivant
    return { t: 1, reach: now, ball: { x: P.x, y: P.y, z: P.z } };
  }

  /**
   * Après un premier toucher : le ballon reste-t-il jouable pour lui ? On regarde où seront le
   * ballon et son pied dans 0,35 s (mouvement relatif) : à moins de ~1 m, il l'a sous contrôle.
   */
  keepsBall(p, dtLook = 0.35) {
    const P = this.P, pm = this.posM(p);
    if (P.z > 1.6) return false;
    const c = Math.cos(pm.face), s = Math.sin(pm.face);
    const fx = pm.x + pm.vx * dtLook + c * 0.32, fy = pm.y + pm.vy * dtLook + s * 0.32;
    const bx = P.x + P.vx * dtLook, by = P.y + P.vy * dtLook;
    return Math.hypot(bx - fx, by - fy) < 1.0 + BR;
  }

  /** Contacts du pas (après le mouvement) : réception de la passe en cours, ou ballon libre. */
  contactStep(dt, out) {
    // Gardien d'abord : ses mains (plongeon, prise debout, sortie aérienne) sur tout ballon adverse.
    if (this.gkContact(dt, out)) return;
    if (this.shot?.live && !this.shot.resolved) { this.shotContact(dt, out); return; }
    const pd = this.pending;
    if (pd && pd.kind === 'pass' && this.players.has(pd.to.mp.id)) { this.passContact(pd, dt, out); return; }
    if (pd && pd.to && this.players.has(pd.to.mp.id) && !(pd.to.gk && pd.aerial)) {
      const r = pd.to;
      const hit = this.letItCome(r, this.sweepContact(r));
      if (hit) {
        if (hit.reach.part === 'head') { this.header(r, pd, out); return; }
        this.controlTouch(r, hit, r.side === pd.from.side ? 'réception' : 'interception', dt);
        this.receive(r, pd, out);
      }
    } else if (!pd && !this.holder) this.loosePickup(dt, out);
  }

  /**
   * Tir en vol (étape 4d) : un joueur dont le corps (sans réaction) ou la zone d'atteinte (après
   * réaction) est réellement traversé par le ballon le contre ou le dévie. Les partenaires du
   * tireur ne le touchent que s'il leur arrive dans le corps.
   */
  shotContact(dt, out) {
    const s = this.shot, P = this.P, b0 = this._sw0;
    if (!b0) return;
    let best = null;
    for (const p of this.players.values()) {
      if (p.gk && this.gkHandsOk(p)) continue;                               // (mains : gkContact)
      if (p === s.shooter && this.now - s.t0 < 0.45) continue;
      if (p._sx == null || p.fall > 0.3) continue;
      let hit;
      const reacted = p.side !== s.side && this.now - s.t0 >= this.reactT(p, this.X(s.shooter), this.Y(s.shooter));
      if (!reacted) {
        const bh = sweptBody({ x: p._sx, y: p._sy }, { x: this.X(p), y: this.Y(p) }, b0, P);
        if (bh) hit = { t: bh.t, ball: bh.ball, reach: { part: bh.ball.z > 1.5 ? 'head' : bh.ball.z > 0.95 ? 'chest' : bh.ball.z > 0.45 ? 'thigh' : 'foot', dist: 0, stretch: 0 }, body: true };
      } else hit = this.sweepContact(p);
      if (hit && (!best || hit.t < best.hit.t)) best = { p, hit };
    }
    if (!best) return;
    const { p, hit } = best;
    this.shotTouched('player', p, null);
    this.controlTouch(p, hit, hit.body ? 'contre' : 'contre (jambe)', dt, hit.body ? 0.05 : null);
    if (!hit.body && this.keepsBall(p)) this.gain(p, out, false, true);
  }

  /**
   * Passe en cours (étape 4c) : le destinataire ET tout adversaire dont la zone d'atteinte est
   * réellement traversée par le ballon pendant le pas peuvent le toucher ; le premier contact (dans
   * le pas) l'emporte. Personne ne reçoit le ballon parce que la passe « devait » rater.
   * Un adversaire qui n'a pas encore réagi (temps de réaction) ne contrôle pas : le ballon rebondit
   * sur lui (déviation). Le gardien dans sa surface : prise à la main (règle propre, étape 4d).
   */
  passContact(pd, dt, out) {
    let best = null, heads = null;
    const P = this.P, b0 = this._sw0;
    for (const p of this.players.values()) {
      if (p !== pd.to && p.side === pd.from.side && !pd.cross) continue;    // les partenaires laissent filer vers le destinataire (sauf sur un centre : chacun attaque le ballon)
      if (p === this._kickBy && this.now - this._kickT < 0.45) continue;
      if (p.gk && this.gkHandsOk(p)) continue;                               // (mains : gkContact)
      let hit;
      if (p.side !== pd.from.side && this.now - pd.t0 < this.reactT(p, pd.fromX, pd.fromY) + (pd.reactPlus || 0)) {
        // Pas encore réagi : seul le corps immobile peut arrêter le ballon (pas de jambe tendue).
        if (!b0 || p._sx == null || p.fall > 0.3 || p.slide > 0.2) continue;
        const bh = sweptBody({ x: p._sx, y: p._sy }, { x: this.X(p), y: this.Y(p) }, b0, P);
        if (!bh) continue;
        hit = { t: bh.t, ball: bh.ball, reach: { part: bh.ball.z > 1.5 ? 'head' : bh.ball.z > 0.95 ? 'chest' : bh.ball.z > 0.45 ? 'thigh' : 'foot', dist: 0, stretch: 0 }, body: true };
      } else hit = this.letItCome(p, this.sweepContact(p, null, this.jumpOpts(p, pd)));
      if (!hit) continue;
      (heads ||= []).push({ p, hit });
      if (!best || hit.t < best.hit.t - 1e-9 || (Math.abs(hit.t - best.hit.t) <= 1e-9 && hit.reach.stretch < best.hit.reach.stretch)) best = { p, hit };
    }
    if (!best) return;
    // Duel aérien : plusieurs joueurs des deux équipes au contact du même ballon dans le même pas.
    if (best.hit.reach.part === 'head') best = this.aerialDuel(best, heads, pd);
    const { p, hit } = best, rec = pd.rec;
    if (p === pd.to || p.side === pd.from.side) {
      if (hit.reach.part === 'head') {
        if (rec) rec.outcome = 'tête';
        p.team.stats.passesOk++; pd.from.mp.passesOk++;   // la passe lui parvient (qu'il la joue de la tête)
        this.header(p, pd, out, hit, best); return;
      }
      const t = this.controlTouch(p, hit, 'réception', dt);
      if (rec) rec.contact = { pid: p.mp.id, side: p.side, part: t.part, dist: t.d, q: t.q, at: this.now - pd.t0 };
      this.receive(p, pd, out);
      return;
    }
    const reacted = !hit.body;
    if (hit.reach.part === 'head' && reacted) { if (rec) { rec.contact = { pid: p.mp.id, side: p.side, part: 'head', at: this.now - pd.t0 }; rec.outcome = 'tête adverse'; } this.header(p, pd, out, hit, best); return; }
    const t = this.controlTouch(p, hit, reacted ? 'interception' : 'déviation', dt, reacted ? null : 0.05);
    if (!reacted) pd._deflect = true;
    if (rec) rec.contact = { pid: p.mp.id, side: p.side, part: t.part, dist: t.d, q: t.q, at: this.now - pd.t0, reacted };
    this.receive(p, pd, out);
  }

  /**
   * Ballon libre (étape 4b-3) : le premier joueur dont la zone d'atteinte (pied, cuisse, poitrine)
   * est RÉELLEMENT traversée par le ballon pendant le pas le touche — plus de ballon « aimanté »
   * au plus proche. Le premier toucher dépend de sa technique : raté, le ballon repart libre.
   * (Le gardien dans sa surface garde sa règle propre jusqu'à l'étape 4d.)
   */
  loosePickup(dt, out) {
    const P = this.P;
    if (outOfPlay(P)) return;   // même seuil que la sortie (OUT_M)
    let best = null;
    for (const p of this.players.values()) {
      if (p === this._kickBy && this.now - this._kickT < 0.45) continue;   // pas de reprise immédiate de sa propre frappe
      if (this.now - (p._ltT ?? -9) < 0.25) continue;                       // deux touches : au moins un pas d'écart
      if (p.gk && this.gkHandsOk(p)) continue;                               // (mains : gkContact)
      const hit = this.letItCome(p, this.sweepContact(p, LOOSE_PARTS, this.jumpOpts(p, this._kickT)), LOOSE_PARTS);
      if (!hit) continue;
      if (!best || hit.t < best.hit.t - 1e-9 || (Math.abs(hit.t - best.hit.t) <= 1e-9 && hit.reach.stretch < best.hit.reach.stretch)) best = { p, hit };
    }
    if (!best) return;
    const { p, hit } = best;
    // Ballon qui sort et que l'équipe laisse filer : il s'écarte et le regarde sortir.
    if (this._letGo?.[p.side] && (P.y < 4 || P.y > W - 4 || P.x < 4 || P.x > L - 4)) return;
    p._ltT = this.now;
    if (hit.reach.part === 'head') { this.header(p, null, out, hit, best); return; }
    this.controlTouch(p, hit, 'récupération', dt);
    if (this.keepsBall(p)) this.gain(p, out, false, true);
  }

  foot(p, d = 0.55) { return { x: p.x * L + Math.cos(p.face) * d, y: p.y * W + Math.sin(p.face) * d }; }
  /** Geste technique pour éliminer le défenseur à `d` mètres (seulement ceux permis par ses étoiles). */
  pickMove(h, d) {
    const can = movesFor(h.mp.p || { sm: 2 });
    const w = can.map((k) => {
      let x = 1 + SKILL_MOVES[k].stars * 0.35;                      // les virtuoses aiment le spectacle
      if (k === 'petitpont') x *= d < 3.6 ? 1.6 : 0.3;               // il faut être tout près
      if (k === 'sombrero') x *= d > 2.6 ? 1.1 : 0.4;
      if (k === 'roulette') x *= d < 3 ? 1.4 : 0.6;                  // défenseur qui arrive au contact
      if (k === 'jongle') x *= 0.5;
      if (k === 'talon' || k === 'coupdusombrero') x *= 0.45;
      return x * (this.m.minute > 85 && this.m.score[h.side] > this.m.score[1 - h.side] ? 0.5 : 1);
    });
    return can[this.rng.weightedIndex(w)] || 'crochet';
  }

  /** Pied fort : +1 droitier, -1 gaucher (donnée du joueur, sinon ~ 1 sur 5 gaucher). */
  footSign(p) { const f = p.mp?.p?.foot; return f === 'G' ? -1 : f === 'D' ? 1 : ((p.mp?.id ?? 0) % 5 === 0 ? -1 : 1); }
  dist(p, x, y) { return Math.hypot(p.x * L - x, p.y * W - y); }
  dir(side) { return side === 0 ? 1 : -1; }
  goalX(side) { return side === 0 ? L : 0; }           // but attaqué par `side`
  rand() { return this.rng.next(); }

  /* ---------------- Boucle ---------------- */

  /** Avance la simulation de dt secondes de jeu. Retourne les événements produits. */
  step(dt) {
    const m = this.m, out = [];
    this.now += dt;
    this._dt = dt; this._stepN = (this._stepN || 0) + 1;   // (horloge du descriptif de gestes : jamais lue par la simulation)
    if (m.phase === 'pre' || (m.phase === 'ht' && this.resumeHT)) {
      this.resumeHT = false;
      this.handle(stepMinute(m), out);
    }
    if (m.phase !== 'live') { this.idle(dt); this.gest.sweep(this.players.values()); return out; }
    // Horloge : une minute de match toutes les 60 / CLOCK secondes de jeu.
    this.sec += dt * TUNE.clock;
    m.workScale = TUNE.clock / CLOCK;
    while (this.sec >= 60 && m.phase === 'live') {
      this.sec -= 60;
      const evs = [];
      minuteStart(m, evs);
      if (m._pendingInjury) { for (const [t, mp] of m._pendingInjury) injure(m, evs, t, mp); m._pendingInjury = null; }
      minuteEnd(m, evs);
      this.handle(evs, out);
    }
    if (m.phase !== 'live') { this.idle(dt); this.gest.sweep(this.players.values()); return out; }
    this.tick(dt, out);
    this.gest.sweep(this.players.values());   // fin naturelle des gestes (descriptif, étape 6a)
    return out;
  }

  /** Événements venus du moteur classique (engagement, remplacement, blessure, fin…). */
  handle(evs, out) {
    for (const ev of evs) {
      out.push(ev);
      if (['sub', 'red', 'injury'].includes(ev.type)) this.sync();
      if (ev.type === 'kickoff') this.setupKickoff(ev);
      if (ev.type === 'ht' || ev.type === 'ft') { this.holder = null; this.pending = null; this.restart = null; this.shot = null; }
    }
  }

  /** Pause (mi-temps, fin) : les joueurs marchent vers le centre / leur position. */
  idle(dt) {
    for (const p of this.players.values()) this.setT(p, p.x, p.y);
    this.move(dt);
    stepBall(this.P, dt);
  }

  tick(dt, out) {
    const m = this.m, P = this.P;
    // Vérification VAR en cours : l'arbitre a la main à l'oreille, tout le monde attend.
    if (this.varT > 0) {
      this.varT -= dt;
      for (const p of this.players.values()) this.setT(p, p.x, p.y);
      this.move(dt); stepBall(P, dt);
      if (this.varT <= 0) this.varDecision(out);
      return;
    }
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      this.move(dt); stepBall(P, dt);
      if (this.celebrate <= 0) {
        // Fin de la célébration : compteur remis à zéro (sinon, après un but refusé par la VAR, il
        // restait négatif — « vrai » pour les tests !this.celebrate — et désactivait sorties, tacles
        // et contacts du ballon libre jusqu'à la fin du match).
        this.celebrate = 0;
        if (this.varPending) {
          this.varT = 4.2; m.stoppages += 1;
          emit(m, out, { type: 'var', side: this.varPending.side, pid: this.varPending.sc.id, outcome: 'check', reason: this.varPending.reason, x: 0.5, y: 0.5, zone: 3 });
        } else { this._goalKo = true; this.handle([this.kickoffEvent(this.afterGoalSide)], out); }
      }
      return;
    }
    this.shotResolve(out);   // issue du tir en cours, constatée dès qu'elle est connue
    this.reshapeT += dt;
    if (this.reshapeT > 0.3) { this.reshapeT = 0; this.positioning(); }
    if (this.restart) this.updateRestart(dt, out);
    else {
      // Dès qu'un arrêt de jeu est sifflé (faute, sortie…), on ne joue plus le ballon dans la foulée.
      this.duelWatch(dt, out);
      if (!this.restart) this.updateHolder(dt, out);
      if (!this.restart) this.updateDefense(dt, out);
      if (!this.restart) this.updateLoose(dt, out);
      if (!this.restart) this.gkWatch(dt);
    }
    // Étape 5a : une seule intention arbitrée par joueur, l'arbitre est le seul à écrire la cible.
    this.resolveIntents(dt);
    // Instantané avant le mouvement : les contacts sont vérifiés sur le mouvement RÉEL du pas
    // (ballon et joueurs de l'instant t à t + dt), jamais par proximité approximative.
    this._sw0 = { x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz: P.vz };
    for (const p of this.players.values()) { p._sx = p.x * L; p._sy = p.y * W; }
    this.move(dt);
    this.ballStep(dt, out);
    if (!this.restart && !this.celebrate) this.contestStep(dt, out);   // tacles, ballons chipés (étape 4e)
    if (!this.restart && !this.holder && !this.celebrate) this.contactStep(dt, out);
    // Statistiques continues : possession, carte de chaleur, état du moteur.
    if (this.poss >= 0) m.teams[this.poss].stats.poss += dt;
    this.heatT = (this.heatT || 0) + dt;
    if (this.heatT > 0.6 && this.poss >= 0) {
      this.heatT = 0;
      m.heat[this.poss][Math.min(11, Math.max(0, Math.floor(P.x / L * 12))) * 8 + Math.min(7, Math.max(0, Math.floor(P.y / W * 8)))]++;
    }
    m.ball.x = clamp(P.x / L, 0, 1); m.ball.y = clamp(P.y / W, 0, 1);
    m.carrier = this.holder?.mp || null;
    const d = this.poss === 0 ? P.x / L : 1 - P.x / L;
    m.zone = d < 0.33 ? 0 : d < 0.58 ? 1 : d < 0.81 ? 2 : 3;
  }

  /* ---------------- Placement collectif ---------------- */

  /**
   * Cibles de déplacement de tous les joueurs sans ballon : bloc équipe (formation, ligne,
   * largeur, selon la position du ballon), pressing, couverture, marquage, soutien, appels.
   */
  positioning() {
    this._draftStamp = (this._draftStamp || 0) + 1;
    for (const p of this.players.values()) { p.ptx = p.tx; p.pty = p.ty; p._draft = 0; }
    this._positioning();
    this.commitDrafts();
  }

  // (Ancien « placement calme » steadyTargets : intégré à l'arbitre des intentions, étape 5a —
  // hystérésis, glissement à allure de marche, petits pas autour de sa place.)

  _positioning() {
    const P = this.P, m = this.m;
    // Le bloc coulisse avec le jeu, mais à allure humaine : il suit un « ballon de référence »
    // qui rattrape le vrai ballon à ~6 m/s (une passe de 30 m ne fait pas sprinter 20 joueurs).
    // L'équipe qui défend réagit plus vite (elle doit fermer les espaces) que celle qui attaque.
    const refs = (this._brefs ||= [{ x: P.x, y: P.y, t: this.now }, { x: P.x, y: P.y, t: this.now }]);
    for (let sd = 0; sd < 2; sd++) {
      const R = refs[sd], span = Math.min(1, this.now - R.t), dxr = P.x - R.x, dyr = P.y - R.y, dr = Math.hypot(dxr, dyr);
      // Le bloc ne réagit pas aux petits mouvements du ballon (zone morte de 3 m) et coulisse à
      // allure de trot : ~4,5 m/s pour l'équipe qui attaque, ~7 m/s pour celle qui défend.
      // Ballon sans maître : le bloc attend de voir qui le récupère (il bouge à peine).
      const v = !this.holder && !this.pending ? 2.2 : this.poss === sd ? 4.2 : 5.8;
      const stepR = dr < 3 ? 0 : Math.min(dr - 3, v * span + (dr > 30 ? (dr - 30) * 0.5 : 0));
      if (dr > 1e-6) { R.x += (dxr / dr) * stepR; R.y += (dyr / dr) * stepR; }
      if (this.restart || this.celebrate > 0 || globalThis.__X?.nolag) { R.x = P.x; R.y = P.y; }
      R.t = this.now;
    }
    const bx = clamp(P.x / L, 0, 1), by = clamp(P.y / W, 0, 1);
    const h = this.holder, poss = this.poss;
    const busy = new Set([h, this.pending?.to, this.restart?.taker].filter(Boolean));
    // Transition attaque ↔ défense progressive (~2 s) : à la perte du ballon, les 20 joueurs
    // ne repartent pas tous en même temps vers une nouvelle place.
    const mode = (this._mode ||= [0.5, 0.5]), mdt = Math.min(1, this.now - (this._modeT ?? this.now));
    this._modeT = this.now;
    for (let sd = 0; sd < 2; sd++) {
      const goal = this.restart ? (this.restart.side === sd ? 1 : 0) : poss === sd ? 1 : poss < 0 ? mode[sd] : 0;
      mode[sd] = this.restart ? goal : mode[sd] + clamp(goal - mode[sd], -mdt / 1.6, mdt / 2.2);
    }
    for (const p of this.players.values()) {
      if (busy.has(p) || p.celeb > 0) continue;
      const R = refs[p.side], k = mode[p.side], rbx = clamp(R.x / L, 0, 1), rby = clamp(R.y / W, 0, 1);
      const f1 = k > 0.02 ? formationPos(p.team, p.mp, rbx, rby, true, false) : null;
      const f0 = k < 0.98 ? formationPos(p.team, p.mp, rbx, rby, false, false) : null;
      p.ptx = f1 && f0 ? f0.x + (f1.x - f0.x) * k : (f1 || f0).x;
      p.pty = f1 && f0 ? f0.y + (f1.y - f0.y) * k : (f1 || f0).y;
      p.role = null;
    }
    if (this.restart) { this.restartPositions(); return; }
    // Gardiens : sur la ligne entre le ballon et le centre du but, avancés selon la distance.
    for (const p of this.players.values()) {
      if (!p.gk || busy.has(p)) continue;
      const own = p.side === 0 ? 0 : L, sgn = p.side === 0 ? 1 : -1;
      const dB = Math.hypot(P.x - own, P.y - W / 2);
      // Gardien moderne : sur sa ligne quand le ballon est proche, avancé quand il s'éloigne, et
      // en « libéro » au bord de sa surface quand son équipe attaque (il couvre la profondeur).
      const ours = poss === p.side;
      let dep = dB < 12 ? 0.9 : dB < 25 ? 0.9 + (dB - 12) * 0.17 : dB < 45 ? 3.1 + (dB - 25) * 0.22 : 7.5 + (dB - 45) * 0.3;
      dep = Math.min(dep, ours ? 19 : 11);
      // Placement sur la BISSECTRICE de l'angle formé par les deux poteaux vus du ballon (il réduit
      // l'angle des deux côtés à la fois, plus près du premier poteau sur un tir excentré).
      const ax = own - P.x, a1y = W / 2 - GOAL_HALF - P.y, a2y = W / 2 + GOAL_HALF - P.y;
      const l1 = Math.hypot(ax, a1y) || 1, l2 = Math.hypot(ax, a2y) || 1;
      let bxv = ax / l1 + ax / l2, byv = a1y / l1 + a2y / l2; const bl = Math.hypot(bxv, byv) || 1; bxv /= bl; byv /= bl;
      const dx0 = Math.abs(own - P.x), tB = Math.abs(bxv) > 0.05 ? Math.max(0, (dx0 - dep) / Math.abs(bxv)) : 0;
      const gxT = P.x + bxv * tB, gyT = P.y + byv * tB;
      p.ptx = (dB < 1.5 ? own + sgn * dep : gxT) / L;
      const latMax = dep < 6 ? GOAL_HALF - 0.4 : 9;
      p.pty = clamp(dB < 1.5 ? W / 2 : gyT, W / 2 - latMax, W / 2 + latMax) / W;
      if (sgn * (p.ptx * L - own) < 0.5) p.ptx = (own + sgn * 0.5) / L;
    }
    if (poss < 0) return;
    const A = m.teams[poss], D = m.teams[1 - poss];
    this.buildUpShape(A, busy);
    const dLine = this.defensiveLine(D, busy);
    const dirA = this.dir(poss);
    const ref = h || null;
    const rx = ref ? this.X(ref) : P.x, ry = ref ? this.Y(ref) : P.y;
    // Défense : le défenseur qui peut COUPER LA ROUTE du porteur presse (en priorité celui
    // placé entre le porteur et le but), un deuxième couvre ; les défenseurs déjà dépassés
    // se replient vers leur but au lieu de courir derrière le porteur.
    const pressRange = 14 + 11 * (LVL[D.tactics.pressing] + 1);
    const ownGoalX = this.goalX(poss); // but défendu par D = but attaqué par A
    const toG = Math.hypot(ownGoalX - rx, W / 2 - ry) || 1;
    const ux = (ownGoalX - rx) / toG, uy = (W / 2 - ry) / toG;
    const hvx = h ? h.vx || 0 : P.vx, hvy = h ? h.vy || 0 : P.vy;
    const cand = this.list(D.side).filter((p) => !p.gk && !busy.has(p)).map((p) => {
      const px = this.X(p), py = this.Y(p);
      // Point de rencontre : là où sera le porteur quand le défenseur y arrivera.
      let t = 0;
      for (let k = 0; k < 2; k++) t = Math.hypot(rx + hvx * t - px, ry + hvy * t - py) / 7.5;
      const ix = rx + hvx * t, iy = ry + hvy * t;
      // Côté but (entre le porteur et son but) ou déjà dépassé ?
      const goalSide = ((px - rx) * ux + (py - ry) * uy) > -1;
      return { p, t, ix, iy, goalSide, d: Math.hypot(px - rx, py - ry), cost: t * (goalSide ? 0.75 : 1.9) };
    }).sort((a, b) => a.cost - b.cost);
    // Zone de pressing (comme en vrai) : bloc bas = on attend dans sa moitié, bloc médian =
    // on presse à partir du rond central, pressing haut = partout. Hors de cette zone, le plus
    // proche « contient » le porteur à distance, sans se jeter, et le bloc reste en place.
    const trigger = { low: 38, mid: 58, high: 110 }[D.tactics.pressing] ?? 58;
    const ballDist = Math.abs(rx - ownGoalX);
    const engage = ballDist < trigger || (h && this.pressure(h) < 2.5);
    // Ballon libre (ni porteur ni passe) : c'est le joueur le plus rapide sur le ballon qui y va
    // (updateLoose), personne d'autre ne « presse » un ballon sans maître.
    const loose = !h && !this.pending;
    let presser = loose ? null : cand.find((c) => c.d < pressRange);
    // On ne change pas de presseur toutes les 0,3 s : l'actuel continue tant qu'il reste dans le coup.
    const prevP = (this._presser ||= [null, null])[D.side];
    if (presser && prevP && prevP !== presser.p) {
      const pc = cand.find((c) => c.p === prevP);
      if (pc && pc.d < pressRange && pc.cost < presser.cost * 1.4 + 0.35) presser = pc;
    }
    this._presser[D.side] = presser ? presser.p : null;
    if (presser && engage) {
      const p = presser.p;
      p.ptx = clamp(presser.ix + ux * 0.9, 0, L) / L; p.pty = clamp(presser.iy + uy * 0.9, 0, W) / W; p.role = 'press';
    } else if (presser) {
      const p = presser.p, gap = 7;
      p.ptx = clamp(rx + ux * gap, 0, L) / L; p.pty = clamp(ry + uy * gap, 0, W) / W; p.role = 'contain';
    }
    const cover = loose ? null : cand.find((c) => c !== presser && c.goalSide && c.d < pressRange + 10);
    const hiPress = D.tactics.pressing === 'high' && engage;
    // Contre-pressing : juste après la perte du ballon, le deuxième joueur proche se jette
    // aussi sur le porteur (on étouffe la relance avant de se replacer).
    const justLost = h && D.tactics.pressing !== 'low' && this.now - (this.gainT?.[poss] ?? -99) < 3;
    if (cover) {
      const p = cover.p;
      if (justLost && cover.d < 16) {
        const side = (this.Y(p) > ry ? 1 : -1) * 1.6;
        p.ptx = clamp(rx + ux * 1.2, 0, L) / L; p.pty = clamp(ry + side, 0, W) / W; p.role = 'press2';
      } else if (hiPress && h) {
        // Pressing haut : il coupe la passe vers le partenaire le plus proche du porteur.
        const mate = this.list(A.side).filter((q) => q !== h && !q.gk).sort((a, b) => this.dist(a, rx, ry) - this.dist(b, rx, ry))[0];
        if (mate) { p.ptx = (rx + (this.X(mate) - rx) * 0.6) / L; p.pty = (ry + (this.Y(mate) - ry) * 0.6) / W; p.role = 'press2'; }
      } else { p.ptx = (rx + ux * 7) / L; p.pty = (ry + uy * 7) / W; p.role = 'cover'; }
    }
    // Repli : dépassés, ils reviennent se placer entre le ballon et le but.
    for (const c of cand) {
      if (loose || c === presser || c === cover || c.goalSide || c.d < 3) continue;
      const k = Math.min(1, 10 / toG);
      c.p.ptx = clamp(rx + (ownGoalX - rx) * Math.max(k, 0.3), 1, L - 1) / L;
      c.p.pty = clamp(c.p.pty * W + (W / 2 - c.p.pty * W) * 0.3, 2, W - 2) / W;
      c.p.role = 'recover';
    }
    const defs = cand.filter((c) => !c.p.role).map((c) => ({ p: c.p, d: c.d }));
    // Marquage : on part des attaquants les plus dangereux (les plus proches de son but) et on
    // leur attribue le défenseur le mieux placé (proche de sa zone ET de l'attaquant). Un
    // attaquant qui s'approche du but n'est jamais laissé seul ; les autres sont pris en zone.
    const attackers = this.list(A.side).filter((p) => !p.gk && p !== h);
    {
      const man = D.tactics.marking === 'man';
      const inOwnHalf = Math.abs(this.P.x - ownGoalX) < L * (hiPress ? 1 : man ? 0.62 : 0.45);
      if (inOwnHalf) {
        // Défenseurs disponibles : sans tâche, ou « dépassés » qui reviennent (ils reprennent un
        // attaquant au lieu de foncer vers leur ligne de but).
        const pool = new Set([...defs.map((x) => x.p), ...this.list(D.side).filter((p) => p.role === 'recover')]);
        const danger = attackers.map((a) => ({ a, dG: Math.hypot(this.X(a) - ownGoalX, this.Y(a) - W / 2) }))
          .filter((x) => x.dG < (man ? 62 : 42)).sort((x, y) => x.dG - y.dG);
        const byId = new Map(attackers.map((a) => [a.mp.id, a]));
        const assign = new Map();
        // Marquages en cours : on garde son attaquant (pas de chassé-croisé toutes les secondes).
        for (const p of pool) {
          const a = byId.get(p._markOf);
          if (a && danger.some((x) => x.a === a) && ![...assign.values()].includes(a) && Math.hypot(this.X(p) - this.X(a), this.Y(p) - this.Y(a)) < 20) assign.set(p, a);
        }
        for (const [p] of assign) pool.delete(p);
        const markedSet = new Set(assign.values());
        for (const { a, dG } of danger) {
          if (markedSet.has(a)) continue;
          const ax = this.X(a), ay = this.Y(a);
          const reach = dG < 25 ? 24 : man ? 18 : 12;
          let best = null, bc = 1e9;
          for (const p of pool) {
            const dz = Math.hypot(p.ptx * L - ax, p.pty * W - ay), dn = Math.hypot(this.X(p) - ax, this.Y(p) - ay);
            if (Math.min(dz, dn) > reach) continue;
            const c = dz * (man ? 0.3 : 0.6) + dn * (man ? 0.7 : 0.4);
            if (c < bc) { bc = c; best = p; }
          }
          if (!best) continue;
          pool.delete(best); assign.set(best, a);
        }
        for (const p of this.list(D.side)) if (!assign.has(p)) p._markOf = null;
        for (const [best, a] of assign) {
          // Il anticipe la course de l'attaquant (où il sera dans ~0,6 s), sans dépasser sa ligne de but.
          const ax = clamp(this.X(a) + (a.vx || 0) * 0.85, 0.5, L - 0.5), ay = clamp(this.Y(a) + (a.vy || 0) * 0.85, 0.5, W - 0.5), dG = Math.hypot(ax - ownGoalX, ay - W / 2);
          best._markOf = a.mp.id;
          // Côté but, légèrement côté ballon ; plus serré près du but et en individuel.
          const g = Math.hypot(ownGoalX - ax, W / 2 - ay) || 1;
          const tight = (man ? 0.9 : 1.4) * (dG < 20 ? 0.75 : 1);
          const bx2 = this.P.x - ax, by2 = this.P.y - ay, bl = Math.hypot(bx2, by2) || 1;
          best.ptx = clamp(ax + ((ownGoalX - ax) / g) * tight + (bx2 / bl) * 0.5, 0.5, L - 0.5) / L;
          best.pty = clamp(ay + ((W / 2 - ay) / g) * tight + (by2 / bl) * 0.5, 0.5, W - 0.5) / W;
          best.role = 'mark';
        }
      }
    }
    // Bloc compact : les milieux sans tâche restent à ~15 m devant la ligne défensive (pas de
    // trou entre les lignes dans lequel l'adversaire pourrait recevoir).
    if (dLine != null) {
      const dirD = this.dir(D.side);
      for (const p of this.list(D.side)) {
        if (busy.has(p) || p.gk || p.role || !['MDC', 'MC', 'MG', 'MD'].includes(D.slots[p.mp.slot].pos)) continue;
        if (p.ptx * L * dirD > dLine + 12) p.ptx = clamp((dLine + 12) * dirD, 1, L - 1) / L;
      }
    }
    // Passe et va : le passeur poursuit sa course (une-deux possible : on le cherche dans la course).
    for (const p of attackers) {
      if (!p.goRun) continue;
      if (this.now > p.goRun.until || p.side !== poss) { p.goRun = null; continue; }
      p.ptx = p.goRun.x / L; p.pty = p.goRun.y / W; p.role = 'run';
    }
    // Attaque : chacun se rend disponible (loin des marqueurs, ligne de passe ouverte).
    if (h && !this.inHands) this.findSpace(A, h, busy);
    // Deux solutions courtes autour du porteur, un appel en profondeur.
    if (h && !this.inHands) {
      // Les joueurs qui « viennent au ballon » (meneur reculé, faux 9, enganche…) se proposent en premier.
      const comes = (p) => (['meneur', 'faux9', 'enganche', 'regista', 'trequartista', 'mil_int', 'lat_inv'].includes(this.rkey(p)) ? 12 : 0);
      const mates = attackers.filter((p) => !p.goRun && !(this.rfx(p).run >= 0.8)).map((p) => ({ p, d: this.dist(p, rx, ry) - comes(p) })).sort((a, b) => a.d - b.d);
      // Les deux soutiens restent les mêmes tant qu'ils sont proches (pas de relais permanent).
      const prevS = (this._sup ||= [[], []])[A.side].filter((p) => mates.slice(0, 4).some((x) => x.p === p && x.d < 26));
      const supp = [...prevS, ...mates.map((x) => x.p).filter((p) => !prevS.includes(p))].slice(0, 2).map((p) => ({ p }));
      this._sup[A.side] = supp.map((x) => x.p);
      supp.forEach(({ p }, i) => {
        const side = (i === 0 ? 1 : -1) * (ry < W / 2 ? 1 : -1);
        p.ptx = clamp(rx + dirA * (4 + i * 5), 2, L - 2) / L;
        p.pty = clamp(ry + side * (11 + i * 3), 3, W - 3) / W;
        p.role = 'support';
      });
      const lastDef = this.list(D.side).filter((p) => !p.gk).map((p) => this.X(p) * dirA).sort((a, b) => b - a)[1];
      // Appel en profondeur : d'abord les rôles qui attaquent l'espace (attaquant de profondeur,
      // chercheur d'espaces, attaquant de l'ombre…), sinon le joueur offensif le plus avancé.
      // Un faux 9 ne fait pas l'appel : il décroche.
      const runScore = (p) => this.X(p) * dirA + (this.rfx(p).run || 0) * 22 - (this.rkey(p) === 'faux9' ? 40 : 0);
      const cands = attackers.filter((p) => ['BU', 'AG', 'AD', 'MO'].includes(A.slots[p.mp.slot].pos) || (this.rfx(p).run || 0) > 0).sort((a, b) => runScore(b) - runScore(a));
      const fwd = cands[0];
      // Second appel en diagonale dans le couloir (rôle « appels » marqué), décalé dans le temps.
      const fwd2 = cands.slice(1).find((p) => (this.rfx(p).run || 0) >= 0.6);
      if (fwd2 && lastDef != null && (this.now + fwd2.mp.id * 3) % 9 > 4) {
        fwd2.ptx = clamp((lastDef + 5) * dirA, 2, L - 2) / L;
        fwd2.pty = clamp(W / 2 + Math.sign(this.Y(fwd2) - W / 2 || 1) * 9, 3, W - 3) / W;
        fwd2.role = 'run';
      }
      if (fwd && lastDef != null && rx * dirA > (dirA > 0 ? L * 0.3 : -L * 0.7)) {
        const runT = (this.now + fwd.mp.id) % 7;
        // Appel : il attend à la limite du hors-jeu puis part dans le dos (cycle de quelques secondes).
        // Appel parfois mal synchronisé (hors-jeu).
        const early = ((fwd.mp.id * 7 + Math.floor(this.now / 7)) % 3) === 0;
        fwd.ptx = clamp((lastDef + (runT < 3 ? (early ? 1.2 : -0.8) : 6)) * dirA, 2, L - 2) / L;
        fwd.role = runT < 3 && !early ? 'hold' : 'run';
      }
      this.wideRuns(A, D, h, attackers, rx, ry);
    }
  }

  /**
   * Mouvements collectifs offensifs sur les côtés : dédoublement du latéral quand l'ailier a le
   * ballon, et occupation de la surface (premier poteau, point de penalty, second poteau,
   * entrée de surface) quand le ballon arrive dans le dernier tiers, côté.
   */
  wideRuns(A, D, h, attackers, rx, ry) {
    const dirA = this.dir(A.side), gA = this.goalX(A.side);
    // Ligne du hors-jeu (sens d'attaque de A) : dernier défenseur de champ, ou le ballon s'il est plus loin.
    const deep = Math.max(...this.list(D.side).filter((p) => !p.gk).map((p) => this.X(p) * dirA));
    const offLine = Math.max(deep, rx * dirA);
    const capX = (x) => (Math.min(x * dirA, offLine - 0.4) * dirA);
    const wide = Math.abs(ry - W / 2) > 11;
    const hp = A.slots[h.mp.slot].pos;
    if (wide && A.tactics.overlap !== 'stay' && (rx - L / 2) * dirA > -5 && ['AG', 'AD', 'MG', 'MD', 'MC', 'MO'].includes(hp)
      && (this.now + h.mp.id) % 10 < (A.tactics.overlap === 'join' ? 8 : 5)) {
      const fb = attackers.filter((p) => ['DG', 'DD'].includes(A.slots[p.mp.slot].pos) && (this.Y(p) - W / 2) * (ry - W / 2) > 0)
        .sort((a, b) => this.dist(a, rx, ry) - this.dist(b, rx, ry))[0];
      const fk = fb ? this.rkey(fb) : null;
      if (fb && fk !== 'lat_def' && this.dist(fb, rx, ry) < 30) {
        fb.ptx = clamp(capX(rx + dirA * 9), 2, L - 2) / L;
        // Latéral inversé : il passe à l'intérieur (demi-espace) au lieu de longer la ligne.
        fb.pty = (fk === 'lat_inv' ? W / 2 + (ry < W / 2 ? -12 : 12) : ry < W / 2 ? 3.5 : W - 3.5) / W;
        fb.role = 'overlap';
      }
    }
    if (!wide || Math.abs(rx - gA) > 26) return;
    const near = ry < W / 2 ? -1 : 1; // côté du ballon
    const spots = [
      { x: gA - dirA * 5.5, y: W / 2 + near * 3.5 },  // premier poteau
      { x: gA - dirA * 11, y: W / 2 - near * 0.5 },   // point de penalty
      { x: gA - dirA * 7, y: W / 2 - near * 5.5 },    // second poteau
      { x: gA - dirA * 19, y: W / 2 - near * 2 },     // entrée de surface : les ballons repoussés
    ];
    const used = new Set();
    const runners = attackers.filter((p) => p.role !== 'overlap' && this.dist(p, rx, ry) > 9 && Math.abs(this.X(p) - gA) < 45
      && ['BU', 'AG', 'AD', 'MO', 'MC', 'MG', 'MD'].includes(A.slots[p.mp.slot].pos));
    // Pas toute l'équipe : selon le moment, deux ou trois joueurs attaquent la surface.
    const n = A.tactics.crossing === 'high' ? 4 : (this.now + h.mp.id) % 6 < 3 ? 2 : 3;
    for (const sp of spots.slice(0, n)) {
      let best = null, bd = 1e9;
      for (const p of runners) { if (used.has(p)) continue; const d = this.dist(p, sp.x, sp.y); if (d < bd) { bd = d; best = p; } }
      if (!best) break;
      used.add(best);
      best.ptx = clamp(capX(sp.x), 2, L - 2) / L; best.pty = clamp(sp.y, 2, W - 2) / W;
      best.role = 'box';
    }
  }

  /**
   * Relance depuis l'arrière : les centraux s'écartent, les latéraux montent, le milieu
   * défensif décroche entre les centraux (l'équipe s'étire pour faire circuler le ballon).
   */
  /** Rôle tactique d'un joueur (effets) — voir ROLES. */
  rfx(p) { return roleFx(p.team?.roles?.[p.mp.slot]); }
  rkey(p) { return p.team?.roles?.[p.mp.slot] || 'std'; }

  buildUpShape(A, busy) {
    const dir = this.dir(A.side), own = this.goalX(1 - A.side);
    const depth = (this.P.x - own) * dir;
    if (depth > L * 0.4) return;
    const hasHalf = this.list(A.side).some((q) => this.rkey(q) === 'demi_def');
    for (const p of this.list(A.side)) {
      if (busy.has(p) || p.gk) continue;
      const pos = A.slots[p.mp.slot].pos;
      const y = p.pty * W;
      const rk = this.rkey(p);
      if (pos === 'DC') { p.pty = clamp(W / 2 + Math.sign(y - W / 2 || 1) * (hasHalf ? 17 : 13), 3, W - 3) / W; p.ptx = (own + dir * (8 + depth * 0.25)) / L; }
      else if ((pos === 'DG' || pos === 'DD') && rk === 'lat_inv') { p.pty = (W / 2 + Math.sign(y - W / 2 || 1) * 9) / W; p.ptx = (own + dir * (22 + depth * 0.3)) / L; }   // rentre au milieu
      else if (pos === 'DG' || pos === 'DD') { p.pty = (pos === 'DG' ? (A.side === 0 ? 4 : W - 4) : (A.side === 0 ? W - 4 : 4)) / W; p.ptx = clamp(p.ptx * L + dir * (rk === 'lat_def' ? 3 : 10), 2, L - 2) / L; }
      else if (rk === 'demi_def') { p.ptx = (own + dir * (7 + depth * 0.2)) / L; p.pty = 0.5; }       // entre les deux centraux
      else if (pos === 'MDC' && !hasHalf) { p.ptx = (own + dir * (14 + depth * 0.3)) / L; p.pty = 0.5; }
      else if (rk === 'meneur' || rk === 'regista') { p.ptx = (own + dir * (17 + depth * 0.35)) / L; p.pty = clamp(p.pty * W + (W / 2 - p.pty * W) * 0.4, 3, W - 3) / W; }   // décroche pour construire
    }
  }

  /** Ligne défensive : les défenseurs restent alignés et montent / reculent ensemble. */
  defensiveLine(D, busy) {
    const dir = this.dir(D.side); // sens d'attaque de D
    const backs = this.list(D.side).filter((p) => !busy.has(p) && ['DC', 'DG', 'DD'].includes(D.slots[p.mp.slot].pos));
    if (backs.length < 2) return;
    // Hauteur commune : la moyenne de leurs positions de formation, sans dépasser le ballon.
    let line = backs.reduce((a, p) => a + p.ptx * L * dir, 0) / backs.length;
    if (D.tactics.offsideTrap === 'on') line += 2.5;          // la ligne monte d'un bloc
    line = Math.min(line, this.P.x * dir - (D.tactics.offsideTrap === 'on' ? 2.5 : 4));
    for (const p of backs) p.ptx = clamp(line * dir, 1, L - 1) / L;
    return line;
  }

  /**
   * Se rendre disponible : autour de sa position, le joueur cherche le point le plus loin des
   * adversaires, avec une ligne de passe ouverte depuis le porteur, sans être hors-jeu.
   */
  findSpace(A, h, busy) {
    const dir = this.dir(A.side);
    const hx = this.X(h), hy = this.Y(h);
    const opps = this.list(1 - A.side);
    const secondLast = opps.map((p) => this.X(p) * dir).sort((a, b) => b - a)[1] ?? L;
    // Entre les lignes : l'espace entre le milieu et la défense adverses (là où l'on reçoit
    // dos au but sans être pris, puis on se retourne). Les joueurs offensifs le recherchent.
    const D = this.m.teams[1 - A.side];
    const avgX = (ps) => (ps.length ? ps.reduce((s, q) => s + this.X(q) * dir, 0) / ps.length : null);
    const dDef = avgX(opps.filter((q) => ['DC', 'DG', 'DD'].includes(D.slots[q.mp.slot]?.pos)));
    const dMid = avgX(opps.filter((q) => ['MDC', 'MC', 'MG', 'MD'].includes(D.slots[q.mp.slot]?.pos)));
    const gap = dDef != null && dMid != null && dDef - dMid > 6 ? [dMid + 1.5, dDef - 1.5] : null;
    for (const p of this.list(A.side)) {
      if (busy.has(p) || p.gk || p === h || p.role) continue;
      const lineSeeker = gap && ['MO', 'MC', 'AG', 'AD', 'BU'].includes(A.slots[p.mp.slot]?.pos);
      const bx = p.ptx * L, by = p.pty * W;
      let best = null, bs = -1e9;
      for (let k = 0; k < 13; k++) {
        const ang = (k / 12) * Math.PI * 2, rr = k === 12 ? 0 : (k % 2 ? 4 : 8);
        const x = clamp(bx + Math.cos(ang) * rr, 2, L - 2), y = clamp(by + Math.sin(ang) * rr, 2, W - 2);
        if (x * dir > secondLast && (x - L / 2) * dir > 0) continue; // hors-jeu
        let free = 12, lane = 6;
        const vx = x - hx, vy = y - hy, len2 = vx * vx + vy * vy || 1;
        for (const o of opps) {
          const ox = this.X(o), oy = this.Y(o);
          free = Math.min(free, Math.hypot(ox - x, oy - y));
          const t = clamp(((ox - hx) * vx + (oy - hy) * vy) / len2, 0, 1);
          lane = Math.min(lane, Math.hypot(ox - (hx + vx * t), oy - (hy + vy * t)));
        }
        let sc = free + lane * 0.7 - rr * 0.12;
        if (lineSeeker && x * dir > gap[0] && x * dir < gap[1]) sc += 2.5;
        if (sc > bs) { bs = sc; best = { x, y }; }
      }
      if (best) { p.ptx = best.x / L; p.pty = best.y / W; }
    }
  }

  /* ---------------- Porteur du ballon ---------------- */

  updateHolder(dt, out) {
    const h = this.holder;
    if (!h) return;
    const P = this.P;
    if (this.inHands) {
      // Le gardien garde le ballon un instant, puis relance.
      if (this.now >= h.next) this.gkDistribution(h, out);
      return;
    }
    // Ballon pas encore contrôlé (rebond, ballon qui file) : il le poursuit.
    const f = this.foot(h);
    const dBall = Math.hypot(f.x - P.x, f.y - P.y);
    const aheadB = (P.x - h.x * L) * Math.cos(h.face) + (P.y - h.y * W) * Math.sin(h.face);
    const inStride = (h.speed || 0) > 1.5 && dBall < 4.2 && aheadB > -0.3 && P.z < 0.8;   // ballon poussé devant lui
    // Geste armé (passe, frappe, centre, dégagement) — étape 4b-2 : le ballon ne part que s'il est
    // RÉELLEMENT dans la zone d'atteinte du pied à l'instant du contact. Ballon à portée : appui
    // planté, le geste se déroule. Ballon sorti de la zone : le joueur va au ballon, le geste est
    // suspendu (l'animation repart de l'armé, pour que le contact de l'image coïncide avec le vrai
    // contact). Trop tard : le geste est abandonné et il redécide.
    if (h.prep) {
      const rr = P.z < 0.6 ? reachAt(this.posM(h), P, { parts: ['foot'] }) : null;
      // Dans tous les cas il accompagne le ballon pour l'avoir devant le pied, dans l'axe du geste
      // (un joueur lancé frappe dans sa foulée, il ne se plante pas en laissant filer le ballon).
      // Hors d'atteinte, il anticipe davantage la trajectoire (sinon il ne rattrape jamais un ballon qui roule).
      const a = h.faceTo ?? h.face, lead = rr ? 0.15 : 0.45;
      this.wantHolder(h, P.x + P.vx * lead - Math.cos(a) * 0.32, P.y + P.vy * lead - Math.sin(a) * 0.32);
      // Il ne s'oriente vers la cible qu'une fois le ballon au pied ; avant, il regarde le ballon
      // (pivoter tôt en courant le ferait passer à côté de son ballon).
      h.faceBall = !rr;
      if (rr) {
        if (h.prep.held) { h.prep.held = false; h.kick = h.kickMax; h.prep.at = this.now + h.kickMax * 0.55 * GS; this.gest.replan(h, h.prep.at, { timer: 'kick', dur: h.kickMax * GS, at: 0.55 }); }
        if (this.now >= h.prep.at) { const pk = h.prep.pick; h.prep = null; h.next = this.now + 0.4; this.execute(h, pk, out); }
        return;
      }
      if (this.now > h.prep.until + 0.6) {
        h.prep = null; h.kick = 0; h.next = Math.min(h.next, this.now + 0.15);
        this.gest.finish(h, 'annulé', 'ballon hors de portée du pied', true);
        if (this.diag) this.diag.miss(this.now, { pid: h.mp.id, x: P.x, y: P.y, reason: 'geste abandonné (ballon hors de portée)' });
      } else {
        if (this.now >= h.prep.at - 0.05 || h.prep.held) { h.prep.held = true; h.kick = h.kickMax; h.prep.at = this.now + h.kickMax * 0.55 * GS; this.gest.replan(h, h.prep.at, { timer: 'kick', dur: h.kickMax * GS, at: 0.55 }, true); }
        return;
      }
    }
    // Ballon hors de la zone d'atteinte du pied (même géométrie que le contact) : il va au ballon,
    // en s'arrêtant de façon à l'avoir devant le pied (pas sur lui).
    const inReach = P.z < 0.6 && reachAt(this.posM(h), P, { parts: ['foot'] });
    if ((!inReach && !inStride) || P.z > 0.8) {
      // Il vise là où le ballon sera quand il l'atteindra (anticipation selon la distance), pas là où il est.
      const lead = clamp(Math.hypot(P.x - h.x * L, P.y - h.y * W) / 6, 0.2, 0.8);
      const bx = P.x + P.vx * lead, by = P.y + P.vy * lead, ux = bx - h.x * L, uy = by - h.y * W, ul = Math.hypot(ux, uy) || 1;
      const back = Math.min(0.3, ul);
      this.wantHolder(h, bx - (ux / ul) * back, by - (uy / ul) * back); h.faceBall = true; return;
    }
    h.faceBall = false;
    // Entre deux touches, il court vers le ballon qu'il vient de pousser (il ne le dépasse pas).
    const chaseTouch = inStride && dBall > 0.7;
    // Point de course « derrière le ballon, sur sa ligne » : le ballon arrive devant son pied au lieu
    // qu'il coure à côté de lui. `lead` : avance prise sur la trajectoire (garde l'élan).
    const behindBall = (lead) => {
      const bs = Math.hypot(P.vx, P.vy), ux = bs > 0.5 ? P.vx / bs : Math.cos(h.face), uy = bs > 0.5 ? P.vy / bs : Math.sin(h.face);
      this.wantHolder(h, P.x + P.vx * lead - ux * 0.3, P.y + P.vy * lead - uy * 0.3);
    };
    const relBall = Math.hypot(P.vx - (h.vx || 0), P.vy - (h.vy || 0));
    // Dribble : le défenseur est-il éliminé (il est passé derrière le porteur, qui a toujours le ballon) ?
    const to = h.carry?.takeon;
    if (to && !to.done && this.players.has(to.def.mp.id)) {
      const dir = this.dir(h.side), beaten = (this.X(h) - this.X(to.def)) * dir > 0.8 && this.dist(to.def, this.X(h), this.Y(h)) < 6;
      if (beaten) {
        to.done = true; const m = this.m;
        h.team.stats.dribbles = (h.team.stats.dribbles || 0) + 1; addRating(h.mp, 0.06);
        if (to.move && SKILL_MOVES[to.move]?.stars >= 3) emit(m, out, { type: 'skill', side: h.side, pid: h.mp.id, pid2: to.def.mp.id, move: to.move, x: P.x / L, y: P.y / W, zone: m.zone });
        emit(m, out, { type: 'dribble', side: h.side, pid: h.mp.id, pid2: to.def.mp.id, x: P.x / L, y: P.y / W, zone: m.zone });
        if (this.diag) this.diag.duel(this.now, { pid: h.mp.id, side: h.side, kind: 'dribble', vs: to.def.mp.id, feint: +to.feint.toFixed(2), result: 'défenseur éliminé' });
      }
    }
    if (chaseTouch) {
      behindBall(0.5);
      if (h.carry && (this.dist(h, h.carry.x, h.carry.y) < 1.5 || this.now > h.carry.until)) { h.carry = null; h.next = Math.min(h.next, this.now); }
    } else if (h.carry) {
      this.wantHolder(h, h.carry.x, h.carry.y);
      const pressed = this.pressure(h) < 2.2;
      if (this.dist(h, h.carry.x, h.carry.y) < 1.5 || this.now > h.carry.until || (pressed && !h.carry.takeon && !h.carry.escape && this.now > h.carry.t0 + 0.9)) { h.carry = null; h.next = Math.min(h.next, this.now); }
    } else {
      // Sans consigne : il protège le ballon s'il est pressé, sinon il avance tranquillement.
      const dir = this.dir(h.side);
      if (relBall > 0.8 && Math.hypot(P.vx, P.vy) > 0.8) behindBall(0.35);   // le ballon roule encore : il le suit
      else if (this.pressure(h) < 3) this.wantHolder(h, this.X(h), this.Y(h));
      else this.wantHolder(h, clamp(this.X(h) + dir * 3, 2, L - 2), clamp(this.Y(h), 3, W - 3));   // il ne longe pas la ligne
    }
    h.shieldK = this.pressure(h) < 2.5 && (h.speed || 0) < 2 ? 1 : 0;
    if (h.shieldK) {
      let near = null, nd = 9;
      for (const o of this.players.values()) if (o.side !== h.side) { const d = this.dist(o, this.X(h), this.Y(h)); if (d < nd) { nd = d; near = o; } }
      h.shieldFace = near ? Math.atan2(this.Y(h) - this.Y(near), this.X(h) - this.X(near)) : null;
    } else h.shieldFace = null;
    // Il ne frappe / passe que le ballon à portée de pied (sinon il attend la prochaine touche).
    // Décider (choix de la passe, de la frappe) est mental : possible quand le ballon est à un pas ;
    // le CONTACT, lui, n'a lieu que ballon dans la zone d'atteinte (voir le geste armé ci-dessus).
    if (this.now >= h.next && this.now >= (h.minNext || 0) && (inReach || dBall < 1.5)) this.decide(h, out);
  }

  /**
   * Arbitre des duels : un ballon coincé entre deux joueurs (porteur arrêté, adversaire collé)
   * ne doit jamais durer. Au-delà de 3 s, le duel se dénoue : le défenseur l'emporte (tacle),
   * ou le porteur se dégage d'une passe en retrait / d'un dégagement — selon leurs qualités.
   */
  /**
   * Ballon coincé (étape 4e) : plus aucune attribution artificielle. Au bout de 3 s sans que le
   * ballon bouge, la sécurité RELANCE les vraies interactions : le porteur doit jouer tout de
   * suite, les adversaires au contact s'engagent, les joueurs proches d'un ballon libre y vont.
   * Si rien ne se débloque en 10 s (anomalie technique), l'arbitre arrête le jeu et redonne le
   * ballon par une balle à terre à l'équipe qui l'a touché en dernier (Loi 8) — jamais au plus proche.
   */
  duelWatch(dt, out) {
    const h = this.holder, P = this.P;
    const slow = Math.hypot(P.vx, P.vy) < 1.5 && (!h || (h.speed || 0) < 1.5);
    const opp = h && !this.inHands ? [...this.players.values()].find((o) => o.side !== h.side && Math.hypot(o.x * L - P.x, o.y * W - P.y) < 2.6) : null;
    const loose = !h && !this.pending && [...this.players.values()].filter((o) => Math.hypot(o.x * L - P.x, o.y * W - P.y) < 2.6).length >= 2;
    if (slow && (opp || loose) && !this.shot) this._stall = (this._stall || 0) + dt; else { this._stall = 0; this._stallMark = false; }
    if (this._stall < 3) return;
    if (!this._stallMark) {
      this._stallMark = true;
      this.stallN = (this.stallN || 0) + 1;
      if (this.diag) this.diag.duel(this.now, { kind: 'ballon coincé', pid: h?.mp.id ?? null, result: 'relance des interactions' });
    }
    if (h) { h.next = Math.min(h.next, this.now); h.minNext = 0; h.waitN = 9; h.prep = h.prep || null; }
    for (const o of this.players.values()) {
      if (Math.hypot(o.x * L - P.x, o.y * W - P.y) > 6) continue;
      if (!h || o.side !== h.side) o._stallPush = this.now + 1;
      if (!h && !o.gk) this.want(o, 'coincé', 'ballon coincé', PRI.URGENCE, 'ballon coincé', P.x, P.y, 0.5, { ttl: 0.12 });
    }
    if (this._stall >= 10) {
      this._stall = 0; this._stallMark = false; this.stallDrop = (this.stallDrop || 0) + 1;
      if (this.diag) this.diag.duel(this.now, { kind: 'ballon coincé', result: 'balle à terre (sécurité)' });
      this.setRestart('freekick', this.lastTouch >= 0 ? this.lastTouch : 0, P.x, P.y, out);
      if (this.restart) this.restart.drop = true;
    }
  }

  /** Décision de la VAR : but validé (engagement) ou refusé (score corrigé, coup franc / six mètres). */
  varDecision(out) {
    const m = this.m, V = this.varPending;
    this.varPending = null;
    if (!V) return;
    emit(m, out, { type: 'var', side: V.side, pid: V.sc.id, outcome: V.cancel ? 'cancelled' : 'confirmed', reason: V.reason, x: 0.5, y: 0.5, zone: 3 });
    if (!V.cancel) { this._goalKo = true; this.handle([this.kickoffEvent(1 - V.side)], out); return; }
    // But refusé : on annule tout ce qu'il avait apporté.
    m.score[V.side] = Math.max(0, m.score[V.side] - 1);
    V.sc.goals = Math.max(0, V.sc.goals - 1); addRating(V.sc, -1.0);
    if (V.assist) { V.assist.assists = Math.max(0, V.assist.assists - 1); addRating(V.assist, -0.6); }
    for (let i = m.goals.length - 1; i >= 0; i--) if (m.goals[i].pid === V.sc.id && m.goals[i].side === V.side) { m.goals.splice(i, 1); break; }
    const tl = m.xgTimeline[m.xgTimeline.length - 1]; if (tl) tl.goal = false;
    for (const p of this.players.values()) p.celeb = 0;
    const D = 1 - V.side;
    if (V.reason === 'offside' || V.reason === 'foul' || V.reason === 'hand') {
      const fx = clamp(V.x + this.dir(V.side) * -6, 8, L - 8), fy = clamp(V.y, 8, W - 8);
      this.setRestart('freekick', D, fx, fy);
    } else this.setRestart('goalkick', D, this.goalX(V.side) - this.dir(V.side) * 5.5, W / 2);
  }

  /** Distance au plus proche adversaire. */
  pressure(h) {
    let best = 99;
    for (const p of this.players.values()) if (p.side !== h.side) best = Math.min(best, Math.hypot((p.x - h.x) * L, (p.y - h.y) * W));
    return best;
  }

  /** Valeur d'avoir le ballon en (x, y) pour l'équipe `side` (proche du but adverse = précieux). */
  threat(side, x, y) {
    const gx = this.goalX(side);
    const d = Math.hypot(gx - x, W / 2 - y);
    return 0.02 + 0.36 * Math.exp(-d / 15.5);
  }

  /** Consignes qui modulent les décisions de l'équipe `A` en ce moment. */
  tacticalMood(A) {
    const m = this.m;
    const lead = m.score[A.side] - m.score[1 - A.side];
    const counter = A.tactics.counter === 'on' && this.now - (this.gainT?.[A.side] ?? -99) < 6;
    const wasting = A.tactics.timeWasting === 'on' && lead > 0 && m.minute >= 60;
    const drib = { less: 0.6, normal: 1, more: 1.45 }[A.tactics.dribbling] || 1;
    return { counter, wasting, drib };
  }

  /** Choix du porteur : passe, conduite, frappe, centre, dégagement. */
  decide(h, out) {
    const m = this.m, A = h.team, D = m.teams[1 - A.side];
    const mood = this.tacticalMood(A);
    const P = this.P, dir = this.dir(A.side), gx = this.goalX(A.side);
    const hx = this.X(h), hy = this.Y(h);
    const press = this.pressure(h);
    const ment = MENT[A.tactics.mentality] || 0;
    const opts = [];
    // Frappe.
    const dGoal = Math.hypot(gx - hx, W / 2 - hy);
    // Frappe de loin (> 25 m) : seulement avec de l'espace et un vrai pied (ou en fin de match si on court après le score).
    const chasing = m.minute > 80 && m.score[A.side] < m.score[D.side];
    const longOk = dGoal < 25 || (press > 3 && (eff(h.mp, 'tir') >= 70 || TR(h, 'sniper') || chasing || A.tactics.longShots === 'high'));   // de l'espace pour armer (et non un adversaire collé)
    if (dGoal < 33 && (gx - hx) * dir > 2 && longOk) {
      const xg = this.xg(h, 'open');
      let w = TUNE.shotW * (1 + ment * 0.2) * ({ less: 0.55, normal: 1, more: 1.5 }[piOf(A, h.mp, 'shoot', 'normal')]);
      if (dGoal > 20) w *= { low: 0.55, mid: 1, high: 1.6 }[A.tactics.longShots] || 1;
      // Comme un vrai attaquant : on frappe dès que la fenêtre s'ouvre (entre le point de penalty
      // et l'entrée de la surface), on ne cherche pas à entrer dans le but avec le ballon.
      w *= dGoal < 6 ? 0.7 : dGoal < 11 ? 0.95 : dGoal < 16.5 ? 1.15 : dGoal < 25 ? 1.0 : 0.5;
      if (dGoal >= 16 && dGoal < 25 && press < 2.2) w *= 1 + eff(h.mp, 'tir') / 160; // espace pour armer
      if (m.minute > 75 && m.score[A.side] < m.score[D.side]) w *= 1.25;
      w *= 1 + Math.min(1, Math.max(0, (A.seqN || 0) - 10) / 15) * 0.3;   // longue possession stérile : on finit par tenter
      // Tirer, c'est (presque toujours) rendre le ballon : on compare l'occasion à la possession.
      // Une frappe de loin ne « rend » pas vraiment le ballon : corner, sortie de but, second ballon.
      const costK = dGoal > 16.5 ? TUNE.longCost : 1;   // une frappe de loin « rend » rarement le ballon dans de mauvaises conditions (sortie, corner, second ballon)
      opts.push({ k: 'shot', u: xg * w - (1 - xg) * this.threat(A.side, hx, hy) * TUNE.shotCost * costK, xg });
    }
    // Passes.
    for (const r of this.list(A.side)) {
      if (r === h || (r.gk && press > 6)) continue;
      const o = this.passOption(h, r);
      if (o) opts.push(o);
    }
    // Conduite dans l'espace.
    const space = this.spaceAhead(h);
    if (space > 3.5 && dGoal > 11.5) {   // collé au but, on ne « conduit » plus : on frappe, on donne ou on dribble
      // Pas de conduite jusque dans les 6 mètres : on s'arrête vers le point de penalty pour frapper.
      const len = Math.min(space - 1.5, 12, Math.max(1.5, dGoal - 9));
      // On ne conduit pas jusque sur la ligne de but ni la ligne de touche (on garde le ballon en jeu).
      const cx = clamp(hx + dir * len, 7, L - 7), cy = clamp(hy + (W / 2 - hy) * (dGoal < 35 ? 0.25 : 0.05), 4, W - 4);
      const dri = eff(h.mp, 'dri');
      const keep = sig((space - 3) / 1.6) * (0.9 + dri / 1000);
      const w = TUNE.carryW * ({ less: 0.6, normal: 1, more: 1.5 }[piOf(A, h.mp, 'dribble', 'normal')]) * (1 + ment * 0.1) * (0.6 + 0.4 * mood.drib) * (mood.counter ? 1.25 : 1);
      // Dans la surface, on ne conduit plus jusqu'au gardien : on frappe ou on donne.
      const boxK = dGoal < 13 ? 0.45 : dGoal < 18 ? 0.7 : 1;
      // Conduire, c'est aussi risquer de perdre le ballon (même coût que pour une passe ratée).
      // (sans adversaire proche, le risque réel de perdre le ballon en conduisant est faible)
      const lossC = (1 - keep) * (this.threat(1 - A.side, hx, hy) + this.threat(A.side, hx, hy) * 1.4 + 0.012) * TUNE.lossW * TUNE.carryLoss * clamp((9 - press) / 6, TUNE.carryFree, 1);
      opts.push({ k: 'carry', u: (keep * this.threat(A.side, cx, cy) * w + 0.004) * boxK - lossC, x: cx, y: cy });
    }
    // Crochet / débordement : un défenseur devant, de l'espace derrière lui.
    const opp = this.frontOpponent(h);
    // Dribble : surtout dans la moitié adverse, ou pour les dribbleurs (on ne provoque pas devant sa surface).
    if (opp && opp.d > 1.8 && opp.d < 7 && ((gx - hx) * dir < 50 || (this.rfx(h).dribble || 1) > 1.2)) {
      const ox = this.X(opp.p), oy = this.Y(opp.p);
      const side = oy > hy ? -1 : 1; // on passe du côté opposé à son appui
      const tx2 = clamp(ox + dir * 4.5, 2, L - 2), ty2 = clamp(oy + side * 2.6, 2, W - 2);
      const dri = eff(h.mp, 'dri') * 0.8 + eff(h.mp, 'vit') * 0.2, def = eff(opp.p.mp, 'def') * 0.75 + eff(opp.p.mp, 'vit') * 0.25;
      const pWin = sig((dri - def) / 11 + 0.15 + (TR(h, 'magicien') ? 0.6 : 0) + (TR(h, 'provocateur') ? 0.3 : 0) - (TR(opp.p, 'roc') ? 0.45 : 0) - (TR(opp.p, 'guerrier') ? 0.15 : 0));
      const w = TUNE.takeonW * ({ less: 0.5, normal: 1, more: 1.7 }[piOf(A, h.mp, 'dribble', 'normal')]) * mood.drib * (TR(h, 'magicien') || TR(h, 'provocateur') ? 1.45 : 1);
      const boxT = dGoal < 11 ? 0.5 : 1; // collé au but : on ne cherche plus à dribbler le dernier homme
      // Geste technique choisi selon ses étoiles et la situation (distance du défenseur, espace).
      const mv = this.pickMove(h, opp.d);
      const pW = clamp(pWin + (SKILL_MOVES[mv]?.bonus || 0) * (0.6 + (h.mp.p?.sm ?? 2) / 10), 0.03, 0.95);
      let tx3 = tx2, ty3 = ty2;
      if (mv === 'petitpont' || mv === 'sombrero') { tx3 = clamp(ox + dir * 4, 2, L - 2); ty3 = oy; } // par-dessous ou par-dessus : tout droit
      if (mv === 'roulette') ty3 = clamp(oy + side * 3.2, 2, W - 2);
      opts.push({ k: 'takeon', u: (pW * this.threat(A.side, tx3, ty3) - (1 - pW) * this.threat(A.side, hx, hy) * TUNE.lossW) * w * boxT, x: tx3, y: ty3, opp: opp.p, pWin: pW, move: mv });
    }
    // Centre : couloir, dernier tiers, coéquipiers dans la surface.
    const wide = Math.abs(hy - W / 2) > 15, deep = (gx - hx) * dir < 30;
    if (wide && deep) {
      const inBox = this.list(A.side).filter((p) => p !== h && Math.abs(this.X(p) - gx) < 16 && Math.abs(this.Y(p) - W / 2) < 18);
      if (inBox.length) {
        const best = inBox.sort((a, b) => eff(b.mp, 'phy') - eff(a.mp, 'phy'))[0];
        const w = TUNE.crossW * ({ low: 0.5, mid: 1, high: 1.6 }[A.tactics.crossing] || 1);
        opts.push({ k: 'cross', u: (0.035 + inBox.length * 0.012) * w, r: best });
      }
    }
    // Dégagement : dans sa surface, sous pression.
    const ownGx = this.goalX(D.side);
    if (Math.hypot(ownGx - hx, W / 2 - hy) < 28 && press < 4) opts.push({ k: 'clear', u: 0.05 * (press < 2 ? 1.5 : 1) });
    // Temporiser : sans adversaire au contact, garder le ballon (se protéger, lever la tête,
    // attendre l'appel d'un partenaire) vaut mieux qu'une passe ou une frappe sans intérêt.
    // Adversaire au contact : on peut protéger le ballon un instant, puis il faut jouer
    // (crochet pour se dégager, passe de sécurité, dribble) — jamais de face-à-face qui s'éternise.
    const opp1 = this.list(D.side).filter((o) => !(o.fall > 0) && !(o.slide > 0)).map((o) => ({ o, d: Math.hypot(this.X(o) - hx, this.Y(o) - hy) })).sort((a, b) => a.d - b.d)[0];
    const contact = opp1 && opp1.d < 2.4;
    const dGoalE = Math.hypot(this.goalX(A.side) - hx, W / 2 - hy);
    if (contact && (h.waitN || 0) >= 1 && dGoalE > 24 && !globalThis.__X?.noesc) {
      // Se dégager : demi-tour / pas de côté, le corps entre l'adversaire et le ballon.
      // On se dégage de côté ou en avant (le corps entre l'adversaire et le ballon), pas en
      // repartant vers son propre but.
      let ax = hx - this.X(opp1.o), ay = hy - this.Y(opp1.o);
      if (ax * dir < 0) ax *= 0.25;
      const al = Math.hypot(ax, ay) || 1;
      const side = ((h.mp.id + Math.floor(this.now)) % 2 ? 1 : -1);
      const ex = clamp(hx + (ax / al) * 4 + (-ay / al) * side * 2.5, 2, L - 2), ey = clamp(hy + (ay / al) * 4 + (ax / al) * side * 2.5, 2, W - 2);
      opts.push({ k: 'carry', u: -0.035 + (h.waitN || 0) * 0.022 + eff(h.mp, 'dri') / 5000, x: ex, y: ey, escape: true });
    }
    // On temporise au plus trois fois de suite (≈ 2-3 s), et deux fois sous la pression d'un adversaire.
    // Balle au pied depuis longtemps : on ne temporise plus, on cherche à jouer (passe de préférence).
    const heldT = this.now - (h._gotT ?? this.now);
    if (heldT > 5) for (const o of opts) if (o.k === 'pass' && !o.offside) o.u += 0.025 * Math.min(5, heldT - 5);
    if (heldT > 4) for (const o of opts) if ((o.k === 'carry' && !o.escape) || o.k === 'takeon') o.u -= 0.025 * Math.min(6, heldT - 4);   // une chevauchée finit par s'arrêter
    if (!h.gk && heldT < 6 && !(contact && (h.waitN || 0) >= 2) && (h.waitN || 0) < 3) {
      const room = clamp((press - 1.6) / 4, 0, 1);
      const waited = h.waitN || 0;                               // on ne temporise pas indéfiniment
      opts.push({ k: 'hold', u: (TUNE.holdU + 0.02 * room) * (1 + waited * 0.6) - (press < 1.4 ? 0.1 : 0) - waited * 0.03 });
    }
    // Une-deux : le partenaire qui vient de donner et repart dans le dos est servi en remise
    // dès que la passe est sûre (c'est tout l'intérêt du mouvement).
    for (const o of opts) if (o.k === 'pass' && o.r.goRun && this.now < o.r.goRun.until && !o.offside && o.p > 0.55) o.u += 0.035;
    // Sous pression prolongée, la passe la plus sûre redevient acceptable (on joue simple).
    if (contact && (h.waitN || 0) >= 1) for (const o of opts) if (o.k === 'pass' && !o.lofted) o.u += 0.03 * Math.min(3, h.waitN);
    if (!opts.length) { h.next = this.now + 0.3; return; }
    // Choix : le meilleur, avec une part de hasard d'autant plus faible que le joueur voit le jeu.
    const vis = eff(h.mp, 'vis');
    const temp = TUNE.temp * (1.5 - vis / 100);
    // Rôle du porteur : ses penchants (frapper, dribbler, centrer, jouer simple) pèsent sur le choix.
    const hf = this.rfx(h);
    const lean = (o) => (o.k === 'shot' ? hf.shot : o.k === 'carry' || o.k === 'takeon' ? hf.dribble : o.k === 'cross' ? hf.cross : o.k === 'pass' ? (o.lofted ? hf.long || hf.pass : hf.pass) : 1) || 1;
    const ws = opts.map((o) => Math.exp((o.u - Math.max(...opts.map((x) => x.u))) / temp) * lean(o));
    const pick = opts[this.rng.weightedIndex(ws)];
    h.lastPick = pick.k;
    const tempo = LVL[A.tactics.tempo] || 0;
    h.next = this.now + (0.45 + this.rand() * 0.5) * TUNE.hold * (1 - tempo * 0.18) * (press < 3 ? 0.6 : 1) * (1.3 - vis / 250) * (mood.counter ? 0.82 : 1) * (mood.wasting && press > 4 ? 1.7 : 1);
    // Passe, frappe, centre, dégagement : le joueur s'arrête sur son appui et arme sa jambe ;
    // le ballon ne part qu'au moment du contact (comme dans un vrai geste).
    if (['shot', 'pass', 'cross', 'clear'].includes(pick.k)) {
      const big = pick.k !== 'pass' || pick.lofted;
      const tgt = pick.k === 'pass' ? { x: pick.tx, y: pick.ty } : pick.k === 'cross' ? { x: this.X(pick.r), y: this.Y(pick.r) } : pick.k === 'shot' ? { x: gx, y: W / 2 } : { x: hx + dir * 30, y: hy };
      h.faceTo = Math.atan2(tgt.y - hy, tgt.x - hx);   // il s'oriente pendant l'armé (le ballon tourne avec lui)
      if (pick.k === 'shot') h.shotTech = this.shotTech(h);
      h.kick = big ? 0.32 : 0.24; h.kickMax = h.kick; h.kickPow = pick.k === 'shot' ? (h.shotTech === 'drive' ? 1 : 0.8) : big ? 0.85 : 0.5; h.kickSide = (pick.k === 'pass' && !big) || h.shotTech === 'finesse' || h.shotTech === 'curl';
      h.kickFoot = pick.k === 'shot' ? (this.footSign(h) > 0 ? 'R' : 'L') : this.chooseFoot(h);   // passe : du pied qui est du côté du ballon (tir : pied fort)
      h.kickLoft = pick.k === 'cross' || pick.k === 'clear' || (pick.k === 'pass' && pick.lofted);
      // Le ballon part à l'instant exact où le pied le touche dans l'animation (55 % du geste).
      h.prep = { pick, at: this.now + h.kick * 0.55 * GS, until: this.now + h.kick * 0.55 * GS + 0.5 };
      this.gest.begin(h, pick.k === 'shot' ? 'frappe' : pick.k === 'pass' ? (pick.lofted ? 'passe levée' : 'passe') : pick.k === 'cross' ? 'centre' : 'dégagement', { foot: h.kickFoot, tPlan: h.prep.at, anim: { timer: 'kick', dur: h.kickMax * GS, at: 0.55 }, src: 'porteur' });   // (descriptif, étape 6a)
      h.next = h.prep.until;
      return;
    }
    this.execute(h, pick, out);
  }

  /** Exécute le choix du porteur (après l'armé pour les frappes). */
  execute(h, pick, out) {
    if (pick.k === 'hold') {
      h.waitN = (h.waitN || 0) + 1;
      h.next = this.now + 0.5 + this.rand() * 0.6;
      return;
    }
    h.waitN = 0;
    if (pick.k === 'shot') this.doShot(h, 'open', out);
    else if (pick.k === 'pass') this.doPass(h, pick, out);
    else if (pick.k === 'carry') { h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + (pick.escape ? 0.9 : 1.2 + this.rand() * 1.4), escape: !!pick.escape }; h.next = h.carry.until; h.minNext = this.now + 0.5; }
    else if (pick.k === 'takeon') {
      // Étape 4e : le crochet n'a plus d'issue tirée d'avance. La FEINTE (corps, geste) prend le
      // défenseur à contre-pied un instant — d'autant plus que le dribbleur est bon et le geste
      // difficile, d'autant moins que le défenseur lit bien le jeu. Ensuite c'est une course au
      // ballon : le défenseur peut encore l'atteindre (tacle), ou il est éliminé.
      const def = pick.opp, stars = SKILL_MOVES[pick.move]?.stars || 1;
      const feint = clamp(0.08 + (eff(h.mp, 'dri') - eff(def.mp, 'def')) / 220 + stars * 0.04 + (TR(h, 'magicien') ? 0.06 : 0) - eff(def.mp, 'vis') / 1000 + gauss(this.rand(), this.rand()) * 0.07, 0, 0.45);
      def._feint = this.now + feint;
      // Pris à contre-pied : son premier appui part du mauvais côté.
      const side = Math.sign((pick.y - this.Y(h)) * Math.cos(h.face) - (pick.x - this.X(h)) * Math.sin(h.face)) || 1;
      def._p6 = { x: this.X(def) + (-Math.sin(h.face) * -side * 1.2), y: this.Y(def) + (Math.cos(h.face) * -side * 1.2), until: def._feint };   // contre-pied : geste subi (P6)
      h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + 2.2, takeon: { def, move: pick.move, feint } };
      if (pick.move === 'petitpont') def._nutmeg = this.now + 0.6;   // le ballon passe entre ses jambes (écartées)
      if (pick.move === 'sombrero' && this.P.z < 0.3) { this.P.vz = 5.2; }
      h.next = h.carry.until;
      // Le geste se joue à l'approche du défenseur (animation) ; le jongle lève déjà le ballon.
      h.skill = pick.move; h.skillT = SKILL_DUR[pick.move] || 0.5; h.skillMax = h.skillT;
      this.gest.begin(h, 'geste technique', { anim: { timer: 'skillT', dur: h.skillMax * GS, at: null }, src: pick.move });
      if (pick.move === 'jongle' && this.P.z < 0.3) { this.P.vz = 2.6; }
    }
    else if (pick.k === 'cross') this.doCross(h, pick.r, out);
    else if (pick.k === 'clear') this.doClear(h, out);
  }

  /** Adversaire le plus proche devant le porteur (dans un cône de 70°). */
  frontOpponent(h) {
    const dir = this.dir(h.side);
    let best = null;
    for (const p of this.players.values()) {
      if (p.side === h.side || p.gk) continue;
      const dx = (p.x - h.x) * L * dir, dy = (p.y - h.y) * W;
      if (dx <= 0) continue;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dy) < dx * 1.4 && (!best || d < best.d)) best = { p, d };
    }
    return best;
  }

  /** Espace libre devant le joueur (distance au premier adversaire dans un cône de 50°). */
  spaceAhead(h) {
    const dir = this.dir(h.side);
    let best = 40;
    for (const p of this.players.values()) {
      if (p.side === h.side) continue;
      const dx = (p.x - h.x) * L * dir, dy = (p.y - h.y) * W;
      if (dx <= -1) continue;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dy) < Math.max(2.5, dx * 0.9)) best = Math.min(best, d);
    }
    const toLine = (this.goalX(h.side) - this.X(h)) * dir;
    return Math.min(best, toLine);
  }

  /**
   * Option de passe vers r : probabilité de réussite selon la ligne (adversaires capables
   * de couper la trajectoire à temps), le marquage du receveur et la qualité du passeur ;
   * valeur = position du receveur (passe en profondeur si un appel est en cours).
   */
  passOption(h, r) {
    const A = h.team, dir = this.dir(A.side);
    const sx = this.X(h), sy = this.Y(h);
    // Passe dans la course : on vise là où le receveur sera à l'arrivée du ballon.
    const d0 = Math.hypot(this.X(r) - sx, this.Y(r) - sy);
    const lead = (r.speed || 0) > 2 ? Math.min(1.2, d0 / 16) * 0.9 : 0.2;
    let tx = this.X(r) + (r.vx || 0) * lead, ty = this.Y(r) + (r.vy || 0) * lead;
    let through = false;
    // Appel en profondeur : ballon devant lui. Une-deux : remise courte, au sol, dans sa course.
    if (r.goRun && this.now < r.goRun.until) { tx = this.X(r) + (r.vx || 0) * 0.7; ty = this.Y(r) + (r.vy || 0) * 0.7; }
    else if (r.role === 'run') { tx += dir * 6; through = true; }
    tx = clamp(tx, 1.5, L - 1.5); ty = clamp(ty, 1.5, W - 1.5);
    const len = Math.hypot(tx - sx, ty - sy);
    if (len < 4 || len > 60) return null;
    // Passe en retrait : courte pour faire tourner, oui ; 30 à 50 m vers l'arrière, presque jamais
    // (seulement pour sortir d'un pressing étouffant). Devant le but adverse, on ne recule pas.
    const back = Math.max(0, (sx - tx) * dir);
    const toGoal = Math.abs(this.goalX(A.side) - sx);
    const nearGoal = toGoal < 32, ownHalf = toGoal > L / 2;
    const pressed = this.pressure(h) < 2.5;  // adversaire au contact
    if (back > (nearGoal ? 24 : ownHalf ? 36 : pressed ? 34 : 28)) return null;
    // Passe à ras de terre par défaut ; aérienne seulement pour un long ballon ou une profondeur lointaine.
    const lofted = len > 42 || (through && len > 30);
    const vb = lofted ? 19 : 15;
    const pas = eff(h.mp, 'pas'), vis = eff(h.mp, 'vis');
    let p = clamp(0.995 - len * TUNE.passErr * (1.35 - pas / 100) - (lofted ? 0.12 : 0) - (through ? (TR(h, 'visionnaire') ? 0.03 : 0.08) : 0), 0.45, 0.995);
    let worst = null, wc = 0;
    for (const o of this.players.values()) {
      if (o.side === A.side) continue;
      const ox = this.X(o), oy = this.Y(o);
      const vx = tx - sx, vy = ty - sy;
      const s = clamp(((ox - sx) * vx + (oy - sy) * vy) / (len * len), 0, 1);
      if (lofted && s < 0.8) continue; // ballon aérien : seuls les joueurs près de la réception
      const px = sx + vx * s, py = sy + vy * s;
      const d = Math.hypot(ox - px, oy - py);
      const tb = (s * len) / vb + 0.15;
      const to = Math.max(0, d - 0.9) / 7.2 + 0.28;
      let c = sig((tb - to) * 3.2 - 0.6) * (0.55 + eff(o.mp, 'def') / 220) * TUNE.passRisk * (this.m.wx?.passRisk || 1) * (lofted ? (this.m.wx?.air || 1) : 1);
      // Jugement du passeur : une passe qui frôle la jambe d'un adversaire tout proche finit
      // dans ses pieds (elle « passe à travers » sa zone d'atteinte dès les premiers mètres).
      if (s * len < (lofted ? 1.5 : 3) && d < 1.1) c = Math.max(c, 0.75);   // (une passe levée, à peine décollée, se contre aussi)
      if (o.gk) c *= Math.abs(ox - this.goalX(1 - A.side)) < 16 ? 0.8 : 0.2;
      // Traits : passeur (Maestro, Métronome, Centreur, Relanceur) et défenseur (Aspirateur, Tour, Joueur de tête).
      if (TR(h, 'maestro') || TR(h, 'metronome')) c *= lofted ? 0.9 : 0.78;
      if (lofted && TR(h, 'centreur')) c *= 0.8;
      if (h.gk && TR(h, 'relanceur')) c *= 0.8;
      if (TR(o, 'aspirateur')) c *= 1.15;
      if (lofted && (TR(o, 'tour') || TR(o, 'tete'))) c *= 1.25;
      c *= 1.1 - vis / 300;
      if (c > 0.01) { p *= 1 - c; if (c > wc) { wc = c; worst = { o, x: px, y: py }; } }
    }
    const offside = this.isOffside(h, r);
    // Le passeur ne voit pas toujours le hors-jeu ; un piège bien tendu le surprend encore plus.
    if (offside) p *= this.m.teams[1 - A.side].tactics.offsideTrap === 'on' ? 0.97 : TUNE.offsideSeen;
    const ment = MENT[A.tactics.mentality] || 0;
    const dirW = { short: 1, mid: 1, direct: 1 }[A.tactics.passing] || 1;
    let lenW = 1;
    if (A.tactics.passing === 'short') lenW = len > 28 ? 0.55 : 1.12;
    if (A.tactics.passing === 'direct') lenW = len > 28 ? 1.6 : 0.85;
    if (ment < 0 && len > 28) lenW *= 1.25;      // bloc bas : on dégage le jeu loin devant
    // Garder le ballon a de la valeur en soi : une passe sûre à un partenaire démarqué, même
    // en retrait ou en largeur, permet de faire tourner et d'attendre l'ouverture.
    let free = 99;
    for (const o of this.players.values()) if (o.side !== A.side) free = Math.min(free, Math.hypot(this.X(o) - tx, this.Y(o) - ty));
    const styleK = { short: 1.7, mid: 1, direct: 0.45 }[A.tactics.passing] ?? 1;
    const mood = this.tacticalMood(A);
    const keep = TUNE.keepW * styleK * (1 + ment * 0.15) * clamp((free - 2) / 6, 0, 1) * (mood.counter ? 0.3 : 1) * (mood.wasting ? 1.8 : 1);
    // Couloir privilégié (gauche / axe / droite, du point de vue de l'équipe qui attaque).
    const rel = A.side === 0 ? ty / W : 1 - ty / W;
    const lane = { left: rel < 0.36 ? 1.18 : rel > 0.64 ? 0.9 : 1, right: rel > 0.64 ? 1.18 : rel < 0.36 ? 0.9 : 1, center: rel > 0.3 && rel < 0.7 ? 1.14 : 0.94 }[A.tactics.focus] || 1;
    // Contre-attaque : on cherche la profondeur tout de suite.
    const fwd = ((tx - sx) * dir) > 6 ? (mood.counter ? 1.18 : 1) : 1;
    // Plus la passe recule, moins elle vaut (et encore moins dans le dernier tiers).
    // Centre en retrait : du bord de la surface, près de la ligne de but, vers le point de penalty
    // (l'arme la plus dangereuse du football moderne) — ce recul-là est recherché.
    const gxA = this.goalX(A.side);
    const cutback = Math.abs(gxA - sx) < 16 && Math.abs(sy - W / 2) > 8 && Math.abs(gxA - tx) > 6 && Math.abs(gxA - tx) < 17 && Math.abs(ty - W / 2) < 10 && !lofted;
    const backK = cutback || back <= 18 || ownHalf ? 1 : Math.exp(-(back - 18) / (pressed ? 14 : 8));
    // Une-deux : le passeur qui a redoublé sa course est cherché en priorité s'il est démarqué.
    const oneTwo = r.goRun && this.now < r.goRun.until && ((tx - sx) * dir) > 2 ? 2.4 : 1;
    // Garder le ballon vaut moins s'il faut reculer pour ça : une passe en retrait se justifie pour
    // sortir de la pression, pas comme réflexe (sinon on joue « à l'envers » sans arrêt).
    const keepDir = cutback ? 1 : back > 3 ? Math.exp(-(back - 3) / (pressed ? 11 : TUNE.backKeep)) : 1;
    // Urgence : après une longue série de passes sans résultat, l'équipe cherche à faire la
    // différence (profondeur, dernier tiers) plutôt que de faire tourner indéfiniment.
    const urg = Math.min(1, Math.max(0, (A.seqN || 0) - 10) / 15);
    const val = (this.threat(A.side, tx, ty) * (1 + ment * 0.05) * fwd * (cutback ? 2.1 : 1) * oneTwo * (1 + urg * 0.4) + keep * backK * keepDir * (1 - urg * 0.3)) * lenW * dirW * lane;
    // Perdre le ballon coûte la valeur de la possession actuelle + le danger d'une contre-attaque.
    const danger = this.threat(1 - A.side, worst ? worst.x : tx, worst ? worst.y : ty) + this.threat(A.side, sx, sy) * 1.4 + 0.012;
    // Les équipes jouent surtout à ras de terre : le long ballon reste un choix (consigne « direct »).
    // (seulement les longs ballons de construction : centres et appels dans le dernier tiers restent normaux)
    const loftPen = lofted && Math.abs(this.goalX(A.side) - sx) > 40 ? TUNE.loftPen * ({ direct: 0.35, short: 1.8 }[A.tactics.passing] ?? 1) : 0;
    // Renversement : un vrai choix quand le côté opposé est libre, pas un réflexe à chaque ballon.
    const switchPen = lofted && Math.abs(ty - sy) > 28 ? (free > 10 ? 0.015 : 0.03) : 0;
    return { k: 'pass', u: p * val - (1 - p) * danger * TUNE.lossW + 0.003 - loftPen - switchPen, r, tx, ty, p, lofted, through, worst, offside, cutback };
  }

  /** Le receveur est-il hors-jeu (dans le camp adverse, devant le ballon et l'avant-dernier défenseur) ? */
  isOffside(h, r) {
    const dir = this.dir(h.side);
    const rx = this.X(r) * dir;
    if ((this.X(r) - L / 2) * dir <= 0) return false; // dans son camp : jamais hors-jeu
    if (rx <= this.P.x * dir) return false;
    const defs = this.list(1 - h.side).map((p) => this.X(p) * dir).sort((a, b) => b - a);
    const second = defs[1] ?? -Infinity;
    const trap = this.m.teams[1 - h.side].tactics.offsideTrap === 'on';
    return rx > second + (trap ? -0.9 : 0.4);
  }

  doPass(h, o, out) {
    const m = this.m, A = h.team, P = this.P;
    this.releaseBall(h);
    A.stats.passes++; h.mp.passes++;
    A.seqN = (A.seqN || 0) + 1;
    // Hors-jeu : sifflé au départ du ballon (l'assistant lève son drapeau).
    if (o.offside && this.rand() < (this.m.teams[1 - A.side].tactics.offsideTrap === 'on' ? 0.97 : 0.85)) {
      A.stats.offsides++;
      this.kickBall(h, o.tx, o.ty, o.lofted);
      emit(m, out, { type: 'offside', side: A.side, pid: o.r.mp.id, x: o.tx / L, y: o.ty / W, zone: m.zone });
      this.setRestart('freekick', 1 - A.side, this.X(o.r), this.Y(o.r));
      return;
    }
    // Étape 4c : aucune issue n'est tirée d'avance. L'erreur d'exécution est calculée à l'instant
    // du contact pied-ballon et dévie la frappe ; la trajectoire physique décide ensuite qui
    // atteint le ballon (destinataire, défenseur qui coupe, ou personne).
    const aim = { x: o.tx, y: o.ty };
    const ex = this.passExec(h, aim, o.lofted, o.through);
    const T = this.kickBall(h, ex.x, ex.y, o.lofted);
    const to = o.r;
    const pd = this.pending = { kind: 'pass', to, from: h, fromX: P.x, fromY: P.y, t0: this.now, T, through: o.through, lofted: o.lofted, aim, err: ex };
    if (this.diag) {
      pd.rec = { pid: h.mp.id, side: A.side, to: to.mp.id, aim, exec: { x: ex.x, y: ex.y }, from: { x: P.x, y: P.y }, dAng: ex.dAng * 57.3, dLen: ex.dLen, sAng: ex.sAng * 57.3, k: ex.k, weak: ex.weak, lofted: !!o.lofted, through: !!o.through, len: ex.len, pas: eff(h.mp, 'pas'), pressure: ex.pressure, speed: ex.speed, turn: ex.turn, awk: ex.awk, interceptors: [], outcome: null };
      this.diag.pass(this.now, pd.rec);
    }
    this.want(to, 'reception', 'receveur', PRI.BALLON, 'receveur', aim.x, aim.y, 1, { ttl: 0.3, end: () => this.pending !== pd });   // fin : la passe est jouée, coupée ou perdue
    m.lastPasser = h.mp;
    if (!o.lofted) this.planGiveGo(h, to, aim.x, aim.y);
    if (o.lofted || o.through) emit(m, out, { type: o.lofted ? 'longpass' : 'pass', side: A.side, pid: h.mp.id, pid2: o.r.mp.id, x: aim.x / L, y: aim.y / W, zone: m.zone });
  }

  /**
   * Frappe réelle d'une passe (étape 4c) : à partir de la cible voulue, l'erreur technique du geste
   * (contact.js · passError) selon la technique, le pied utilisé, l'équilibre, la vitesse, la
   * pression, la distance et la difficulté. Renvoie le point réellement visé par la frappe.
   */
  passExec(h, aim, lofted, through) {
    const P = this.P, hm = this.posM(h);
    const dx = aim.x - P.x, dy = aim.y - P.y, len = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
    const sp = h.speed || 0, run = Math.atan2(h.vy || 0, h.vx || 0);
    const turn = sp > 0.5 ? Math.abs(Math.atan2(Math.sin(a - run), Math.cos(a - run))) : 0;
    const strong = this.footSign(h) > 0 ? 'R' : 'L';
    const weak = !h.throwIn && !!h.kickFoot && h.kickFoot !== strong;
    const rr = reachAt(hm, P, { parts: ['foot'] });
    const pl = h.mp.p || {}, awk = !!h._awk; h._awk = false;
    const e = passError({
      pas: eff(h.mp, 'pas'), vis: eff(h.mp, 'vis'), sf: eff(h.mp, 'sf'), wf: pl.wf ?? 3, weak, cons: pl.cons ?? 10,
      len, lofted, through, pressure: this.pressure(h), speed: sp, turn,
      stretch: Math.min(1, (rr ? rr.stretch : 1) + (awk ? 0.35 : 0)), ballRel: Math.hypot(P.vx - hm.vx, P.vy - hm.vy),
      rnd: [this.rand(), this.rand(), this.rand(), this.rand()],
    });
    const a2 = a + e.dAng, l2 = len * Math.max(0.4, 1 + e.dLen);
    return { x: P.x + Math.cos(a2) * l2, y: P.y + Math.sin(a2) * l2, len, ...e, weak, awk, pressure: this.pressure(h), speed: sp, turn };
  }

  /**
   * Pied utilisé pour un geste, choisi à l'armé selon le côté où se trouve le ballon : du côté
   * de son pied faible, il le joue du pied faible s'il en est capable (≥ 3 étoiles), sinon il le
   * joue maladroitement du bon pied (h._awk).
   */
  chooseFoot(h) {
    const P = this.P, c = Math.cos(h.face || 0), s = Math.sin(h.face || 0);
    const w = -(P.x - this.X(h)) * s + (P.y - this.Y(h)) * c;   // > 0 : ballon à sa gauche
    const strong = this.footSign(h) > 0 ? 'R' : 'L', weakSide = strong === 'R' ? w > 0.12 : w < -0.12;
    h._awk = false;
    if (!weakSide) return strong;
    if ((h.mp.p?.wf ?? 3) >= 3) return strong === 'R' ? 'L' : 'R';
    h._awk = true; return strong;
  }

  /**
   * Interceptions (étape 4c) : chaque adversaire qui a eu le temps de RÉAGIR au départ de la passe
   * calcule, avec ses propres capacités (vitesse, accélération, demi-tour, saut), le premier point
   * de la trajectoire prédite qu'il peut atteindre à temps. Les deux qui y arrivent le plus tôt —
   * et pas nettement après le destinataire — s'y lancent. Rien n'est décidé ici : c'est le contact
   * réel (passContact) qui tranche, et un défenseur peut arriver trop tard ou rater le ballon.
   */
  planInterceptors(pd, path, rPlan) {
    const tr = rPlan && !rPlan.late ? rPlan.t : 99, el = this.now - pd.t0;
    const cand = [];
    for (const o of this.players.values()) {
      if (o.side === pd.from.side || o.fall > 0.3 || o.slide > 0.2) continue;
      if (o.gk && !this.inOwnBox(o)) continue;
      const rt = this.reactT(o, pd.fromX, pd.fromY) + (pd.reactPlus || 0);
      if (el < rt) continue;                                   // il n'a pas encore « lu » la passe
      const ip = interceptPlan(this.posM(o), path, { ...this.reachOpts(o), react: 0.05, slack: 0.3, gk: o.gk && this.inOwnBox(o) });
      if (ip && ip.t < tr + 0.2) cand.push({ p: o, x: ip.x, y: ip.y, t: ip.t, abs: this.now + ip.t, margin: ip.margin, part: ip.part });
    }
    cand.sort((a, b) => a.t - b.t || a.p.mp.id - b.p.mp.id);
    pd.cuts = cand.slice(0, 2);
    // Ballon aérien : le défenseur le plus proche du point de réception va disputer le ballon au
    // receveur (côté but, au contact), même s'il ne peut pas y arriver avant lui.
    if (pd.lofted && rPlan && !rPlan.late) {
      let ch = null, cd = 7;
      for (const o of this.players.values()) { if (o.side === pd.from.side || o.gk || pd.cuts.some((c) => c.p === o)) continue; const d = Math.hypot(this.X(o) - rPlan.x, this.Y(o) - rPlan.y); if (d < cd) { cd = d; ch = o; } }
      if (ch) { const goalSide = this.goalX(pd.from.side) === L ? 0.5 : -0.5; pd.cuts.push({ p: ch, x: rPlan.x + goalSide, y: rPlan.y, t: rPlan.t, abs: this.now + rPlan.t, margin: 0, part: rPlan.part, challenge: true }); }
    }
    // Centre : les partenaires du destinataire dans la surface attaquent aussi le ballon.
    if (pd.cross) {
      const runs = [];
      for (const o of this.players.values()) {
        if (o.side !== pd.from.side || o === pd.to || o === pd.from || o.gk || o.fall > 0.3) continue;
        if (Math.abs(this.X(o) - this.goalX(o.side)) > 20) continue;
        const ip = interceptPlan(this.posM(o), path, { ...this.reachOpts(o), react: Math.max(0, 0.18 - el), slack: 0.3 });
        if (ip) runs.push({ p: o, x: ip.x, y: ip.y, t: ip.t, abs: this.now + ip.t, margin: ip.margin, part: ip.part });
      }
      runs.sort((a, b) => a.t - b.t || a.p.mp.id - b.p.mp.id);
      pd.cuts.push(...runs.slice(0, 2));
    }
    if (pd.rec) for (const c of pd.cuts) if (!pd.rec.interceptors.some((x) => x.pid === c.p.mp.id)) pd.rec.interceptors.push({ pid: c.p.mp.id, eta: +(el + c.t).toFixed(2), margin: +c.margin.toFixed(2), x: c.x, y: c.y });
    if (this.diag) for (const c of pd.cuts) this.diag.plan(this.now, { pid: c.p.mp.id, side: c.p.side, x: c.x, y: c.y, z: 0, part: c.part, eta: c.t, margin: c.margin, cut: true });
  }

  /** Temps de réaction d'un joueur au départ d'une passe adverse (lecture du jeu, orientation). */
  reactT(p, fromX, fromY) {
    let t = 0.38 - eff(p.mp, 'def') / 500 - eff(p.mp, 'vis') / 1000;
    const toB = Math.atan2(fromY - this.Y(p), fromX - this.X(p));
    if (Math.cos(toB - (p.face || 0)) < -0.2) t += 0.15;   // passe jouée dans son dos : il doit d'abord la voir
    return Math.max(0.12, t);
  }

  /**
   * « Passe et va » : après une passe courte vers l'avant, le passeur ne regarde pas, il file
   * dans le dos de son adversaire pour offrir le une-deux (ou devenir le troisième homme).
   */
  planGiveGo(h, r, tx, ty) {
    const A = h.team, dir = this.dir(A.side), pos = A.slots[h.mp.slot]?.pos;
    if (!pos || pos === 'GB' || pos === 'DC') return;
    const hx = this.X(h), hy = this.Y(h);
    if ((dir > 0 ? hx : L - hx) < L * 0.35 || Math.hypot(tx - hx, ty - hy) > 24 || (tx - hx) * dir < -2) return;
    if ((h.mp.id + Math.floor(this.now * 2)) % 3 === 0) return; // pas à chaque passe
    const deep = Math.max(-Infinity, ...this.list(1 - A.side).filter((p) => !p.gk).map((p) => this.X(p) * dir));
    const off = Math.max(deep, tx * dir) - 0.5;
    const gx = Math.min(Math.max(hx * dir + 11, tx * dir + 5), off);
    if (gx < hx * dir + 4) return; // pas d'espace devant lui
    const gy = clamp(ty + (hy - ty) * 0.4 + (W / 2 - ty) * 0.15, 3, W - 3);
    h.goRun = { until: this.now + 4.2, x: clamp(gx * dir, 2, L - 2), y: gy };   // assez long pour que le receveur contrôle et remise
  }

  /** Frappe le ballon vers (tx, ty) : au sol, ou en l'air. Retourne la durée du trajet. */
  kickBall(h, tx, ty, lofted, z = null) {
    const P = this.P;
    // Plus aucun recalage : le ballon part de là où il est réellement (étape 4b-2).
    const len = Math.hypot(tx - P.x, ty - P.y);
    if (h.throwIn > 0) P.z = 2.0;                       // touche : le ballon part des mains, au-dessus de la tête
    else if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = lofted ? 0.85 : 0.5; h.kickSide = !lofted; h.kickLoft = lofted; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; }
    h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side;
    this._kickBy = h; this._kickT = this.now;   // le tireur ne peut pas reprendre son propre ballon tout de suite
    this._lastToucher = h; this._deflect = false;
    P.inGoal = 0; P.hitPost = false;
    this.gest.contact(h, h.throwIn > 0 ? 'lancer' : 'frappe', h.throwIn > 0 ? 'mains' : 'pied', { reflex: h.throwIn > 0 ? 'touche' : lofted ? 'passe levée' : 'passe', foot: h.throwIn > 0 ? null : h.kickFoot, anim: h.throwIn > 0 ? null : { timer: 'kick', dur: (h.kickMax || 0.32) * GS, at: 0.55 }, src: 'kickBall' });
    const T = !lofted ? solveKick(P, { x: tx, y: ty }, { mode: 'ground', arrive: Math.min(12, 6 + len * 0.16) })
      : solveKick(P, { x: tx, y: ty, z: z ?? (0.4 + this.rand() * 1.1) }, { T: 0.9 + len / 30, spin: h.throwIn > 0 ? 0 : this.footSign(h) * (0.5 + this.rand() * 3.5), top: h.throwIn > 0 ? 0 : 2.2 }); // longue passe : brossée de l'intérieur, rétro (elle « tient » en l'air)
    if (this.diag) this.diag.path(this.now, ballPath(P, predict, { horizon: Math.min(3, T + 1), step: 0.1 }).map((q) => ({ x: q.x, y: q.y, z: q.z })), h.mp.id);
    return T;
  }

  releaseBall(h) {
    if (h.prep) this.gest.finish(h, 'interrompu', 'ballon perdu pendant l\'armé', true);   // (descriptif : l'armé en cours ne sera pas exécuté)
    if (this.holder === h) this.holder = null;
    this.inHands = false;
    h.carry = null; h.prep = null;
  }

  doCross(h, r, out) {
    const m = this.m, A = h.team, P = this.P;
    this.releaseBall(h);
    A.stats.passes++; h.mp.passes++;
    const gx = this.goalX(A.side), dir = this.dir(A.side);
    const tx = clamp(this.X(r) + dir * 1, gx - dir * 14, gx - dir * 4), ty = clamp(this.Y(r), W / 2 - 9, W / 2 + 9);
    const vy = ty - P.y, swing = this.rand() < 0.65 ? 1 : -1;
    if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = 0.85; h.kickLoft = true; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; } h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side; this._lastToucher = h; this._deflect = false;
    const len = Math.hypot(tx - P.x, ty - P.y);
    // Centre brossé de l'intérieur du pied (rentrant ou sortant selon le pied et le côté), parfois de l'extérieur.
    const cf = this.footSign(h) * (this.rand() < 0.15 && eff(h.mp, 'pas') >= 76 ? -0.8 : 1);
    // Étape 4c : précision du centre au contact (même modèle que les passes, geste aérien) ; aucun
    // duel aérien n'est tranché d'avance : attaquants, défenseurs et gardien vont au ballon selon
    // leurs capacités, et le premier contact réel l'emporte.
    const P0 = { x: P.x, y: P.y };
    const ex = this.passExec(h, { x: tx, y: ty }, true, false);
    this.gest.contact(h, 'frappe', 'pied', { reflex: 'centre', foot: h.kickFoot, anim: { timer: 'kick', dur: h.kickMax * GS, at: 0.55 }, src: 'centre' });
    const T = solveKick(P, { x: ex.x, y: ex.y, z: 1.8 + this.rand() * 0.5 }, { T: 0.95 + len / 32, spin: cf * (7 + this.rand() * 5) * (swing > 0 ? 1 : 0.6), top: 1.2 });
    const D = m.teams[1 - A.side];
    // Coup de pied arrêté : une combinaison travaillée surprend l'organisation défensive adverse —
    // elle retarde la lecture des défenseurs (temps de réaction), elle ne choisit pas le vainqueur.
    const spE = this._spAim ? setPieceEdge(A.setPlan || setPlanOf(), D.setPlan || setPlanOf(), this._spAim, A.cpaCoach, D.cpaCoach) : 0;
    this._spAim = null;
    const pd = this.pending = { kind: 'pass', cross: true, aerial: true, lofted: true, to: r, from: h, fromX: P0.x, fromY: P0.y, t0: this.now, T, aim: { x: tx, y: ty }, err: ex, reactPlus: clamp(spE * 0.25, -0.1, 0.25) };
    if (this.diag) {
      pd.rec = { pid: h.mp.id, side: A.side, to: r.mp.id, aim: { x: tx, y: ty }, exec: { x: ex.x, y: ex.y }, from: P0, dAng: ex.dAng * 57.3, dLen: ex.dLen, sAng: ex.sAng * 57.3, k: ex.k, weak: ex.weak, lofted: true, cross: true, through: false, len: ex.len, pas: eff(h.mp, 'pas'), pressure: ex.pressure, speed: ex.speed, turn: ex.turn, awk: ex.awk, interceptors: [], outcome: null };
      this.diag.pass(this.now, pd.rec);
      this.diag.path(this.now, ballPath(P, predict, { horizon: Math.min(3, T + 1), step: 0.1 }).map((q) => ({ x: q.x, y: q.y, z: q.z })), h.mp.id);
    }
    this._kickBy = h; this._kickT = this.now;
    this.want(r, 'reception', 'receveur', PRI.BALLON, 'receveur', tx, ty, 1, { ttl: 0.3, end: () => this.pending !== pd });
    m.lastPasser = h.mp;
    emit(m, out, { type: 'cross', side: A.side, pid: h.mp.id, pid2: r.mp.id, x: tx / L, y: ty / W, zone: 3 });
  }

  doClear(h, out) {
    const A = h.team, dir = this.dir(A.side);
    this.releaseBall(h);
    // Dégagement dans l'urgence : parfois derrière sa propre ligne (corner).
    if (this.pressure(h) < 2 && this.rand() < TUNE.clearCorner) {
      const own = this.goalX(1 - A.side);
      this.kickBall(h, own - dir * 3, this.Y(h) < W / 2 ? 6 : W - 6, true, 1.2);
      this.pending = null;
      emit(this.m, out, { type: 'clearance', side: A.side, pid: h.mp.id, x: this.P.x / L, y: this.P.y / W, zone: this.m.zone });
      return;
    }
    const wideSide = this.Y(h) < W / 2 ? -1 : 1;
    const toTouch = Math.abs(this.Y(h) - W / 2) > 12 && this.rand() < 0.45;   // « en touche ! » (dans l'urgence)
    const tx = clamp(this.X(h) + dir * (toTouch ? 20 + this.rand() * 15 : 35 + this.rand() * 20), 5, L - 5);
    const ty = toTouch ? W / 2 + wideSide * (W / 2 + 6) : clamp(this.Y(h) + (this.rand() - 0.5) * 40, 3, W - 3);
    this.kickBall(h, tx, ty, true, BR);
    this.pending = null;
    emit(this.m, out, { type: 'clearance', side: A.side, pid: h.mp.id, x: tx / L, y: ty / W, zone: this.m.zone });
  }

  /* ---------------- Tirs ---------------- */

  /** xG géométrique : angle d'ouverture du but, distance, pression, qualité du tireur. */
  xg(h, kind) {
    const m = this.m, gx = this.goalX(h.side);
    const x = this.X(h), y = this.Y(h);
    const dx = Math.abs(gx - x), dy = y - W / 2;
    const d = Math.hypot(dx, dy);
    const a1 = Math.atan2(dy + GOAL_HALF, dx), a2 = Math.atan2(dy - GOAL_HALF, dx);
    const ang = Math.abs(a1 - a2);
    let xg = TUNE.xg * 0.9 * (1 - Math.exp(-ang * 1.35)) * Math.exp(-Math.max(0, d - 5) * 0.075);
    if (kind === 'header') xg *= 0.55;
    if (kind === 'penalty') return 0.76;
    if (kind === 'freekick') xg = Math.min(0.09, xg * 0.6);
    const pr = this.pressure(h);
    if (pr < 1.5) xg *= 0.55; else if (pr < 3) xg *= 0.8;
    const q = (eff(h.mp, 'tir') * 0.7 + eff(h.mp, 'sf') * 0.3) / (m.level - 8);
    // De loin, la qualité du tireur pèse beaucoup plus (frappe, technique) qu'à bout portant.
    xg *= Math.pow(q, d > 16.5 ? 1.8 : 1.0) * (m.profile.goals || 1);
    return clamp(xg, 0.005, 0.8);
  }

  /**
   * Technique de frappe, comme un vrai joueur : plat du pied placé près du but, lob si le
   * gardien est avancé, frappe du cou-de-pied (puissante) de plus loin.
   */
  shotTech(h) {
    const gx = this.goalX(h.side), x = this.X(h), y = this.Y(h);
    const d = Math.hypot(gx - x, W / 2 - y);
    const gk = this.list(1 - h.side).find((p) => p.gk);
    const gkOut = gk ? Math.abs(this.X(gk) - gx) : 0;
    if (gk && gkOut > 7 && d > 12 && d < 30 && eff(h.mp, 'tir') + eff(h.mp, 'sf') > 110) return 'chip';
    if (d < 17) return 'finesse';
    if (d < 23 && Math.abs(y - W / 2) > 6 && this.rand() < 0.5) return 'curl';
    return 'drive';
  }

  doShot(h, kind, out) {
    if (kind === 'freekick') for (const p of this._wall || []) { p.jump = 0.45; this.gest.begin(p, 'saut', { anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: 'mur' }); }   // le mur saute
    const m = this.m, A = h.team, D = m.teams[1 - A.side], P = this.P;
    const gx = this.goalX(A.side), gdir = this.dir(A.side), cy = W / 2;
    const xg = this.xg(h, kind);
    this.releaseBall(h);
    const gk = this.list(D.side).find((p) => p.gk);
    // Traits du tireur et du gardien.
    const dShot = Math.hypot(gx - this.X(h), cy - this.Y(h));
    let tb = 1;
    if (kind === 'penalty') tb *= TR(h, 'tueur') ? 1.12 : 1;   // (traits du gardien : réflexes et portée, voir gkSkill / plongeon)
    else if (kind === 'freekick') tb *= TR(h, 'coupsfrancs') ? 1.6 : 1;
    else if (kind === 'header') tb *= TR(h, 'tete') || TR(h, 'tour') ? 1.18 : 1;
    else { if (dShot > 18 && TR(h, 'sniper')) tb *= 1.3; if (dShot <= 16 && TR(h, 'renard')) tb *= 1.15; if (xg > 0.25 && TR(h, 'tueur')) tb *= 1.1; }
    // Joueurs importés : penalty / coup franc selon leur note détaillée (12/20 = neutre).
    if (kind === 'penalty' && det20(h.mp, 11)) tb *= clamp(1 + (det20(h.mp, 11) - 12) * 0.012, 0.9, 1.1);
    if (kind === 'freekick' && det20(h.mp, 5)) tb *= clamp(1 + (det20(h.mp, 5) - 12) * 0.05, 0.7, 1.4);
    if (TR(h, 'clutch') && m.minute >= 75) tb *= 1.08;
    // Mauvais pied : environ une frappe sur trois part du pied faible ; 1 étoile = gros handicap, 5 = aucun.
    A.stats.shots++; h.mp.shots++;
    A.stats.xg += xg;
    m.xgTimeline.push({ minute: m.minute, extra: m.extra, side: A.side, xg, goal: false });
    momentum(m, A.side, 4 + xg * 30);
    // Étape 4d : AUCUNE issue n'est tirée d'avance. Le tireur CHOISIT un point du but (côté,
    // hauteur, marge au poteau selon sa technique), l'erreur d'exécution au contact dévie la
    // frappe, puis la physique décide : poteau, à côté, contre, gardien (qui doit réellement
    // intercepter la trajectoire), ou but.
    const r1 = this.rand(), r2 = this.rand(), r3 = this.rand();
    const tech = kind === 'open' ? (h.shotTech || this.shotTech(h)) : kind;
    h.shotTech = null;
    // Côté visé : plutôt le petit filet opposé (« ouvrir le pied ») quand on frappe de biais ; à
    // l'opposé du gardien s'il est décalé.
    const gkY = gk ? this.Y(gk) : cy;
    let far = -Math.sign(this.Y(h) - cy || 1);
    if (gk && Math.abs(gkY - cy) > 0.8) far = -Math.sign(gkY - cy);
    const side = r2 < (tech === 'finesse' || tech === 'curl' ? 0.7 : 0.6) ? far : -far;
    // Vitesses réelles de frappe : plat du pied ~70 km/h, enroulée ~80, frappe en force 75-100 km/h.
    // Tête : la vitesse vient du cou, du corps et du ballon reçu ; la qualité du contact compte.
    const headSp = kind === 'header' ? clamp(5 + eff(h.mp, 'phy') / 14 + (h._headIn || 10) * 0.3, 8, 19) : 13;
    let speed = { penalty: 24, header: headSp, freekick: 23, finesse: 18 + r1 * 4, curl: 20 + r1 * 4, chip: 15, drive: 21 + r1 * 7 }[tech] || 22;
    // Effet selon le PIED : l'intérieur du pied droit enroule de droite à gauche (rotation
    // positive), l'extérieur (« trivela ») dans l'autre sens ; c'est l'inverse pour un gaucher.
    const need = -side * gdir;                       // sens d'enroulé qui ramène le ballon vers le cadre
    const foot = this.footSign(h);                   // +1 droitier, -1 gaucher
    const skill = eff(h.mp, 'tir') * 0.5 + eff(h.mp, 'dri') * 0.5;
    let spin = 0, top = 0, knuckle = 0, how = '', weak = false;
    if (kind === 'freekick') {
      if (r1 < 0.22 && eff(h.mp, 'tir') >= 72) { knuckle = 1 + r3 * 5; speed = 28 + r2 * 4; top = 0; how = 'flottante'; } // frappe flottante « à la Juninho »
      else { spin = foot * (8 + r3 * 4); top = -3; how = 'enroulée'; }
    } else if (tech === 'curl' || tech === 'finesse') {
      const mag = tech === 'curl' ? 9 + r3 * 4 : 4 + r3 * 3;
      if (need === foot) { spin = need * mag; how = 'intérieur du pied'; }
      else if (skill >= 74 && r1 < 0.45) { spin = need * mag * 0.8; how = 'extérieur du pied'; } // trivela
      else if ((h.mp.p?.wf ?? 3) >= 4) { spin = need * mag * 0.85; how = 'pied faible'; weak = true; h.kickFoot = h.kickFoot === 'L' ? 'R' : 'L'; } // bon pied faible : il enroule de l'autre pied
      else { spin = foot * mag * 0.35; how = 'mauvais pied'; }    // ouvre moins, finit souvent à côté
    } else if (tech === 'drive') {
      if (r1 < 0.18 && speed > 25) { knuckle = 1 + r3 * 5; how = 'flottante'; }
      else { spin = foot * (r3 - 0.3) * 3; top = r1 < 0.5 ? -2.5 : 1; how = top < 0 ? 'qui plonge' : 'sèche'; }
    } else if (tech === 'chip') top = -4;
    h.lastHow = how;
    if (how === 'extérieur du pied') { h.kickSide = false; h.kickOut = 0.35; }
    // Point visé : marge au poteau et hauteur selon le geste et la technique (les meilleurs visent
    // plus près du poteau) ; le lob vise au-dessus du gardien.
    const low = r1 < (tech === 'finesse' ? 0.75 : 0.55);
    const margin = clamp(1.15 - eff(h.mp, 'tir') / 110 + (kind === 'header' ? 0.3 : 0), 0.3, 1.2) + r3 * 0.4;
    const aimZ = tech === 'chip' ? 1.6 + r1 * 0.5 : kind === 'header' ? (low ? 0.3 : 1.5) : low ? 0.2 + r3 * 0.35 : 1.4 + r3 * 0.6;
    const aim = { x: gx + gdir * 0.3, y: cy + side * (GOAL_HALF - margin), z: aimZ };
    // Erreur d'exécution au contact (contact.js · shotError).
    const sp = h.speed || 0, run = Math.atan2(h.vy || 0, h.vx || 0), ang0 = Math.atan2(aim.y - P.y, aim.x - P.x);
    const rr = reachAt(this.posM(h), P, { phy: h.mp?.p?.attrs?.phy });
    const ex = shotError({ tir: eff(h.mp, 'tir'), sf: eff(h.mp, 'sf'), wf: h.mp.p?.wf ?? 3, weak: weak || how === 'mauvais pied', tech, pressure: this.pressure(h),
      speed: sp, turn: sp > 0.5 ? Math.abs(Math.atan2(Math.sin(ang0 - run), Math.cos(ang0 - run))) : 0, stretch: kind === 'header' ? clamp(1 - (h._headQ ?? 0.5), 0, 1) : rr ? rr.stretch : 0.5,
      ballRel: Math.hypot(P.vx - (h.vx || 0), P.vy - (h.vy || 0)), tb, aim: m.wx?.aim ? 1 / m.wx.aim : 1, rnd: [this.rand(), this.rand(), this.rand(), this.rand()] });
    const dAim = Math.hypot(aim.x - P.x, aim.y - P.y);
    const a2 = ang0 + ex.dH;
    const tgt = { x: P.x + Math.cos(a2) * dAim, y: P.y + Math.sin(a2) * dAim, z: Math.max(0.1, aim.z + Math.tan(ex.dV) * dAim) };
    if (tech === 'chip') speed = Math.max(11, Math.hypot(tgt.x - P.x, tgt.y - P.y) / 1.5);
    if (kind === 'header') h.jump = 0.45; else if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = tech === 'drive' ? 1 : 0.8; h.kickSide = tech === 'finesse'; h.kickLoft = false; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; }
    h.lastTech = tech; h._headQ = null; h._headIn = null;
    h.face = Math.atan2(tgt.y - P.y, tgt.x - P.x);
    this.lastTouch = A.side; this._lastToucher = h; this._deflect = false;
    this._kickBy = h; this._kickT = this.now;
    P.inGoal = 0; P.hitPost = false;
    const d = Math.hypot(tgt.x - P.x, tgt.y - P.y, tgt.z - P.z);
    if (kind !== 'header') this.gest.contact(h, 'frappe', 'pied', { reflex: 'frappe', foot: h.kickFoot, anim: { timer: 'kick', dur: h.kickMax * GS, at: 0.55 }, src: 'tir' });
    const T = solveKick(P, tgt, { T: Math.max(0.25, d / speed), spin, top, knuckle });
    // Cadré ? (définition statistique : le ballon entrerait sans intervention d'un joueur)
    const c = cloneBall(P); let onTarget = false;
    for (let t = 0; t < 3.5 && !onTarget; t += 0.02) { stepBall(c, 0.02); if (c.inGoal) onTarget = true; if (c.x < -3 || c.x > L + 3 || c.y < -3 || c.y > W + 3) break; }
    this.shot = { side: A.side, shooter: h, gk, kind, xg, how, tech, t0: this.now, T, live: true, onTarget, aim, tgt, err: ex, post: false };
    this.pending = null;
    // Penalty : le gardien choisit son côté avant la frappe (il ne peut pas réagir à 11 m) — un pari,
    // pas une issue : s'il part du bon côté, ses mains doivent encore rencontrer le ballon.
    if (kind === 'penalty' && gk) {
      const g = this.rand(), guess = g < 0.42 ? -1 : g < 0.84 ? 1 : 0;
      if (guess) this.startDive(gk, guess, 0.4 + this.rand() * 1.2, diveRange(this.gkSkill(gk).agil) * (TR(gk, 'stoppeur') ? 1.1 : 1));
    }
    emit(m, out, { type: 'strike', side: A.side, pid: h.mp.id, kind, x: P.x / L, y: P.y / W, zone: 3 });
    if (this.diag) this.diag.path(this.now, ballPath(P, predict, { horizon: Math.min(3, T + 1), step: 0.05 }).map((q) => ({ x: q.x, y: q.y, z: q.z })), h.mp.id);
  }

  /** Un joueur ou le gardien a touché le tir en cours : il n'est plus « en vol libre ». */
  shotTouched(kind, p, result) {
    const s = this.shot;
    if (!s || s.resolved) return;
    s.live = false;
    if (kind === 'gk' && p.side !== s.side) s.gkTouch = s.gkTouch || { pid: p.mp.id, result };
    else if (p.side !== s.side && !s.gkTouch) s.block = s.block || { pid: p.mp.id };
  }

  /**
   * Issue d'un tir, constatée (jamais décidée) : but = le ballon a franchi la ligne (goal()) ;
   * sinon, dès que le ballon est sorti, contrôlé, capté ou retombé : arrêt (le gardien a touché un
   * tir cadré), contre, poteau ou à côté. Les statistiques et l'événement « tir » partent ici.
   */
  shotResolve(out) {
    const s = this.shot, P = this.P;
    if (!s || s.resolved) return;
    if (P.hitPost) s.post = true;
    const slow = Math.hypot(P.vx, P.vy, P.vz) < 3 && P.z < 0.5;
    const done = this.restart || this.inHands || (this.holder && this.now - s.t0 > 0.1) || this.now - s.t0 > 4 || (!s.live && slow) || (s.live && slow && this.now - s.t0 > 0.6);
    if (!done) return;
    const o = s.gkTouch && s.onTarget ? 'saved' : s.block ? 'blocked' : s.post ? 'post' : s.gkTouch ? 'wide' : s.onTarget ? 'saved' : 'wide';
    this.emitShot(s, o, out);
  }
  emitShot(s, o, out) {
    const m = this.m, A = m.teams[s.side], D = m.teams[1 - s.side], h = s.shooter;
    s.resolved = true; s.outcome = o;
    const ev = emit(m, out, { type: 'shot', side: A.side, pid: h.mp.id, xg: +s.xg.toFixed(2), kind: s.kind, zone: 3, outcome: o, x: s.tgt.x / L, y: s.tgt.y / W, how: s.how || undefined,
      ax: +(this.goalX(A.side) > L / 2 ? h.x : 1 - h.x).toFixed(3), ay: +(this.goalX(A.side) > L / 2 ? h.y : 1 - h.y).toFixed(3) });
    if (o === 'saved') { A.stats.onTarget++; D.stats.saves++; addRating(h.mp, 0.08); const gk = s.gkTouch ? this.players.get(s.gkTouch.pid) : s.gk; if (gk) { gk.mp.saves++; addRating(gk.mp, 0.2 + s.xg * 0.8); ev.pid2 = gk.mp.id; } }
    if (o === 'blocked' && s.block) { ev.pid2 = s.block.pid; const b = this.players.get(s.block.pid); if (b) addRating(b.mp, 0.08); }
    if (o === 'post') addRating(h.mp, 0.05);
    if (this.diag) this.diag.shot(this.now, { pid: h.mp.id, side: s.side, kind: s.kind, tech: s.tech, xg: s.xg, onTarget: s.onTarget, aim: s.aim, tgt: s.tgt, errH: s.err.dH * 57.3, errV: s.err.dV * 57.3, gk: s.gkTouch?.result || null, outcome: o });
    if (this.shot === s) this.shot = null;
  }

  /** But : score, buteur, passeur, notes, puis célébration et engagement. */
  goal(out, scoringSide = this.shot?.side) {
    const m = this.m;
    // Tir en cours de l'équipe qui marque : c'est son but (même dévié). Sinon, le dernier joueur à
    // avoir touché le ballon : un défenseur → but contre son camp.
    let s = this.shot && !this.shot.resolved && this.shot.side === scoringSide ? this.shot : null;
    if (this.shot && !this.shot.resolved && !s) this.emitShot(this.shot, 'blocked', out);
    const toucher = s ? s.shooter : this._lastToucher || [...this.players.values()].find((p) => p.side === scoringSide && !p.gk);
    const og = !s && toucher && toucher.side !== scoringSide;
    if (s) this.emitShot(s, 'goal', out);
    else s = { side: scoringSide, shooter: toucher, kind: og ? 'og' : 'open', gk: this.list(1 - scoringSide).find((p) => p.gk), how: og ? 'contre son camp' : undefined };
    const A = m.teams[s.side], D = m.teams[1 - s.side];
    const sc = s.shooter.mp;
    if (!og && s.kind !== 'og' && s.resolved) A.stats.onTarget++;
    m.score[s.side]++;
    if (og) addRating(sc, -0.5); else { sc.goals++; addRating(sc, 1.0); }
    const tl = m.xgTimeline[m.xgTimeline.length - 1];
    if (tl) tl.goal = true;
    const assist = !og && m.lastPasser && m.lastPasser !== sc && A.onPitch.includes(m.lastPasser) && s.kind !== 'penalty' && s.kind !== 'freekick' ? m.lastPasser : null;
    if (assist) { assist.assists++; addRating(assist, 0.6); }
    if (s.gk) addRating(s.gk.mp, -0.3);
    for (const mp of activePlayers(D)) if (['DC', 'DG', 'DD'].includes(D.slots[mp.slot].pos)) addRating(mp, -0.12);
    momentum(m, s.side, 18);
    m.stoppages += 0.6;
    m.goals.push({ side: s.side, pid: sc.id, name: og ? `${sc.name} (csc)` : sc.name, og: og || undefined, minute: m.minute, extra: m.extra, pen: s.kind === 'penalty', assist: assist ? assist.name : null });
    emit(m, out, { type: 'goal', side: s.side, pid: sc.id, pid2: assist ? assist.id : null, kind: s.kind, og: og || undefined, how: s.how || undefined, x: this.P.x / L, y: this.P.y / W, zone: 3 });
    // Célébration : le buteur file vers le poteau de corner, ses coéquipiers le rejoignent.
    const cx = s.side === 0 ? 0.97 : 0.03, cyy = this.P.y < W / 2 ? 0.06 : 0.94;
    // Chaque buteur a sa célébration fétiche (le plus souvent), parfois une autre.
    const CELEBS = ['plane', 'knees', 'fist', 'point', 'jump', 'slide', 'salute', 'ear', 'shush', 'heart', 'cool', 'badge', 'flex'];
    const cr = this.rand();
    const hero = og ? [...this.players.values()].filter((p) => p.side === s.side && !p.gk).sort((a, b) => this.dist(a, this.P.x, this.P.y) - this.dist(b, this.P.x, this.P.y))[0] : s.shooter;
    hero.celebType = CELEBS[cr < 0.6 ? (hero.mp.id * 7 + 3) % CELEBS.length : Math.floor(cr * CELEBS.length)];
    for (const p of this.players.values()) {
      if (p.side === s.side && !p.gk) {
        p.celeb = p === hero ? 3.2 : 2.6;
        // Les coéquipiers serrent le buteur dans leurs bras (ou sautent autour de lui).
        if (p !== hero) p.celebType = p.mp.id % 3 ? 'hug' : 'jump';
        this.setT(p, cx + (this.rand() - 0.5) * 0.05, cyy + (this.rand() - 0.5) * 0.08);
      }
    }
    this.holder = null; this.pending = null; this.shot = null; this.restart = null;
    this.celebrate = 4.5;
    this.afterGoalSide = 1 - s.side;
    // VAR : certains buts sont vérifiés après la célébration (hors-jeu, faute, main).
    if (m.varEnabled && s.kind !== 'penalty' && this.rand() < 0.07) {
      this.varPending = { side: s.side, sc, assist, cancel: this.rand() < 0.4, reason: ['offside', 'foul', 'hand'][Math.floor(this.rand() * 3)], x: this.P.x, y: this.P.y };
    }
  }

  /** Événement d'engagement (par le moteur classique : choix du joueur qui engage). */
  kickoffEvent(side) {
    const evs = [];
    engineKickoff(this.m, evs, side);
    return evs[0];
  }

  /* ---------------- Défense : duels ---------------- */

  /**
   * DÉFENSE SUR LE PORTEUR (étape 4e) — plus aucun tirage « à proximité ». Le défenseur au contact
   * lit le duel (5 fois par seconde) : où sera le ballon dans un instant, le porteur le protège-t-il
   * de son corps, le ballon est-il exposé (touche trop longue) ? S'il s'engage, son tacle (debout
   * ou glissé) suit une vraie trajectoire de corps et de pied ; seul le CONTACT réel décide : pied
   * sur le ballon (gagné, poussé, disputé), jambe sur le joueur (faute ou non), ou rien (raté).
   */
  updateDefense(dt, out) {
    const h = this.holder;
    if (!h || this.inHands) return;
    const m = this.m, D = m.teams[1 - h.side], P = this.P;
    const press = LVL[D.tactics.pressing] || 0, tk = TK[D.tactics.tackling] || 0;
    if ([...this.players.values()].some((o) => o._tk && o.side === D.side)) return;   // un engagement à la fois
    const hm = this.posM(h), hfx = hm.x + Math.cos(hm.face) * 0.32, hfy = hm.y + Math.sin(hm.face) * 0.32;
    const ownBox = Math.abs(P.x - this.goalX(h.side)) < 16.5 && Math.abs(P.y - W / 2) < 20.15;
    for (const o of this.list(D.side)) {
      if (o.gk && Math.abs(this.X(o) - this.goalX(h.side)) > 16) continue;
      if (o.fall > 0 || o.slide > 0 || (o._down || 0) > this.now || (o._feint || 0) > this.now) continue;   // au sol, engagé, ou pris à contre-pied
      if ((o._tkCool || 0) > this.now) continue;   // il vient de tacler : il se replace avant de se réengager
      if (this.now < (o._tkDecT || 0)) continue;
      const d = this.dist(o, P.x, P.y);
      if (d > 3.4) continue;
      if (o.role !== 'press' && o !== h.carry?.takeon?.def && d > 1.3 && !((o._stallPush || 0) > this.now)) continue;
      o._tkDecT = this.now + 0.2;
      const look = 0.22, bx = P.x + P.vx * look, by = P.y + P.vy * look;
      const ox = this.X(o), oy = this.Y(o), db = Math.hypot(bx - ox, by - oy);
      const shield = shields(ox, oy, bx, by, this.X(h), this.Y(h));
      const exposedD = Math.hypot(bx - hfx, by - hfy), exposed = exposedD > 0.75;   // ballon hors de portée du porteur
      // Course perdue : le porteur file vers le but, le défenseur est à côté / derrière lui.
      const gdx = this.goalX(h.side) - this.X(h), lost = (h.speed || 0) > 4 && ((this.X(o) - this.X(h)) * Math.sign(gdx)) < 0.3;
      let kind = null;
      if (!shield && db < 1.3) kind = 'stand';
      else if (!shield && exposedD > 1.0 && db >= 1.3 && db < 3.0) kind = 'slide';
      if (!kind) continue;
      // Envie de s'engager : consignes, lecture, ballon exposé ; sinon il temporise (il reste devant).
      const aggr = kind === 'slide'
        ? clamp(0.005 + tk * 0.01 + (lost ? 0.08 : 0) + (TR(o, 'rugueux') ? 0.02 : 0) - (ownBox ? 0.01 : 0), 0, 0.2)
        : clamp(0.06 + press * 0.04 + tk * 0.05 + (exposed ? 0.3 : 0) + (eff(o.mp, 'def') - 60) / 300
          + (TR(o, 'rugueux') ? 0.06 : 0) + ((o._stallPush || 0) > this.now ? 0.5 : 0) - (ownBox ? 0.05 : 0), 0.02, 0.9);
      if (this.rand() > aggr) continue;
      this.startTackle(o, kind, bx, by, h);
      return;
    }
  }

  /** Engagement d'un tacle : direction visée (avec l'erreur de lecture du défenseur), fente / glissade. */
  startTackle(o, kind, bx, by, h = null) {
    const ox = this.X(o), oy = this.Y(o), G = TACKLE[kind];
    const sk = (eff(o.mp, 'def') * 0.7 + eff(o.mp, 'vis') * 0.3) / 100;
    const err = 0.06 + (1 - clamp(sk, 0, 1)) * 0.18;   // à 1 m, un défenseur pose le pied à ~10-20 cm près
    const ex = gauss(this.rand(), this.rand()) * err, ey = gauss(this.rand(), this.rand()) * err;
    const tx = bx + ex, ty = by + ey, dd = Math.hypot(tx - ox, ty - oy) || 1;
    const Lg = kind === 'slide' ? clamp(dd - G.foot + 0.3, 0.8, G.lunge) : clamp(dd - G.foot, 0, G.lunge);
    o._tk = { kind, t0: this.now, x0: ox, y0: oy, ux: (tx - ox) / dd, uy: (ty - oy) / dd, L: Lg, err: Math.hypot(ex, ey), v0: Math.hypot(o.vx || 0, o.vy || 0), vdir: Math.atan2(o.vy || 0, o.vx || 0), target: h, ball: false, man: false };
    this.gest.begin(o, kind === 'slide' ? 'tacle (glissé)' : 'tacle (fente)', { anim: { timer: '_tk', dur: G.dur * GS, at: null }, src: 'tacle' });
    o.tk = kind; o.slide = G.dur; o.face = Math.atan2(o._tk.uy, o._tk.ux);
    o._tkCool = this.now + G.dur + (kind === 'slide' ? 2.2 : 1.6);
    o._tk.rec = this.diag ? { pid: o.mp.id, side: o.side, kind, vs: h?.mp.id ?? null, dist: +dd.toFixed(2), err: +o._tk.err.toFixed(2), result: 'raté' } : null;
    if (o._tk.rec) this.diag.duel(this.now, o._tk.rec);
  }
  /** Mouvement du corps pendant le tacle (fente ou glissade), puis relevé. */
  tackleStep(p, dt) {
    const k = p._tk, f = tackleFoot(k, this.now);
    if (f.done) { p._tk = null; p._down = this.now + (k.kind === 'slide' ? 0.45 : 0.12); p.vx = p.vy = 0; p.speed = 0; this.setT(p, p.x, p.y); return; }
    const x = clamp(f.bx, 0, L), y = clamp(f.by, 0, W);
    p.vx = (x - this.X(p)) / Math.max(dt, 1e-4); p.vy = (y - this.Y(p)) / Math.max(dt, 1e-4);
    p.x = x / L; p.y = y / W; this.setT(p, p.x, p.y); p.speed = Math.hypot(p.vx, p.vy); p.acc = 0;
  }

  /**
   * Contacts au sol pendant le pas (étape 4e), avec ou sans porteur :
   *  - pied d'un tacle sur le ballon / jambe d'un tacle sur le joueur, dans l'ordre où ils arrivent ;
   *  - défenseur qui « anticipe » une touche trop longue : le ballon, hors de portée du porteur,
   *    traverse sa zone d'atteinte — il le joue (il ne le reçoit jamais par simple proximité).
   */
  contestStep(dt, out) {
    const P = this.P, b0 = this._sw0;
    if (!b0) return;
    for (const o of this.players.values()) {
      const k = o._tk;
      if (!k || k.ball || k.man) continue;
      const f0 = tackleFoot(k, this.now - dt), f1 = tackleFoot(k, this.now);
      if (!f0.active && !f1.active) continue;
      const hb = sweptTackleBall(f0, f1, b0, P, TACKLE[k.kind].footR);
      let victim = null;
      for (const q of this.players.values()) if (q.side !== o.side && !(q.fall > 0) && legHits(f1, this.X(q), this.Y(q))) { victim = q; break; }
      if (hb) { k.ball = true; this.gest.contact(o, 'tacle (ballon)', 'jambe', { frac: hb.t ?? 1, src: 'tacle' }); this.tackleBall(o, k, hb, dt, out); if (victim && k.kind === 'slide') { victim.fall = Math.max(victim.fall || 0, 1.0); victim.cd = 1.5; } return; }
      if (victim) { k.man = true; this.tackleMan(o, k, victim, out); return; }
    }
    // Anticipation d'une mauvaise touche : ballon hors de portée du porteur, dans la zone d'un adversaire.
    const h = this.holder;
    // Ballon sous contrôle du porteur : dans la zone de son pied, ou dans ses pieds (même derrière lui,
    // quand il protège) — personne ne peut le lui prendre « en passant ».
    if (!h || this.inHands || h._reach || this.dist(h, P.x, P.y) < 0.6) return;
    for (const o of this.players.values()) {
      if (o.side === h.side || o._tk || o.fall > 0 || o.slide > 0 || (o._down || 0) > this.now || (o._nutmeg || 0) > this.now) continue;
      if (o.gk && this.gkHandsOk(o)) continue;
      if (this.dist(o, P.x, P.y) > 2.6) continue;
      // Il doit avoir eu le temps de réagir à la touche du porteur (sinon le porteur la reprend avant).
      if (this.now - (h._touchT ?? -9) < this.reactT(o, this.X(h), this.Y(h))) continue;
      const hit = this.sweepContact(o, LOOSE_PARTS);
      if (!hit || hit.reach.part === 'head') continue;
      const t = this.controlTouch(o, hit, 'récupération', dt);
      if (!this.keepsBall(h)) { this.releaseBall(h); this.pending = null; }
      if (this.keepsBall(o)) {
        emit(this.m, out, { type: 'interception', side: o.side, pid: o.mp.id, pid2: h.mp.id, x: P.x / L, y: P.y / W, zone: this.m.zone });
        this.gain(o, out, true);
      }
      if (this.diag) this.diag.duel(this.now, { pid: o.mp.id, side: o.side, kind: 'ballon chipé', vs: h.mp.id, q: +t.q.toFixed(2), result: this.holder === o ? 'ballon gagné' : 'ballon touché', since: +(this.now - (h._touchT ?? -9)).toFixed(2), sinceGain: +(this.now - (h._gotT ?? -9)).toFixed(2), hd: +this.dist(h, P.x, P.y).toFixed(2), hsp: +(h.speed || 0).toFixed(1), prep: !!h.prep });
      return;
    }
  }

  /** Le pied du tacle a touché le ballon : lutte physique avec le porteur, puis effet sur le ballon. */
  tackleBall(o, k, hb, dt, out) {
    const P = this.P, h = this.holder && this.holder.side !== o.side ? this.holder : null, G = TACKLE[k.kind];
    const f = tackleFoot(k, this.now);
    const runDiff = Math.abs(Math.atan2(Math.sin(k.vdir - Math.atan2(k.uy, k.ux)), Math.cos(k.vdir - Math.atan2(k.uy, k.ux))));
    const balance = k.v0 < 1 ? 1 : 1 - (runDiff / Math.PI) * Math.min(1, k.v0 / 5) - Math.max(0, k.v0 - 6) * 0.05;
    const q = tackleQuality({ def: eff(o.mp, 'def') + (TR(o, 'roc') ? 8 : 0), phy: eff(o.mp, 'phy'), timing: k.err * 0.6, stretch: Math.min(1, f.t / G.t1) * 0.5, balance, slide: k.kind === 'slide' });
    // Le porteur dispute-t-il le ballon au même instant (ballon dans sa zone d'atteinte) ?
    let grip = 0;
    if (h) {
      const rr = reachAt(this.posM(h), P, { parts: ['foot'] });
      if (rr) grip = clamp((eff(h.mp, 'dri') * 0.6 + eff(h.mp, 'phy') * 0.25 + eff(h.mp, 'sf') * 0.15) / 100 - rr.stretch * 0.3 + (h.shieldK ? 0.1 : 0) + (TR(h, 'magicien') ? 0.1 : 0), 0, 1);
    }
    const win = q - grip * 0.45 + gauss(this.rand(), this.rand()) * 0.18;
    const B = hb.ball;
    Object.assign(P, { x: B.x, y: B.y, z: BR });
    let res;
    if (win > 0.2) {
      if (k.kind === 'stand' && win > 0.33) {
        // Il impose son pied et garde le ballon : ramené devant lui.
        const ax = this.X(o) - B.x, ay = this.Y(o) - B.y, al = Math.hypot(ax, ay) || 1;
        P.vx = (o.vx || 0) * 0.5 + (ax / al) * 1.2; P.vy = (o.vy || 0) * 0.5 + (ay / al) * 1.2; res = 'ballon gagné';
      } else {
        const a = Math.atan2(k.uy, k.ux) + gauss(this.rand(), this.rand()) * (0.25 + (1 - q) * 0.5), v = k.kind === 'slide' ? 5 + q * 4 : 3 + q * 3;
        P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; res = 'ballon poussé';
      }
    } else if (win > -0.1) {
      const a = this.rand() * Math.PI * 2, v = 2.5 + this.rand() * 3;
      P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; res = 'ballon disputé';
    } else {
      P.vx *= 0.85; P.vy *= 0.85; P.vx += (this.rand() - 0.5) * 1.2; P.vy += (this.rand() - 0.5) * 1.2; res = 'effleuré, le porteur garde';
    }
    P.vz = 0; P.spin = 0; P.top = 0;
    stepBall(P, Math.max(0, (1 - hb.t) * dt));
    this.lastTouch = o.side; this._lastToucher = o; this._deflect = res === 'effleuré, le porteur garde'; this._kickBy = o; this._kickT = this.now;
    o.touch = 0.2;
    if (h && !this.keepsBall(h)) { this.releaseBall(h); this.pending = null; h.cd = 1.2; }
    if (this.holder !== h || !h) {
      if (this.keepsBall(o)) this.gain(o, out, true);
      const T = o.team;
      T.stats.tackles++; o.mp.tackles++; addRating(o.mp, 0.06);
      if (h) emit(this.m, out, { type: 'tackle', side: o.side, pid: o.mp.id, pid2: h.mp.id, x: P.x / L, y: P.y / W, zone: this.m.zone });
    }
    if (k.rec) Object.assign(k.rec, { result: this.holder === o ? 'ballon gagné' : this.holder === h && h ? 'le porteur garde' : res, q: +q.toFixed(2), grip: +grip.toFixed(2) });
  }

  /**
   * La jambe du tacle a touché le joueur sans toucher le ballon. L'intensité du contact (vitesse,
   * glissé, par derrière) est réelle ; l'arbitre la siffle ou laisse jouer selon sa sévérité.
   */
  tackleMan(o, k, v, out) {
    const m = this.m, rel = Math.hypot((o.vx || 0) - (v.vx || 0), (o.vy || 0) - (v.vy || 0));
    const vs = Math.hypot(v.vx || 0, v.vy || 0);
    const behind = vs > 1.5 && (((this.X(o) - this.X(v)) * (v.vx || 0) + (this.Y(o) - this.Y(v)) * (v.vy || 0)) / vs) < -0.3;
    const I = 0.35 + rel / 7 + (k.kind === 'slide' ? 0.5 : 0) + (behind ? 0.6 : 0) + (TR(o, 'rugueux') ? 0.15 : 0);
    const whistle = I * this.ref.whistle * (m.profile.fouls || 1);
    const foul = whistle > 0.72 + gauss(this.rand(), this.rand()) * 0.15;
    if (k.rec) Object.assign(k.rec, { result: foul ? 'faute' : 'contact sans faute', intensity: +I.toFixed(2) });
    this.gest.note(o, foul ? 'faute sur l\'homme' : 'contact sur l\'homme');
    if (foul) { this.foul(v, o, out, I); return; }
    // Avantage / contact léger : il est déséquilibré, il ne tombe que si le choc est fort.
    v.bump = 0.45; v.bumpDir = Math.atan2(this.Y(v) - this.Y(o), this.X(v) - this.X(o));
    v.vx *= 0.5; v.vy *= 0.5;
    if (I > 1.1) { v.fall = 0.7; v.cd = 1.2; }
  }

  /** Faute : coup franc (ou penalty dans la surface), cartons, blessure éventuelle. */
  foul(victim, offender, out, sev = 0.9) {
    const m = this.m, A = victim.team, D = offender.team;
    D.stats.fouls++; offender.mp.fouls++;
    addRating(offender.mp, -0.06);
    offender.slide = 0.9; victim.fall = 2.0;
    const fx = this.P.x, fy = this.P.y;
    const z = m.zone;
    emit(m, out, { type: 'foul', side: D.side, pid: offender.mp.id, pid2: victim.mp.id, x: fx / L, y: fy / W, zone: z });
    m.stoppages += 0.15;
    let yP = 0.135 + (z === 1 || z === 2 ? 0.04 : 0) + (m.minute > 75 ? 0.04 : 0) + (z === 3 ? 0.08 : 0);
    if (offender.mp.yellow) yP *= 0.3;   // déjà averti : il se retient (et l'arbitre aussi)
    if (offender.mp.p?.traits?.includes('sangchaud')) yP *= 1.5;
    if (offender.mp.p?.traits?.includes('veteran')) yP *= 0.8;
    if ((offender.mp.calm || 0) > m.minute || (D.calmUntil || 0) > m.minute) yP *= 0.6; // consigne « calmez-vous » du banc
    yP *= clamp((sev - 0.3) / 0.8, 0.4, 2);   // gravité réelle du contact (vitesse, glissé, par derrière)
    yP *= this.ref.strict * (m.profile.cards || 1) * (1 + (TK[D.tactics.tackling] || 0) * 0.18) * (D.cm ? D.cm.cards : 1) * captainCalm(D);
    if (this.rand() < 0.0022) sendOff(m, out, D, offender.mp, 'direct');
    else if (this.rand() < yP) {
      offender.mp.yellow++; D.stats.yellows++;
      addRating(offender.mp, -0.3);
      if (offender.mp.yellow >= 2) sendOff(m, out, D, offender.mp, 'second');
      else emit(m, out, { type: 'yellow', side: D.side, pid: offender.mp.id, x: fx / L, y: fy / W, zone: z });
    }
    if (this.rand() < 0.012 * A.injuryMod) injure(m, out, A, victim.mp);
    this.sync();
    const gx = this.goalX(A.side);
    const inBox = Math.abs(fx - gx) < 16.5 && Math.abs(fy - W / 2) < 20.15;
    this.holder = null; this.pending = null;
    if (inBox) this.setRestart('penalty', A.side, gx - this.dir(A.side) * 11, W / 2, out);
    else this.setRestart('freekick', A.side, fx, fy, out);
  }

  /** Le joueur p récupère le ballon (contrôle, tacle, interception). */
  gain(p, out, fast = false, viaTouch = false) {
    if (!viaTouch) { this.diagContact(p, fast ? 'duel' : 'récupération'); this.gest.contact(p, fast ? 'duel' : 'récupération', 'pied', { reflex: 'prise de balle', src: 'gain' }); }
    const m = this.m;
    this.holder = p; this.inHands = false; this.pending = null;
    p.carry = null; p._gotT = this.now;
    for (const q of this.players.values()) q.faceBall = false;
    // Il prend le ballon face à lui (jamais « dans le dos »).
    if (this.dist(p, this.P.x, this.P.y) < 2.5) p.face = Math.atan2(this.P.y - p.y * W, this.P.x - p.x * L);
    // Ballon gagné dans un duel : on joue vite (sinon l'adversaire, juste à côté, retacle aussitôt).
    p.next = this.now + (fast ? 0.25 + this.rand() * 0.3 : (0.35 + this.rand() * 0.45) * TUNE.recv);
    // Adversaire au contact : il n'a pas le temps de s'installer, il joue tout de suite.
    if (this.pressure(p) < 2.4) p.next = Math.min(p.next, this.now + 0.25 + this.rand() * 0.2);
    if (fast) { this.duelCd = Math.max(this.duelCd || 0, 1.8); p.cd = 1.2; }
    p.touch = 0.2;
    this.lastTouch = p.side; this._lastToucher = p;
    if (this.poss !== p.side) {
      p.team.seqN = 0;   // nouvelle possession : compteur de passes remis à zéro
      this.gainT = this.gainT || [-99, -99]; this.gainT[p.side] = this.now;
      this.poss = p.side;
      changePossession(m, p.side, m.zone, p.mp);
      momentum(m, p.side, 1);
    }
    m.carrier = p.mp;
  }

  /* ---------------- Ballons libres, passes en vol ---------------- */

  updateLoose(dt, out) {
    const P = this.P;
    if (this.holder || this.shot?.live) return;
    // Ballon sorti : personne ne le joue, c'est touche / corner / six mètres. Même seuil que la
    // sortie (OUT_M) : plus de zone morte où le ballon n'est ni jouable ni sorti.
    if (outOfPlay(P)) return;
    const pd = this.pending;
    if (pd) {
      const r = pd.to;
      if (!this.players.has(r.mp.id)) { this.pending = null; return; }
      // Le destinataire se rend au point où il peut couper la VRAIE trajectoire du ballon (physique
      // prédite), réévalué toutes les 0,15 s (rebonds, effet). Le contact lui-même est vérifié
      // après le mouvement (contactStep) : s'il arrive trop tard ou se place mal, il manque le ballon.
      if (!(r.gk && pd.aerial) && (!pd.planT || this.now >= pd.planT)) {
        pd.planT = this.now + 0.15;
        // Il a vu partir la passe (elle est pour lui) : le temps de réaction ne compte qu'au départ.
        const rm = this.posM(r), opt = { ...this.reachOpts(r), react: Math.max(0, 0.18 - (this.now - pd.t0)), slack: 0.3 };
        const path = ballPath(P, predict, { horizon: 3, step: 0.05 });
        // Comme un vrai receveur, il vise un point où il arrive avec un peu d'avance pour s'installer
        // (sinon il arrive lancé au dernier instant et le ballon lui passe sous le pied).
        const alone = this.pressure(r) > 4;
        let plan = receivePlan(rm, path, { ...opt, minMargin: 0.3, headCost: alone ? 6 : 0 }) || interceptPlan(rm, path, opt);
        if (!plan) {
          // Hors de portée : il va au point de la trajectoire où son retard est le plus faible.
          let best = null;
          for (const sp of path) { const late = timeToReach(rm, sp.x, sp.y, opt) - sp.t; if (!best || late < best.late) best = { x: sp.x, y: sp.y, z: sp.z, t: sp.t, late }; }
          plan = best ? { ...best, part: null, margin: -best.late, late: true } : null;
        }
        pd.plan = plan;
        if (plan) plan.abs = this.now + plan.t;
        if (this.diag && plan) this.diag.plan(this.now, { pid: r.mp.id, side: r.side, x: plan.x, y: plan.y, z: plan.z, part: plan.part, eta: plan.t, margin: plan.margin });
        if (pd.kind === 'pass') this.planInterceptors(pd, path, plan);
      }
      // Les défenseurs lancés vers la trajectoire gardent leur course (le replacement collectif,
      // recalculé toutes les 0,3 s, ne les rappelle pas tant que la passe est en l'air).
      if (pd.kind === 'pass' && pd.cuts) for (const c of pd.cuts) {
        if (!this.players.has(c.p.mp.id)) continue;
        this.want(c.p, 'coupe', c.challenge ? 'duel aérien' : c.attack ? 'attaque du centre' : 'coupe', PRI.URGENCE, c.challenge ? 'duel aérien' : c.attack ? 'attaque du centre' : 'coupe', c.x, c.y, 0.5 + (c.margin || 0), { ttl: 0.12, end: () => this.pending !== pd }); c.p.role = 'chase';
        if (c.part === 'head' && !c.jumped && c.abs - this.now < 0.28) { c.jumped = true; c.p.jump = 0.45; this.gest.begin(c.p, 'saut de tête', { tPlan: c.abs, anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: c.challenge ? 'duel aérien' : 'coupe' }); }   // il s'élève pour arriver au ballon au sommet du saut
      }
      if (pd.plan?.part === 'head' && !pd.plan.jumped && pd.plan.abs - this.now < 0.28) { pd.plan.jumped = true; r.jump = 0.45; this.gest.begin(r, 'saut de tête', { tPlan: pd.plan.abs, anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: 'receveur' }); }
      // Receveur : P5 s'il peut réellement jouer le ballon (point atteignable à temps), sinon P4.
      if (pd.plan) { const ok = !pd.plan.late && pd.plan.margin >= 0; this.want(r, 'reception', 'receveur', ok ? PRI.BALLON : PRI.URGENCE, 'receveur', pd.plan.x, pd.plan.y, ok ? 1 : 0.5 + pd.plan.margin, { ttl: 0.12, end: () => this.pending !== pd }); }
      for (const q of this.players.values()) q.faceBall = q === r && this.dist(r, P.x, P.y) < 9;
      // Sortie aérienne du gardien : il s'élance, bras tendus au-dessus de la tête, et capte haut.
      // (gardien : inchangé à ce stade — refonte physique à l'étape 4d)
      if (r.gk && pd.aerial && !r._claimJ && this.now > pd.t0 + pd.T - 0.42) { r._claimJ = true; r.jump = 0.45; r.claimHigh = 0.8; this.gest.begin(r, 'saut', { part: 'mains', tPlan: pd.t0 + pd.T, anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: 'sortie aérienne' }); }
      if (r.gk && pd.aerial) {
        const f = this.foot(r, 0.4), d = Math.hypot(f.x - P.x, f.y - P.y);
        if (d < 1.6 && P.z < 3.1 && this.inOwnBox(r)) { r._claimJ = false; this.gkCatch(r, out); return; }
        if (d < 1.9 && P.z < 1.3) { this.receive(r, pd, out); return; }
      }
      // Raté : le ballon a filé (trajectoire dépassée) — il devient libre.
      const inReachNow = !!reachAt(this.posM(r), P, { phy: r.mp?.p?.attrs?.phy });   // le ballon arrive dans son pied : rien n'est perdu
      if (!inReachNow && (this.now > pd.t0 + pd.T + 1.2 || (pd.plan?.late && pd.plan.t < 0.1 && this.now > pd.t0 + 0.5))) {
        if (this.diag) this.diag.miss(this.now, { pid: r.mp.id, side: r.side, x: P.x, y: P.y, reason: pd.plan?.late ? 'trop tard / hors de portée' : 'ballon manqué' });
        if (pd.rec && !pd.rec.outcome) pd.rec.outcome = pd.plan?.late ? 'hors de portée du destinataire' : 'manquée par le destinataire';
        this.pending = null;
      }
      return;
    }
    // Ballon libre : le plus proche de chaque équipe y va ; le premier au contact le contrôle.
    const sp = Math.hypot(P.vx, P.vy);
    const ahead = Math.min(0.8, sp / 8);
    const px = P.x + P.vx * ahead, py = P.y + P.vy * ahead;
    // Où le ballon va-t-il s'arrêter ? S'il file hors du terrain et que l'adversaire l'a touché
    // en dernier, on le laisse sortir (touche / six mètres pour nous), comme les vrais joueurs.
    const stop = sp > 0.3 ? (sp * sp) / (2 * 1.55) : 0;
    const rx = P.x + (sp > 0.3 ? (P.vx / sp) * stop : 0), ry = P.y + (sp > 0.3 ? (P.vy / sp) * stop : 0);
    const goingOut = P.z < 0.6 && (ry < -0.3 || ry > W + 0.3 || rx < -0.3 || rx > L + 0.3);
    // Ballon qui file dehors : l'adversaire du dernier toucheur le laisse sortir ; même le coéquipier
    // abandonne s'il ne peut pas l'atteindre avant la ligne (sinon on rattrape tout, au millimètre).
    const tLine = (() => {
      if (sp < 0.5) return 99;
      const dl = Math.min(P.vy < 0 ? P.y / -P.vy : P.vy > 0 ? (W - P.y) / P.vy : 99, P.vx < 0 ? P.x / -P.vx : P.vx > 0 ? (L - P.x) / P.vx : 99);
      return dl * 1.15;   // (le ballon freine un peu)
    })();
    const canReach = (side) => this.list(side).some((p) => this.dist(p, P.x, P.y) < 1.6 || this.dist(p, P.x + P.vx * tLine * 0.85, P.y + P.vy * tLine * 0.85) / (6 + (p.mp?.p?.attrs?.vit ?? 60) * 0.03) < tLine * 0.85 - 0.25);
    const letGo = (side) => goingOut && sp > 0.8 && (this.lastTouch !== side || !canReach(side));
    // Un seul joueur par équipe sur le ballon : celui qui l'atteint le plus tôt (sa vitesse, la
    // trajectoire du ballon), et on ne change pas de chasseur sans une vraie raison.
    const ch = (this._chaser ||= [null, null]);
    // Temps pour atteindre le ballon qui roule (étape 5c) : simulation du modèle cinématique réel
    // (body.js) qui poursuit la position prévue du ballon (ralentissement au sol).
    const ballAt = (t) => {
      const bv = Math.max(0, sp - 1.55 * t), dd = sp > 0.3 ? (sp * t - 0.78 * t * t) * (bv > 0 ? 1 : 0) + (bv <= 0 ? stop : 0) : 0;
      return { x: P.x + (sp > 0.3 ? (P.vx / sp) * Math.min(dd, stop) : 0), y: P.y + (sp > 0.3 ? (P.vy / sp) * Math.min(dd, stop) : 0) };
    };
    const tReach = (p) => {
      const o = this.reachOpts(p), r = bodyPursue(this.posM(p), ballAt, { vmax: o.vmax, acc: o.acc, radius: 0.6, tMax: 3 });
      if (r) return { t: r.t, bx: r.x, by: r.y };
      return { t: 3 + this.dist(p, rx, ry) / o.vmax, bx: rx, by: ry };
    };
    for (const side of [0, 1]) {
      if (letGo(side)) { ch[side] = null; continue; }
      let best = null, br = null;
      for (const p of this.list(side)) {
        if (p.gk && Math.abs(px - (side === 0 ? 0 : L)) > 18) continue;
        if (p.fall > 0.3 || p.slide > 0.2) continue;
        const r = tReach(p);
        if (!br || r.t < br.t) { br = r; best = p; }
      }
      const cur = ch[side] && this.players.has(ch[side].mp.id) ? ch[side] : null;
      if (cur && cur !== best && !(cur.fall > 0.3)) { const rc = tReach(cur); if (rc.t < br.t * 1.25 + 0.25) { best = cur; br = rc; } }
      ch[side] = best;
      // Il attaque le ballon qui roule : il vise un peu au-delà (dans le sens où il roule), sinon il
      // freinerait en arrivant sur sa position et resterait collé derrière lui sans jamais le toucher.
      if (best) {
        const lead = sp > 1 ? Math.min(2.5, sp * 0.35) / sp : 0;
        this.want(best, 'poursuite', 'poursuite', PRI.URGENCE, 'poursuite', br.bx + P.vx * lead, br.by + P.vy * lead, 1 - br.t / 3, { ttl: 0.12 }); best.role = 'chase';
      }
      // Les autres ne viennent pas s'agglutiner : leur place reste à 7 m du ballon au moins
      // (ils offrent une solution ou couvrent derrière le chasseur).
      for (const p of this.list(side)) {
        if (p === best || p.gk) continue;
        const dx = p.tx * L - br?.bx, dy = p.ty * W - br?.by, d = Math.hypot(dx, dy);
        if (!(d < 7)) continue;
        const ux = d > 0.3 ? dx / d : (p.x * L - P.x) / Math.max(0.3, this.dist(p, P.x, P.y)), uy = d > 0.3 ? dy / d : (p.y * W - P.y) / Math.max(0.3, this.dist(p, P.x, P.y));
        this.want(p, 'espacement', 'espacement', PRI.SOUTIEN, 'espacement', clamp(br.bx + ux * 7, 1, L - 1), clamp(br.by + uy * 7, 1.4, W - 1.4), 0.4, { ttl: 0.6, glide: 4 });
      }
    }
    this._letGo = [letGo(0), letGo(1)];
    // (Gardien dans sa surface : prise de balle à la main par contact réel — gkContact, étape 4d.)
  }

  inOwnBox(p) {
    const own = p.side === 0 ? 0 : L;
    return Math.abs(this.P.x - own) < 16.5 && Math.abs(this.P.y - W / 2) < 20.15;
  }

  receive(r, pd, out) {
    if (pd.kind !== 'pass') this.diagContact(r, 'réception');
    const m = this.m, P = this.P;
    // Le premier toucher a déjà eu lieu physiquement (controlTouch) : ici, seulement la possession.
    // Passe RÉUSSIE = le destinataire touche le ballon (même s'il le contrôle mal ensuite).
    if (r.side === pd.from.side && (pd.kind !== 'pass' || r === pd.to || pd.cross) && (pd.ok ?? true)) {
      r.team.stats.passesOk++; pd.from.mp.passesOk++;
      addRating(pd.from.mp, 0.012);
    }
    r.faceBall = false;
    this.pending = null;
    if (r.gk && this.inOwnBox(r) && pd.aerial) { this.gkCatch(r, out); return; }
    // Possession : il garde le ballon s'il pourra encore le jouer un instant plus tard (le toucher
    // ne l'a pas fait filer hors de sa portée). Un ballon qui a rebondi sur lui sans qu'il ait réagi
    // n'est pas contrôlé : il redevient libre.
    const gained = r.gk || (!pd._deflect && this.keepsBall(r));
    if (pd.rec) pd.rec.outcome = r.side === pd.from.side ? (gained ? 'reçue' : 'contrôle raté') : (gained ? 'interceptée' : 'déviée');
    if (r.side !== pd.from.side && gained) {
      addRating(r.mp, 0.05);
      if (!r.gk) emit(m, out, { type: 'interception', side: r.side, pid: r.mp.id, pid2: pd.from.mp.id, x: P.x / L, y: P.y / W, zone: m.zone });
    }
    if (gained) this.gain(r, out, false, true);
  }

  /**
   * Timing du saut (étape 4d) : sur un ballon haut, chaque joueur saute plus ou moins bien en
   * rythme (détente, lecture, technique) ; un saut mal synchronisé ne monte pas aussi haut — le
   * ballon peut lui passer au-dessus. Tirage unique par ballon et par joueur (déterministe).
   */
  jumpOpts(p, key) {
    const P = this.P;
    if (P.z < 1.8 && (this._sw0?.z ?? 0) < 1.8) return null;
    if (this.dist(p, P.x, P.y) > 5) return null;
    if (!p._jk || p._jk.key !== key) {
      const sk = (eff(p.mp, 'phy') * 0.4 + eff(p.mp, 'vis') * 0.3 + Math.max(eff(p.mp, 'tir'), eff(p.mp, 'def')) * 0.3) / 100;
      const e = gauss(this.rand(), this.rand()) * (0.05 + (1 - clamp(sk, 0, 1)) * 0.1);
      p._jk = { key, e, k: clamp(1 - Math.abs(e) / 0.22, 0, 1) };
    }
    return { jumpK: p._jk.k };
  }

  /**
   * Duel aérien : quand des joueurs des deux équipes touchent le ballon de la tête dans le même pas,
   * le vainqueur est celui qui l'atteint le premier et le plus haut (détente × timing), avec le
   * corps le plus fort (physique), le mieux placé (moins étiré) ; une part d'aléa (contact de corps).
   */
  aerialDuel(best, heads, pd) {
    const rivals = (heads || []).filter((h) => h.hit.reach.part === 'head' || h.hit.ball.z > 1.5);
    const sides = new Set(rivals.map((h) => h.p.side));
    const P = this.P;
    // Adversaire au contact (même sans toucher) : il gêne le geste.
    let close = null;
    for (const o of this.players.values()) if (o.side !== best.p.side && !o.gk && Math.hypot(this.X(o) - best.hit.ball.x, this.Y(o) - best.hit.ball.y) < 1.2) close = o;
    best.contested = !!close; best.rival = close;
    if (sides.size < 2) return best;
    const score = (h) => {
      const jk = h.p._jk?.k ?? 1, reachH = 2.05 + jumpGainOf(h.p) * jk - h.hit.ball.z;
      return reachH * 1.5 + eff(h.p.mp, 'phy') / 100 * 0.8 + (TR(h.p, 'tete') || TR(h.p, 'tour') ? 0.25 : 0) + (1 - h.hit.reach.stretch) * 0.5 + (1 - h.hit.t) * 0.4 + gauss(this.rand(), this.rand()) * 0.25;
    };
    let win = null, ws = -Infinity, lose = null;
    for (const h of rivals) { const sc = score(h); if (sc > ws) { if (win) lose = win; ws = sc; win = h; } else if (!lose || h.p.side !== win.p.side) lose = h; }
    win.contested = true; win.rival = lose?.p || close;
    if (lose?.p && !(lose.p.jump > 0)) this.gest.begin(lose.p, 'saut', { anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: 'duel aérien perdu' });
    if (lose?.p) { lose.p.jump = Math.max(lose.p.jump || 0, 0.45); if (this.rand() < 0.15) lose.p.bump = 0.35; }
    void P;
    return win;
  }

  /**
   * TÊTE (étape 4d) : le contact a eu lieu au point réel (zone de la tête, saut compris). La
   * qualité du geste dépend de la technique (frappe pour un attaquant, défense pour un défenseur),
   * de la puissance (physique), du timing du saut, de l'extension et de la gêne adverse. Le joueur
   * choisit son geste — tête au but, remise, déviation (prolongation), dégagement — et l'exécute
   * avec une erreur d'autant plus grande que le contact est mauvais. Aucun résultat tiré d'avance.
   */
  header(r, pd, out, hit = null, ctx = null) {
    const m = this.m, P = this.P;
    if (!(r.gk && this.gkHandsOk(r))) this.gest.contact(r, 'tête', 'tête', { frac: hit?.t ?? 1, reflex: 'tête', anim: r.jump > 0 ? null : { timer: 'jump', dur: 0.3 * GS, at: 0.5 }, src: 'tête' });
    if (!(r.jump > 0)) r.jump = 0.3;   // (saut déjà lancé à l'approche du ballon, sinon petit saut au contact)
    emit(m, out, { type: 'aerial', side: r.side, pid: r.mp.id, x: P.x / L, y: P.y / W, zone: m.zone });
    this.pending = null;
    if (r.gk && this.gkHandsOk(r)) { this.gkCatch(r, out); return; }
    const B = hit?.ball || { x: P.x, y: P.y, z: P.z };
    Object.assign(P, { x: B.x, y: B.y, z: Math.max(BR, B.z) });
    const inSp = Math.hypot(P.vx, P.vy, P.vz);
    const gx = this.goalX(r.side), dG = Math.hypot(gx - this.X(r), W / 2 - this.Y(r));
    const ownG = this.goalX(1 - r.side), dOwn = Math.hypot(ownG - this.X(r), W / 2 - this.Y(r));
    const attacking = dG < dOwn;
    const tech = (attacking ? eff(r.mp, 'tir') : eff(r.mp, 'def')) * 0.6 + eff(r.mp, 'phy') * 0.2 + eff(r.mp, 'sf') * 0.2;
    const jk = r._jk?.k ?? 1, stretch = hit?.reach?.stretch ?? 0.3, contested = !!ctx?.contested;
    const q = clamp(0.25 + 0.6 * (tech - 30) / 65 - stretch * 0.35 - Math.max(0, inSp - 14) * 0.02 - (contested ? 0.18 : 0) - (1 - jk) * 0.25 + (TR(r, 'tete') ? 0.08 : 0), 0, 1);
    // Choix du geste (décision du joueur, pas d'issue décidée).
    let type;
    const mates = this.list(r.side).filter((q2) => q2 !== r && !q2.gk);
    const dir = this.dir(r.side);
    const mate = mates.map((q2) => ({ q2, d: this.dist(q2, B.x, B.y), free: this.pressure(q2), fw: (this.X(q2) - B.x) * dir }))
      .filter((x) => x.d > 4 && x.d < 15 && x.free > 2.5).sort((a, b) => (b.free + b.fw * 0.3) - (a.free + a.fw * 0.3))[0];
    if (attacking && dG < 13 && Math.abs(this.Y(r) - W / 2) < 11 && B.z > 1.2) type = 'tête au but';
    else if (!attacking && dOwn < 30) type = 'dégagement';
    else if (mate && !contested) type = 'remise';
    else type = 'déviation';
    if (this.diag) this.diag.aerial(this.now, { pid: r.mp.id, side: r.side, type, q: +q.toFixed(2), z: +B.z.toFixed(2), contested, rival: ctx?.rival?.mp?.id ?? null, timing: Math.abs(r._jk?.e ?? 0), jumpK: +jk.toFixed(2), inSpeed: +inSp.toFixed(1) });
    this.lastTouch = r.side; this._lastToucher = r; this._deflect = false; this._kickBy = r; this._kickT = this.now;
    if (type === 'tête au but') {
      r._headQ = q; r._headIn = inSp;
      this.holder = r; this.poss = r.side; changePossession(m, r.side, 3, r.mp);
      this.doShot(r, 'header', out);
      return;
    }
    // Direction et puissance voulues, puis erreur selon la qualité du contact.
    const err = gauss(this.rand(), this.rand()) * (0.06 + (1 - q) * 0.4);
    const pw = 0.6 + q * 0.4;
    if (type === 'remise') {
      const tx = this.X(mate.q2) + (mate.q2.vx || 0) * 0.5, ty = this.Y(mate.q2) + (mate.q2.vy || 0) * 0.5;
      const d = Math.hypot(tx - B.x, ty - B.y), a = Math.atan2(ty - B.y, tx - B.x) + err;
      const T = solveKick(P, { x: B.x + Math.cos(a) * d * pw * 1.1, y: B.y + Math.sin(a) * d * pw * 1.1, z: 0.4 }, { T: 0.45 + d / 20 });
      const pd2 = this.pending = { kind: 'pass', lofted: true, to: mate.q2, from: r, fromX: B.x, fromY: B.y, t0: this.now, T, aim: { x: tx, y: ty }, err: { dAng: err, dLen: 0, sAng: 0 } };
      if (this.diag) { pd2.rec = { pid: r.mp.id, side: r.side, to: mate.q2.mp.id, aim: { x: tx, y: ty }, exec: { x: B.x + Math.cos(a) * d, y: B.y + Math.sin(a) * d }, from: { x: B.x, y: B.y }, dAng: err * 57.3, dLen: 0, sAng: 0, k: 1, weak: false, lofted: true, header: true, through: false, len: d, pas: eff(r.mp, 'pas'), pressure: this.pressure(r), speed: r.speed || 0, turn: 0, interceptors: [], outcome: null }; this.diag.pass(this.now, pd2.rec); }
      r.team.stats.passes++; r.mp.passes++;
    } else if (type === 'dégagement') {
      // Loin de son but, haut, plutôt vers les côtés : la puissance vient du cou et du ballon reçu.
      const away = Math.atan2(B.y - W / 2, (B.x - ownG) || dir) * 0.5;
      const a = (dir > 0 ? 0 : Math.PI) + away * dir + err;
      const d = (10 + eff(r.mp, 'phy') / 8 + inSp * 0.4) * pw;
      solveKick(P, { x: B.x + Math.cos(a) * d, y: clamp(B.y + Math.sin(a) * d, -3, W + 3), z: BR }, { T: 1.0 + d / 30 });
      emit(m, out, { type: 'header', side: r.side, pid: r.mp.id, x: P.x / L, y: P.y / W, zone: m.zone });
      if (dOwn < 35) emit(m, out, { type: 'clearance', side: r.side, pid: r.mp.id, x: P.x / L, y: P.y / W, zone: m.zone, head: true });
      addRating(r.mp, 0.04);
    } else {
      // Déviation / prolongation : le ballon garde sa course, légèrement réorienté vers l'avant.
      const vin = Math.atan2(P.vy, P.vx), fwd = dir > 0 ? 0 : Math.PI;
      let da = Math.atan2(Math.sin(fwd - vin), Math.cos(fwd - vin)); da = clamp(da, -0.5, 0.5);
      // Près d'une ligne de touche, il prolonge vers l'intérieur du terrain (pas vers la ligne).
      const edge = Math.min(B.y, W - B.y);
      let inw = 0;
      if (edge < 10) { const inward = B.y < W / 2 ? Math.PI / 2 : -Math.PI / 2; const di = Math.atan2(Math.sin(inward - (vin + da * q)), Math.cos(inward - (vin + da * q))); inw = clamp(di, -1.0, 1.0) * (1 - edge / 12) * (0.6 + 0.4 * q); }
      const a = vin + da * q + inw + err, v = Math.hypot(P.vx, P.vy) * (0.45 + q * 0.25) + 2;
      P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = Math.max(0.5, Math.abs(P.vz) * 0.3 + 1.5 * q); P.spin = 0; P.top = 0;
    }
    if (this.poss !== r.side && type !== 'déviation') { this.poss = r.side; changePossession(m, r.side, m.zone, r.mp); }
  }

  /* ---------------- Gardien (étape 4d) ---------------- */

  /** Qualités du gardien : mains (prise de balle), agilité (portée du plongeon), réflexes (réaction). */
  gkSkill(g) {
    const arr = eff(g.mp, 'arr'), sf = eff(g.mp, 'sf'), phy = eff(g.mp, 'phy'), vit = eff(g.mp, 'vit');
    return {
      handling: clamp((arr * 0.75 + sf * 0.25) / 100 + (TR(g, 'chat') ? 0.06 : 0), 0, 1),
      agil: clamp((arr * 0.6 + phy * 0.2 + vit * 0.2) / 100, 0, 1),
      react: Math.max(0.14, 0.31 - arr / 700 - (TR(g, 'mur') ? 0.02 : 0)),
    };
  }
  /** Les mains sont-elles permises ? (dans sa surface, et pas sur une passe volontaire d'un partenaire) */
  gkHandsOk(g) { return this.inOwnBox(g) && (this.lastTouch !== g.side || !!this._deflect || !this._lastToucher || this._lastToucher === g); }

  /**
   * Lecture de la trajectoire par chaque gardien : un ballon qui file vers son but (prédiction
   * physique) déclenche, APRÈS son temps de réaction, un pas de côté (ballon à portée de mains)
   * ou un plongeon (direction, hauteur) dont le départ est calé pour que les mains arrivent au
   * point de passage. Trop loin ou trop tard : il ne l'atteindra pas — rien n'est décidé ici.
   */
  gkWatch(dt) {
    const P = this.P;
    if (this.inHands || this.holder || this.celebrate) return;
    for (const g of this.players.values()) {
      if (!g.gk || g._dive || (g._down || 0) > this.now) continue;
      if (this.lastTouch === g.side && !this._deflect) { g._threat = null; continue; }   // passe d'un partenaire : il la joue au pied
      const own = g.side === 0 ? 0 : L, sgnOut = own === 0 ? -1 : 1;
      const sp = Math.hypot(P.vx, P.vy);
      const toward = (own - P.x) * P.vx > 0 && Math.abs(P.x - own) < 40 && sp > 5;
      if (!toward) { g._threat = null; continue; }
      if (this.now < (g._gkT || 0)) { if (g._threat) this.gkHold(g); continue; }
      g._gkT = this.now + 0.02;
      // Prédiction physique : où et quand le ballon franchirait-il la ligne de but ?
      // … et quel est le point de la trajectoire (avant la ligne) le plus proche de lui : c'est là
      // qu'il doit amener ses mains (plan latéral ou point d'approche pour un tir en biais).
      const c = cloneBall(P); let cross = null, t = 0;
      const gX = this.X(g), gY = this.Y(g); let plane = null, bestD = Infinity;
      while (t < 2.5) {
        stepBall(c, 0.02); t += 0.02;
        const dd = Math.hypot(c.x - gX, c.y - gY);
        if (dd < bestD) { bestD = dd; plane = { x: c.x, y: c.y, z: c.z, t }; }
        if ((c.x - own) * sgnOut >= 0) { cross = { y: c.y, z: c.z, t }; break; }
        if (c.y < -1 || c.y > W + 1) break;
      }
      const onFrame = cross && Math.abs(cross.y - W / 2) < GOAL_HALF + 0.6 && cross.z < BAR + 0.35;
      if (!onFrame) { g._threat = null; continue; }
      const th = g._threat;
      // Nouvelle trajectoire (frappe, déviation) : il doit d'abord la lire (temps de réaction).
      if (!th || Math.abs(th.y - cross.y) > 0.9 || Math.abs(th.z - cross.z) > 0.7 || this._kickT > th.kickT) {
        const sk = this.gkSkill(g);
        // Vue masquée : des joueurs entre le ballon et lui retardent sa lecture.
        let screened = 0;
        for (const o of this.players.values()) { if (o === g) continue; const d = this.distToSeg(this.X(o), this.Y(o), P.x, P.y, this.X(g), this.Y(g)); if (d < 0.6 && this.dist(o, P.x, P.y) > 1.5 && this.dist(o, this.X(g), this.Y(g)) > 1.5) screened = 1; }
        g._threat = { t0: this.now, react: this.now + sk.react + screened * 0.12, y: cross.y, z: cross.z, tGoal: this.now + cross.t, kickT: this._kickT, screened };
        if (this.diag) this.diag.gk(this.now, g._threat.rec = { pid: g.mp.id, side: g.side, from: { x: P.x, y: P.y }, speed: sp, cross: { y: cross.y, z: cross.z, t: cross.t }, react: sk.react + screened * 0.12, screened: !!screened, action: null, contact: null, result: null });
      }
      const T = g._threat;
      if (this.now < T.react) { this.gkHold(g); continue; }
      // Point de passage à sa hauteur (plan parallèle à la ligne de but, à sa position).
      const pt = plane || { x: own, y: cross.y, z: cross.z, t: cross.t };
      const dxp = pt.x - this.X(g), dyp = pt.y - this.Y(g), dy = Math.hypot(dxp, dyp) * (Math.sign(dyp) || 1), zc = pt.z;
      const sk = this.gkSkill(g), S = diveRange(sk.agil);
      if (Math.abs(dy) <= 1.15) {   // dans sa portée debout (bras tendus : contact.js · PARTS.hands)
        // À portée de mains : il se recale sur la trajectoire (pas chassé), saute si le ballon est haut.
        this.wantGk(g, clamp(pt.x, 0, L), clamp(pt.y, W / 2 - GOAL_HALF - 1, W / 2 + GOAL_HALF + 1)); g.faceBall = true;
        if (zc > 1.9 && !(g.jump > 0) && pt.t < 0.35) { g.jump = 0.45; g.claimHigh = 0.6; this.gest.begin(g, 'saut', { part: 'mains', tPlan: this.now + pt.t, anim: { timer: 'jump', dur: 0.45 * GS, at: 0.5 }, src: 'gardien : ballon haut' }); }
        if (T.rec && !T.rec.action) T.rec.action = 'debout';
        continue;
      }
      const Su = clamp(Math.abs(dy) - DIVE.arm * 0.85, 0.35, S), need = diveTimeFor(Math.abs(dy), Su);
      // Il plonge quand c'est le moment (les mains doivent arriver au point de passage) ; s'il a le
      // temps, il se décale d'abord en pas chassés. Hors de portée : il plonge quand même s'il y croit.
      if (need === Infinity && Math.abs(dy) > S + DIVE.arm + 0.8) { this.gkHold(g); if (T.rec && !T.rec.action) T.rec.action = 'hors de portée'; continue; }
      if (need !== Infinity && pt.t > Math.max(need, DIVE.T * 0.85) + 0.06) {
        this.wantGk(g, this.X(g), clamp(this.Y(g) + Math.sign(dy) * Math.min(Math.abs(dy), 1.5), 1, W - 1)); g.faceBall = true;
        continue;
      }
      this.startDive(g, Math.sign(dy) || 1, zc, S, T, Math.abs(dy), { x: dxp, y: dyp });
    }
  }
  /** Le gardien reste sur ses appuis (il lit la trajectoire). */
  gkHold(g) { this.wantGk(g, this.X(g), this.Y(g)); g.faceBall = true; }
  wantGk(g, x, y) { this.want(g, 'gardien', 'gardien', PRI.BALLON, 'gardien', x, y, 1, { ttl: 0.12 }); }
  wantHolder(h, x, y) { this.want(h, 'porteur', 'porteur', PRI.BALLON, 'porteur', clamp(x, 0, L), clamp(y, 0, W), 1, { ttl: 0.12, end: () => this.holder !== h }); }
  /** Distance d'un point au segment [A, B]. */
  distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }
  /** Départ du plongeon : direction latérale (le long de sa ligne), hauteur visée. */
  startDive(g, sideY, h, S, T = null, lat = null, dirv = null) {
    const own = g.side === 0 ? 0 : L;
    // Il plonge vers le point d'interception (le long de sa ligne pour un tir de face, en avant
    // pour un tir en biais) ; sans point précis (penalty), le long de sa ligne.
    const ux = dirv ? dirv.x : (own === 0 ? 1 : -1) * 0.12, uy = dirv ? dirv.y : sideY * 0.99;
    const n = Math.hypot(ux, uy);
    // Il dose son plongeon : le corps parcourt ce qu'il faut pour que les mains finissent sur la trajectoire.
    const Su = lat != null ? clamp(lat - DIVE.arm * 0.85, 0.35, S) : S;
    g._dive = { t0: this.now, x0: this.X(g), y0: this.Y(g), ux: ux / n, uy: uy / n, S: Su, h: clamp(h, 0.15, 2.45), px: this.X(g), py: this.Y(g) };
    this.gest.begin(g, 'plongeon', { anim: { timer: '_dive', dur: DIVE.dur, at: null }, src: 'gardien' });
    g.dive = DIVE.dur; g.diveDir = sideY; g.diveH = Math.min(1, h / 2.2);
    if (T?.rec) { T.rec.action = 'plongeon'; T.rec.dive = { at: +(this.now - T.t0).toFixed(2), side: sideY, h: +h.toFixed(2), range: +(S + DIVE.arm).toFixed(2) }; }
  }
  /** Mouvement du corps pendant le plongeon, puis au sol avant de se relever. */
  diveStep(p, dt) {
    const d = p._dive, t = this.now - d.t0;
    if (t > DIVE.dur) { p._dive = null; p._down = this.now + 0.35; p.vx = p.vy = 0; p.speed = 0; this.setT(p, p.x, p.y); return; }
    const f = diveFrac(t), x = d.x0 + d.ux * d.S * f, y = d.y0 + d.uy * d.S * f;
    p.vx = (x - d.px) / Math.max(dt, 1e-4); p.vy = (y - d.py) / Math.max(dt, 1e-4);
    d.px = x; d.py = y;
    p.x = clamp(x, 0, L) / L; p.y = clamp(y, 0, W) / W; this.setT(p, p.x, p.y);
    p.speed = Math.hypot(p.vx, p.vy); p.acc = 0;
  }

  /**
   * Contact du gardien (mains) pendant le pas : en plongeon, ses mains suivent la cinématique du
   * geste ; debout, sa zone de mains (contact.js · PARTS.hands, saut compris) ; avant d'avoir réagi,
   * seul son corps peut arrêter le ballon. Au contact : capter, repousser ou effleurer selon la
   * qualité du geste (gkHandle). Renvoie true s'il a touché le ballon.
   */
  gkContact(dt, out) {
    const P = this.P, b0 = this._sw0;
    if (!b0) return false;
    for (const g of this.players.values()) {
      if (!g.gk || !this.gkHandsOk(g) || g._sx == null) continue;
      if (g === this._kickBy && this.now - this._kickT < 0.45) continue;
      const th = g._threat;
      let hit = null, stretch = 0, mode;
      if (g._dive) {
        const h0 = diveHands(g._dive, this.now - dt), h1 = diveHands(g._dive, this.now);
        const sp = sweptPoint(h0, h1, b0, P);
        const ext = clamp((Math.hypot(h1.x - g._dive.x0, h1.y - g._dive.y0) - DIVE.arm) / Math.max(0.5, diveRange(this.gkSkill(g).agil)), 0, 1);
        if (sp) { hit = { t: sp.t, ball: sp.ball }; stretch = clamp(ext * 0.85 + sp.dist / (DIVE.handR + BR) * 0.25, 0, 1); mode = 'plongeon'; }
        else {
          const lb = sweptLimb({ x: h1.bx, y: h1.by }, h1, b0, P);
          if (lb) { hit = { t: lb.t, ball: lb.ball }; stretch = clamp(ext * 0.5 + (1 - lb.u) * 0.2, 0, 1); mode = 'plongeon (corps)'; }
        }
      } else if (th && this.now < th.react) {
        const bh = sweptBody({ x: g._sx, y: g._sy }, { x: this.X(g), y: this.Y(g) }, b0, P);
        if (bh) { hit = { t: bh.t, ball: bh.ball }; mode = 'corps'; }
      } else {
        const r = this.sweepContact(g, null, { gk: true });
        if (r) { hit = r; stretch = r.reach.stretch; mode = 'mains'; }
      }
      if (!hit) continue;
      this.gkTouch(g, hit, mode, stretch, dt, out);
      return true;
    }
    return false;
  }

  /** Effet physique du contact du gardien sur le ballon. */
  gkTouch(g, hit, mode, stretch, dt, out) {
    this.gest.contact(g, 'mains', mode === 'corps' ? 'corps' : 'mains', { frac: hit.t ?? 1, reflex: 'mains', src: 'gardien : ' + mode });
    const P = this.P, B = hit.ball;
    const vin = { vx: P.vx, vy: P.vy, vz: P.vz }, speed = Math.hypot(P.vx, P.vy, P.vz);
    const sk = this.gkSkill(g), own = g.side === 0 ? 0 : L, outX = own === 0 ? 1 : -1;
    const pd = this.pending, aerial = B.z > 1.7 && (pd?.lofted || pd?.cross);
    let traffic = false;
    for (const o of this.players.values()) if (o.side !== g.side && Math.hypot(this.X(o) - B.x, this.Y(o) - B.y) < 1.6) traffic = true;
    let res;
    if (mode === 'corps') res = { q: 0.15, result: 'block' };
    else res = gkHandle({ handling: sk.handling, speed, stretch, z: B.z, knuckle: P.knuckle || 0, grip: this.m.wx?.grip || 1, rnd: this.rand() });
    // Ballon aérien dans la circulation : il préfère boxer plutôt que risquer de le relâcher.
    if (aerial && traffic && res.result !== 'catch') res.result = 'punch';
    Object.assign(P, { x: B.x, y: B.y, z: Math.max(BR, B.z) });
    const side = Math.sign(B.y - W / 2) || (this.rand() < 0.5 ? -1 : 1);
    if (res.result === 'catch') {
      this.lastTouch = g.side; this._lastToucher = g;
      this.gkLog(g, hit, mode, stretch, res, speed);
      this.shotTouched('gk', g, res.result);
      if (pd && pd.rec) { pd.rec.contact = { pid: g.mp.id, side: g.side, part: 'mains', at: this.now - pd.t0 }; pd.rec.outcome = 'interceptée'; }
      this.gkCatch(g, out, true);
      return;
    }
    let vx, vy, vz;
    if (res.result === 'punch') {
      const a = Math.atan2(B.y - W / 2, (B.x - own) * outX) * 0.6 + (this.rand() - 0.5) * (1 - res.q) * 0.9;
      const v = 11 + res.q * 6;
      vx = outX * Math.cos(a) * v; vy = Math.sin(a) * v; vz = 4 + this.rand() * 2.5;
    } else if ((res.result === 'parry' && mode.startsWith('plongeon')) || (res.result === 'parry' && stretch > 0.5)) {
      // Parade en extension : la paume DÉVIE le ballon, qui garde une partie de son élan et part sur
      // le côté (souvent derrière la ligne : corner) ; mieux maîtrisée, elle l'écarte davantage.
      const vh = Math.hypot(vin.vx, vin.vy) || 1, k = 0.35 + this.rand() * 0.2;
      vx = vin.vx * k * 0.6; vy = vin.vy * k * 0.3 + side * (3 + res.q * 4 + vh * 0.15); vz = Math.abs(vin.vz) * 0.3 + 1 + this.rand() * (B.z > 1.2 ? 3 : 1.2);
    } else if (res.result === 'parry' || res.result === 'block') {
      // Repoussé de face (gardien sur la trajectoire) : le ballon rebondit vers le terrain, plus ou
      // moins loin et sur le côté selon la maîtrise ; mal maîtrisé, il retombe devant le but.
      const v = speed * (0.22 + this.rand() * 0.18) + 2.5;
      const lat = mode === 'corps' ? (this.rand() - 0.5) * 1.2 : side * (0.3 + res.q * 0.5);
      const fwd = 1 - Math.abs(lat) * 0.6;
      vx = outX * fwd * v; vy = lat * v; vz = 1 + this.rand() * (B.z > 1.2 ? 3.5 : 1.5);
    } else {
      // Effleuré : le ballon garde l'essentiel de sa vitesse, légèrement détourné vers l'extérieur
      // (ou au-dessus) — il peut encore entrer.
      const k = 0.08 + res.q * 0.3, vh = Math.hypot(vin.vx, vin.vy) || 1;
      const ang = Math.atan2(vin.vy, vin.vx) + side * k * Math.sign(vin.vx || 1) * outX * -1;
      vx = Math.cos(ang) * vh * 0.85; vy = Math.sin(ang) * vh * 0.85; vz = vin.vz + (B.z > 1.6 ? 2 + res.q * 2 : 0.3);
    }
    Object.assign(P, { vx, vy, vz, spin: 0, top: 0, knuckle: 0 });
    stepBall(P, Math.max(0, (1 - hit.t) * dt));
    this.lastTouch = g.side; this._lastToucher = g; this._deflect = true; this._kickBy = g; this._kickT = this.now;
    if (!g._dive) { if (B.z > 1.7) { g.jump = Math.max(g.jump || 0, 0.4); g.claimHigh = 0.5; } else g.block = 0.4; }
    if (pd) { if (pd.rec) { pd.rec.contact = { pid: g.mp.id, side: g.side, part: 'mains', at: this.now - pd.t0 }; pd.rec.outcome = 'déviée'; } this.pending = null; }
    this.gkLog(g, hit, mode, stretch, res, speed);
    this.shotTouched('gk', g, res.result);
    emit(this.m, out, { type: 'save', side: g.side, pid: g.mp.id, how: res.result, x: B.x / L, y: B.y / W, zone: this.m.zone });
  }
  gkLog(g, hit, mode, stretch, res, speed) {
    if (!this.diag) return;
    const B = hit.ball, rec = g._threat?.rec;
    const c = { pid: g.mp.id, side: g.side, kind: 'gk', x: B.x, y: B.y, z: B.z, speed, part: 'mains', dist: 0, stretch, q: res.q, physical: true };
    this.diag.contact(this.now, c);
    if (rec) { rec.contact = { x: B.x, y: B.y, z: B.z, mode, stretch: +stretch.toFixed(2), q: +res.q.toFixed(2), at: +(this.now - g._threat.t0).toFixed(2) }; rec.result = res.result; }
    else this.diag.gk(this.now, { pid: g.mp.id, side: g.side, from: null, speed, cross: null, react: null, action: mode, contact: { x: B.x, y: B.y, z: B.z, mode, stretch, q: res.q }, result: res.result });
  }

  gkCatch(gk, out, logged = false) {
    if (!logged) { this.diagContact(gk, 'gk'); this.gest.contact(gk, 'mains', 'mains', { reflex: 'mains', src: 'gardien : prise' }); }
    const P = this.P;
    this.holder = gk; this.inHands = true; this.pending = null;
    P.vx = P.vy = P.vz = 0; P.spin = 0;
    gk.next = this.now + 1.4 + this.rand() * 1.4;
    this.lastTouch = gk.side;
    if (this.poss !== gk.side) { this.poss = gk.side; changePossession(this.m, gk.side, 0, gk.mp); }
  }

  /** Relance du gardien : courte vers un défenseur libre, ou longue vers les attaquants. */
  gkDistribution(gk, out) {
    const T = gk.team, dir = this.dir(gk.side);
    const long = this.rand() < ({ short: 0.2, long: 0.85 }[T.tactics.gkDist] ?? 0.5);
    const mates = this.list(gk.side).filter((p) => p !== gk);
    let r;
    if (long) r = mates.sort((a, b) => (this.X(b) - this.X(a)) * dir)[Math.floor(this.rand() * 3)];
    else r = mates.map((p) => ({ p, s: this.pressure(p) - this.dist(p, this.X(gk), this.Y(gk)) * 0.15 })).sort((a, b) => b.s - a.s)[0]?.p;
    if (!r) return;
    const o = this.passOption(gk, r) || { r, tx: this.X(r), ty: this.Y(r), p: 0.8, lofted: long };
    o.lofted = long || o.lofted;
    this.inHands = false;
    this.doPass(gk, o, out);
  }

  /* ---------------- Ballon : physique, sorties, buts ---------------- */

  ballStep(dt, out) {
    const P = this.P, h = this.holder;
    // Ballon ramené pour une remise en jeu : trajectoire en cloche jusqu'au point exact.
    const F = this.restart?.fetch;
    if (F && F.wait > 0) {
      // Ballon sorti : il continue sa course (il roule, rebondit sur les panneaux) avant d'être rendu.
      F.wait -= dt; stepBall(P, dt);
      if (F.wait <= 0) { P.inGoal = 0; P.hitPost = false; F.x0 = P.x; F.y0 = P.y; F.z0 = Math.max(BR, P.z); F.t = 0; const d0 = Math.hypot(P.x - this.restart.x, P.y - this.restart.y); F.T = clamp(d0 / 13, 0.45, 1.7); F.h = clamp(d0 * 0.09, 0.3, 3); }
      return;
    }
    if (F) {
      F.t += dt;
      const k = Math.min(1, F.t / F.T), rs = this.restart;
      const nx = F.x0 + (rs.x - F.x0) * k, ny = F.y0 + (rs.y - F.y0) * k;
      const nz = Math.max(BR, F.z0 * (1 - k) + BR * k + 4 * F.h * k * (1 - k));
      P.vx = (nx - P.x) / Math.max(dt, 1e-4); P.vy = (ny - P.y) / Math.max(dt, 1e-4); P.vz = (nz - P.z) / Math.max(dt, 1e-4);
      P.x = nx; P.y = ny; P.z = nz; P.rot.a += Math.hypot(P.vx, P.vy) / BR * dt;
      P.inGoal = 0; P.hitPost = false;
      if (k >= 1) { Object.assign(P, { x: rs.x, y: rs.y, z: BR, vx: 0, vy: 0, vz: 0, inGoal: 0, hitPost: false }); rs.fetch = null; }
      return;
    }
    let glued = false;
    if (h && this.inHands) {
      // Le ballon rejoint les mains en une fraction de seconde (il ne « saute » pas dans les gants).
      const f = this.foot(h, 0.3), k = Math.min(1, dt * 14);
      const nx = P.x + (f.x - P.x) * k, ny = P.y + (f.y - P.y) * k, nz = P.z + (1.05 - P.z) * k;
      Object.assign(P, { vx: (nx - P.x) / Math.max(dt, 1e-4), vy: (ny - P.y) / Math.max(dt, 1e-4), vz: 0, x: nx, y: ny, z: nz });
      glued = true;
    } else if (h) {
      // Conduite de balle PHYSIQUE (étape 4b-2) : le ballon roule librement ; le porteur ne le
      // touche que s'il est réellement dans la zone d'atteinte de son pied (contact.js), par une
      // impulsion. À l'arrêt ou en marchant : petites touches pour le garder sous le pied ; en
      // course : il le pousse devant lui. Hors d'atteinte : rien — c'est lui qui va au ballon.
      const sp = h.speed || 0;
      const hm = this.posM(h);
      const rr = P.z < 0.6 ? reachAt(hm, P, { parts: ['foot'] }) : null;
      h._reach = rr;
      const dri = eff(h.mp, 'dri');
      if (rr && this.now > (h.nextTouch || 0)) {
        const fx = Math.cos(h.face), fy = Math.sin(h.face);
        if (sp < 1.8 || h.prep) {
          // Garder le ballon : on vise le point de contact du pied (0,32 m devant lui) en suivant
          // le déplacement du joueur. Pas de touche si le ballon y est déjà, immobile par rapport à lui.
          // Le point visé reste dans le terrain : on ne garde pas le ballon sur la ligne.
          // Pressé de près : il se tourne dos à l'adversaire et garde le ballon de l'autre côté de son
          // corps (protection) ; sinon devant son pied.
          let cp0 = contactPoint(hm, 'foot');
          if (h.shieldK && h.shieldFace != null) cp0 = { x: hm.x + Math.cos(h.shieldFace) * 0.36, y: hm.y + Math.sin(h.shieldFace) * 0.36 };
          const cp = { x: clamp(cp0.x, 1, L - 1), y: clamp(cp0.y, 1, W - 1) };
          const ex = cp.x - P.x, ey = cp.y - P.y;
          const rvx = P.vx - hm.vx, rvy = P.vy - hm.vy;
          if (Math.hypot(ex, ey) > 0.1 || Math.hypot(rvx, rvy) > 0.5) {
            const q = touchQuality({ tech: dri, stretch: rr.stretch, rel: Math.hypot(rvx, rvy), part: 'foot', pressure: this.pressure(h) });
            const k = 2.2, e = (1 - q) * 0.9;
            let vx = hm.vx + ex * k + (this.rand() - 0.5) * e, vy = hm.vy + ey * k + (this.rand() - 0.5) * e;
            const m = Math.hypot(vx, vy), cap = sp + 2.2; if (m > cap) { vx *= cap / m; vy *= cap / m; }
            P.vx = vx; P.vy = vy; P.vz = 0; P.spin = 0; P.top = 0; P.knuckle = 0;
            if (!h.prep) { h.touch = 0.14; h.touchMax = 0.14; h.touchFoot = Math.sin(h.phase || 0) >= 0 ? 'L' : 'R'; h.touchIn = true; }
            h.nextTouch = this.now + (Math.hypot(rvx, rvy) > 1.2 ? 0.2 : sp > 0.4 ? 0.3 : 0.45) + this.rand() * 0.15;
            this.lastTouch = h.side; this._lastToucher = h; this._deflect = false; h._touchT = this.now;
            this.diagContact(h, 'conduite', { x: P.x, y: P.y, z: P.z, speed: Math.hypot(rvx, rvy), part: 'foot', dist: rr.dist, stretch: rr.stretch, q });
            this.gest.contact(h, 'conduite', 'pied', { reflex: 'touche de conduite', foot: h.touchFoot, anim: { timer: 'touch', dur: (h.touchMax || 0.14) * GS, at: 0.5 }, src: 'conduite' });
          }
        } else {
          // En course : le ballon arrive à son pied (il ne le dépasse pas) → nouvelle poussée.
          const bv = P.vx * fx + P.vy * fy;                                 // vitesse du ballon dans sa course
          if (bv < sp + 0.6) {
            const tight = h.carry?.takeon || this.pressure(h) < 4;            // collé au pied en un-contre-un
            // Au trot, des touches courtes (le ballon reste à un pas) ; lancé, il le pousse plus loin.
            const nearLine = Math.min(P.x, L - P.x, P.y, W - P.y) < 8;   // près d'une ligne : touches courtes
            // Force de la touche déduite de l'écart voulu entre le pied et le ballon (le ballon ralentit
            // d'environ 1,4 m/s² sur l'herbe : écart max ≈ push² / 2,8). Collé au pied en un-contre-un
            // (~0,15 m au-delà du pied), ~0,3 m au trot, ballon poussé loin seulement lancé dans l'espace.
            const nut = h.carry?.takeon?.move === 'petitpont' && (h.carry.takeon.def._nutmeg || 0) > this.now;
            const want = nut ? 2.5 : tight || nearLine ? 0.15 : sp > 5 ? 0.4 + (sp - 5) * 0.9 : 0.3;   // petit pont : poussé entre les jambes, assez loin derrière lui
            const push = Math.sqrt(2.8 * want) * (0.85 + this.rand() * 0.3) + (1 - dri / 100) * 0.5;
            // Un toucher en extension (pied tendu) est moins précis.
            const err = (this.rand() - 0.5) * 0.3 * (1.2 - dri / 100) * (1 + rr.stretch);
            let tx = h.carry ? h.carry.x - h.x * L : fx, ty = h.carry ? h.carry.y - h.y * W : fy;
            const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
            const a = Math.atan2(ty, tx) + err, v = sp + push;
            P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = 0;
            // Le long de la ligne, le joueur garde le ballon dans le terrain (il ne le pousse pas dehors).
            const ny = P.y + P.vy * 1.2, nx = P.x + P.vx * 1.2;
            if (ny < 0.8 || ny > W - 0.8) P.vy = (P.y < W / 2 ? 1 : -1) * Math.abs(P.vy) * 0.3;
            if (nx < 0.8 || nx > L - 0.8) P.vx = (P.x < L / 2 ? 1 : -1) * Math.abs(P.vx) * 0.3;
            // Touche avec le pied qui est devant dans la foulée (souvent l'intérieur ou l'extérieur du pied fort).
            h.touch = 0.16; h.touchMax = 0.16; h.touchFoot = Math.sin(h.phase || 0) >= 0 ? 'L' : 'R'; h.touchIn = this.rand() < 0.55;
            h.nextTouch = this.now + 0.25;
            this.lastTouch = h.side; this._lastToucher = h; this._deflect = false; h._touchT = this.now;
            this.diagContact(h, 'conduite', { x: P.x, y: P.y, z: P.z, speed: Math.abs(bv - sp), part: 'foot', dist: rr.dist, stretch: rr.stretch, q: dri / 100 });
            this.gest.contact(h, 'conduite', 'pied', { reflex: 'touche de conduite', foot: h.touchFoot, anim: { timer: 'touch', dur: (h.touchMax || 0.16) * GS, at: 0.5 }, src: 'conduite (poussée)' });
          }
        }
      }
      // Touche trop longue : le ballon lui échappe, il redevient libre.
      if (Math.hypot(h.x * L - P.x, h.y * W - P.y) > 4.5) { this.releaseBall(h); this.pending = null; }
      // (Ballon chipé : plus par proximité — un adversaire doit réellement atteindre le ballon,
      // voir contestStep, étape 4e.)
    }
    if (!glued) stepBall(P, dt);
    // But : le ballon a physiquement franchi la ligne, dans le cadre (ballPhysics) — quel que soit
    // le dernier joueur à l'avoir touché (tir, déviation, contre son camp). Rien n'est « accordé ».
    if (P.inGoal) { this.goal(out, P.inGoal > 0 ? 0 : 1); return; }
    // Sorties : touche, six mètres, corner.
    if (!this.restart && !this.celebrate) {
      if (P.y < -OUT_M || P.y > W + OUT_M) {
        this.setRestart('throw', 1 - this.lastTouch, clamp(P.x, 1, L - 1), P.y < 0 ? 0.2 : W - 0.2, out);
      } else if (P.x < -OUT_M || P.x > L + OUT_M) {
        const att = P.x > L ? 0 : 1; // équipe qui attaque ce but
        if (this.lastTouch === att) this.setRestart('goalkick', 1 - att, P.x > L ? L - 5.5 : 5.5, W / 2 + (P.y < W / 2 ? -8 : 8), out);
        else this.setRestart('corner', att, P.x > L ? L - 0.4 : 0.4, P.y < W / 2 ? 0.4 : W - 0.4, out);
      }
    }
  }

  /* ---------------- Coups de pied arrêtés ---------------- */

  setRestart(kind, side, x, y, out = null) {
    const m = this.m, T = m.teams[side];
    if (this.pending?.rec && !this.pending.rec.outcome) this.pending.rec.outcome = 'sortie sans contact';   // (diagnostic)
    this.holder = null; this.pending = null; this.inHands = false;
    if (this.shot?.resolved) this.shot = null;   // un tir non encore constaté (sorti) le sera au pas suivant
    for (const p of this.players.values()) { p.carry = null; p._dive = null; p._threat = null; }
    this.endIntents();
    let taker;
    const mates = this.list(side);
    if (kind === 'goalkick') taker = mates.find((p) => p.gk);
    else if (kind === 'corner') {
      taker = this.players.get(setPieceTaker(T, 'corner', (mp) => spec(mp, 0, eff(mp, 'pas'))).id);
      // Spécialiste trop loin : le meilleur centreur parmi les joueurs proches du corner s'en charge.
      if (!taker || this.dist(taker, x, y) > 30) taker = mates.filter((p) => !p.gk && this.dist(p, x, y) < 32).sort((a, b) => eff(b.mp, 'pas') - eff(a.mp, 'pas'))[0] || taker;
    }
    else if (kind === 'penalty') taker = this.players.get(setPieceTaker(T, 'pen', (mp) => spec(mp, 11, eff(mp, 'tir') * 0.5 + eff(mp, 'sf') * 0.5)).id);
    else taker = mates.filter((p) => !p.gk).sort((a, b) => this.dist(a, x, y) - this.dist(b, x, y))[0];
    // Coup franc direct : le spécialiste est désigné dès la faute et vient poser le ballon.
    let direct = false;
    if (kind === 'freekick') {
      const dG = Math.hypot(this.goalX(side) - x, W / 2 - y);
      if (dG < 30 && Math.abs(y - W / 2) < 18 && this.rand() < directFkChance(T.setPlan || setPlanOf(), 0.4)) {
        direct = true;
        const fk = this.players.get(setPieceTaker(T, 'fk', (mp) => spec(mp, 5, eff(mp, 'tir') + eff(mp, 'sf'))).id);
        if (fk) taker = fk;
      }
    }
    if (!taker) taker = mates[0];
    this.restart = { kind, side, x, y, taker, t: 0, direct };
    this.poss = side;
    changePossession(m, side, m.zone, taker?.mp);
    if (kind === 'corner') {
      T.stats.corners++; momentum(m, side, 2);
      // Combinaison travaillée à l'entraînement (variée d'un corner à l'autre, sans tirage au sort).
      this.restart.routine = cornerRoutine(T.setPlan || setPlanOf(), T.stats.corners, m.minute);
      if (out) emit(m, out, { type: 'corner', side, pid: taker.mp.id, x: x / L, y: y / W, zone: 3 });
    }
    if (kind === 'penalty' && out) emit(m, out, { type: 'penalty', side, pid: taker.mp.id, x: x / L, y: y / W, zone: 3 });
    if (kind === 'freekick' && out) emit(m, out, { type: 'freekick', side, pid: taker.mp.id, x: x / L, y: y / W, zone: m.zone });
    if (kind === 'freekick' || kind === 'penalty') m.stoppages += kind === 'penalty' ? 0.8 : 0.1;
    // Le ballon revient à l'endroit de la remise en jeu (renvoyé par un ramasseur ou le joueur),
    // jamais téléporté : il fait le trajet, en cloche s'il est loin.
    const P = this.P, d0 = Math.hypot(P.x - x, P.y - y);
    const rolling = Math.hypot(P.vx, P.vy) > 1 && kind !== 'freekick' && kind !== 'penalty';
    if ((d0 > 1.2 || rolling) && kind !== 'penalty') {
      this.restart.fetch = { x0: P.x, y0: P.y, z0: Math.max(BR, P.z), t: 0, T: clamp(d0 / 13, 0.45, 1.7), h: clamp(d0 * 0.09, 0.3, 3), wait: rolling ? 1.6 : 0 };
      if (!rolling) Object.assign(P, { spin: 0, top: 0, inGoal: 0, hitPost: false });
    } else Object.assign(P, { x, y, z: BR, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, inGoal: 0, hitPost: false });
    this.positioning();
  }

  /** Placement sur coup de pied arrêté. */
  restartPositions() {
    const rs = this.restart, m = this.m;
    const A = m.teams[rs.side], D = m.teams[1 - rs.side];
    const gx = this.goalX(rs.side), dir = this.dir(rs.side);
    const t = rs.taker;
    if (t) {
      const away = rs.kind === 'kickoff' ? 0 : 0.6;
      const tgtX = rs.kind === 'kickoff' ? rs.x - dir * 0.3 : rs.x - dir * away * (rs.kind === 'corner' ? -0.5 : 1);
      t.ptx = clamp(tgtX, -1, L + 1) / L; t.pty = clamp(rs.y, -1, W + 1) / W;
    }
    if (rs.kind === 'kickoff') { this.kickoffTargets(); return; }
    const nearBox = Math.abs(rs.x - gx) < 35;
    if (rs.kind === 'corner' || rs.kind === 'penalty' || (rs.kind === 'freekick' && nearBox)) {
      // Attaquants dans la surface, défenseurs au marquage ; penalty : tout le monde hors de la surface.
      let spots = [[6, -3], [8, 3], [11, 0], [5, 6], [13, -6], [16, 2]];
      const plan = A.setPlan || setPlanOf(), dPlan = D.setPlan || setPlanOf();
      const threatIds = rs.kind === 'corner' ? plan.corner.threats || [] : [];
      const aerial = (p) => eff(p.mp, 'phy') + (threatIds.includes(p.mp.id) ? 100 : 0);
      let att = this.list(rs.side).filter((p) => p !== t && !p.gk).sort((a, b) => aerial(b) - aerial(a));
      if (rs.kind === 'corner') {
        // Plan de l'équipe : n joueurs dans la surface (les menaces aériennes d'abord), un rôdeur à
        // l'entrée de la surface pour les seconds ballons, les autres restent derrière (couverture).
        const nBox = Math.max(3, Math.min(6, plan.corner.box));
        spots = [[6, -3], [8, 3], [11, 0], [5, 6], [13, -6], [9, -7]].slice(0, nBox);
        // Zone visée : les attaquants se décalent vers le poteau ou le point de penalty choisi.
        const sY = rs.y < W / 2 ? -1 : 1;
        const shift = { near: [0, -3 * sY], far: [0, 3 * sY], centre: [3, 0] }[rs.routine] || [0, 0];
        spots = spots.map(([a, b]) => [a + shift[0], b + shift[1]]);
        const inBox = att.slice(0, nBox), rest = att.slice(nBox);
        const lurk = plan.corner.lurker || rs.routine === 'low' ? rest.sort((a, b) => eff(b.mp, 'tir') - eff(a.mp, 'tir')).shift() : null;
        if (lurk) { lurk.ptx = (gx - dir * 19) / L; lurk.pty = (W / 2 + (rs.y < W / 2 ? 4 : -4)) / W; rs.lurker = lurk; }
        rest.forEach((p, i) => { p.ptx = (gx - dir * (44 + (i % 2) * 6)) / L; p.pty = (W / 2 + (i - (rest.length - 1) / 2) * 12) / W; });
        att = inBox;
      }
      // En attendant le ballon, ça bouge : appels, feintes, on se décale pour perdre son marqueur.
      // En attendant le ballon : chacun tient son poste (petit déplacement lent, pas de danse) ;
      // les vrais appels partent quand le tireur s'élance (updateRestart).
      const jig = (i) => (rs.kind === 'penalty' ? [0, 0] : [Math.sin(this.now * 0.35 + i * 1.7) * 0.4, Math.sin(this.now * 0.3 + i * 2.3) * 0.6]);
      att.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.ptx = (gx - dir * (18.5 + (i % 3))) / L; p.pty = (W / 2 + ((i % 6) - 2.5) * 5) / W; return; }
        if (i < spots.length) { const [jx, jy] = jig(i); p.ptx = (gx - dir * (spots[i][0] + jx)) / L; p.pty = (W / 2 + spots[i][1] + jy) / W; }
      });
      let defs = this.list(D.side).filter((p) => !p.gk);
      if (rs.kind === 'corner') {
        // Organisation défensive adverse : joueurs aux poteaux, joueurs laissés devant pour le
        // contre, puis marquage en zone, individuel ou mixte pour les autres.
        const sY = rs.y < W / 2 ? -1 : 1;
        const fast = defs.slice().sort((a, b) => eff(b.mp, 'vit') - eff(a.mp, 'vit'));
        const up = fast.filter((p) => !['DC', 'DG', 'DD'].includes(p.mp.p.pos)).slice(0, dPlan.def.up);
        up.forEach((p, i) => { p.ptx = (gx - dir * (L / 2 - 2)) / L; p.pty = (W / 2 + (i ? 10 : -6)) / W; });
        defs = defs.filter((p) => !up.includes(p));
        const posts = defs.slice().sort((a, b) => eff(a.mp, 'phy') - eff(b.mp, 'phy')).slice(0, dPlan.def.posts);
        posts.forEach((p, i) => { p.ptx = (gx - dir * 0.6) / L; p.pty = (W / 2 + (i ? -sY : sY) * 3.4) / W; });
        defs = defs.filter((p) => !posts.includes(p)).sort((a, b) => eff(b.mp, 'phy') + eff(b.mp, 'def') - eff(a.mp, 'phy') - eff(a.mp, 'def'));
        const zones = [[5.5, 0], [5.5, -3.5 * sY], [5.5, 3.5 * sY], [8.5, -1.5], [8.5, 2.5], [11, 0], [13, -4], [13, 4]];
        const nZone = dPlan.def.marking === 'zonal' ? defs.length : dPlan.def.marking === 'man' ? 0 : Math.min(3, defs.length);
        defs.forEach((p, i) => {
          if (i < nZone) { const [a, b] = zones[i % zones.length]; p.ptx = (gx - dir * a) / L; p.pty = (W / 2 + b) / W; return; }
          const a = att[i - nZone] || (rs.lurker && i - nZone === att.length ? rs.lurker : null);
          // Marquage individuel : côté but et côté ballon, à un bras de distance (pas collé dessus).
          if (a) { p.ptx = a.ptx - (dir * 1.2) / L; p.pty = a.pty + ((rs.y - a.pty * W) > 0 ? 0.5 : -0.5) / W; }
        });
      } else defs.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.ptx = (gx - dir * (18.5 + ((i + 1) % 3))) / L; p.pty = (W / 2 + ((i % 6) - 2.5) * 5 + 2) / W; return; }
        const a = att[i];
        if (a && i < spots.length) { p.ptx = a.ptx - (dir * 1.2) / L; p.pty = a.pty + ((rs.y - a.pty * W) > 0 ? 0.5 : -0.5) / W; }
      });
      // Corner joué à deux : un petit milieu vient se proposer à quelques mètres du tireur ;
      // un défenseur sort pour le gêner (règle des 9,15 m respectée plus bas).
      if (rs.kind === 'corner' && rs.routine === 'short') {
        if (!rs.shortP || !this.players.has(rs.shortP.mp.id)) rs.shortP = att[att.length - 1] || null;
        const sp = rs.shortP;
        if (sp) {
          const inward = rs.y < W / 2 ? 1 : -1;
          sp.ptx = clamp(rs.x - dir * 5, 1, L - 1) / L; sp.pty = clamp(rs.y + inward * 8, 1, W - 1) / W;
          const d = defs[Math.min(spots.length, att.length)] || defs[defs.length - 1]; // un défenseur sans marquage
          if (d) { d.ptx = clamp(rs.x - dir * 9, 1, L - 1) / L; d.pty = clamp(rs.y + inward * 11, 1, W - 1) / W; }
        }
      }
    }
    // Mur : 2 à 5 joueurs alignés à 9,15 m, entre le ballon et le but.
    for (const p of this.players.values()) p.wall = false;
    if (rs.kind === 'freekick') {
      const gxD = this.goalX(rs.side), dG = Math.hypot(gxD - rs.x, W / 2 - rs.y);
      if (dG < 32) {
        const n = dG < 22 ? (Math.abs(rs.y - W / 2) < 12 ? 5 : 4) : dG < 27 ? 3 : 2;
        const ux = (gxD - rs.x) / dG, uy = (W / 2 - rs.y) / dG;
        const wx = rs.x + ux * 9.15, wy = rs.y + uy * 9.15;
        const ws = this.list(D.side).filter((p) => !p.gk).sort((a, b) => this.dist(a, wx, wy) - this.dist(b, wx, wy)).slice(0, n);
        ws.forEach((p, i) => {
          const off = (i - (n - 1) / 2) * 0.62 + 0.25;
          p.ptx = clamp(wx - uy * off, 0, L) / L; p.pty = clamp(wy + ux * off, 0, W) / W; p.wall = true;
        });
      }
    }
    // Personne à moins de 9 m du ballon côté adverse.
    for (const p of this.list(D.side)) {
      if (p.wall) continue;
      if (p.gk) continue;
      const dx = p.ptx * L - rs.x, dy = p.pty * W - rs.y, d = Math.hypot(dx, dy);
      if (d < 9.2 && rs.kind !== 'penalty') { const k = 9.2 / Math.max(0.5, d); p.ptx = (rs.x + dx * k) / L; p.pty = (rs.y + dy * k) / W; }
    }
    // Devant le but : chaque joueur a SA place (au moins 1,3 m entre deux places), sinon ils se
    // marchent dessus et se bousculent en permanence en attendant le ballon.
    if (rs.kind === 'corner' || rs.kind === 'freekick') {
      const ps = [...this.players.values()].filter((p) => p !== t && !p.wall && !p.gk && Math.abs(p.ptx * L - gx) < 22);
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j];
          const dx = (b.ptx - a.ptx) * L, dy = (b.pty - a.pty) * W, d = Math.hypot(dx, dy), minD = a.side === b.side ? 2.2 : 1.15;
          if (d >= minD) continue;
          const ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : 1, push = (minD - d) / 2;
          a.ptx -= (ux * push) / L; a.pty -= (uy * push) / W; b.ptx += (ux * push) / L; b.pty += (uy * push) / W;
        }
      }
      for (const p of ps) { p.ptx = clamp(p.ptx, 0.003, 0.997); p.pty = clamp(p.pty, 0.01, 0.99); }
    }
  }

  setupKickoff(ev) {
    const m = this.m;
    this.sync();
    this.holder = null; this.pending = null; this.shot = null; this.celebrate = 0;
    // Après un but, le ballon est ramené au rond central (renvoyé du filet), pas téléporté.
    const P0 = { x: this.P.x, y: this.P.y, z: this.P.z };
    Object.assign(this.P, { x: L / 2, y: W / 2, z: BR, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, inGoal: 0, hitPost: false });
    const dB = Math.hypot(P0.x - L / 2, P0.y - W / 2);
    for (const p of this.players.values()) p.celeb = 0;
    // Tireur : l'attaquant (ou le meneur) le plus axial de l'équipe, comme en vrai.
    const slotPos = (p) => p.team.slots[p.mp.slot]?.pos;
    const taker = this.list(ev.side).filter((p) => !p.gk && ['BU', 'MO'].includes(slotPos(p))).sort((a, b) => Math.abs(a.team.slots[a.mp.slot].y - 0.5) - Math.abs(b.team.slots[b.mp.slot].y - 0.5))[0]
      || this.players.get(ev.pid) || this.list(ev.side).find((p) => !p.gk);
    this.restart = { kind: 'kickoff', side: ev.side, x: L / 2, y: W / 2, taker, t: 0 };
    if (this._goalKo && dB > 1.5) {
      Object.assign(this.P, { x: P0.x, y: P0.y, z: Math.max(BR, P0.z) });
      this.restart.fetch = { x0: P0.x, y0: P0.y, z0: Math.max(BR, P0.z), t: 0, T: clamp(dB / 18, 0.6, 2.2), h: clamp(dB * 0.12, 0.5, 6), wait: 0 };
    }
    this.poss = ev.side;
    this.endIntents();
    this._draftStamp = (this._draftStamp || 0) + 1;
    this.kickoffTargets();
    this.commitDrafts(); this.resolveIntents(0);
    // Début de mi-temps : les joueurs sont entrés sur le terrain et ont pris place avant le coup
    // de sifflet (pas de tireur qui traverse la moitié de terrain pour venir au ballon).
    if (!this._goalKo) for (const p of this.players.values()) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; p.speed = 0; p.face = p.side === 0 ? 0 : Math.PI; }
    this._goalKo = false;
  }

  /**
   * Placement à l'engagement (lois du jeu) : chacun dans SA moitié, à au moins 1,5 m de la
   * ligne médiane ; l'équipe qui ne donne pas le coup d'envoi hors du rond central (9,15 m).
   * Le tireur est au ballon, un partenaire à côté pour la passe en retrait.
   */
  kickoffTargets() {
    const rs = this.restart;
    let partner = null;
    for (const p of this.players.values()) {
      const f = formationPos(p.team, p.mp, 0.5, 0.5, p.side === rs.side, true);
      const own = -this.dir(p.side);                       // côté de sa propre moitié (−1 : x < milieu)
      let x = f.x * L, y = f.y * W;
      // Dans sa moitié, avec une marge : jamais au-delà de la ligne médiane.
      if ((x - L / 2) * own < 1.5) x = L / 2 + own * (1.5 + Math.abs((f.x - 0.5) * L) * 0.15);
      if (p.side !== rs.side) {
        const dx = x - L / 2, dy = y - W / 2, d = Math.hypot(dx, dy);
        if (d < 10.2) { const k = 10.2 / Math.max(0.5, d); x = L / 2 + dx * k; y = W / 2 + dy * k; if ((x - L / 2) * own < 1.5) x = L / 2 + own * 1.5; }
      }
      p.ptx = clamp(x, 1, L - 1) / L; p.pty = clamp(y, 1, W - 1) / W;
      if (p.side === rs.side && p !== rs.taker && !p.gk && ['BU', 'MO', 'AG', 'AD', 'MC'].includes(p.mp.p.pos)) {
        const dd = Math.hypot(x - L / 2, y - W / 2);
        if (!partner || dd < partner.d) partner = { p, d: dd };
      }
    }
    const t = rs.taker, own = -this.dir(rs.side);
    if (t) { t.ptx = (L / 2 + own * 0.35) / L; t.pty = 0.5; }
    // Partenaire à 5 m en retrait, en diagonale : c'est lui qui reçoit la première passe.
    if (partner) { partner.p.ptx = (L / 2 + own * 4) / L; partner.p.pty = (W / 2 + (partner.p.pty < 0.5 ? -3 : 3)) / W; rs.partner = partner.p; }
  }

  updateRestart(dt, out) {
    const rs = this.restart, t = rs.taker;
    rs.t += dt;
    if (!t || !this.players.has(t.mp.id)) { rs.taker = this.list(rs.side).find((p) => !p.gk); return; }
    // Temps de mise en place (le temps de jeu effectif baisse, mais tout est lisible) :
    // ballon posé, mur formé, joueurs placés, signal du tireur.
    const nearGoal = Math.hypot(this.goalX(rs.side) - rs.x, W / 2 - rs.y) < 32;
    const minT = { kickoff: 8, throw: 16, goalkick: 25, corner: 32, freekick: nearGoal ? 32 : 22, penalty: 35 }[rs.kind] * (this.tacticalMood(rs.taker?.team || this.m.teams[rs.side]).wasting ? 1.8 : 1);
    rs.minT = minT;
    const atBall = this.dist(t, rs.x, rs.y) < 1.4 && !rs.fetch;
    if (atBall && !rs.placed && rs.kind !== 'throw' && rs.kind !== 'kickoff') { rs.placed = true; t.place = 0.9; t.face = Math.atan2(rs.y - t.y * W, rs.x - t.x * L); }
    if (rs.kind === 'corner' && rs.placed && rs.t > minT - 1.4 && !rs.signal) { rs.signal = true; t.signal = 1.1; }
    t.hold = rs.kind === 'throw' && atBall ? 1 : 0;   // touche : ballon pris à deux mains
    if (t.hold) { rs.holdT = (rs.holdT || 0) + dt; if (rs.holdT < 1.0 && rs.t < 14) return; }
    if (t.hold) t.face = Math.atan2(W / 2 - rs.y, 0);
    // Engagement : chacun doit être dans sa moitié.
    let settled = true;
    if (rs.kind === 'kickoff' || rs.kind === 'penalty' || rs.kind === 'corner' || (rs.kind === 'freekick' && nearGoal)) {
      const gxR = this.goalX(rs.side);
      for (const p of this.players.values()) {
        // Corner / coup franc : seuls comptent les joueurs attendus dans la zone de vérité.
        if (rs.kind !== 'kickoff' && rs.kind !== 'penalty' && Math.abs(p.tx * L - gxR) > 24 && p !== t) continue;
        if (Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W) > (rs.kind === 'kickoff' ? 7 : 4.5)) { settled = false; break; }
        // Engagement : tout le monde dans sa moitié (et l'adversaire hors du rond central).
        if (rs.kind === 'kickoff' && (p.x * L - L / 2) * this.dir(p.side) > 0.02) { settled = false; break; }
      }
    }
    // Trop long : l'arbitre presse les retardataires, qui sprintent (personne n'est jamais déplacé
    // d'un coup) ; on reprend dès que le tireur est au ballon et que l'engagement est réglementaire.
    if (rs.t > minT + 5) rs.hurry = true;
    const kickoffOk = rs.kind !== 'kickoff' || [...this.players.values()].every((p) => (p.x * L - L / 2) * this.dir(p.side) <= 0.02);
    if (!(atBall && rs.t >= minT && (settled || (rs.hurry && kickoffOk) || rs.t > 30) && !(t.place > 0))) return;
    // Armé de la jambe avant de jouer le ballon (le geste précède le départ du ballon).
    if (rs.kind !== 'throw') {
      if (rs.go == null) { rs.go = this.now + 0.28 * 0.55 * GS; t.kick = 0.28; t.kickMax = 0.28; t.kickFoot = this.footSign(t) > 0 ? 'R' : 'L'; t.kickLoft = ['goalkick', 'corner'].includes(rs.kind); t.kickPow = ['goalkick', 'corner', 'penalty'].includes(rs.kind) ? 1 : 0.55; t.kickSide = rs.kind === 'kickoff'; t.face = Math.atan2(W / 2 - this.P.y, this.goalX(rs.side) - this.P.x); this.gest.begin(t, 'remise en jeu au pied', { foot: t.kickFoot, tPlan: rs.go, anim: { timer: 'kick', dur: 0.28 * GS, at: 0.55 }, src: rs.kind }); return; }
      if (this.now < rs.go) return;
    } else { t.throwIn = 0.6; t.hold = 0; this.gest.begin(t, 'touche', { anim: { timer: 'throwIn', dur: 0.6 * GS, at: 0.455 }, src: 'touche' }); }
    this._wall = [...this.players.values()].filter((p) => p.wall);
    for (const p of this.players.values()) p.wall = false;
    this.restart = null;
    const P = this.P;
    t.face = Math.atan2(W / 2 - P.y, this.goalX(rs.side) - P.x);
    this.holder = t; this.lastTouch = rs.side;
    const mates = this.list(rs.side).filter((p) => p !== t);
    if (rs.kind === 'penalty') { this.doShot(t, 'penalty', out); return; }
    if (rs.kind === 'corner') {
      // Corner à deux : passe courte, celui qui reçoit centre ou repique ensuite.
      if (rs.routine === 'short' && rs.shortP && rs.shortP !== t && this.players.has(rs.shortP.mp.id)) {
        const o = this.passOption(t, rs.shortP);
        if (o) { o.offside = false; o.lofted = false; this.doPass(t, o, out); return; }
      }
      // Ballon en retrait au sol pour le rôdeur posté à l'entrée de la surface.
      if (rs.routine === 'low' && rs.lurker && rs.lurker !== t && this.players.has(rs.lurker.mp.id)) {
        const o = this.passOption(t, rs.lurker);
        if (o) { o.offside = false; o.lofted = false; this.doPass(t, o, out); return; }
      }
      this._spAim = rs.routine === 'short' || rs.routine === 'low' ? 'centre' : rs.routine;
      const plan = t.team.setPlan || setPlanOf();
      const inBox = mates.filter((p) => Math.abs(this.X(p) - this.goalX(rs.side)) < 16).sort((a, b) => eff(b.mp, 'phy') + ((plan.corner.threats || []).includes(b.mp.id) ? 100 : 0) - eff(a.mp, 'phy') - ((plan.corner.threats || []).includes(a.mp.id) ? 100 : 0));
      const pick = this.rand();
      if (inBox.length && (rs.routine === 'near' || rs.routine === 'far')) {
        // Premier poteau (déviation) ou second poteau (le plus grand, au-dessus de tout le monde).
        const sideY = rs.y < W / 2 ? -1 : 1;
        const byPost = inBox.slice().sort((a, b) => (this.Y(b) - this.Y(a)) * sideY * (rs.routine === 'near' ? 1 : -1));
        this.doCross(t, byPost[pick < 0.7 ? 0 : Math.min(1, byPost.length - 1)], out); return;
      }
      if (inBox.length) { this.doCross(t, inBox[Math.floor(pick * Math.min(3, inBox.length))], out); return; }
    }
    if (rs.kind === 'freekick') {
      const dG = Math.hypot(this.goalX(rs.side) - rs.x, W / 2 - rs.y);
      if (rs.direct) { this.doShot(t, 'freekick', out); return; }
      if (dG < 40) {
        const fa = (t.team.setPlan || setPlanOf()).fk.aim;
        this._spAim = fa === 'auto' ? 'centre' : fa;
        const inBox = mates.filter((p) => Math.abs(this.X(p) - this.goalX(rs.side)) < 16);
        if (inBox.length) { this.doCross(t, inBox[Math.floor(this.rand() * inBox.length)], out); return; }
      }
    }
    if (rs.kind === 'goalkick') { this.inHands = false; this.gkDistribution(t, out); return; }
    // Engagement : première passe courte au partenaire posté en retrait.
    if (rs.kind === 'kickoff' && rs.partner && rs.partner !== t && this.players.has(rs.partner.mp.id)) {
      const o = this.passOption(t, rs.partner);
      if (o) { o.offside = false; o.lofted = false; o.p = Math.max(o.p, 0.97); this.doPass(t, o, out); return; }
    }
    // Engagement, touche, coup franc lointain : passe au coéquipier le mieux placé.
    let best = null;
    for (const r of mates) {
      if (rs.kind === 'kickoff' && (this.X(r) - L / 2) * this.dir(rs.side) > 0) continue;
      const o = this.passOption(t, r);
      if (!o) continue;
      if (rs.kind === 'throw') { if (o.tx && Math.hypot(o.tx - P.x, o.ty - P.y) > 20) continue; o.lofted = true; }
      if (!best || o.u > best.u) best = o;
    }
    if (best) { if (rs.kind === 'throw') best.offside = false; this.doPass(t, best, out); }
    else this.gain(t, out);
  }

  /* ---------------- Déplacements ---------------- */

  /**
   * ALLURE DEMANDÉE (étape 5b) : vitesse maximale que le joueur VEUT atteindre, selon son intention
   * et la situation. Ce n'est pas la vitesse réelle : move() l'atteint (ou non) par accélération,
   * freinage, virages, fatigue et attributs. Renvoie { v (m/s), pace, why }.
   * 5b-1 : regroupement à l'identique des anciens plafonds de move() (conservé : paceOld, pour comparaison).
   */
  paceOld(p) {
    let cap = Infinity;
    if (this.restart?.hurry) cap = Infinity;   // l'arbitre presse : on court se replacer
    else if (this.restart && p !== this.restart.taker) { const dd = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W); cap = dd > 25 ? 6.4 : dd > 10 ? 5 : 3.4; }
    else if (this.restart) cap = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W) > 12 ? 6.5 : 4.2;   // le tireur file vers le ballon
    else if (!globalThis.__X?.nocap && p !== this.holder && p !== this.pending?.to && !['press', 'press2', 'run', 'overlap', 'box', 'recover', 'hold', 'chase'].includes(p.role) && !p.gk) {
      // Allure selon l'urgence : on marche ou on trottine pour garder sa place, on accélère
      // seulement si l'on est loin de sa place, près de l'action, ou si l'on défend un
      // ballon qui file vers son but (on ne sprinte pas sans raison).
      const dd = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W);
      const dBall = this.dist(p, this.P.x, this.P.y);
      const own = this.goalX(1 - p.side), threatened = this.poss !== p.side && (Math.abs(this.P.x - own) < 52 || (this.P.vx * (own - this.P.x)) > 0);
      // En possession : celui qui se projette devant le ballon ou se propose au porteur y va franchement.
      const attacking = this.poss === p.side && (p.tx * L - this.P.x) * this.dir(p.side) > -2 && dBall < 40;
      const near = dBall < 15 || attacking || p.role === 'support';
      // Allures réelles (un joueur passe ~70 % du match à marcher ou trottiner) : marche < 2 m/s,
      // trot 2-4 m/s, course 4-5,5 ; le sprint est réservé au repli quand le but est menacé.
      const loose = !this.holder && !this.pending;
      if (p._idle && dd < 4) cap = 1.1; else   // petits pas autour de sa place : on marche
      cap = dd > 18 ? (threatened ? 6.2 : dBall > 30 ? 4.2 : 5) : dd > 9 ? (threatened && !loose ? 5.4 : near ? 4.4 : 3.6) : dd > 4 ? (threatened && !loose ? 4.2 : near ? 3.6 : 2.8) : dd > 1.5 ? 1.9 : 1.3;
      if (p.role === 'mark' && dd > 1.2) {
        // On suit son attaquant à SON allure : on sprinte s'il sprinte, on trottine s'il trottine.
        const a = p._markOf != null ? this.players.get(p._markOf) : null, as = a ? a.speed || 0 : 3;
        cap = Math.max(cap, as + (dd > 4 ? 3 : 1.5), dd > 6 ? 6 : 0);
      }
    } else if (!globalThis.__X?.nocap && p !== this.holder && p !== this.pending?.to && !p.gk && ['press', 'press2', 'run', 'recover', 'overlap', 'box', 'hold'].includes(p.role)) {
      // Rôles « urgents » : on court franchement, mais le sprint maximal est réservé aux vrais
      // moments décisifs (presser le porteur à bout portant, se replier quand le but est menacé,
      // un appel pour lequel la passe part).
      const dd = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W), dBall = this.dist(p, this.P.x, this.P.y);
      const own = this.goalX(1 - p.side), danger = Math.abs(this.P.x - own) < 35;
      if (p.role === 'press') cap = dBall < 6 ? Infinity : dBall < 15 ? 6.4 : 5.4;
      else if (p.role === 'press2') cap = dBall < 8 ? 6.2 : 5;
      else if (p.role === 'recover') cap = danger ? Infinity : dd > 20 ? 6.2 : 5.2;
      else if (p.role === 'run') cap = dd > 6 ? 6.6 : 5;
      else cap = dd > 10 ? 6.2 : 5;
    } else if (p === this.holder && !this.inHands && !p.carry?.takeon) {
      // Porteur libre de tout marquage : il ne fonce pas, il marche ou trottine balle au pied en
      // levant la tête (il n'accélère que pressé, en contre-attaque ou dans un espace à attaquer).
      const free = this.pressure(p);
      const A = p.team, counter = this.tacticalMood?.(A)?.counter;
      if (!counter) cap = free > 12 ? (p.waitN ? 1.5 : 3.2) : free > 7 ? 4.6 : Infinity;
    }
    // Ballon hors de portée de son pied : le porteur accélère pour le rejoindre (sinon un ballon
    // poussé un peu trop fort lui échapperait au trot).
    if (p === this.holder && !this.inHands && !p._reach) cap = Math.max(cap, Math.hypot(this.P.vx, this.P.vy) + 1.5);
    return { v: cap, pace: cap < 2 ? 'marche' : cap < 4 ? 'trot' : cap < 5.5 ? 'course' : 'sprint', why: 'plafonds' };
  }

  /**
   * ALLURE DEMANDÉE (étape 5b-2). L'intention demande une allure parmi :
   *   marche 1,3 m/s (petits pas autour de sa place 1,1) · trot 3,2 · course 5,0 · sprint 6,3 · à fond (capacité).
   * Ce n'est qu'une DEMANDE : move() n'y arrive que par accélération, freinage (cinématique), virages,
   * fatigue et attributs. Pas de palier qui baisse à mesure qu'on approche de sa cible : l'allure est
   * décidée au début du déplacement (distance à parcourir, urgence, contexte), monte immédiatement si
   * la situation l'exige, ne redescend qu'après PACE_HOLD s ; à l'arrivée (< 1 m) on repasse au pas.
   * Hors champ de 5b (inchangés) : arrêts de jeu, gardien, porteur, destinataire d'une passe.
   */
  paceOf(p) {
    if (globalThis.__X?.pace0) return this.paceOld(p);
    // Cas inchangés : hors jeu (arrêts), gardien, porteur, destinataire d'une passe (à fond).
    if (this.restart || p.gk || p === this.holder || p === this.pending?.to) return this.paceOld(p);
    const LV = PACE_LEVELS, it = p._intent, A = p._arb;
    const dd = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W), dBall = this.dist(p, this.P.x, this.P.y);
    // Début d'un déplacement : nouvelle intention, ou départ d'une place atteinte (hystérésis de l'arbitre).
    const key = it ? it.slot + '/' + it.id : '-';
    const st = (p._pc ||= { key: null, dd0: 0, lvl: 'marche', low: null });
    if (st.key !== key) st.key = key;
    // Distance restante : le joueur peut lever le pied en approchant, mais la baisse d'allure doit être
    // demandée PACE_HOLD s (pas de palier instantané) ; le dernier freinage relève de la cinématique.
    const D = dd, role = p.role, src = it?.src;
    const own = this.goalX(1 - p.side);
    let lvl, why, rel = null, fam = 'mission';
    if (p._idle && dd < 4) { lvl = 'marche'; why = 'à sa place (petits pas)'; fam = 'placement'; }
    else if (it && it.pri >= PRI.URGENCE && role !== 'press') { lvl = 'à fond'; why = 'urgence ' + src; }   // poursuite, coupe, receveur, ballon coincé
    else if (role === 'press') { lvl = dBall < 6 ? 'à fond' : dBall < 15 ? 'sprint' : 'course'; why = 'pressing'; }
    else if (role === 'press2') { lvl = dBall < 8 ? 'sprint' : 'course'; why = 'second presseur'; }
    else if (role === 'recover') { lvl = Math.abs(this.P.x - own) < 35 ? 'à fond' : D > 20 ? 'sprint' : 'course'; why = 'repli'; }
    else if (role === 'run') { lvl = D > 6 ? 'sprint' : 'course'; why = 'appel'; }
    else if (role === 'hold' || role === 'overlap' || role === 'box') { lvl = D > 10 ? 'sprint' : 'course'; why = role === 'hold' ? 'attente de l\'appel' : role === 'overlap' ? 'dédoublement' : 'surface'; }
    else {
      // Placement, soutien, couverture, contenir, marquage : selon la distance À PARCOURIR et l'urgence.
      const threatened = this.poss !== p.side && (Math.abs(this.P.x - own) < 52 || (this.P.vx * (own - this.P.x)) > 0);
      const attacking = this.poss === p.side && (p.tx * L - this.P.x) * this.dir(p.side) > -2 && dBall < 40;
      const near = dBall < 15 || attacking || role === 'support', loose = !this.holder && !this.pending;
      lvl = D > 18 ? (threatened ? 'sprint' : 'course') : D > 9 ? (threatened && !loose ? 'course' : near ? 'course' : 'trot') : D > 4 ? (threatened && !loose ? 'course' : 'trot') : 'marche';
      why = threatened ? 'replacement, but menacé' : 'replacement'; fam = 'placement'; st.threat = threatened;
      if (role === 'mark' && dd > 1.2) {
        // Marquage : il suit son attaquant à SON allure (demande relative), plus de quoi revenir.
        const a = p._markOf != null ? this.players.get(p._markOf) : null, as = a ? a.speed || 0 : 3;
        rel = Math.max(as + (dd > 4 ? 3 : 1.5), dd > 6 ? 6 : 0); why = 'marquage (allure de l\'attaquant)';
      }
    }
    st.family = fam;
    // Hystérésis : monte tout de suite, redescend seulement si la demande plus basse dure PACE_HOLD s.
    const rank = (k) => PACE_ORDER.indexOf(k);
    // Arrivée (hystérésis) : au pas sous 1 m, ne relance qu'au-delà de 3 m (ou nouvelle intention).
    if (dd < 1) st.arrived = true; else if (dd > 3 || st.key0 !== key) st.arrived = false;
    st.key0 = key;
    if (st.arrived && rank(lvl) < rank('sprint')) { lvl = 'marche'; why = 'arrivé'; }
    if (rank(lvl) >= rank(st.lvl) || (st.arrived && lvl === 'marche')) { st.lvl = lvl; st.low = null; }
    else if (st.low == null) st.low = this.now;
    else if (this.now - st.low >= PACE_HOLD) { st.lvl = lvl; st.low = null; }
    let v = why === 'à sa place (petits pas)' && st.lvl === 'marche' ? LV['petits pas'] : LV[st.lvl];
    if (rel != null) v = Math.max(v, rel);
    // Décélération voulue à l'approche : un déplacement calme ralentit tôt (on arrive en marchant),
    // un replacement pressé un peu plus tard, une urgence (sprint, à fond, marquage) au dernier moment.
    // Freinage calme réservé au placement et au soutien (on rejoint sa place) ; missions (appel, repli,
    // dédoublement, surface), pressing, marquage et urgences gardent le freinage d'avant (6 m/s²).
    const placing = st.family === 'placement';
    const brake = !placing || rel != null || st.lvl === 'sprint' || st.lvl === 'à fond' ? 6 : st.threat ? 2.5 : 1.5;
    return { v, pace: st.lvl, why: st.lvl === lvl ? why : 'maintien (' + st.lvl + ')', brake };
  }

  /** Vitesse de pointe atteignable (modèle partagé, body.js) : attribut, trait, météo, fatigue, ballon au pied. */
  capacity(p, withBall = 1) {
    return topSpeed({ vit: p.mp?.p?.attrs?.vit ?? 60, energy: p.mp?.energy ?? 100, weather: this.m.wx?.speed || 1, fusee: TR(p, 'fusee'), withBall, celeb: p.celeb > 0 });
  }

  move(dt) {
    const step = (p, maxSp, brake = 6) => {
      if (p._dive) { this.diveStep(p, dt); return; }
      if (p._tk) { this.tackleStep(p, dt); return; }   // tacle : fente / glissade imposée par le geste
      if ((p._down || 0) > this.now) { p.vx *= 0.6; p.vy *= 0.6; p.speed = Math.hypot(p.vx, p.vy); p.x += p.vx * dt / L; p.y += p.vy * dt / W; return; }   // au sol / se relève   // plongeon : trajectoire du corps imposée par la physique du geste
      const dx = (p.tx - p.x) * L, dy = (p.ty - p.y) * W;
      const dist = Math.hypot(dx, dy);
      // Pas de vitesse du modèle cinématique partagé (body.js, étape 5c) : allure demandée, freinage
      // voulu à l'approche (5b), à reculons, inertie (accélération selon l'attribut vitesse), virage lancé.
      const before = p.speed || 0;
      velocityStep(p, dx, dy, maxSp, brake, accelOf(p.mp?.p?.attrs?.vit ?? 60), dt);
      p.x += (p.vx * dt) / L; p.y += (p.vy * dt) / W;
      p.speed = Math.hypot(p.vx, p.vy);
      p.acc = dt > 0 ? (p.speed - before) / dt : 0;
      const P = this.P;
      // Orientation : vers la cible de son geste (armé), vers le ballon qui arrive (réception,
      // il ouvre le corps au lieu de lui tourner le dos), sinon dans le sens de sa course.
      let target, rate = 7;
      if (p.prep && p.faceTo != null && !p.faceBall) { target = p.faceTo; rate = 12; }
      else if (p === this.holder && p.shieldK && p.shieldFace != null && !p.faceBall) { target = p.shieldFace; rate = 6; }   // dos à l'adversaire : il protège le ballon
      else if (p.faceBall) { target = Math.atan2(P.y - p.y * W, P.x - p.x * L); rate = 10; }
      else {
        // Sans ballon, on recule face au jeu (petits pas, pas de demi-tour) quand le ballon est devant soi.
        const toBall = Math.atan2(P.y - p.y * W, P.x - p.x * L), mv = Math.atan2(p.vy, p.vx);
        // Reculer face au jeu : un défenseur qui se replace sur quelques mètres, le gardien,
        // ou un petit ajustement. Sinon on court droit devant soi (la tête suit le ballon).
        const defending = this.poss !== p.side;
        p.back = p !== this.holder && p.speed > 0.6 && Math.cos(mv - toBall) < -0.35
          && (p.gk ? p.speed < 5 : (defending && dist < 7 && p.speed < 4.6 && Math.hypot(P.x - p.x * L, P.y - p.y * W) < 25) || (dist < 1 && p.speed < 1.5));
        // Sinon il avance de face, le corps « ouvert » vers le jeu (jusqu'à ~50°), la tête sur le ballon.
        let open = toBall - mv; open = Math.atan2(Math.sin(open), Math.cos(open));
        const openK = defending || p === this.holder || ['run', 'hold', 'overlap', 'box', 'chase', 'press', 'press2', 'recover'].includes(p.role) ? 0 : 0.55;
        const openMv = mv + clamp(open, -0.9, 0.9) * openK;
        target = p.back ? toBall : p.gk && p.speed < 4 ? toBall : p.speed > 0.6 ? openMv : toBall;
      }
      let d = target - (p.face || 0);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.turnGap = Math.abs(d);
      p.face = (p.face || 0) + d * Math.min(1, dt * rate);
      // Foulée réelle : un cycle (deux pas) ≈ 4,4 m en sprint, ≈ 2,8 m en petite foulée.
      // Cadence réelle : un cycle (deux pas) ≈ 1,4 m en marchant, 2,3 m au trot, 4,4 m en sprint
      // (sinon les jambes tournent trop lentement pour la vitesse : le joueur « glisse »).
      p.phase = (p.phase || 0) + p.speed * dt * (Math.PI * 2) / (1.0 + 0.42 * p.speed);
    };
    // Descriptif du déplacement (étape 6a, lecture seule) : état du modèle cinématique 5c après le pas.
    const loco = (p) => {
      const lo = p.loco || (p.loco = {}), sp = p.speed || 0;
      const rel = sp > 0.3 ? Math.abs(Math.atan2(Math.sin(Math.atan2(p.vy, p.vx) - (p.face || 0)), Math.cos(Math.atan2(p.vy, p.vx) - (p.face || 0)))) : 0;
      lo.speed = sp; lo.vx = p.vx || 0; lo.vy = p.vy || 0; lo.acc = p.acc || 0; lo.face = p.face || 0; lo.turn = p.turnGap || 0;
      lo.mode = sp < 0.3 ? 'arrêt' : rel > 2.2 ? 'reculons' : rel > 0.9 ? 'pas chassés' : 'avant';
      lo.ctrl = p._dive ? 'plongeon' : p._tk ? 'tacle' : (p._down || 0) > this.now ? 'au sol' : 'libre';
    };
    for (const p of this.players.values()) {
      const vit = p.mp?.p?.attrs?.vit ?? 60, en = p.mp?.energy ?? 100;
      const withBall = p === this.holder && !this.inHands ? (p.carry?.takeon ? 1.0 : 0.86) * ((p.turnGap || 0) > 1.2 ? 0.35 : (p.turnGap || 0) > 0.6 ? 0.7 : 1) : 1;
      if (p.fall > 0.3 || p.slide > 0.2 || p.hurt > 0) this.setT(p, p.x, p.y);
      // Arrêt de jeu : on se replace en trottinant (on ne sprinte pas pour un coup franc).
      const pr = (p._pace = this.paceOf(p)), cap = pr.v;   // allure demandée (étape 5b) ; la vitesse réelle dépend de la cinématique
      step(p, Math.min(cap, this.capacity(p, withBall)), pr.brake); loco(p);
      // Effort réel : ce qu'il court (les sprints coûtent bien plus que le trot).
      if (p.mp && !p.celeb) { const v = p.speed || 0; p.mp.work = (p.mp.work || 0) + v * dt * (0.6 + (v / 6.5) ** 2 * 1.6); }
      const gd = dt / GS;
      if (p.diveDelay != null) { p.diveDelay -= dt; if (p.diveDelay <= 0) { p.diveDelay = null; p.dive = 0.75; } }
      for (const k of ['kick', 'slide', 'dive', 'jump', 'celeb', 'touch', 'fall', 'block', 'throwIn', 'ctrl', 'place', 'signal', 'bump', 'hurt', 'appeal', 'headHands', 'kickOut', 'skillT', 'claimHigh']) if (p[k] > 0) p[k] = Math.max(0, p[k] - gd);
    }
    // Contacts : on ne se traverse pas.
    const arr = [...this.players.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], c = arr[j];
        if (a.slide > 0 || c.slide > 0 || a.celeb > 0 || c.celeb > 0) continue;
        const dx = (c.x - a.x) * L, dy = (c.y - a.y) * W, d = Math.hypot(dx, dy);
        if (d > 1.0 || d < 1e-4) continue;
        const ux = dx / d, uy = dy / d;
        // Le plus costaud déplace l'autre (poids ≈ physique).
        const wa = 0.5 + (a.mp?.p?.attrs?.phy ?? 60) / 200, wc = 0.5 + (c.mp?.p?.attrs?.phy ?? 60) / 200;
        const ka = wc / (wa + wc), kc = wa / (wa + wc);
        // Séparation progressive (pas de saut d'une image à l'autre quand deux joueurs se percutent).
        const push = Math.min(1.0 - d, 4 * dt);
        a.x -= (ux * push * ka) / L; a.y -= (uy * push * ka) / W;
        c.x += (ux * push * kc) / L; c.y += (uy * push * kc) / W;
        // Vitesses : la composante qui les rapproche est absorbée (pas de traversée ni de rebond).
        const rv = (c.vx - a.vx) * ux + (c.vy - a.vy) * uy;
        if (rv < 0) {
          a.vx += ux * rv * ka; a.vy += uy * rv * ka;
          c.vx -= ux * rv * kc; c.vy -= uy * rv * kc;
          if (-rv > 3.5) { const kb = Math.min(0.9, -rv * 0.085); a.bump = Math.max(a.bump || 0, kb * ka * 2); c.bump = Math.max(c.bump || 0, kb * kc * 2); a.bumpDir = Math.atan2(-uy, -ux); c.bumpDir = Math.atan2(uy, ux); }
        }
        // Duel de corps (étape 4e) : deux adversaires qui se percutent près du ballon — force, taille,
        // poids, élan, orientation, placement et une part d'aléa : le plus puissant ne gagne pas toujours.
        if (a.side !== c.side && d < 0.85 && this.now > (a._duelT || 0) && this.now > (c._duelT || 0) && !a._tk && !c._tk && !a._dive && !c._dive) {
          const P = this.P, ba = Math.hypot(a.x * L - P.x, a.y * W - P.y), bc = Math.hypot(c.x * L - P.x, c.y * W - P.y);
          if (Math.min(ba, bc) < 2.5) {
            a._duelT = c._duelT = this.now + 0.6;
            const sc = (p, nx, ny, other, bd, bo) => bodyScore({ phy: eff(p.mp, 'phy') + (TR(p, 'roc') ? 6 : 0), height: p.mp.p?.height ?? 180, weight: p.mp.p?.weight ?? 75,
              push: (p.vx || 0) * nx + (p.vy || 0) * ny, facing: Math.cos(Math.atan2(ny, nx) - (p.face || 0)), ahead: bd < bo ? 1 : 0, rnd: gauss(this.rand(), this.rand()) });
            const sa = sc(a, ux, uy, c, ba, bc), sb = sc(c, -ux, -uy, a, bc, ba), diff = sa - sb;
            const lose = diff > 0 ? c : a, win = diff > 0 ? a : c, mag = Math.abs(diff);
            lose.bump = Math.max(lose.bump || 0, 0.3 + Math.min(0.4, mag)); lose.bumpDir = Math.atan2((lose.y - win.y) * W, (lose.x - win.x) * L);
            lose.vx *= 0.55; lose.vy *= 0.55;
            if (mag > 0.55 && (lose.speed || 0) > 3) { lose.fall = 0.7; lose.cd = 1.1; }
            if (this.diag) this.diag.duel(this.now, { kind: 'duel de corps', pid: win.mp.id, side: win.side, vs: lose.mp.id, margin: +mag.toFixed(2), result: lose.fall > 0 ? 'adversaire au sol' : 'adversaire déséquilibré' });
          }
        }
      }
    }
  }
}

/** Simule un match entier sans affichage (calibrage, tests). dt = pas de simulation. */
export function simulateLive(m, dt = 0.05) {
  const sim = new LiveSim(m);
  let guard = 0;
  while (m.phase !== 'ft' && guard++ < 400000) {
    sim.step(dt);
    if (m.phase === 'ht') sim.resumeHT = true;
  }
  return sim;
}
