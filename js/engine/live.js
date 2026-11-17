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
import { createBall, stepBall, solveKick, R as BR, GOAL_HALF, PITCH_L as L, PITCH_W as W } from '../ui/ballPhysics.js';
import { formationPos } from './positions.js';
import { roleFx } from '../data/constants.js';
import { setPlanOf, cornerRoutine, setPieceEdge, directFkChance } from './setPlays.js';
import { clamp } from '../core/rng.js';
import { activePlayers, eff, addRating, emit, changePossession, momentum, setPieceTaker, sendOff, injure, kickoff as engineKickoff, minuteStart, minuteEnd, stepMinute, captainCalm } from './match.js';

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

const TUNE = {   // calibré en TEMPS RÉEL : ~2,7 buts, ~23 tirs, ~20 fautes, ~80 % de passes, ~4,5 passes par possession
  clock: 1,        // secondes de match par seconde de jeu simulé (1 = temps réel)
  shotW: 0.5,        // attrait de la frappe face aux autres options
  shotCost: 5,     // coût de la perte de balle dans le choix de tirer
  carryW: 0.5,        // attrait de la conduite de balle
  keepW: 0.6,        // valeur de garder le ballon (passe sûre à un partenaire libre)
  holdU: -0.025,       // temporiser balle au pied (négatif : seulement quand les autres options sont mauvaises)
  crossW: 0.4,
  passRisk: 1.0,      // sévérité des interceptions
  lossW: 10,         // coût de la perte de balle dans le choix des passes
  tackleRate: 0.4,    // fréquence des tentatives de tacle
  foulP: 0.16,        // part des tentatives de tacle qui finissent en faute
  xg: 0.95,          // échelle du modèle d'xG géométrique
  takeonW: 0.3,       // attrait du crochet / débordement
  hold: 2.4,            // temps de réflexion avant de jouer le ballon (×)
  recv: 3.2,            // temps de contrôle à la réception (×)
  clearCorner: 0.025,  // part des dégagements d'urgence qui finissent en corner
  loftPen: 0.2,       // coût de choix d'un ballon aérien (réalisme : surtout des passes au sol)
  passErr: 0.0032,    // imprécision des passes selon la longueur
  carryLoss: 1.5,     // part du coût de perte appliquée à la conduite de balle
  backKeep: 10,        // à quel point garder le ballon en reculant vaut moins (m)
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
    for (const [id, o] of Object.entries(s.players || {})) { const p = this.players.get(+id); if (p) Object.assign(p, o, { carry: null, prep: null, kick: 0 }); }
    this.holder = s.holder != null ? this.players.get(s.holder) || null : null;
    this.pending = null; this.shot = null;
    if (s.restart) {
      const taker = this.players.get(s.restart.taker) || this.list(s.restart.side).find((p) => !p.gk);
      this.restart = { ...s.restart, taker, t: 0 };
      if (this.restart.kind === 'kickoff') this.kickoffTargets(); else this.restartPositions();
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
  tagPlayers() { for (const pl of this.players.values()) { pl.cd = pl.cd || 0; pl.next = pl.next || 0; } }

  list(side = null) { const a = [...this.players.values()]; return side == null ? a : a.filter((p) => p.side === side); }
  X(p) { return p.x * L; }
  Y(p) { return p.y * W; }
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
    if (m.phase === 'pre' || (m.phase === 'ht' && this.resumeHT)) {
      this.resumeHT = false;
      this.handle(stepMinute(m), out);
    }
    if (m.phase !== 'live') { this.idle(dt); return out; }
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
    if (m.phase !== 'live') { this.idle(dt); return out; }
    this.tick(dt, out);
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
    for (const p of this.players.values()) { p.tx = p.x; p.ty = p.y; }
    this.move(dt);
    stepBall(this.P, dt);
  }

  tick(dt, out) {
    const m = this.m, P = this.P;
    // Vérification VAR en cours : l'arbitre a la main à l'oreille, tout le monde attend.
    if (this.varT > 0) {
      this.varT -= dt;
      for (const p of this.players.values()) { p.tx = p.x; p.ty = p.y; }
      this.move(dt); stepBall(P, dt);
      if (this.varT <= 0) this.varDecision(out);
      return;
    }
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      this.move(dt); stepBall(P, dt);
      if (this.celebrate <= 0) {
        if (this.varPending) {
          this.varT = 4.2; m.stoppages += 1;
          emit(m, out, { type: 'var', side: this.varPending.side, pid: this.varPending.sc.id, outcome: 'check', reason: this.varPending.reason, x: 0.5, y: 0.5, zone: 3 });
        } else this.handle([this.kickoffEvent(this.afterGoalSide)], out);
      }
      return;
    }
    this.reshapeT += dt;
    if (this.reshapeT > 0.3) { this.reshapeT = 0; this.positioning(); }
    if (this.restart) this.updateRestart(dt, out);
    else {
      this.duelWatch(dt, out);
      this.updateHolder(dt, out);
      this.updateDefense(dt, out);
      this.updateLoose(dt, out);
    }
    this.move(dt);
    this.ballStep(dt, out);
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
    this._positioning();
    this.steadyTargets();
  }

  /**
   * Placement calme : sans ballon, un joueur ne change pas de cible à chaque réévaluation
   * (sinon il « panique » en zigzag). Petites corrections = glissement doux vers la nouvelle
   * place ; il ne repart franchement que si sa place change vraiment (> 4 m) ou s'il a une
   * mission urgente (presser, appel, dédoublement, attaque de la surface, marquage serré).
   */
  steadyTargets() {
    if (globalThis.__X?.nosteady) return;
    const urgent = new Set(['press', 'press2', 'run', 'overlap', 'box', 'recover', 'hold', 'mark', 'chase']);
    for (const p of this.players.values()) {
      if (p === this.holder || p === this.pending?.to || this.restart || p.gk || urgent.has(p.role)) { p._ax = p.tx; p._ay = p.ty; continue; }
      if (p._ax == null) { p._ax = p.tx; p._ay = p.ty; p._at = this.now; continue; }
      const dx = (p.tx - p._ax) * L, dy = (p.ty - p._ay) * W, d = Math.hypot(dx, dy);
      const span = Math.min(1, this.now - (p._at ?? this.now)); p._at = this.now;
      if ((p.role && p.role !== p._role) || d > 30) { p._ax = p.tx; p._ay = p.ty; }
      else {
        // Sa place « mentale » glisse vers la place tactique à allure de trot : il se replace en
        // trottinant au lieu de courir après une cible qui saute. Plus vite si son but est menacé.
        const own = this.goalX(1 - p.side), threatened = this.poss !== p.side && this.poss >= 0 && Math.abs(this.P.x - own) < 45;
        const vA = threatened ? 5 : this.poss === p.side ? 2.4 : 2.9;
        // « À peu près à sa place » suffit : on ne se recale que si l'écart dépasse ~3 m, puis on
        // s'arrête à 1 m (sinon 20 joueurs trottinent en permanence derrière une cible qui glisse).
        if (d > (threatened ? 2 : 3.2)) p._mv = true; else if (d < 1) p._mv = false;
        const k = !p._mv ? 0 : d > 1e-6 ? Math.min(1, (vA * span) / d) : 1;
        p._ax += (p.tx - p._ax) * k; p._ay += (p.ty - p._ay) * k;
        p.tx = p._ax; p.ty = p._ay;
      }
      p._role = p.role;
    }
  }

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
      p.tx = f1 && f0 ? f0.x + (f1.x - f0.x) * k : (f1 || f0).x;
      p.ty = f1 && f0 ? f0.y + (f1.y - f0.y) * k : (f1 || f0).y;
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
      const k = dep / Math.max(1, dB);
      p.tx = (own + (P.x - own) * k) / L;
      const latMax = dep < 6 ? GOAL_HALF - 0.4 : 9;
      p.ty = clamp(W / 2 + (P.y - W / 2) * k, W / 2 - latMax, W / 2 + latMax) / W;
      if (sgn * (p.tx * L - own) < 0.5) p.tx = (own + sgn * 0.5) / L;
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
      p.tx = clamp(presser.ix + ux * 0.9, 0, L) / L; p.ty = clamp(presser.iy + uy * 0.9, 0, W) / W; p.role = 'press';
    } else if (presser) {
      const p = presser.p, gap = 7;
      p.tx = clamp(rx + ux * gap, 0, L) / L; p.ty = clamp(ry + uy * gap, 0, W) / W; p.role = 'contain';
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
        p.tx = clamp(rx + ux * 1.2, 0, L) / L; p.ty = clamp(ry + side, 0, W) / W; p.role = 'press2';
      } else if (hiPress && h) {
        // Pressing haut : il coupe la passe vers le partenaire le plus proche du porteur.
        const mate = this.list(A.side).filter((q) => q !== h && !q.gk).sort((a, b) => this.dist(a, rx, ry) - this.dist(b, rx, ry))[0];
        if (mate) { p.tx = (rx + (this.X(mate) - rx) * 0.6) / L; p.ty = (ry + (this.Y(mate) - ry) * 0.6) / W; p.role = 'press2'; }
      } else { p.tx = (rx + ux * 7) / L; p.ty = (ry + uy * 7) / W; p.role = 'cover'; }
    }
    // Repli : dépassés, ils reviennent se placer entre le ballon et le but.
    for (const c of cand) {
      if (loose || c === presser || c === cover || c.goalSide || c.d < 3) continue;
      const k = Math.min(1, 10 / toG);
      c.p.tx = clamp(rx + (ownGoalX - rx) * Math.max(k, 0.3), 1, L - 1) / L;
      c.p.ty = clamp(c.p.ty * W + (W / 2 - c.p.ty * W) * 0.3, 2, W - 2) / W;
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
            const dz = Math.hypot(p.tx * L - ax, p.ty * W - ay), dn = Math.hypot(this.X(p) - ax, this.Y(p) - ay);
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
          const ax = clamp(this.X(a) + (a.vx || 0) * 0.6, 0.5, L - 0.5), ay = clamp(this.Y(a) + (a.vy || 0) * 0.6, 0.5, W - 0.5), dG = Math.hypot(ax - ownGoalX, ay - W / 2);
          best._markOf = a.mp.id;
          // Côté but, légèrement côté ballon ; plus serré près du but et en individuel.
          const g = Math.hypot(ownGoalX - ax, W / 2 - ay) || 1;
          const tight = (man ? 0.9 : 1.4) * (dG < 20 ? 0.75 : 1);
          const bx2 = this.P.x - ax, by2 = this.P.y - ay, bl = Math.hypot(bx2, by2) || 1;
          best.tx = clamp(ax + ((ownGoalX - ax) / g) * tight + (bx2 / bl) * 0.5, 0.5, L - 0.5) / L;
          best.ty = clamp(ay + ((W / 2 - ay) / g) * tight + (by2 / bl) * 0.5, 0.5, W - 0.5) / W;
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
        if (p.tx * L * dirD > dLine + 15) p.tx = clamp((dLine + 15) * dirD, 1, L - 1) / L;
      }
    }
    // Passe et va : le passeur poursuit sa course (une-deux possible : on le cherche dans la course).
    for (const p of attackers) {
      if (!p.goRun) continue;
      if (this.now > p.goRun.until || p.side !== poss) { p.goRun = null; continue; }
      p.tx = p.goRun.x / L; p.ty = p.goRun.y / W; p.role = 'run';
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
        p.tx = clamp(rx + dirA * (4 + i * 5), 2, L - 2) / L;
        p.ty = clamp(ry + side * (11 + i * 3), 3, W - 3) / W;
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
        fwd2.tx = clamp((lastDef + 5) * dirA, 2, L - 2) / L;
        fwd2.ty = clamp(W / 2 + Math.sign(this.Y(fwd2) - W / 2 || 1) * 9, 3, W - 3) / W;
        fwd2.role = 'run';
      }
      if (fwd && lastDef != null && rx * dirA > (dirA > 0 ? L * 0.3 : -L * 0.7)) {
        const runT = (this.now + fwd.mp.id) % 7;
        // Appel : il attend à la limite du hors-jeu puis part dans le dos (cycle de quelques secondes).
        // Appel parfois mal synchronisé (hors-jeu).
        const early = ((fwd.mp.id * 7 + Math.floor(this.now / 7)) % 3) === 0;
        fwd.tx = clamp((lastDef + (runT < 3 ? (early ? 1.2 : -0.8) : 6)) * dirA, 2, L - 2) / L;
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
        fb.tx = clamp(capX(rx + dirA * 9), 2, L - 2) / L;
        // Latéral inversé : il passe à l'intérieur (demi-espace) au lieu de longer la ligne.
        fb.ty = (fk === 'lat_inv' ? W / 2 + (ry < W / 2 ? -12 : 12) : ry < W / 2 ? 3.5 : W - 3.5) / W;
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
      best.tx = clamp(capX(sp.x), 2, L - 2) / L; best.ty = clamp(sp.y, 2, W - 2) / W;
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
      const y = p.ty * W;
      const rk = this.rkey(p);
      if (pos === 'DC') { p.ty = clamp(W / 2 + Math.sign(y - W / 2 || 1) * (hasHalf ? 17 : 13), 3, W - 3) / W; p.tx = (own + dir * (8 + depth * 0.25)) / L; }
      else if ((pos === 'DG' || pos === 'DD') && rk === 'lat_inv') { p.ty = (W / 2 + Math.sign(y - W / 2 || 1) * 9) / W; p.tx = (own + dir * (22 + depth * 0.3)) / L; }   // rentre au milieu
      else if (pos === 'DG' || pos === 'DD') { p.ty = (pos === 'DG' ? (A.side === 0 ? 4 : W - 4) : (A.side === 0 ? W - 4 : 4)) / W; p.tx = clamp(p.tx * L + dir * (rk === 'lat_def' ? 3 : 10), 2, L - 2) / L; }
      else if (rk === 'demi_def') { p.tx = (own + dir * (7 + depth * 0.2)) / L; p.ty = 0.5; }       // entre les deux centraux
      else if (pos === 'MDC' && !hasHalf) { p.tx = (own + dir * (14 + depth * 0.3)) / L; p.ty = 0.5; }
      else if (rk === 'meneur' || rk === 'regista') { p.tx = (own + dir * (17 + depth * 0.35)) / L; p.ty = clamp(p.ty * W + (W / 2 - p.ty * W) * 0.4, 3, W - 3) / W; }   // décroche pour construire
    }
  }

  /** Ligne défensive : les défenseurs restent alignés et montent / reculent ensemble. */
  defensiveLine(D, busy) {
    const dir = this.dir(D.side); // sens d'attaque de D
    const backs = this.list(D.side).filter((p) => !busy.has(p) && ['DC', 'DG', 'DD'].includes(D.slots[p.mp.slot].pos));
    if (backs.length < 2) return;
    // Hauteur commune : la moyenne de leurs positions de formation, sans dépasser le ballon.
    let line = backs.reduce((a, p) => a + p.tx * L * dir, 0) / backs.length;
    if (D.tactics.offsideTrap === 'on') line += 2.5;          // la ligne monte d'un bloc
    line = Math.min(line, this.P.x * dir - (D.tactics.offsideTrap === 'on' ? 2.5 : 4));
    for (const p of backs) p.tx = clamp(line * dir, 1, L - 1) / L;
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
      const bx = p.tx * L, by = p.ty * W;
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
      if (best) { p.tx = best.x / L; p.ty = best.y / W; }
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
    // Geste armé (passe, frappe) : il est joué même si, en pivotant, le pied s'est un peu écarté
    // du ballon (sinon le geste expirait sans partir et le joueur restait planté).
    if (h.prep && dBall < 1.9 && P.z < 0.8) {
      h.tx = h.x; h.ty = h.y; h.faceBall = false;
      if (this.now >= h.prep.at) { const pk = h.prep.pick; h.prep = null; h.next = this.now + 0.4; this.execute(h, pk, out); }
      else if (this.now > h.prep.until) h.prep = null;
      return;
    }
    if ((dBall > 0.9 && !inStride) || P.z > 0.8) { h.tx = P.x / L; h.ty = P.y / W; h.faceBall = true; return; }
    h.faceBall = false;
    // Entre deux touches, il court vers le ballon qu'il vient de pousser (il ne le dépasse pas).
    const chaseTouch = inStride && dBall > 0.7 && !h.prep;
    if (h.prep) {
      // Appui planté : il ne bouge plus, le ballon part au contact.
      h.tx = h.x; h.ty = h.y;
      if (this.now > h.prep.until) h.prep = null;
      else if (this.now >= h.prep.at) { const pk = h.prep.pick; h.prep = null; h.next = this.now + 0.4; this.execute(h, pk, out); }
      return;
    }
    if (chaseTouch) {
      // Il vise un peu au-delà du ballon pour garder son élan (pas de freinage à chaque touche).
      h.tx = clamp((P.x + P.vx * 0.7) / L, 0, 1); h.ty = clamp((P.y + P.vy * 0.7) / W, 0, 1);
      if (h.carry && (this.dist(h, h.carry.x, h.carry.y) < 1.5 || this.now > h.carry.until)) { h.carry = null; h.next = Math.min(h.next, this.now); }
    } else if (h.carry) {
      h.tx = h.carry.x / L; h.ty = h.carry.y / W;
      const pressed = this.pressure(h) < 2.2;
      if (this.dist(h, h.carry.x, h.carry.y) < 1.5 || this.now > h.carry.until || (pressed && !h.carry.takeon && !h.carry.escape && this.now > h.carry.t0 + 0.9)) { h.carry = null; h.next = Math.min(h.next, this.now); }
    } else {
      // Sans consigne : il protège le ballon s'il est pressé, sinon il avance tranquillement.
      const dir = this.dir(h.side);
      if (this.pressure(h) < 3) { h.tx = h.x; h.ty = h.y; }
      else { h.tx = clamp(h.x + (dir * 3) / L, 0.02, 0.98); h.ty = h.y; }
    }
    h.shieldK = this.pressure(h) < 2.5 ? 1 : 0;
    // Il ne frappe / passe que le ballon à portée de pied (sinon il attend la prochaine touche).
    if (this.now >= h.next && dBall < 1.5) this.decide(h, out);
  }

  /**
   * Arbitre des duels : un ballon coincé entre deux joueurs (porteur arrêté, adversaire collé)
   * ne doit jamais durer. Au-delà de 3 s, le duel se dénoue : le défenseur l'emporte (tacle),
   * ou le porteur se dégage d'une passe en retrait / d'un dégagement — selon leurs qualités.
   */
  duelWatch(dt, out) {
    const h = this.holder, P = this.P;
    const slow = Math.hypot(P.vx, P.vy) < 1.5 && (!h || (h.speed || 0) < 1.5);
    const opp = h && !this.inHands ? [...this.players.values()].find((o) => o.side !== h.side && Math.hypot(o.x * L - P.x, o.y * W - P.y) < 2.6) : null;
    const loose = !h && !this.pending && [...this.players.values()].filter((o) => Math.hypot(o.x * L - P.x, o.y * W - P.y) < 2.6).length >= 2;
    if (slow && (opp || loose) && !this.shot) this._stall = (this._stall || 0) + dt; else this._stall = 0;
    if (this._stall < 3) return;
    this._stall = 0;
    if (loose) {
      const c = [...this.players.values()].sort((a, b) => Math.hypot(a.x * L - P.x, a.y * W - P.y) - Math.hypot(b.x * L - P.x, b.y * W - P.y))[0];
      if (c) this.gain(c, out);
      return;
    }
    h.prep = null; h.carry = null; h.waitN = 0;
    // Face au gardien : il se couche sur le ballon (ou le dégage) — l'attaquant a trop attendu.
    if (opp.gk) { if (typeof this.gkCatch === 'function' && Math.abs(P.x - this.goalX(h.side)) < 16.5) this.gkCatch(opp, out); else this.gain(opp, out, true); return; }
    const att = eff(h.mp, 'dri') * 0.6 + eff(h.mp, 'pas') * 0.4, def = eff(opp.mp, 'def') * 0.75 + eff(opp.mp, 'phy') * 0.25;
    if (this.rand() < sig((def - att) / 14)) {
      opp.slide = this.rand() < 0.3 ? 0.8 : 0.5; opp.face = Math.atan2((h.y - opp.y) * W, (h.x - opp.x) * L);
      opp.team.stats.tackles++; opp.mp.tackles++;
      emit(this.m, out, { type: 'tackle', side: opp.side, pid: opp.mp.id, pid2: h.mp.id, x: P.x / L, y: P.y / W, zone: this.m.zone });
      h.cd = 2.6; h.bump = 0.6; h.bumpDir = Math.atan2((h.y - opp.y) * W, (h.x - opp.x) * L);   // le perdant est déséquilibré
      this.gain(opp, out, true);
      return;
    }
    // Le porteur se dégage : passe vers le partenaire le plus libre (souvent en retrait), sinon dégagement.
    const mates = this.list(h.side).filter((q) => q !== h).map((q) => ({ q, o: this.passOption(h, q) })).filter((x) => x.o).sort((a, b) => (b.o.p || 0) - (a.o.p || 0));
    if (mates.length) { const o = mates[0].o; o.offside = false; h.kick = 0.24; h.kickMax = 0.24; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; this.doPass(h, o, out); }
    else this.doClear(h, out);
  }

  /** Décision de la VAR : but validé (engagement) ou refusé (score corrigé, coup franc / six mètres). */
  varDecision(out) {
    const m = this.m, V = this.varPending;
    this.varPending = null;
    if (!V) return;
    emit(m, out, { type: 'var', side: V.side, pid: V.sc.id, outcome: V.cancel ? 'cancelled' : 'confirmed', reason: V.reason, x: 0.5, y: 0.5, zone: 3 });
    if (!V.cancel) { this.handle([this.kickoffEvent(1 - V.side)], out); return; }
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
    const longOk = dGoal < 25 || (press < 2.2 && (eff(h.mp, 'tir') >= 72 || TR(h, 'sniper') || chasing || A.tactics.longShots === 'high'));
    if (dGoal < 33 && (gx - hx) * dir > 2 && longOk) {
      const xg = this.xg(h, 'open');
      let w = TUNE.shotW * (1 + ment * 0.2) * ({ less: 0.55, normal: 1, more: 1.5 }[piOf(A, h.mp, 'shoot', 'normal')]);
      if (dGoal > 20) w *= { low: 0.55, mid: 1, high: 1.6 }[A.tactics.longShots] || 1;
      // Comme un vrai attaquant : on frappe dès que la fenêtre s'ouvre (entre le point de penalty
      // et l'entrée de la surface), on ne cherche pas à entrer dans le but avec le ballon.
      w *= dGoal < 6 ? 0.7 : dGoal < 11 ? 0.95 : dGoal < 16.5 ? 1.15 : dGoal < 25 ? 1.0 : 0.5;
      if (dGoal >= 16 && dGoal < 25 && press < 2.2) w *= 1 + eff(h.mp, 'tir') / 160; // espace pour armer
      if (m.minute > 75 && m.score[A.side] < m.score[D.side]) w *= 1.25;
      // Tirer, c'est (presque toujours) rendre le ballon : on compare l'occasion à la possession.
      // Une frappe de loin ne « rend » pas vraiment le ballon : corner, sortie de but, second ballon.
      const costK = dGoal > 16.5 ? 0.9 : 1;
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
    if (space > 3.5) {
      // Pas de conduite jusque dans les 6 mètres : on s'arrête vers le point de penalty pour frapper.
      const len = Math.min(space - 1.5, 12, Math.max(1.5, dGoal - 9));
      const cx = clamp(hx + dir * len, 2, L - 2), cy = clamp(hy + (W / 2 - hy) * (dGoal < 35 ? 0.25 : 0.05), 2, W - 2);
      const dri = eff(h.mp, 'dri');
      const keep = sig((space - 3) / 1.6) * (0.75 + dri / 400);
      const w = TUNE.carryW * ({ less: 0.6, normal: 1, more: 1.5 }[piOf(A, h.mp, 'dribble', 'normal')]) * (1 + ment * 0.1) * (0.6 + 0.4 * mood.drib) * (mood.counter ? 1.25 : 1);
      // Dans la surface, on ne conduit plus jusqu'au gardien : on frappe ou on donne.
      const boxK = dGoal < 13 ? 0.45 : dGoal < 18 ? 0.7 : 1;
      // Conduire, c'est aussi risquer de perdre le ballon (même coût que pour une passe ratée).
      const lossC = (1 - keep) * (this.threat(1 - A.side, hx, hy) + this.threat(A.side, hx, hy) * 1.4 + 0.012) * TUNE.lossW * TUNE.carryLoss;
      opts.push({ k: 'carry', u: (keep * this.threat(A.side, cx, cy) * w + 0.004) * boxK - lossC, x: cx, y: cy });
    }
    // Crochet / débordement : un défenseur devant, de l'espace derrière lui.
    const opp = this.frontOpponent(h);
    if (opp && opp.d > 1.8 && opp.d < 7) {
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
    if (Math.hypot(ownGx - hx, W / 2 - hy) < 22 && press < 3) opts.push({ k: 'clear', u: 0.02 });
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
    if (!h.gk && !(contact && (h.waitN || 0) >= 2) && (h.waitN || 0) < 3) {
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
      h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L';   // frappe et passe du pied fort
      h.kickLoft = pick.k === 'cross' || pick.k === 'clear' || (pick.k === 'pass' && pick.lofted);
      // Le ballon part à l'instant exact où le pied le touche dans l'animation (55 % du geste).
      h.prep = { pick, at: this.now + h.kick * 0.55 * GS, until: this.now + h.kick * 0.55 * GS + 0.5 };
      P.vx *= 0.3; P.vy *= 0.3;   // dernier contact pour placer le ballon avant la frappe
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
    else if (pick.k === 'carry') { h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + (pick.escape ? 0.9 : 1.2 + this.rand() * 1.4), escape: !!pick.escape }; h.next = h.carry.until; }
    else if (pick.k === 'takeon') {
      // Le crochet est joué : réussi, le défenseur se jette dans le vide ; raté, il gagne le duel.
      h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + 2.2, takeon: { def: pick.opp, win: this.rand() < pick.pWin, move: pick.move } };
      h.next = h.carry.until;
      // Le geste se joue à l'approche du défenseur (animation) ; le jongle lève déjà le ballon.
      h.skill = pick.move; h.skillT = SKILL_DUR[pick.move] || 0.5; h.skillMax = h.skillT;
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
    if (offside) p *= this.m.teams[1 - A.side].tactics.offsideTrap === 'on' ? 0.95 : 0.76;
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
    const keepDir = cutback ? 1 : back > 3 ? Math.exp(-(back - 3) / (pressed ? 14 : TUNE.backKeep)) : 1;
    const val = (this.threat(A.side, tx, ty) * (1 + ment * 0.05) * fwd * (cutback ? 2.1 : 1) * oneTwo + keep * backK * keepDir) * lenW * dirW * lane;
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
    // Hors-jeu : sifflé au départ du ballon (l'assistant lève son drapeau).
    if (o.offside && this.rand() < (this.m.teams[1 - A.side].tactics.offsideTrap === 'on' ? 0.97 : 0.85)) {
      A.stats.offsides++;
      this.kickBall(h, o.tx, o.ty, o.lofted);
      emit(m, out, { type: 'offside', side: A.side, pid: o.r.mp.id, x: o.tx / L, y: o.ty / W, zone: m.zone });
      this.setRestart('freekick', 1 - A.side, this.X(o.r), this.Y(o.r));
      return;
    }
    const ok = this.rand() < o.p;
    let tx = o.tx, ty = o.ty, to = o.r;
    // Passe ratée : soit coupée par un adversaire, soit mal dosée / mal ajustée (le ballon
    // file dans le vide, parfois en touche), comme dans un vrai match.
    if (!ok && (!o.worst || this.rand() < (o.lofted ? 0.5 : 0.32))) {
      const ang = Math.atan2(ty - P.y, tx - P.x) + (this.rand() - 0.5) * (o.lofted ? 1.0 : 0.8);
      const len = Math.hypot(tx - P.x, ty - P.y) * (0.7 + this.rand() * 0.8);
      const T = this.kickBall(h, P.x + Math.cos(ang) * len, P.y + Math.sin(ang) * len, o.lofted);
      this.pending = null;
      o.r.tx = (P.x + Math.cos(ang) * len * 0.8) / L; o.r.ty = clamp(P.y + Math.sin(ang) * len * 0.8, 0, W) / W;
      void T;
      return;
    }
    if (!ok && o.worst) { to = o.worst.o; tx = o.worst.x; ty = o.worst.y; }
    const T = this.kickBall(h, tx, ty, o.lofted);
    this.pending = { to, ok, from: h, t0: this.now, T, through: o.through };
    to.tx = tx / L; to.ty = ty / W;
    if (ok) m.lastPasser = h.mp;
    if (ok && !o.lofted) this.planGiveGo(h, to, tx, ty);
    if (o.lofted || o.through) emit(m, out, { type: o.lofted ? 'longpass' : 'pass', side: A.side, pid: h.mp.id, pid2: o.r.mp.id, x: tx / L, y: ty / W, zone: m.zone });
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
    const f = this.foot(h);
    if (Math.hypot(f.x - P.x, f.y - P.y) < 0.4 && P.z < 0.5) { P.x = f.x; P.y = f.y; }
    const len = Math.hypot(tx - P.x, ty - P.y);
    if (h.throwIn > 0) P.z = 2.0;                       // touche : le ballon part des mains, au-dessus de la tête
    else if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = lofted ? 0.85 : 0.5; h.kickSide = !lofted; h.kickLoft = lofted; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; }
    h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side;
    P.inGoal = 0; P.hitPost = false;
    if (!lofted) return solveKick(P, { x: tx, y: ty }, { mode: 'ground', arrive: Math.min(12, 6 + len * 0.16) });
    return solveKick(P, { x: tx, y: ty, z: z ?? (0.4 + this.rand() * 1.1) }, { T: 0.9 + len / 30, spin: h.throwIn > 0 ? 0 : this.footSign(h) * (0.5 + this.rand() * 3.5), top: h.throwIn > 0 ? 0 : 2.2 }); // longue passe : brossée de l'intérieur, rétro (elle « tient » en l'air)
  }

  releaseBall(h) {
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
    const f = this.foot(h);
    if (Math.hypot(f.x - P.x, f.y - P.y) < 0.4) { P.x = f.x; P.y = f.y; }
    if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = 0.85; h.kickLoft = true; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; } h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side;
    const len = Math.hypot(tx - P.x, ty - P.y);
    // Centre brossé de l'intérieur du pied (rentrant ou sortant selon le pied et le côté), parfois de l'extérieur.
    const cf = this.footSign(h) * (this.rand() < 0.15 && eff(h.mp, 'pas') >= 76 ? -0.8 : 1);
    const T = solveKick(P, { x: tx, y: ty, z: 1.8 + this.rand() * 0.5 }, { T: 0.95 + len / 32, spin: cf * (7 + this.rand() * 5) * (swing > 0 ? 1 : 0.6), top: 1.2 });
    // Duel aérien : l'attaquant visé contre le défenseur le plus proche (le gardien sort parfois).
    const D = m.teams[1 - A.side];
    const def = this.list(D.side).filter((p) => !p.gk).sort((a, b) => Math.hypot(this.X(a) - tx, this.Y(a) - ty) - Math.hypot(this.X(b) - tx, this.Y(b) - ty))[0];
    const gk = this.list(D.side).find((p) => p.gk);
    const delivery = eff(h.mp, 'pas') * 0.7 + eff(h.mp, 'vis') * 0.3;
    const att = eff(r.mp, 'phy') * 0.55 + eff(r.mp, 'tir') * 0.25 + eff(r.mp, 'sf') * 0.2;
    const dfn = def ? eff(def.mp, 'phy') * 0.5 + eff(def.mp, 'def') * 0.5 : 40;
    // Coup de pied arrêté : combinaison travaillée contre l'organisation défensive adverse.
    const spE = this._spAim ? setPieceEdge(A.setPlan || setPlanOf(), D.setPlan || setPlanOf(), this._spAim, A.cpaCoach, D.cpaCoach) : 0;
    this._spAim = null;
    let win = sig((delivery - m.level) / 18 + (att - dfn) / 14 - 0.55 + spE);
    const gkClaim = gk && Math.abs(tx - gx) < 6 && this.rand() < 0.35;
    let to = r;
    if (gkClaim) to = gk; else if (this.rand() > win && def) to = def;
    this.pending = { to, ok: to === r, from: h, t0: this.now, T, aerial: true };
    to.tx = tx / L; to.ty = ty / W;
    if (to === r) m.lastPasser = h.mp;
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
    const toTouch = Math.abs(this.Y(h) - W / 2) > 18 && this.rand() < 0.22;   // « en touche ! » (dans l'urgence)
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
    if (kind === 'freekick') for (const p of this._wall || []) p.jump = 0.45;   // le mur saute
    const m = this.m, A = h.team, D = m.teams[1 - A.side], P = this.P;
    const gx = this.goalX(A.side), gdir = this.dir(A.side), cy = W / 2;
    const xg = this.xg(h, kind);
    this.releaseBall(h);
    const gk = this.list(D.side).find((p) => p.gk);
    // Contre : défenseurs sur la trajectoire.
    let blocker = null, pBlock = 0;
    if (kind !== 'penalty') {
      for (const o of this.list(D.side)) {
        if (o.gk) continue;
        const sx = this.X(h), sy = this.Y(h), vx = gx - sx, vy = cy - sy, len2 = vx * vx + vy * vy;
        const s = ((this.X(o) - sx) * vx + (this.Y(o) - sy) * vy) / len2;
        if (s <= 0.03 || s >= 0.95) continue;
        const d = Math.hypot(this.X(o) - (sx + vx * s), this.Y(o) - (sy + vy * s));
        if (d < 1.4) { pBlock += 0.32 * (1 - d / 1.4); if (!blocker || d < blocker.d) blocker = { o, d, x: sx + vx * s, y: sy + vy * s }; }
      }
    }
    pBlock = Math.min(0.6, pBlock);
    const keeper = gk ? eff(gk.mp, 'arr') * 0.85 + eff(gk.mp, 'sf') * 0.15 : 20;
    const kf = clamp(1 + (m.level - 6 - keeper) / 100 * 0.7, 0.65, 1.3);
    // Traits du tireur et du gardien.
    const dShot = Math.hypot(gx - this.X(h), cy - this.Y(h));
    let tb = 1;
    if (kind === 'penalty') tb *= (TR(h, 'tueur') ? 1.12 : 1) * (gk && TR(gk, 'stoppeur') ? 0.82 : 1);
    else if (kind === 'freekick') tb *= TR(h, 'coupsfrancs') ? 1.6 : 1;
    else if (kind === 'header') tb *= TR(h, 'tete') || TR(h, 'tour') ? 1.18 : 1;
    else { if (dShot > 18 && TR(h, 'sniper')) tb *= 1.3; if (dShot <= 16 && TR(h, 'renard')) tb *= 1.15; if (xg > 0.25 && TR(h, 'tueur')) tb *= 1.1; }
    // Joueurs importés : penalty / coup franc selon leur note détaillée (12/20 = neutre).
    if (kind === 'penalty' && det20(h.mp, 11)) tb *= clamp(1 + (det20(h.mp, 11) - 12) * 0.012, 0.9, 1.1);
    if (kind === 'freekick' && det20(h.mp, 5)) tb *= clamp(1 + (det20(h.mp, 5) - 12) * 0.05, 0.7, 1.4);
    if (TR(h, 'clutch') && m.minute >= 75) tb *= 1.08;
    if (gk && TR(gk, 'mur')) tb *= 0.88;
    // Mauvais pied : environ une frappe sur trois part du pied faible ; 1 étoile = gros handicap, 5 = aucun.
    if (kind !== 'header' && kind !== 'penalty') tb *= 1 - (5 - (h.mp.p?.wf ?? 3)) * 0.025;
    const goalP = clamp(xg * kf * tb / (1 - pBlock), 0, 0.95);
    A.stats.shots++; h.mp.shots++;
    A.stats.xg += xg;
    m.xgTimeline.push({ minute: m.minute, extra: m.extra, side: A.side, xg, goal: false });
    momentum(m, A.side, 4 + xg * 30);
    let o;
    if (blocker && this.rand() < pBlock) o = 'blocked';
    else if (this.rand() < goalP) o = 'goal';
    else {
      const onP = kind === 'penalty' ? 0.7 : clamp((0.3 + (eff(h.mp, 'tir') - (m.level - 16)) / 220 + xg * 0.4) * (m.wx?.aim || 1), 0.15, 0.6);
      o = this.rand() < onP ? 'saved' : this.rand() < 0.07 ? 'post' : 'wide';
    }
    // Frappe non cadrée déviée par un défenseur : corner.
    if (o === 'wide' && blocker && this.rand() < 0.3) o = 'blocked';
    // Trajectoire selon l'issue et la technique (la physique fait le reste).
    const r1 = this.rand(), r2 = this.rand(), r3 = this.rand();
    const tech = kind === 'open' ? (h.shotTech || this.shotTech(h)) : kind;
    h.shotTech = null;
    // Côté visé : plutôt le petit filet opposé (« ouvrir le pied ») quand on frappe de biais.
    const far = -Math.sign(this.Y(h) - cy || 1);
    const side = r2 < (tech === 'finesse' || tech === 'curl' ? 0.7 : 0.55) ? far : -far;
    let tgt;
    let speed = { penalty: 24, header: 13, freekick: 23, finesse: 19 + r1 * 4, curl: 22 + r1 * 4, chip: 15, drive: 26 + r1 * 7 }[tech] || 26;
    // Effet selon le PIED : l'intérieur du pied droit enroule de droite à gauche (rotation
    // positive), l'extérieur (« trivela ») dans l'autre sens ; c'est l'inverse pour un gaucher.
    // Le sens dont on a besoin pour ramener le ballon vers le but décide du geste.
    const need = -side * gdir;                       // sens d'enroulé qui ramène le ballon vers le cadre
    const foot = this.footSign(h);                   // +1 droitier, -1 gaucher
    const skill = eff(h.mp, 'tir') * 0.5 + eff(h.mp, 'dri') * 0.5;
    let spin = 0, top = 0, knuckle = 0, how = '';
    if (kind === 'freekick') {
      if (r1 < 0.22 && eff(h.mp, 'tir') >= 72) { knuckle = 1 + r3 * 5; speed = 28 + r2 * 4; top = 0; how = 'flottante'; } // frappe flottante « à la Juninho »
      else { spin = foot * (8 + r3 * 4); top = -3; how = 'enroulée'; }
    } else if (tech === 'curl' || tech === 'finesse') {
      const mag = tech === 'curl' ? 9 + r3 * 4 : 4 + r3 * 3;
      if (need === foot) { spin = need * mag; how = 'intérieur du pied'; }
      else if (skill >= 74 && r1 < 0.45) { spin = need * mag * 0.8; how = 'extérieur du pied'; } // trivela
      else if ((h.mp.p?.wf ?? 3) >= 4) { spin = need * mag * 0.85; how = 'pied faible'; h.kickFoot = h.kickFoot === 'L' ? 'R' : 'L'; } // bon pied faible : il enroule de l'autre pied
      else { spin = foot * mag * 0.35; how = 'mauvais pied'; }    // ouvre moins, finit souvent à côté
    } else if (tech === 'drive') {
      // Frappe sèche : légère rotation, parfois sans aucune rotation (flottante) quand elle est très appuyée.
      if (r1 < 0.18 && speed > 28) { knuckle = 1 + r3 * 5; how = 'flottante'; }
      else { spin = foot * (r3 - 0.3) * 3; top = r1 < 0.5 ? -2.5 : 1; how = top < 0 ? 'qui plonge' : 'sèche'; }
    } else if (tech === 'chip') top = -4;
    h.lastHow = how;
    if (how === 'extérieur du pied') { h.kickSide = false; h.kickOut = 0.35; }
    const low = r1 < (tech === 'finesse' ? 0.75 : 0.55);
    const zIn = tech === 'chip' ? 1.5 + r1 * 0.7 : low ? 0.15 + r3 * 0.5 : 1.3 + r3 * 0.9;
    if (o === 'goal') tgt = { x: gx + gdir * 0.9, y: cy + side * (GOAL_HALF - 0.35 - r3 * 0.9), z: zIn };
    else if (o === 'saved') tgt = { x: gx - gdir * 0.7, y: cy + side * (GOAL_HALF - 1.1) * (0.25 + r3 * 0.7), z: Math.min(2, zIn) };
    else if (o === 'post') tgt = r1 < 0.3 ? { x: gx, y: cy + side * (1 + r2 * 2), z: 2.5 } : { x: gx, y: cy + side * (GOAL_HALF + 0.12), z: 0.4 + r2 * 1.6 };
    else if (o === 'blocked') tgt = { x: blocker.x, y: blocker.y, z: 0.4 + r1 * 0.5 };
    else tgt = r2 < 0.35 ? { x: gx + gdir * 0.6, y: cy + side * r3 * GOAL_HALF, z: 2.6 + r1 * 0.9 } : { x: gx + gdir * 0.6, y: cy + side * (GOAL_HALF + 0.5 + r1 * 3.5), z: 0.2 + r2 * 1.5 };
    if (tech === 'chip') speed = Math.max(11, Math.hypot(tgt.x - P.x, tgt.y - P.y) / 1.5);
    const f = this.foot(h);
    if (kind !== 'header' && Math.hypot(f.x - P.x, f.y - P.y) < 0.4 && P.z < 0.5) { P.x = f.x; P.y = f.y; }
    if (kind === 'header') h.jump = 0.45; else if (!(h.kick > 0)) { h.kick = 0.32; h.kickMax = 0.32; h.kickPow = tech === 'drive' ? 1 : 0.8; h.kickSide = tech === 'finesse'; h.kickLoft = false; h.kickFoot = this.footSign(h) > 0 ? 'R' : 'L'; }
    h.lastTech = tech;
    h.face = Math.atan2(tgt.y - P.y, tgt.x - P.x);
    this.lastTouch = A.side;
    P.inGoal = 0; P.hitPost = false;
    const d = Math.hypot(tgt.x - P.x, tgt.y - P.y, tgt.z - P.z);
    const T = solveKick(P, tgt, { T: Math.max(0.25, d / speed), spin, top, knuckle });
    this.shot = { side: A.side, outcome: o, shooter: h, gk, at: this.now + T, kind, xg, how, blocker: blocker?.o, catchIt: speed < 27 && r2 < 0.42 * (m.wx?.grip || 1) * (gk && TR(gk, 'chat') ? 1.35 : 1) };
    this.pending = null;
    // Le gardien plonge vers le ballon au bon moment (trop tard s'il y a but).
    if (gk && o !== 'blocked') {
      gk.tx = (gx - gdir * 0.8) / L;
      gk.ty = (cy + (tgt.y - cy) * (o === 'saved' ? 0.6 : 0.15)) / W;
      const lat = tgt.y - this.Y(gk);
      if (Math.abs(lat) > 0.9 || tgt.z > 1.6) { gk.diveDelay = Math.max(0, T - 0.35); gk.diveDir = Math.sign(lat) || 1; gk.diveH = Math.min(1, tgt.z / 2.2); }
    }
    const ev = emit(m, out, { type: 'shot', side: A.side, pid: h.mp.id, xg: +xg.toFixed(2), kind, zone: 3, outcome: o, x: tgt.x / L, y: tgt.y / W, how: how || undefined,
      ax: +(gx > L / 2 ? h.x : 1 - h.x).toFixed(3), ay: +(gx > L / 2 ? h.y : 1 - h.y).toFixed(3) });
    if (o === 'saved') { A.stats.onTarget++; D.stats.saves++; addRating(h.mp, 0.08); if (gk) { gk.mp.saves++; addRating(gk.mp, 0.2 + xg * 0.8); } ev.pid2 = gk?.mp.id ?? null; }
    if (o === 'blocked' && blocker) { ev.pid2 = blocker.o.mp.id; addRating(blocker.o.mp, 0.08); }
    if (o === 'post') addRating(h.mp, 0.05);
  }

  /** But : score, buteur, passeur, notes, puis célébration et engagement. */
  goal(out) {
    const m = this.m, s = this.shot, A = m.teams[s.side], D = m.teams[1 - s.side];
    const sc = s.shooter.mp;
    A.stats.onTarget++;
    m.score[s.side]++;
    sc.goals++; addRating(sc, 1.0);
    const tl = m.xgTimeline[m.xgTimeline.length - 1];
    if (tl) tl.goal = true;
    const assist = m.lastPasser && m.lastPasser !== sc && A.onPitch.includes(m.lastPasser) && s.kind !== 'penalty' && s.kind !== 'freekick' ? m.lastPasser : null;
    if (assist) { assist.assists++; addRating(assist, 0.6); }
    if (s.gk) addRating(s.gk.mp, -0.3);
    for (const mp of activePlayers(D)) if (['DC', 'DG', 'DD'].includes(D.slots[mp.slot].pos)) addRating(mp, -0.12);
    momentum(m, s.side, 18);
    m.stoppages += 0.6;
    m.goals.push({ side: s.side, pid: sc.id, name: sc.name, minute: m.minute, extra: m.extra, pen: s.kind === 'penalty', assist: assist ? assist.name : null });
    emit(m, out, { type: 'goal', side: s.side, pid: sc.id, pid2: assist ? assist.id : null, kind: s.kind, how: s.how || undefined, x: this.P.x / L, y: this.P.y / W, zone: 3 });
    // Célébration : le buteur file vers le poteau de corner, ses coéquipiers le rejoignent.
    const cx = s.side === 0 ? 0.97 : 0.03, cyy = this.P.y < W / 2 ? 0.06 : 0.94;
    // Chaque buteur a sa célébration fétiche (le plus souvent), parfois une autre.
    const CELEBS = ['plane', 'knees', 'fist', 'point', 'jump', 'slide', 'salute', 'ear', 'shush', 'heart', 'cool', 'badge', 'flex'];
    const cr = this.rand();
    s.shooter.celebType = CELEBS[cr < 0.6 ? (sc.id * 7 + 3) % CELEBS.length : Math.floor(cr * CELEBS.length)];
    for (const p of this.players.values()) {
      if (p.side === s.side && !p.gk) {
        p.celeb = p === s.shooter ? 3.2 : 2.6;
        // Les coéquipiers serrent le buteur dans leurs bras (ou sautent autour de lui).
        if (p !== s.shooter) p.celebType = p.mp.id % 3 ? 'hug' : 'jump';
        p.tx = cx + (this.rand() - 0.5) * 0.05; p.ty = cyy + (this.rand() - 0.5) * 0.08;
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

  updateDefense(dt, out) {
    const h = this.holder;
    if (!h || this.inHands) return;
    const m = this.m, D = m.teams[1 - h.side];
    // Un seul duel à la fois sur le porteur (pas de rafale de tacles).
    this.duelCd = (this.duelCd || 0) - dt;
    if (this.duelCd > 0) return;
    for (const o of this.list(D.side)) {
      if (o.gk && Math.abs(this.X(o) - this.goalX(h.side)) > 16) continue;
      o.cd -= dt;
      if (o.cd > 0 || o.fall > 0 || o.slide > 0) continue; // au sol ou en plein geste : pas de nouveau duel
      const d = Math.hypot((o.x - h.x) * L, (o.y - h.y) * W);
      if (d > ((h.speed || 0) < 1.2 ? 2.0 : 1.4)) continue;   // porteur arrêté : on peut aller le chercher d'un pas
      if (o.role !== 'press' && o !== h.carry?.takeon?.def && d > 0.9) continue; // seul le presseur va au duel
      const press = LVL[D.tactics.pressing] || 0;
      // Par derrière : on tente rarement (et c'est plus souvent faute).
      const hs = Math.hypot(h.vx || 0, h.vy || 0);
      const behind = hs > 1.5 && (((o.x - h.x) * L * (h.vx || 0) + (o.y - h.y) * W * (h.vy || 0)) / hs) < -0.6;
      if (behind && (h.speed || 0) > 1.2 && this.rand() < 0.7) { o.cd = 0.6; continue; }
      this.duelCd = 0.9 + this.rand() * 0.5;
      o.tk = this.rand() < 0.35 ? 'slide' : 'stand';
      const to = h.carry?.takeon;
      if (to && to.def === o) {
        o.cd = 1.2;
        if (to.win) {
          // Geste réussi : le défenseur est éliminé (il se jette dans le vide, ou reste planté).
          const P = this.P, mv = to.move;
          const ang = Math.atan2(h.carry.y - P.y, h.carry.x - P.x);
          if (mv === 'petitpont') { P.vx = Math.cos(ang) * 6.5; P.vy = Math.sin(ang) * 6.5; P.vz = 0; o.cd = 2.2; }        // entre les jambes
          else if (mv === 'sombrero') { P.vx = Math.cos(ang) * 3.6; P.vy = Math.sin(ang) * 3.6; P.vz = 6.4; P.top = 0; P.spin = 0; o.jump = 0.45; o.cd = 2.2; } // par-dessus la tête
          else if (mv === 'talon') { P.vx = Math.cos(ang) * 5; P.vy = Math.sin(ang) * 5; }
          else o.slide = o.tk === 'slide' || this.rand() < 0.5 ? 0.9 : 0;
          if (!o.slide) o.bump = 0.5; // planté sur place, déséquilibré
          o.cd = Math.max(o.cd, 1.8); h.carry.takeon = null;
          if (mv && SKILL_MOVES[mv]?.stars >= 3) emit(m, out, { type: 'skill', side: h.side, pid: h.mp.id, pid2: o.mp.id, move: mv, x: P.x / L, y: P.y / W, zone: m.zone });
          h.team.stats.dribbles = (h.team.stats.dribbles || 0) + 1; addRating(h.mp, 0.06);
          if (this.rand() < 0.5) emit(m, out, { type: 'dribble', side: h.side, pid: h.mp.id, pid2: o.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
          continue;
        }
        // Raté : le défenseur lit l'action et récupère le ballon (ou commet une faute).
        // Dans sa surface, le défenseur se retient aussi ici (sinon : un penalty par dribble raté).
        const inOwnBox = Math.abs(this.P.x - this.goalX(h.side)) < 16.5 && Math.abs(this.P.y - W / 2) < 20.15;
        if (this.rand() < TUNE.foulP * 0.5 * (m.profile.fouls || 1) * (inOwnBox ? 0.15 : 1)) { this.foul(h, o, out); return; }
        o.slide = o.tk === 'slide' ? 0.8 : 0.55; h.fall = o.tk === 'slide' ? 1.4 : this.rand() < 0.3 ? 0.7 : 0; h.cd = 2.4;
        D.stats.tackles++; o.mp.tackles++; addRating(o.mp, 0.06);
        emit(m, out, { type: 'tackle', side: D.side, pid: o.mp.id, pid2: h.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
        this.gain(o, out, true);
        return;
      }
      o.cd = 0.55 + this.rand() * 0.5 - press * 0.1;
      // Porteur arrêté (il protège le ballon) : le défenseur au contact va le chercher.
      const still = (h.speed || 0) < 1.2 ? 1.8 : 1;
      if (this.rand() > Math.min(0.95, (0.5 + press * 0.12) * TUNE.tackleRate * still)) continue;
      // Tentative de tacle : faute, ballon récupéré, ou dribble réussi du porteur.
      const tk = TK[D.tactics.tackling] || 0;
      // Dans sa propre surface, un défenseur se retient (sinon c'est penalty).
      const ownBox = Math.abs(this.P.x - this.goalX(h.side)) < 16.5 && Math.abs(this.P.y - W / 2) < 20.15;
      const foulP = TUNE.foulP * this.ref.whistle * (m.profile.fouls || 1) * (1 + tk * 0.35) * (TR(o, 'rugueux') ? 1.35 : 1) * (TR(o, 'sangchaud') ? 1.2 : 1) * ((h.speed || 0) > 5 ? 1.3 : 1) * (ownBox ? 0.015 : 1) * (behind ? 2.2 : 1) * (h.prep ? 0.35 : 1) * ((h.speed || 0) < 1.2 ? 0.6 : 1);
      o.face = Math.atan2((h.y - o.y) * W, (h.x - o.x) * L);
      if (this.rand() < foulP) { this.foul(h, o, out); return; }
      const att = eff(h.mp, 'dri') * 0.75 + eff(h.mp, 'phy') * 0.25;
      const def = eff(o.mp, 'def') * 0.75 + eff(o.mp, 'phy') * 0.25;
      if (this.rand() < sig((def - att) / 13 - 0.25 + (TR(o, 'roc') ? 0.45 : 0) + (TR(o, 'rugueux') ? 0.2 : 0) + (TR(o, 'guerrier') ? 0.15 : 0) - (TR(h, 'magicien') ? 0.4 : 0))) {
        o.slide = o.tk === 'slide' ? 0.9 : 0.55; h.fall = o.tk === 'slide' ? 1.4 : this.rand() < 0.3 ? 0.7 : 0; h.cd = 2.4;
        D.stats.tackles++; o.mp.tackles++; addRating(o.mp, 0.06);
        emit(m, out, { type: 'tackle', side: D.side, pid: o.mp.id, pid2: h.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
        // Souvent, le tacle ne fait que chasser le ballon : il roule (parfois en touche).
        if (o.tk === 'slide' || this.rand() < 0.3) {
          const P = this.P, a = Math.atan2((h.y - o.y) * W, (h.x - o.x) * L) + (this.rand() - 0.5) * 1.6, v = 3.5 + this.rand() * 4.5;
          this.releaseBall(h); this.pending = null; this.lastTouch = D.side;
          P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = this.rand() < 0.3 ? 2 : 0;
          return;
        }
        this.gain(o, out, true);
        return;
      }
      // Dribble réussi : le défenseur est éliminé un instant.
      o.fall = 0.5; o.cd = 1.6;
      h.team.stats.dribbles = (h.team.stats.dribbles || 0) + 1; addRating(h.mp, 0.05);
      if (this.rand() < 0.3) emit(m, out, { type: 'dribble', side: h.side, pid: h.mp.id, pid2: o.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
    }
  }

  /** Faute : coup franc (ou penalty dans la surface), cartons, blessure éventuelle. */
  foul(victim, offender, out) {
    const m = this.m, A = victim.team, D = offender.team;
    D.stats.fouls++; offender.mp.fouls++;
    addRating(offender.mp, -0.06);
    offender.slide = 0.9; victim.fall = 2.0;
    const fx = this.P.x, fy = this.P.y;
    const z = m.zone;
    emit(m, out, { type: 'foul', side: D.side, pid: offender.mp.id, pid2: victim.mp.id, x: fx / L, y: fy / W, zone: z });
    m.stoppages += 0.15;
    let yP = 0.105 + (z === 1 || z === 2 ? 0.04 : 0) + (m.minute > 75 ? 0.04 : 0) + (z === 3 ? 0.08 : 0);
    if (offender.mp.yellow) yP *= 0.45;
    if (offender.mp.p?.traits?.includes('sangchaud')) yP *= 1.5;
    if (offender.mp.p?.traits?.includes('veteran')) yP *= 0.8;
    if ((offender.mp.calm || 0) > m.minute || (D.calmUntil || 0) > m.minute) yP *= 0.6; // consigne « calmez-vous » du banc
    yP *= this.ref.strict * (m.profile.cards || 1) * (1 + (TK[D.tactics.tackling] || 0) * 0.18) * (D.cm ? D.cm.cards : 1) * captainCalm(D);
    if (this.rand() < 0.003) sendOff(m, out, D, offender.mp, 'direct');
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
  gain(p, out, fast = false) {
    const m = this.m;
    this.holder = p; this.inHands = false; this.pending = null;
    p.carry = null;
    for (const q of this.players.values()) q.faceBall = false;
    // Il prend le ballon face à lui (jamais « dans le dos »).
    if (this.dist(p, this.P.x, this.P.y) < 2.5) p.face = Math.atan2(this.P.y - p.y * W, this.P.x - p.x * L);
    // Ballon gagné dans un duel : on joue vite (sinon l'adversaire, juste à côté, retacle aussitôt).
    p.next = this.now + (fast ? 0.25 + this.rand() * 0.3 : (0.35 + this.rand() * 0.45) * TUNE.recv);
    // Adversaire au contact : il n'a pas le temps de s'installer, il joue tout de suite.
    if (this.pressure(p) < 2.4) p.next = Math.min(p.next, this.now + 0.25 + this.rand() * 0.2);
    if (fast) { this.duelCd = Math.max(this.duelCd || 0, 1.8); p.cd = 1.2; }
    p.touch = 0.2;
    this.lastTouch = p.side;
    if (this.poss !== p.side) {
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
    if (this.holder || this.shot && this.now < this.shot.at) return;
    // Ballon sorti (même de peu) : personne ne le joue, c'est touche / corner / six mètres.
    if (P.y < -0.08 || P.y > W + 0.08 || P.x < -0.08 || P.x > L + 0.08) return;
    const pd = this.pending;
    if (pd) {
      const r = pd.to;
      if (!this.players.has(r.mp.id)) { this.pending = null; return; }
      // Le destinataire (receveur ou intercepteur) court à la réception.
      const lead = Math.min(0.6, Math.hypot(P.vx, P.vy) / 25);
      if (this.now > pd.t0 + pd.T * 0.6) { r.tx = clamp((P.x + P.vx * lead) / L, 0, 1); r.ty = clamp((P.y + P.vy * lead) / W, 0, 1); }
      for (const q of this.players.values()) q.faceBall = q === r && this.dist(r, P.x, P.y) < 9;
      // Sortie aérienne du gardien : il s'élance, bras tendus au-dessus de la tête, et capte haut.
      if (r.gk && pd.aerial && !r._claimJ && this.now > pd.t0 + pd.T - 0.42) { r._claimJ = true; r.jump = 0.45; r.claimHigh = 0.8; }
      const f = this.foot(r, 0.4);
      const d = Math.hypot(f.x - P.x, f.y - P.y);
      if (r.gk && pd.aerial && d < 1.6 && P.z < 3.1 && this.inOwnBox(r)) { r._claimJ = false; this.gkCatch(r, out); return; }
      const reach = Math.hypot(P.vx, P.vy) < 9 ? 1.9 : 1.35; // ballon lent : il va le chercher d'un pas
      if (d < reach && P.z < 1.3) { this.receive(r, pd, out); return; }
      if (d < 1.4 && P.z < 2.8 && pd.aerial) { this.header(r, pd, out); return; }
      if (this.now > pd.t0 + pd.T + 1.2) this.pending = null; // raté : ballon libre
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
    const letGo = (side) => goingOut && this.lastTouch !== side;
    // Un seul joueur par équipe sur le ballon : celui qui l'atteint le plus tôt (sa vitesse, la
    // trajectoire du ballon), et on ne change pas de chasseur sans une vraie raison.
    const ch = (this._chaser ||= [null, null]);
    const tReach = (p) => {
      const vmax = 6 + (p.mp?.p?.attrs?.vit ?? 60) * 0.03;
      for (let t = 0; t <= 3; t += 0.15) {
        const bv = Math.max(0, sp - 1.55 * t), dd = sp > 0.3 ? (sp * t - 0.78 * t * t) * (bv > 0 ? 1 : 0) + (bv <= 0 ? stop : 0) : 0;
        const bx = P.x + (sp > 0.3 ? (P.vx / sp) * Math.min(dd, stop) : 0), by = P.y + (sp > 0.3 ? (P.vy / sp) * Math.min(dd, stop) : 0);
        const d = Math.max(0, this.dist(p, bx, by) - 0.6);
        if (d / vmax <= t + 0.15) return { t, bx, by };
      }
      return { t: 3 + this.dist(p, rx, ry) / vmax, bx: rx, by: ry };
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
      if (best) { best.tx = clamp(br.bx / L, 0, 1); best.ty = clamp(br.by / W, 0, 1); best.role = 'chase'; }
      // Les autres ne viennent pas s'agglutiner : leur place reste à 7 m du ballon au moins
      // (ils offrent une solution ou couvrent derrière le chasseur).
      for (const p of this.list(side)) {
        if (p === best || p.gk) continue;
        const dx = p.tx * L - br?.bx, dy = p.ty * W - br?.by, d = Math.hypot(dx, dy);
        if (!(d < 7)) continue;
        const ux = d > 0.3 ? dx / d : (p.x * L - P.x) / Math.max(0.3, this.dist(p, P.x, P.y)), uy = d > 0.3 ? dy / d : (p.y * W - P.y) / Math.max(0.3, this.dist(p, P.x, P.y));
        p.tx = clamp((br.bx + ux * 7) / L, 0.01, 0.99); p.ty = clamp((br.by + uy * 7) / W, 0.02, 0.98);
      }
    }
    let first = null, fd = 9;
    for (const p of this.players.values()) {
      const f = this.foot(p, 0.4);
      const d = Math.hypot(f.x - P.x, f.y - P.y);
      if (d < fd) { fd = d; first = p; }
    }
    if (first && fd < 1.0 && P.z < 1.2) {
      if (letGo(first.side) && (P.y < 4 || P.y > W - 4 || P.x < 4 || P.x > L - 4)) return; // il s'écarte et le regarde sortir
      if (first.gk && this.inOwnBox(first)) { this.gkCatch(first, out); return; }
      this.gain(first, out);
    }
  }

  inOwnBox(p) {
    const own = p.side === 0 ? 0 : L;
    return Math.abs(this.P.x - own) < 16.5 && Math.abs(this.P.y - W / 2) < 20.15;
  }

  receive(r, pd, out) {
    const m = this.m;
    if (pd.ok && r.side === pd.from.side) {
      r.team.stats.passesOk++; pd.from.mp.passesOk++;
      addRating(pd.from.mp, 0.012);
    } else if (r.side !== pd.from.side) {
      addRating(r.mp, 0.05);
      if (!r.gk) emit(m, out, { type: 'interception', side: r.side, pid: r.mp.id, pid2: pd.from.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
    }
    const P = this.P;
    // Interception du bout du pied : souvent le ballon est juste dévié (il file, parfois en touche).
    // Ballon rapide et contrôle approximatif : il rebondit trop loin (« contrôle raté »).
    const spd = Math.hypot(P.vx, P.vy);
    const tech = eff(r.mp, 'dri') * 0.5 + eff(r.mp, 'pas') * 0.5;
    const deflect = r.side !== pd.from.side && !r.gk && this.rand() < 0.42;
    const heavy = !deflect && !r.gk && spd > 11 && this.rand() < clamp(0.32 - tech / 330, 0.03, 0.2);
    if (deflect || heavy) {
      const a = Math.atan2(P.vy, P.vx) + (deflect ? (this.rand() - 0.5) * 2.2 : (this.rand() - 0.5) * 0.9);
      const v = deflect ? 3 + spd * (0.25 + this.rand() * 0.35) : 3.5 + this.rand() * 3;
      P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = deflect && this.rand() < 0.4 ? 2.5 : 0; P.spin = 0;
      // Près de son but, un défenseur qui dévie le ballon cherche à l'éloigner (pas à le pousser derrière sa ligne).
      const own = this.goalX(1 - r.side);
      if (deflect && Math.abs(P.x - own) < 22 && (own - P.x) * P.vx > 0 && this.rand() < 0.6) P.vx = -P.vx * 0.7;
      this.lastTouch = r.side; this.pending = null; r.touch = 0.2; r.ctrl = 0.25; r.ctrlH = P.z;
      return;
    }
    // Contrôle orienté : le corps face au ballon, qui reste devant lui.
    r.faceBall = false;
    r.face = Math.atan2(P.y - r.y * W, P.x - r.x * L);
    // Contrôle : le ballon est amorti (pied, cuisse ou poitrine selon la hauteur).
    r.ctrl = 0.3; r.ctrlH = P.z;
    P.vx *= 0.2; P.vy *= 0.2; P.vz = Math.min(0, P.vz) * 0.2; P.spin = 0;
    if (r.gk && this.inOwnBox(r) && pd.aerial) { this.gkCatch(r, out); return; }
    this.gain(r, out);
  }

  /** Tête : frappe dans la surface adverse, sinon remise / dégagement. */
  header(r, pd, out) {
    const m = this.m, P = this.P;
    r.jump = 0.45;
    this.pending = null;
    const gx = this.goalX(r.side);
    if (r.gk && this.inOwnBox(r)) { this.gkCatch(r, out); return; }
    if (Math.abs(this.X(r) - gx) < 14 && Math.abs(this.Y(r) - W / 2) < 12 && r.side === pd.from.side) {
      this.holder = r; this.poss = r.side; changePossession(m, r.side, 3, r.mp);
      this.doShot(r, 'header', out);
      return;
    }
    // Tête défensive (ou remise) : le ballon repart vers l'avant de l'équipe qui la gagne.
    if (r.side !== pd.from.side) { addRating(r.mp, 0.05); emit(m, out, { type: 'header', side: r.side, pid: r.mp.id, x: P.x / L, y: P.y / W, zone: m.zone }); }
    const dir = this.dir(r.side);
    let tx = clamp(P.x + dir * (12 + this.rand() * 15), 3, L - 3), ty = clamp(P.y + (this.rand() - 0.5) * 20, 3, W - 3);
    // Tête défensive sous pression : parfois mise en corner.
    if (r.side !== pd.from.side && this.rand() < 0.12) { tx = this.goalX(pd.from.side) + this.dir(pd.from.side) * 3; ty = P.y < W / 2 ? 8 : W - 8; }
    solveKick(P, { x: tx, y: ty, z: BR }, { T: 1.1 + this.rand() * 0.6 });
    this.lastTouch = r.side;
    if (this.poss !== r.side) { this.poss = r.side; changePossession(m, r.side, m.zone, r.mp); }
  }

  gkCatch(gk, out) {
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
      if (F.wait <= 0) { F.x0 = P.x; F.y0 = P.y; F.z0 = Math.max(BR, P.z); F.t = 0; const d0 = Math.hypot(P.x - this.restart.x, P.y - this.restart.y); F.T = clamp(d0 / 13, 0.45, 1.7); F.h = clamp(d0 * 0.09, 0.3, 3); }
      return;
    }
    if (F) {
      F.t += dt;
      const k = Math.min(1, F.t / F.T), rs = this.restart;
      const nx = F.x0 + (rs.x - F.x0) * k, ny = F.y0 + (rs.y - F.y0) * k;
      const nz = Math.max(BR, F.z0 * (1 - k) + BR * k + 4 * F.h * k * (1 - k));
      P.vx = (nx - P.x) / Math.max(dt, 1e-4); P.vy = (ny - P.y) / Math.max(dt, 1e-4); P.vz = (nz - P.z) / Math.max(dt, 1e-4);
      P.x = nx; P.y = ny; P.z = nz; P.rot.a += Math.hypot(P.vx, P.vy) / BR * dt;
      if (k >= 1) { Object.assign(P, { x: rs.x, y: rs.y, z: BR, vx: 0, vy: 0, vz: 0 }); rs.fetch = null; }
      return;
    }
    let glued = false;
    if (h && this.inHands) {
      const f = this.foot(h, 0.3);
      Object.assign(P, { x: f.x, y: f.y, z: 1.05, vx: 0, vy: 0, vz: 0 });
      glued = true;
    } else if (h) {
      // Conduite de balle réelle : à l'arrêt ou en marchant, le ballon reste sous la semelle ;
      // en course, le joueur le pousse devant lui à chaque touche, puis le ballon roule
      // librement (il peut être chipé) jusqu'à ce qu'il le rattrape.
      const sp = h.speed || 0;
      const f0 = this.foot(h, 0.45);
      const dB = Math.hypot(f0.x - P.x, f0.y - P.y);
      const bsp = Math.hypot(P.vx, P.vy);
      if (P.z < 0.8 && dB < 1.0 && !h.prep && bsp > 3.5 && sp < 1.8) {
        // Premier contrôle : un ballon qui arrive vite est amorti (il ralentit en deux temps), il ne
        // se « colle » pas au pied d'un coup.
        P.vx *= 0.4; P.vy *= 0.4; h.ctrl = Math.max(h.ctrl || 0, 0.2); h.ctrlH = P.z;
      } else if (P.z < 0.8 && (dB < 1.0 || (h.prep && dB < 1.7)) && (sp < 1.8 || h.prep)) {
        glued = true;
        const k = Math.min(1, dt * (h.prep ? 10 : 7));
        const nx = P.x + (f0.x - P.x) * k, ny = P.y + (f0.y - P.y) * k;
        P.vx = (nx - P.x) / Math.max(dt, 1e-4); P.vy = (ny - P.y) / Math.max(dt, 1e-4);
        P.x = nx; P.y = ny; P.z = BR; P.vz = 0; P.spin = 0; P.top = 0;
        P.rot.a += (Math.hypot(P.vx, P.vy) / BR) * dt; P.rot.b = Math.atan2(P.vy, P.vx);
        // En marchant balle au pied : petites touches de l'intérieur, au rythme des pas.
        if (sp > 0.4 && !h.prep && this.now > (h.nextTouch || 0)) {
          h.touch = 0.14; h.touchMax = 0.14; h.touchFoot = Math.sin(h.phase || 0) >= 0 ? 'L' : 'R'; h.touchIn = true;
          h.nextTouch = this.now + 0.45 + this.rand() * 0.2;
        }
      } else if (P.z < 0.6 && sp >= 1.8) {
        // Le ballon arrive à hauteur du pied (ou il est encore dessous) : nouvelle touche.
        const fx = Math.cos(h.face), fy = Math.sin(h.face);
        const ahead = (P.x - h.x * L) * fx + (P.y - h.y * W) * fy;      // distance devant lui
        const lat = Math.abs(-(P.x - h.x * L) * fy + (P.y - h.y * W) * fx);
        const bv = P.vx * fx + P.vy * fy;                                 // vitesse du ballon dans sa course
        if (ahead < 0.85 && ahead > -0.7 && lat < 1.0 && bv < sp + 0.6 && this.now > (h.nextTouch || 0)) {
          const dri = eff(h.mp, 'dri');
          const tight = h.carry?.takeon || this.pressure(h) < 4;            // collé au pied en un-contre-un
          // Au trot, des touches courtes (le ballon reste à un pas) ; lancé, il le pousse plus loin.
          const push = (tight ? 0.6 : 0.6 + sp * 0.2 + this.rand() * 0.6) + (1 - dri / 100) * (tight ? 0.4 : 1.0);
          const err = (this.rand() - 0.5) * 0.3 * (1.2 - dri / 100);
          let tx = h.carry ? h.carry.x - h.x * L : fx, ty = h.carry ? h.carry.y - h.y * W : fy;
          const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
          const a = Math.atan2(ty, tx) + err, v = sp + push;
          P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = 0;
          // Le long de la ligne, le joueur garde le ballon dans le terrain (il ne le pousse pas dehors).
          const ny = P.y + P.vy * 0.7, nx = P.x + P.vx * 0.7;
          if (ny < 0.8 || ny > W - 0.8) P.vy = (P.y < W / 2 ? 1 : -1) * Math.abs(P.vy) * 0.3;
          if (nx < 0.8 || nx > L - 0.8) P.vx = (P.x < L / 2 ? 1 : -1) * Math.abs(P.vx) * 0.3;
          // Touche avec le pied qui est devant dans la foulée (souvent l'intérieur ou l'extérieur du pied fort).
          h.touch = 0.16; h.touchMax = 0.16; h.touchFoot = Math.sin(h.phase || 0) >= 0 ? 'L' : 'R'; h.touchIn = this.rand() < 0.55;
          h.nextTouch = this.now + 0.25;
          this.lastTouch = h.side;
        }
      }
      // Touche trop longue : le ballon lui échappe, il redevient libre.
      if (!glued && Math.hypot(h.x * L - P.x, h.y * W - P.y) > 4.5) { this.releaseBall(h); this.pending = null; }
      // Entre deux touches, un adversaire bien placé peut chiper le ballon.
      else if (!glued && P.z < 0.6) {
        for (const o of this.players.values()) {
          if (o.side === h.side || o.fall > 0 || (o.cd || 0) > 0.3) continue;
          const fo = this.foot(o, 0.5);
          if (Math.hypot(fo.x - P.x, fo.y - P.y) < 0.6 && this.rand() < dt * (0.6 + eff(o.mp, 'def') / 70)) {
            o.touch = 0.2; o.cd = 0.8;
            emit(this.m, [], { type: 'interception', side: o.side, pid: o.mp.id, pid2: h.mp.id, x: P.x / L, y: P.y / W, zone: this.m.zone });
            this.gain(o, []);
            break;
          }
        }
      }
    }
    if (!glued) stepBall(P, dt);
    // Tir : arrêt / parade / contre à l'arrivée du ballon.
    const s = this.shot;
    if (s && this.now >= s.at && !s.done) {
      s.done = true;
      if (s.outcome === 'saved' && s.gk) {
        const gf = this.foot(s.gk, 0.3);
        if (s.catchIt && Math.hypot(gf.x - P.x, gf.y - P.y) < 2.2) this.gkCatch(s.gk, out);
        else {
          // Parade : souvent en corner (le gardien pousse le ballon derrière sa ligne), sinon repoussé.
          const sx = Math.sign(P.y - W / 2) || 1;
          if (this.rand() < 0.32) { P.vx = -P.vx * 0.1 + this.dir(s.side) * 4; P.vy = sx * (6 + this.rand() * 4); P.vz = 3 + this.rand() * 2; }
          else { P.vx = -P.vx * 0.25; P.vy = sx * (5 + this.rand() * 6); P.vz = 2 + this.rand() * 4; }
          P.spin = 0; this.lastTouch = s.gk.side;
        }
      } else if (s.outcome === 'blocked') {
        // Contre : dévié en corner une fois sur trois, sinon le ballon repart.
        if (this.rand() < 0.2) { P.vx = this.dir(s.side) * (7 + this.rand() * 4); P.vy = (this.rand() - 0.5) * 10; P.vz = 1.5 + this.rand() * 2; }
        else { P.vx = -P.vx * 0.25; P.vy += (this.rand() - 0.5) * 9; P.vz = 1.2 + this.rand() * 2; }
        P.spin = 0;
        if (s.blocker) this.lastTouch = s.blocker.side;
      }
    }
    if (s && this.now > s.at + 0.2 && s.outcome !== 'goal') this.shot = null;
    // But : seulement si le tir a été accordé ; sinon le ballon est repoussé sur la ligne.
    if (P.inGoal) {
      if (this.shot && this.shot.outcome === 'goal') { this.goal(out); return; }
      if (globalThis.__CNT) globalThis.__CNT.rej = (globalThis.__CNT.rej || 0) + 1;
      const gx = P.inGoal > 0 ? L : 0, d = P.inGoal > 0 ? -1 : 1;
      P.x = gx + d * 0.3; P.vx = d * Math.max(3, Math.abs(P.vx) * 0.3); P.vy *= 0.5; P.vz = Math.max(P.vz, 1.5); P.inGoal = 0; P.spin = 0;
    }
    // Sorties : touche, six mètres, corner.
    if (!this.restart && !this.celebrate) {
      if (P.y < -0.1 || P.y > W + 0.1) {
        this.setRestart('throw', 1 - this.lastTouch, clamp(P.x, 1, L - 1), P.y < 0 ? 0.2 : W - 0.2, out);
      } else if (P.x < -0.1 || P.x > L + 0.1) {
        const att = P.x > L ? 0 : 1; // équipe qui attaque ce but
        if (this.lastTouch === att) this.setRestart('goalkick', 1 - att, P.x > L ? L - 5.5 : 5.5, W / 2 + (P.y < W / 2 ? -8 : 8), out);
        else this.setRestart('corner', att, P.x > L ? L - 0.4 : 0.4, P.y < W / 2 ? 0.4 : W - 0.4, out);
      }
    }
  }

  /* ---------------- Coups de pied arrêtés ---------------- */

  setRestart(kind, side, x, y, out = null) {
    const m = this.m, T = m.teams[side];
    this.holder = null; this.pending = null; this.shot = null; this.inHands = false;
    for (const p of this.players.values()) p.carry = null;
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
      t.tx = clamp(tgtX, -1, L + 1) / L; t.ty = clamp(rs.y, -1, W + 1) / W;
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
        if (lurk) { lurk.tx = (gx - dir * 19) / L; lurk.ty = (W / 2 + (rs.y < W / 2 ? 4 : -4)) / W; rs.lurker = lurk; }
        rest.forEach((p, i) => { p.tx = (gx - dir * (44 + (i % 2) * 6)) / L; p.ty = (W / 2 + (i - (rest.length - 1) / 2) * 12) / W; });
        att = inBox;
      }
      // En attendant le ballon, ça bouge : appels, feintes, on se décale pour perdre son marqueur.
      // En attendant le ballon : chacun tient son poste (petit déplacement lent, pas de danse) ;
      // les vrais appels partent quand le tireur s'élance (updateRestart).
      const jig = (i) => (rs.kind === 'penalty' ? [0, 0] : [Math.sin(this.now * 0.35 + i * 1.7) * 0.4, Math.sin(this.now * 0.3 + i * 2.3) * 0.6]);
      att.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.tx = (gx - dir * (18.5 + (i % 3))) / L; p.ty = (W / 2 + ((i % 6) - 2.5) * 5) / W; return; }
        if (i < spots.length) { const [jx, jy] = jig(i); p.tx = (gx - dir * (spots[i][0] + jx)) / L; p.ty = (W / 2 + spots[i][1] + jy) / W; }
      });
      let defs = this.list(D.side).filter((p) => !p.gk);
      if (rs.kind === 'corner') {
        // Organisation défensive adverse : joueurs aux poteaux, joueurs laissés devant pour le
        // contre, puis marquage en zone, individuel ou mixte pour les autres.
        const sY = rs.y < W / 2 ? -1 : 1;
        const fast = defs.slice().sort((a, b) => eff(b.mp, 'vit') - eff(a.mp, 'vit'));
        const up = fast.filter((p) => !['DC', 'DG', 'DD'].includes(p.mp.p.pos)).slice(0, dPlan.def.up);
        up.forEach((p, i) => { p.tx = (gx - dir * (L / 2 - 2)) / L; p.ty = (W / 2 + (i ? 10 : -6)) / W; });
        defs = defs.filter((p) => !up.includes(p));
        const posts = defs.slice().sort((a, b) => eff(a.mp, 'phy') - eff(b.mp, 'phy')).slice(0, dPlan.def.posts);
        posts.forEach((p, i) => { p.tx = (gx - dir * 0.6) / L; p.ty = (W / 2 + (i ? -sY : sY) * 3.4) / W; });
        defs = defs.filter((p) => !posts.includes(p)).sort((a, b) => eff(b.mp, 'phy') + eff(b.mp, 'def') - eff(a.mp, 'phy') - eff(a.mp, 'def'));
        const zones = [[5.5, 0], [5.5, -3.5 * sY], [5.5, 3.5 * sY], [8.5, -1.5], [8.5, 2.5], [11, 0], [13, -4], [13, 4]];
        const nZone = dPlan.def.marking === 'zonal' ? defs.length : dPlan.def.marking === 'man' ? 0 : Math.min(3, defs.length);
        defs.forEach((p, i) => {
          if (i < nZone) { const [a, b] = zones[i % zones.length]; p.tx = (gx - dir * a) / L; p.ty = (W / 2 + b) / W; return; }
          const a = att[i - nZone] || (rs.lurker && i - nZone === att.length ? rs.lurker : null);
          // Marquage individuel : côté but et côté ballon, à un bras de distance (pas collé dessus).
          if (a) { p.tx = a.tx - (dir * 1.2) / L; p.ty = a.ty + ((rs.y - a.ty * W) > 0 ? 0.5 : -0.5) / W; }
        });
      } else defs.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.tx = (gx - dir * (18.5 + ((i + 1) % 3))) / L; p.ty = (W / 2 + ((i % 6) - 2.5) * 5 + 2) / W; return; }
        const a = att[i];
        if (a && i < spots.length) { p.tx = a.tx - (dir * 1.2) / L; p.ty = a.ty + ((rs.y - a.ty * W) > 0 ? 0.5 : -0.5) / W; }
      });
      // Corner joué à deux : un petit milieu vient se proposer à quelques mètres du tireur ;
      // un défenseur sort pour le gêner (règle des 9,15 m respectée plus bas).
      if (rs.kind === 'corner' && rs.routine === 'short') {
        if (!rs.shortP || !this.players.has(rs.shortP.mp.id)) rs.shortP = att[att.length - 1] || null;
        const sp = rs.shortP;
        if (sp) {
          const inward = rs.y < W / 2 ? 1 : -1;
          sp.tx = clamp(rs.x - dir * 5, 1, L - 1) / L; sp.ty = clamp(rs.y + inward * 8, 1, W - 1) / W;
          const d = defs[Math.min(spots.length, att.length)] || defs[defs.length - 1]; // un défenseur sans marquage
          if (d) { d.tx = clamp(rs.x - dir * 9, 1, L - 1) / L; d.ty = clamp(rs.y + inward * 11, 1, W - 1) / W; }
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
          p.tx = clamp(wx - uy * off, 0, L) / L; p.ty = clamp(wy + ux * off, 0, W) / W; p.wall = true;
        });
      }
    }
    // Personne à moins de 9 m du ballon côté adverse.
    for (const p of this.list(D.side)) {
      if (p.wall) continue;
      if (p.gk) continue;
      const dx = p.tx * L - rs.x, dy = p.ty * W - rs.y, d = Math.hypot(dx, dy);
      if (d < 9.2 && rs.kind !== 'penalty') { const k = 9.2 / Math.max(0.5, d); p.tx = (rs.x + dx * k) / L; p.ty = (rs.y + dy * k) / W; }
    }
    // Devant le but : chaque joueur a SA place (au moins 1,3 m entre deux places), sinon ils se
    // marchent dessus et se bousculent en permanence en attendant le ballon.
    if (rs.kind === 'corner' || rs.kind === 'freekick') {
      const ps = [...this.players.values()].filter((p) => p !== t && !p.wall && !p.gk && Math.abs(p.tx * L - gx) < 22);
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j];
          const dx = (b.tx - a.tx) * L, dy = (b.ty - a.ty) * W, d = Math.hypot(dx, dy), minD = a.side === b.side ? 2.2 : 1.15;
          if (d >= minD) continue;
          const ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : 1, push = (minD - d) / 2;
          a.tx -= (ux * push) / L; a.ty -= (uy * push) / W; b.tx += (ux * push) / L; b.ty += (uy * push) / W;
        }
      }
      for (const p of ps) { p.tx = clamp(p.tx, 0.003, 0.997); p.ty = clamp(p.ty, 0.01, 0.99); }
    }
  }

  setupKickoff(ev) {
    const m = this.m;
    this.sync();
    this.holder = null; this.pending = null; this.shot = null; this.celebrate = 0;
    Object.assign(this.P, { x: L / 2, y: W / 2, z: BR, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, inGoal: 0, hitPost: false });
    for (const p of this.players.values()) p.celeb = 0;
    const taker = this.players.get(ev.pid) || this.list(ev.side).find((p) => !p.gk && ['BU', 'MO', 'AG', 'AD'].includes(p.mp.p.pos)) || this.list(ev.side).find((p) => !p.gk);
    this.restart = { kind: 'kickoff', side: ev.side, x: L / 2, y: W / 2, taker, t: 0 };
    this.poss = ev.side;
    this.kickoffTargets();
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
      p.tx = clamp(x, 1, L - 1) / L; p.ty = clamp(y, 1, W - 1) / W;
      if (p.side === rs.side && p !== rs.taker && !p.gk && ['BU', 'MO', 'AG', 'AD', 'MC'].includes(p.mp.p.pos)) {
        const dd = Math.hypot(x - L / 2, y - W / 2);
        if (!partner || dd < partner.d) partner = { p, d: dd };
      }
    }
    const t = rs.taker, own = -this.dir(rs.side);
    if (t) { t.tx = (L / 2 + own * 0.35) / L; t.ty = 0.5; }
    if (partner) { partner.p.tx = (L / 2 + own * 1.2) / L; partner.p.ty = (W / 2 + (partner.p.ty < 0.5 ? -2.5 : 2.5)) / W; }
  }

  updateRestart(dt, out) {
    const rs = this.restart, t = rs.taker;
    rs.t += dt;
    if (!t || !this.players.has(t.mp.id)) { rs.taker = this.list(rs.side).find((p) => !p.gk); return; }
    // Temps de mise en place (le temps de jeu effectif baisse, mais tout est lisible) :
    // ballon posé, mur formé, joueurs placés, signal du tireur.
    const nearGoal = Math.hypot(this.goalX(rs.side) - rs.x, W / 2 - rs.y) < 32;
    const minT = { kickoff: 4, throw: 7, goalkick: 11, corner: 12, freekick: nearGoal ? 14 : 8, penalty: 8 }[rs.kind] * (this.tacticalMood(rs.taker?.team || this.m.teams[rs.side]).wasting ? 1.8 : 1);
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
      if (rs.go == null) { rs.go = this.now + 0.28 * 0.55 * GS; t.kick = 0.28; t.kickMax = 0.28; t.kickFoot = this.footSign(t) > 0 ? 'R' : 'L'; t.kickLoft = ['goalkick', 'corner'].includes(rs.kind); t.kickPow = ['goalkick', 'corner', 'penalty'].includes(rs.kind) ? 1 : 0.55; t.kickSide = rs.kind === 'kickoff'; t.face = Math.atan2(W / 2 - this.P.y, this.goalX(rs.side) - this.P.x); return; }
      if (this.now < rs.go) return;
    } else { t.throwIn = 0.6; t.hold = 0; }
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

  move(dt) {
    const step = (p, maxSp) => {
      const dx = (p.tx - p.x) * L, dy = (p.ty - p.y) * W;
      const dist = Math.hypot(dx, dy);
      let want = dist < 0.15 ? 0 : Math.min(maxSp, Math.sqrt(2 * 6 * dist));
      if (dist > 0.01 && p.face != null && Math.cos(Math.atan2(dy, dx) - p.face) < -0.5) want = Math.min(want, 5.6); // à reculons
      const dvx = dist > 0.01 ? (dx / dist) * want : 0, dvy = dist > 0.01 ? (dy / dist) * want : 0;
      const ax = dvx - p.vx, ay = dvy - p.vy, am = Math.hypot(ax, ay);
      // Inertie : on accélère selon sa vitesse de pointe, on ne tourne pas sur place lancé
      // (virage large ou appui pour freiner), on court moins vite à reculons.
      const sp0 = p.speed || 0;
      let lim = (want > sp0 ? 4.4 + (p.mp?.p?.attrs?.vit ?? 60) * 0.013 : 8.5) * dt;
      if (sp0 > 3.5 && want > 0.5) {
        const turn = Math.abs(Math.atan2(p.vx * dvy - p.vy * dvx, p.vx * dvx + p.vy * dvy));
        if (turn > 1.3) lim *= 0.75;
      }
      const before = p.speed || 0;
      if (am > lim) { p.vx += (ax / am) * lim; p.vy += (ay / am) * lim; } else { p.vx = dvx; p.vy = dvy; }
      p.x += (p.vx * dt) / L; p.y += (p.vy * dt) / W;
      p.speed = Math.hypot(p.vx, p.vy);
      p.acc = dt > 0 ? (p.speed - before) / dt : 0;
      const P = this.P;
      // Orientation : vers la cible de son geste (armé), vers le ballon qui arrive (réception,
      // il ouvre le corps au lieu de lui tourner le dos), sinon dans le sens de sa course.
      let target, rate = 7;
      if (p.prep && p.faceTo != null) { target = p.faceTo; rate = 12; }
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
    for (const p of this.players.values()) {
      const vit = p.mp?.p?.attrs?.vit ?? 60, en = p.mp?.energy ?? 100;
      const withBall = p === this.holder && !this.inHands ? (p.carry?.takeon ? 1.0 : 0.86) * ((p.turnGap || 0) > 1.2 ? 0.35 : (p.turnGap || 0) > 0.6 ? 0.7 : 1) : 1;
      if (p.fall > 0.3 || p.slide > 0.2 || p.hurt > 0) { p.tx = p.x; p.ty = p.y; }
      // Arrêt de jeu : on se replace en trottinant (on ne sprinte pas pour un coup franc).
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
        cap = dd > 18 ? (threatened ? 6.2 : dBall > 30 ? 4.2 : 5) : dd > 9 ? (threatened && !loose ? 5.4 : near ? 4.4 : 3.6) : dd > 4 ? (threatened && !loose ? 4.2 : near ? 3.6 : 2.8) : dd > 1.5 ? 2.1 : 1.3;
        if (p.role === 'mark' && dd > 1.2) {
          // On suit son attaquant à SON allure : on sprinte s'il sprinte, on trottine s'il trottine.
          const a = p._markOf != null ? this.players.get(p._markOf) : null, as = a ? a.speed || 0 : 3;
          cap = Math.max(cap, Math.min(Infinity, as + (dd > 4 ? 2.2 : 1.2)), dd > 6 ? 5.5 : 0);
        }
      } else if (p === this.holder && !this.inHands && !p.carry?.takeon) {
        // Porteur libre de tout marquage : il ne fonce pas, il marche ou trottine balle au pied en
        // levant la tête (il n'accélère que pressé, en contre-attaque ou dans un espace à attaquer).
        const free = this.pressure(p);
        const A = p.team, counter = this.tacticalMood?.(A)?.counter;
        if (!counter) cap = free > 12 ? (p.waitN ? 1.5 : 3.2) : free > 7 ? 4.6 : Infinity;
      }
      step(p, Math.min(cap, (6.6 + vit * 0.033) * (TR(p, 'fusee') ? 1.03 : 1) * (this.m.wx?.speed || 1) * (en > 70 ? 1 - (100 - en) * 0.002 : 0.94 - (70 - en) * 0.006) * withBall * (p.celeb > 0 ? 0.8 : 1)));
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
        const push = 1.0 - d;
        a.x -= (ux * push * ka) / L; a.y -= (uy * push * ka) / W;
        c.x += (ux * push * kc) / L; c.y += (uy * push * kc) / W;
        // Vitesses : la composante qui les rapproche est absorbée (pas de traversée ni de rebond).
        const rv = (c.vx - a.vx) * ux + (c.vy - a.vy) * uy;
        if (rv < 0) {
          a.vx += ux * rv * ka; a.vy += uy * rv * ka;
          c.vx -= ux * rv * kc; c.vy -= uy * rv * kc;
          if (-rv > 3.5) { const kb = Math.min(0.9, -rv * 0.085); a.bump = Math.max(a.bump || 0, kb * ka * 2); c.bump = Math.max(c.bump || 0, kb * kc * 2); a.bumpDir = Math.atan2(-uy, -ux); c.bumpDir = Math.atan2(uy, ux); }
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
