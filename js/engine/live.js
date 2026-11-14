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
import { createBall, stepBall, solveKick, R as BR, GOAL_HALF, PITCH_L as L, PITCH_W as W } from '../ui/ballPhysics.js';
import { formationPos } from './positions.js';
import { clamp } from '../core/rng.js';
import { activePlayers, eff, addRating, emit, changePossession, momentum, setPieceTaker, sendOff, injure, kickoff as engineKickoff, minuteStart, minuteEnd, stepMinute, captainCalm } from './match.js';

const GS = 1.6;            // les gestes (frappe, tacle…) durent un temps « d'affichage »
export const CLOCK = 6.25; // ancienne horloge compressée (référence pour la fatigue)
const LVL = { low: -1, mid: 0, high: 1 };
const MENT = { defensive: -1, balanced: 0, offensive: 1 };
const TK = { soft: -1, normal: 0, hard: 1 };
const sig = (x) => 1 / (1 + Math.exp(-x));
const piOf = (t, mp, key, def) => (mp && t.pi?.[mp.slot]?.[key]) || def;

/** Réglages d'équilibre (calibrés avec tests/live.test.js : buts, tirs, fautes, corners). */
export const TUNE = {   // calibré en TEMPS RÉEL (horloge 1) : ~2,8 buts, ~28 tirs, ~22 fautes par match
  clock: 1,        // secondes de match par seconde de jeu simulé (1 = temps réel)
  shotW: 0.5,         // attrait de la frappe face aux autres options
  shotCost: 0.8,     // coût de la perte de balle dans le choix de tirer
  carryW: 0.5,        // attrait de la conduite de balle
  keepW: 0.25,        // valeur de garder le ballon (passe sûre à un partenaire libre)
  crossW: 0.6,
  passRisk: 2,      // sévérité des interceptions
  lossW: 6,         // coût de la perte de balle dans le choix des passes
  tackleRate: 0.65,    // fréquence des tentatives de tacle
  foulP: 0.15,        // part des tentatives de tacle qui finissent en faute
  xg: 0.62,          // échelle du modèle d'xG géométrique
  takeonW: 0.3,       // attrait du crochet / débordement
  hold: 1.6,            // temps de réflexion avant de jouer le ballon (×)
  recv: 3.2,            // temps de contrôle à la réception (×)
  clearCorner: 0.05,  // part des dégagements d'urgence qui finissent en corner
};

export class LiveSim {
  /**
   * m : état du moteur (createMatch). opts : { players (Map partagée avec la vue), ball (objet
   * physique partagé), sync (fonction de synchronisation des joueurs de la vue) }.
   */
  constructor(m, opts = {}) {
    this.m = m;
    m.live = true;
    this.rng = m.rng;
    this.players = opts.players || new Map();
    this.P = opts.ball || createBall();
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
      restart: rs ? { kind: rs.kind, side: rs.side, x: rs.x, y: rs.y, taker: rs.taker?.mp.id ?? null } : null,
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
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      this.move(dt); stepBall(P, dt);
      if (this.celebrate <= 0) this.handle([this.kickoffEvent(this.afterGoalSide)], out);
      return;
    }
    this.reshapeT += dt;
    if (this.reshapeT > 0.3) { this.reshapeT = 0; this.positioning(); }
    if (this.restart) this.updateRestart(dt, out);
    else {
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
    const P = this.P, m = this.m;
    const bx = clamp(P.x / L, 0, 1), by = clamp(P.y / W, 0, 1);
    const h = this.holder, poss = this.poss;
    const busy = new Set([h, this.pending?.to, this.restart?.taker].filter(Boolean));
    for (const p of this.players.values()) {
      if (busy.has(p) || p.celeb > 0) continue;
      const f = formationPos(p.team, p.mp, bx, by, p.side === poss, false);
      p.tx = f.x; p.ty = f.y;
      p.role = null;
    }
    if (this.restart) { this.restartPositions(); return; }
    // Gardiens : sur la ligne entre le ballon et le centre du but, avancés selon la distance.
    for (const p of this.players.values()) {
      if (!p.gk || busy.has(p)) continue;
      const own = p.side === 0 ? 0 : L, sgn = p.side === 0 ? 1 : -1;
      const dB = Math.hypot(P.x - own, P.y - W / 2);
      const k = clamp(1.2 + dB / 14, 1.2, 9) / Math.max(1, dB);
      p.tx = (own + (P.x - own) * k + sgn * 0.3) / L;
      p.ty = clamp(W / 2 + (P.y - W / 2) * k, W / 2 - GOAL_HALF - 1, W / 2 + GOAL_HALF + 1) / W;
    }
    if (poss < 0) return;
    const A = m.teams[poss], D = m.teams[1 - poss];
    this.buildUpShape(A, busy);
    this.defensiveLine(D, busy);
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
    const presser = cand.find((c) => c.d < pressRange);
    if (presser && engage) {
      const p = presser.p;
      p.tx = clamp(presser.ix + ux * 0.9, 0, L) / L; p.ty = clamp(presser.iy + uy * 0.9, 0, W) / W; p.role = 'press';
    } else if (presser) {
      const p = presser.p, gap = 6 + (this.rand() * 2);
      p.tx = clamp(rx + ux * gap, 0, L) / L; p.ty = clamp(ry + uy * gap, 0, W) / W; p.role = 'contain';
    }
    const cover = cand.find((c) => c !== presser && c.goalSide && c.d < pressRange + 10);
    const hiPress = D.tactics.pressing === 'high' && engage;
    if (cover) {
      const p = cover.p;
      if (hiPress && h) {
        // Pressing haut : il coupe la passe vers le partenaire le plus proche du porteur.
        const mate = this.list(A.side).filter((q) => q !== h && !q.gk).sort((a, b) => this.dist(a, rx, ry) - this.dist(b, rx, ry))[0];
        if (mate) { p.tx = (rx + (this.X(mate) - rx) * 0.6) / L; p.ty = (ry + (this.Y(mate) - ry) * 0.6) / W; p.role = 'press2'; }
      } else { p.tx = (rx + ux * 7) / L; p.ty = (ry + uy * 7) / W; p.role = 'cover'; }
    }
    // Repli : dépassés, ils reviennent se placer entre le ballon et le but.
    for (const c of cand) {
      if (c === presser || c === cover || c.goalSide || c.d < 3) continue;
      const k = Math.min(1, 10 / toG);
      c.p.tx = clamp(rx + (ownGoalX - rx) * Math.max(k, 0.3), 1, L - 1) / L;
      c.p.ty = clamp(c.p.ty * W + (W / 2 - c.p.ty * W) * 0.3, 2, W - 2) / W;
      c.p.role = 'recover';
    }
    const defs = cand.filter((c) => !c.p.role).map((c) => ({ p: c.p, d: c.d }));
    // Marquage : dans sa moitié, chaque défenseur suit l'attaquant le plus proche de sa zone.
    const attackers = this.list(A.side).filter((p) => !p.gk && p !== h);
    const taken = new Set();
    for (const { p } of defs) {
      const zx = p.tx * L, zy = p.ty * W;
      let best = null, bd = 9;
      const reachM = D.tactics.marking === 'man' ? 14 : 9;
      bd = reachM;
      for (const a of attackers) {
        if (taken.has(a)) continue;
        const d = Math.hypot(this.X(a) - zx, this.Y(a) - zy);
        if (d < bd) { bd = d; best = a; }
      }
      const man = D.tactics.marking === 'man';
      const inOwnHalf = Math.abs(this.P.x - ownGoalX) < L * (hiPress ? 1 : man ? 0.62 : 0.4); // marquage serré près de son but
      if (best && inOwnHalf) {
        taken.add(best);
        const ax = this.X(best), ay = this.Y(best);
        const g = Math.hypot(ownGoalX - ax, W / 2 - ay) || 1;
        const tight = man ? 0.9 : 1.6;
        p.tx = (ax + ((ownGoalX - ax) / g) * tight) / L; p.ty = (ay + ((W / 2 - ay) / g) * tight) / W; p.role = 'mark';
      }
    }
    // Attaque : chacun se rend disponible (loin des marqueurs, ligne de passe ouverte).
    if (h && !this.inHands) this.findSpace(A, h, busy);
    // Deux solutions courtes autour du porteur, un appel en profondeur.
    if (h && !this.inHands) {
      const mates = attackers.map((p) => ({ p, d: this.dist(p, rx, ry) })).sort((a, b) => a.d - b.d);
      mates.slice(0, 2).forEach(({ p }, i) => {
        const side = (i === 0 ? 1 : -1) * (ry < W / 2 ? 1 : -1);
        p.tx = clamp(rx + dirA * (4 + i * 5), 2, L - 2) / L;
        p.ty = clamp(ry + side * (11 + i * 3), 3, W - 3) / W;
        p.role = 'support';
      });
      const lastDef = this.list(D.side).filter((p) => !p.gk).map((p) => this.X(p) * dirA).sort((a, b) => b - a)[1];
      const fwd = attackers.filter((p) => ['BU', 'AG', 'AD', 'MO'].includes(A.slots[p.mp.slot].pos)).sort((a, b) => (this.X(b) - this.X(a)) * dirA)[0];
      if (fwd && lastDef != null && rx * dirA > (dirA > 0 ? L * 0.3 : -L * 0.7)) {
        const runT = (this.now + fwd.mp.id) % 7;
        // Appel : il attend à la limite du hors-jeu puis part dans le dos (cycle de quelques secondes).
        // Appel parfois mal synchronisé (hors-jeu).
        const early = ((fwd.mp.id * 7 + Math.floor(this.now / 7)) % 3) === 0;
        fwd.tx = clamp((lastDef + (runT < 3 ? (early ? 1.2 : -0.8) : 6)) * dirA, 2, L - 2) / L;
        fwd.role = runT < 3 && !early ? 'hold' : 'run';
      }
    }
  }

  /**
   * Relance depuis l'arrière : les centraux s'écartent, les latéraux montent, le milieu
   * défensif décroche entre les centraux (l'équipe s'étire pour faire circuler le ballon).
   */
  buildUpShape(A, busy) {
    const dir = this.dir(A.side), own = this.goalX(1 - A.side);
    const depth = (this.P.x - own) * dir;
    if (depth > L * 0.4) return;
    for (const p of this.list(A.side)) {
      if (busy.has(p) || p.gk) continue;
      const pos = A.slots[p.mp.slot].pos;
      const y = p.ty * W;
      if (pos === 'DC') { p.ty = clamp(W / 2 + Math.sign(y - W / 2 || 1) * 13, 3, W - 3) / W; p.tx = (own + dir * (8 + depth * 0.25)) / L; }
      else if (pos === 'DG' || pos === 'DD') { p.ty = (pos === 'DG' ? (A.side === 0 ? 4 : W - 4) : (A.side === 0 ? W - 4 : 4)) / W; p.tx = clamp(p.tx * L + dir * 10, 2, L - 2) / L; }
      else if (pos === 'MDC') { p.tx = (own + dir * (14 + depth * 0.3)) / L; p.ty = 0.5; }
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
    for (const p of this.list(A.side)) {
      if (busy.has(p) || p.gk || p === h || p.role) continue;
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
        const sc = free + lane * 0.7 - rr * 0.12;
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
      if (this.dist(h, h.carry.x, h.carry.y) < 1.5 || this.now > h.carry.until || (pressed && !h.carry.takeon && this.now > h.carry.t0 + 0.4)) { h.carry = null; h.next = Math.min(h.next, this.now); }
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
    if (dGoal < 33 && (gx - hx) * dir > 2) {
      const xg = this.xg(h, 'open');
      let w = TUNE.shotW * (1 + ment * 0.2) * ({ less: 0.55, normal: 1, more: 1.5 }[piOf(A, h.mp, 'shoot', 'normal')]);
      if (dGoal > 20) w *= { low: 0.55, mid: 1, high: 1.6 }[A.tactics.longShots] || 1;
      if (m.minute > 75 && m.score[A.side] < m.score[D.side]) w *= 1.25;
      // Tirer, c'est (presque toujours) rendre le ballon : on compare l'occasion à la possession.
      opts.push({ k: 'shot', u: xg * w - (1 - xg) * this.threat(A.side, hx, hy) * TUNE.shotCost, xg });
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
      const len = Math.min(space - 1.5, 12);
      const cx = clamp(hx + dir * len, 2, L - 2), cy = clamp(hy + (W / 2 - hy) * (dGoal < 35 ? 0.25 : 0.05), 2, W - 2);
      const dri = eff(h.mp, 'dri');
      const keep = sig((space - 3) / 1.6) * (0.75 + dri / 400);
      const w = TUNE.carryW * ({ less: 0.6, normal: 1, more: 1.5 }[piOf(A, h.mp, 'dribble', 'normal')]) * (1 + ment * 0.1) * (0.6 + 0.4 * mood.drib) * (mood.counter ? 1.25 : 1);
      opts.push({ k: 'carry', u: keep * this.threat(A.side, cx, cy) * w + 0.004, x: cx, y: cy });
    }
    // Crochet / débordement : un défenseur devant, de l'espace derrière lui.
    const opp = this.frontOpponent(h);
    if (opp && opp.d > 1.8 && opp.d < 7) {
      const ox = this.X(opp.p), oy = this.Y(opp.p);
      const side = oy > hy ? -1 : 1; // on passe du côté opposé à son appui
      const tx2 = clamp(ox + dir * 4.5, 2, L - 2), ty2 = clamp(oy + side * 2.6, 2, W - 2);
      const dri = eff(h.mp, 'dri') * 0.8 + eff(h.mp, 'vit') * 0.2, def = eff(opp.p.mp, 'def') * 0.75 + eff(opp.p.mp, 'vit') * 0.25;
      const pWin = sig((dri - def) / 11 + 0.15);
      const w = TUNE.takeonW * ({ less: 0.5, normal: 1, more: 1.7 }[piOf(A, h.mp, 'dribble', 'normal')]) * mood.drib;
      opts.push({ k: 'takeon', u: (pWin * this.threat(A.side, tx2, ty2) - (1 - pWin) * this.threat(A.side, hx, hy) * TUNE.lossW) * w, x: tx2, y: ty2, opp: opp.p, pWin });
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
    if (!opts.length) { h.next = this.now + 0.3; return; }
    // Choix : le meilleur, avec une part de hasard d'autant plus faible que le joueur voit le jeu.
    const vis = eff(h.mp, 'vis');
    const temp = 0.012 * (1.5 - vis / 100);
    const ws = opts.map((o) => Math.exp((o.u - Math.max(...opts.map((x) => x.u))) / temp));
    const pick = opts[this.rng.weightedIndex(ws)];
    const tempo = LVL[A.tactics.tempo] || 0;
    h.next = this.now + (0.45 + this.rand() * 0.5) * TUNE.hold * (1 - tempo * 0.18) * (press < 3 ? 0.6 : 1) * (1.3 - vis / 250) * (mood.counter ? 0.82 : 1) * (mood.wasting && press > 4 ? 1.7 : 1);
    // Passe, frappe, centre, dégagement : le joueur s'arrête sur son appui et arme sa jambe ;
    // le ballon ne part qu'au moment du contact (comme dans un vrai geste).
    if (['shot', 'pass', 'cross', 'clear'].includes(pick.k)) {
      const big = pick.k !== 'pass' || pick.lofted;
      const tgt = pick.k === 'pass' ? { x: pick.tx, y: pick.ty } : pick.k === 'cross' ? { x: this.X(pick.r), y: this.Y(pick.r) } : pick.k === 'shot' ? { x: gx, y: W / 2 } : { x: hx + dir * 30, y: hy };
      h.faceTo = Math.atan2(tgt.y - hy, tgt.x - hx);   // il s'oriente pendant l'armé (le ballon tourne avec lui)
      if (pick.k === 'shot') h.shotTech = this.shotTech(h);
      h.kick = big ? 0.32 : 0.24; h.kickPow = pick.k === 'shot' ? (h.shotTech === 'drive' ? 1 : 0.8) : big ? 0.85 : 0.5; h.kickSide = (pick.k === 'pass' && !big) || h.shotTech === 'finesse' || h.shotTech === 'curl';
      h.prep = { pick, at: this.now + (h.kick - 0.16) * GS, until: this.now + (h.kick - 0.16) * GS + 0.5 };
      P.vx *= 0.3; P.vy *= 0.3;   // dernier contact pour placer le ballon avant la frappe
      h.next = h.prep.until;
      return;
    }
    this.execute(h, pick, out);
  }

  /** Exécute le choix du porteur (après l'armé pour les frappes). */
  execute(h, pick, out) {
    if (pick.k === 'shot') this.doShot(h, 'open', out);
    else if (pick.k === 'pass') this.doPass(h, pick, out);
    else if (pick.k === 'carry') { h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + 1.2 + this.rand() * 1.4 }; h.next = h.carry.until; }
    else if (pick.k === 'takeon') {
      // Le crochet est joué : réussi, le défenseur se jette dans le vide ; raté, il gagne le duel.
      h.carry = { x: pick.x, y: pick.y, t0: this.now, until: this.now + 2.2, takeon: { def: pick.opp, win: this.rand() < pick.pWin } };
      h.next = h.carry.until;
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
    if (r.role === 'run') { tx += dir * 6; through = true; }
    tx = clamp(tx, 1.5, L - 1.5); ty = clamp(ty, 1.5, W - 1.5);
    const len = Math.hypot(tx - sx, ty - sy);
    if (len < 4 || len > 60) return null;
    const lofted = len > 32 || (through && len > 22);
    const vb = lofted ? 19 : 15;
    const pas = eff(h.mp, 'pas'), vis = eff(h.mp, 'vis');
    let p = clamp(0.995 - len * 0.0045 * (1.35 - pas / 100) - (lofted ? 0.12 : 0) - (through ? 0.08 : 0), 0.45, 0.995);
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
      let c = sig((tb - to) * 3.2 - 0.6) * (0.55 + eff(o.mp, 'def') / 220) * TUNE.passRisk;
      if (o.gk) c *= Math.abs(ox - this.goalX(1 - A.side)) < 16 ? 0.8 : 0.2;
      c *= 1.1 - vis / 300;
      if (c > 0.01) { p *= 1 - c; if (c > wc) { wc = c; worst = { o, x: px, y: py }; } }
    }
    const offside = this.isOffside(h, r);
    // Le passeur ne voit pas toujours le hors-jeu ; un piège bien tendu le surprend encore plus.
    if (offside) p *= this.m.teams[1 - A.side].tactics.offsideTrap === 'on' ? 0.92 : 0.6;
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
    const val = (this.threat(A.side, tx, ty) * (1 + ment * 0.05) * fwd + keep) * lenW * dirW * lane;
    // Perdre le ballon coûte la valeur de la possession actuelle + le danger d'une contre-attaque.
    const danger = this.threat(1 - A.side, worst ? worst.x : tx, worst ? worst.y : ty) + this.threat(A.side, sx, sy) * 1.4 + 0.012;
    return { k: 'pass', u: p * val - (1 - p) * danger * TUNE.lossW + 0.003, r, tx, ty, p, lofted, through, worst, offside };
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
    if (o.lofted || o.through) emit(m, out, { type: o.lofted ? 'longpass' : 'pass', side: A.side, pid: h.mp.id, pid2: o.r.mp.id, x: tx / L, y: ty / W, zone: m.zone });
  }

  /** Frappe le ballon vers (tx, ty) : au sol, ou en l'air. Retourne la durée du trajet. */
  kickBall(h, tx, ty, lofted, z = null) {
    const P = this.P;
    const f = this.foot(h);
    if (Math.hypot(f.x - P.x, f.y - P.y) < 0.4 && P.z < 0.5) { P.x = f.x; P.y = f.y; }
    const len = Math.hypot(tx - P.x, ty - P.y);
    if (h.throwIn > 0) P.z = 2.0;                       // touche : le ballon part des mains, au-dessus de la tête
    else if (!(h.kick > 0)) { h.kick = 0.32; h.kickPow = lofted ? 0.85 : 0.5; h.kickSide = !lofted; }
    h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side;
    P.inGoal = 0; P.hitPost = false;
    if (!lofted) return solveKick(P, { x: tx, y: ty }, { mode: 'ground', arrive: Math.min(12, 6 + len * 0.16) });
    return solveKick(P, { x: tx, y: ty, z: z ?? (0.4 + this.rand() * 1.1) }, { T: 0.9 + len / 30, spin: (this.rand() - 0.5) * 6, top: 1.5 });
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
    if (!(h.kick > 0)) { h.kick = 0.32; h.kickPow = 0.85; } h.face = Math.atan2(ty - P.y, tx - P.x);
    this.lastTouch = h.side;
    const len = Math.hypot(tx - P.x, ty - P.y);
    const T = solveKick(P, { x: tx, y: ty, z: 1.8 + this.rand() * 0.5 }, { T: 0.95 + len / 32, spin: -Math.sign(vy || 1) * dir * swing * (7 + this.rand() * 5) });
    // Duel aérien : l'attaquant visé contre le défenseur le plus proche (le gardien sort parfois).
    const D = m.teams[1 - A.side];
    const def = this.list(D.side).filter((p) => !p.gk).sort((a, b) => Math.hypot(this.X(a) - tx, this.Y(a) - ty) - Math.hypot(this.X(b) - tx, this.Y(b) - ty))[0];
    const gk = this.list(D.side).find((p) => p.gk);
    const delivery = eff(h.mp, 'pas') * 0.7 + eff(h.mp, 'vis') * 0.3;
    const att = eff(r.mp, 'phy') * 0.55 + eff(r.mp, 'tir') * 0.25 + eff(r.mp, 'sf') * 0.2;
    const dfn = def ? eff(def.mp, 'phy') * 0.5 + eff(def.mp, 'def') * 0.5 : 40;
    let win = sig((delivery - m.level) / 18 + (att - dfn) / 14 - 0.55);
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
    const toTouch = Math.abs(this.Y(h) - W / 2) > 16 && this.rand() < 0.45;   // « en touche ! »
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
    xg *= Math.pow(q, 1.0) * (m.profile.goals || 1);
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
    const goalP = clamp(xg * kf / (1 - pBlock), 0, 0.95);
    A.stats.shots++; h.mp.shots++;
    A.stats.xg += xg;
    m.xgTimeline.push({ minute: m.minute, extra: m.extra, side: A.side, xg, goal: false });
    momentum(m, A.side, 4 + xg * 30);
    let o;
    if (blocker && this.rand() < pBlock) o = 'blocked';
    else if (this.rand() < goalP) o = 'goal';
    else {
      const onP = kind === 'penalty' ? 0.7 : clamp(0.3 + (eff(h.mp, 'tir') - (m.level - 16)) / 220 + xg * 0.4, 0.18, 0.6);
      o = this.rand() < onP ? 'saved' : this.rand() < 0.07 ? 'post' : 'wide';
    }
    // Frappe non cadrée déviée par un défenseur : corner.
    if (o === 'wide' && blocker && this.rand() < 0.5) o = 'blocked';
    // Trajectoire selon l'issue et la technique (la physique fait le reste).
    const r1 = this.rand(), r2 = this.rand(), r3 = this.rand();
    const tech = kind === 'open' ? (h.shotTech || this.shotTech(h)) : kind;
    h.shotTech = null;
    // Côté visé : plutôt le petit filet opposé (« ouvrir le pied ») quand on frappe de biais.
    const far = -Math.sign(this.Y(h) - cy || 1);
    const side = r2 < (tech === 'finesse' || tech === 'curl' ? 0.7 : 0.55) ? far : -far;
    let tgt;
    let speed = { penalty: 24, header: 13, freekick: 23, finesse: 19 + r1 * 4, curl: 22 + r1 * 4, chip: 15, drive: 26 + r1 * 7 }[tech] || 26;
    let spin = 0, top = 0;
    if (kind === 'freekick') { spin = -side * gdir * (8 + r3 * 4); top = -3; }
    else if (tech === 'curl' || tech === 'finesse') spin = -side * gdir * (tech === 'curl' ? 9 + r3 * 4 : 4 + r3 * 3);
    else if (tech === 'drive') { spin = (r3 - 0.5) * 3; top = r1 < 0.4 ? -2.5 : 1; }  // frappe sèche, parfois flottante
    else if (tech === 'chip') top = -4;
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
    if (kind === 'header') h.jump = 0.45; else if (!(h.kick > 0)) { h.kick = 0.32; h.kickPow = tech === 'drive' ? 1 : 0.8; h.kickSide = tech === 'finesse'; }
    h.lastTech = tech;
    h.face = Math.atan2(tgt.y - P.y, tgt.x - P.x);
    this.lastTouch = A.side;
    P.inGoal = 0; P.hitPost = false;
    const d = Math.hypot(tgt.x - P.x, tgt.y - P.y, tgt.z - P.z);
    const T = solveKick(P, tgt, { T: Math.max(0.25, d / speed), spin, top });
    this.shot = { side: A.side, outcome: o, shooter: h, gk, at: this.now + T, kind, xg, blocker: blocker?.o, catchIt: speed < 27 && r2 < 0.55 };
    this.pending = null;
    // Le gardien plonge vers le ballon au bon moment (trop tard s'il y a but).
    if (gk && o !== 'blocked') {
      gk.tx = (gx - gdir * 0.8) / L;
      gk.ty = (cy + (tgt.y - cy) * (o === 'saved' ? 0.6 : 0.15)) / W;
      const lat = tgt.y - this.Y(gk);
      if (Math.abs(lat) > 0.9 || tgt.z > 1.6) { gk.diveDelay = Math.max(0, T - 0.35); gk.diveDir = Math.sign(lat) || 1; gk.diveH = Math.min(1, tgt.z / 2.2); }
    }
    const ev = emit(m, out, { type: 'shot', side: A.side, pid: h.mp.id, xg: +xg.toFixed(2), kind, zone: 3, outcome: o, x: tgt.x / L, y: tgt.y / W });
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
    emit(m, out, { type: 'goal', side: s.side, pid: sc.id, pid2: assist ? assist.id : null, kind: s.kind, x: this.P.x / L, y: this.P.y / W, zone: 3 });
    // Célébration : le buteur file vers le poteau de corner, ses coéquipiers le rejoignent.
    const cx = s.side === 0 ? 0.97 : 0.03, cyy = this.P.y < W / 2 ? 0.06 : 0.94;
    s.shooter.celebType = ['plane', 'knees', 'fist', 'point', 'jump'][Math.floor(this.rand() * 5)];
    for (const p of this.players.values()) {
      if (p.side === s.side && !p.gk) { p.celeb = p === s.shooter ? 3.2 : 2.6; p.tx = cx + (this.rand() - 0.5) * 0.05; p.ty = cyy + (this.rand() - 0.5) * 0.08; }
    }
    this.holder = null; this.pending = null; this.shot = null; this.restart = null;
    this.celebrate = 4.5;
    this.afterGoalSide = 1 - s.side;
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
      if (o.cd > 0) continue;
      const d = Math.hypot((o.x - h.x) * L, (o.y - h.y) * W);
      if (d > 1.4) continue;
      if (o.role !== 'press' && o !== h.carry?.takeon?.def && d > 0.9) continue; // seul le presseur va au duel
      const press = LVL[D.tactics.pressing] || 0;
      // Par derrière : on tente rarement (et c'est plus souvent faute).
      const hs = Math.hypot(h.vx || 0, h.vy || 0);
      const behind = hs > 1.5 && (((o.x - h.x) * L * (h.vx || 0) + (o.y - h.y) * W * (h.vy || 0)) / hs) < -0.6;
      if (behind && this.rand() < 0.7) { o.cd = 0.6; continue; }
      this.duelCd = 0.9 + this.rand() * 0.5;
      o.tk = this.rand() < 0.35 ? 'slide' : 'stand';
      const to = h.carry?.takeon;
      if (to && to.def === o) {
        o.cd = 1.2;
        if (to.win) {
          // Crochet réussi : le défenseur se jette dans le vide.
          o.slide = 0.55; o.cd = 1.8; h.carry.takeon = null;
          h.team.stats.dribbles = (h.team.stats.dribbles || 0) + 1; addRating(h.mp, 0.06);
          if (this.rand() < 0.5) emit(m, out, { type: 'dribble', side: h.side, pid: h.mp.id, pid2: o.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
          continue;
        }
        // Raté : le défenseur lit l'action et récupère le ballon (ou commet une faute).
        if (this.rand() < TUNE.foulP * 0.5 * (m.profile.fouls || 1)) { this.foul(h, o, out); return; }
        o.slide = 0.45; h.fall = 0.5;
        D.stats.tackles++; o.mp.tackles++; addRating(o.mp, 0.06);
        emit(m, out, { type: 'tackle', side: D.side, pid: o.mp.id, pid2: h.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
        this.gain(o, out);
        return;
      }
      o.cd = 0.55 + this.rand() * 0.5 - press * 0.1;
      if (this.rand() > (0.5 + press * 0.12) * TUNE.tackleRate) continue;
      // Tentative de tacle : faute, ballon récupéré, ou dribble réussi du porteur.
      const tk = TK[D.tactics.tackling] || 0;
      // Dans sa propre surface, un défenseur se retient (sinon c'est penalty).
      const ownBox = Math.abs(this.P.x - this.goalX(h.side)) < 16.5 && Math.abs(this.P.y - W / 2) < 20.15;
      const foulP = TUNE.foulP * (m.profile.fouls || 1) * (1 + tk * 0.35) * ((h.speed || 0) > 5 ? 1.3 : 1) * (ownBox ? 0.07 : 1) * (behind ? 2.2 : 1) * (h.prep ? 0.35 : 1);
      o.face = Math.atan2((h.y - o.y) * W, (h.x - o.x) * L);
      if (this.rand() < foulP) { this.foul(h, o, out); return; }
      const att = eff(h.mp, 'dri') * 0.75 + eff(h.mp, 'phy') * 0.25;
      const def = eff(o.mp, 'def') * 0.75 + eff(o.mp, 'phy') * 0.25;
      if (this.rand() < sig((def - att) / 13 - 0.25)) {
        o.slide = 0.55; h.fall = 0.6;
        D.stats.tackles++; o.mp.tackles++; addRating(o.mp, 0.06);
        emit(m, out, { type: 'tackle', side: D.side, pid: o.mp.id, pid2: h.mp.id, x: this.P.x / L, y: this.P.y / W, zone: m.zone });
        // Souvent, le tacle ne fait que chasser le ballon : il roule (parfois en touche).
        if (o.tk === 'slide' || this.rand() < 0.3) {
          const P = this.P, a = Math.atan2((h.y - o.y) * W, (h.x - o.x) * L) + (this.rand() - 0.5) * 1.6, v = 5 + this.rand() * 6;
          this.releaseBall(h); this.pending = null; this.lastTouch = D.side;
          P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = this.rand() < 0.3 ? 2 : 0;
          return;
        }
        this.gain(o, out);
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
    offender.slide = 0.55; victim.fall = 1.1;
    const fx = this.P.x, fy = this.P.y;
    const z = m.zone;
    emit(m, out, { type: 'foul', side: D.side, pid: offender.mp.id, pid2: victim.mp.id, x: fx / L, y: fy / W, zone: z });
    m.stoppages += 0.15;
    let yP = 0.135 + (z === 1 || z === 2 ? 0.05 : 0) + (m.minute > 75 ? 0.04 : 0) + (z === 3 ? 0.08 : 0);
    if (offender.mp.yellow) yP *= 0.45;
    yP *= (m.profile.cards || 1) * (1 + (TK[D.tactics.tackling] || 0) * 0.18) * (D.cm ? D.cm.cards : 1) * captainCalm(D);
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
  gain(p, out) {
    const m = this.m;
    this.holder = p; this.inHands = false; this.pending = null;
    p.carry = null;
    for (const q of this.players.values()) q.faceBall = false;
    // Il prend le ballon face à lui (jamais « dans le dos »).
    if (this.dist(p, this.P.x, this.P.y) < 2.5) p.face = Math.atan2(this.P.y - p.y * W, this.P.x - p.x * L);
    p.next = this.now + (0.35 + this.rand() * 0.45) * TUNE.recv;
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
      const f = this.foot(r, 0.4);
      const d = Math.hypot(f.x - P.x, f.y - P.y);
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
    const stop = sp > 0.3 ? (sp * sp) / (2 * 1.9) : 0;
    const rx = P.x + (sp > 0.3 ? (P.vx / sp) * stop : 0), ry = P.y + (sp > 0.3 ? (P.vy / sp) * stop : 0);
    const goingOut = P.z < 0.6 && (ry < -0.3 || ry > W + 0.3 || rx < -0.3 || rx > L + 0.3);
    const letGo = (side) => goingOut && this.lastTouch !== side;
    for (const side of [0, 1]) {
      if (letGo(side)) continue;
      let best = null, bd = 1e9;
      for (const p of this.list(side)) {
        if (p.gk && Math.abs(px - (side === 0 ? 0 : L)) > 18) continue;
        const d = this.dist(p, px, py);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { best.tx = clamp(px / L, 0, 1); best.ty = clamp(py / W, 0, 1); }
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
    if (r.side !== pd.from.side && this.rand() < 0.55) { tx = this.goalX(pd.from.side) + this.dir(pd.from.side) * 3; ty = P.y < W / 2 ? 8 : W - 8; }
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
      if (P.z < 0.8 && (dB < 1.0 || (h.prep && dB < 1.7)) && (sp < 1.8 || h.prep)) {
        glued = true;
        const k = Math.min(1, dt * (h.prep ? 10 : 7));
        const nx = P.x + (f0.x - P.x) * k, ny = P.y + (f0.y - P.y) * k;
        P.vx = (nx - P.x) / Math.max(dt, 1e-4); P.vy = (ny - P.y) / Math.max(dt, 1e-4);
        P.x = nx; P.y = ny; P.z = BR; P.vz = 0; P.spin = 0; P.top = 0;
        P.rot.a += (Math.hypot(P.vx, P.vy) / BR) * dt; P.rot.b = Math.atan2(P.vy, P.vx);
      } else if (P.z < 0.6 && sp >= 1.8) {
        // Le ballon arrive à hauteur du pied (ou il est encore dessous) : nouvelle touche.
        const fx = Math.cos(h.face), fy = Math.sin(h.face);
        const ahead = (P.x - h.x * L) * fx + (P.y - h.y * W) * fy;      // distance devant lui
        const lat = Math.abs(-(P.x - h.x * L) * fy + (P.y - h.y * W) * fx);
        const bv = P.vx * fx + P.vy * fy;                                 // vitesse du ballon dans sa course
        if (ahead < 0.85 && ahead > -0.7 && lat < 1.0 && bv < sp + 0.6 && this.now > (h.nextTouch || 0)) {
          const dri = eff(h.mp, 'dri');
          const tight = h.carry?.takeon || this.pressure(h) < 4;            // collé au pied en un-contre-un
          const push = (tight ? 0.7 : 1.5 + this.rand() * 0.8) + (1 - dri / 100) * (tight ? 0.4 : 1.2);
          const err = (this.rand() - 0.5) * 0.3 * (1.2 - dri / 100);
          let tx = h.carry ? h.carry.x - h.x * L : fx, ty = h.carry ? h.carry.y - h.y * W : fy;
          const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
          const a = Math.atan2(ty, tx) + err, v = sp + push;
          P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v; P.vz = 0;
          h.touch = 0.16; h.nextTouch = this.now + 0.25;
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
          if (this.rand() < 0.4) { P.vx = -P.vx * 0.1 + this.dir(s.side) * 4; P.vy = sx * (6 + this.rand() * 4); P.vz = 3 + this.rand() * 2; }
          else { P.vx = -P.vx * 0.25; P.vy = sx * (5 + this.rand() * 6); P.vz = 2 + this.rand() * 4; }
          P.spin = 0; this.lastTouch = s.gk.side;
        }
      } else if (s.outcome === 'blocked') {
        // Contre : dévié en corner une fois sur trois, sinon le ballon repart.
        if (this.rand() < 0.3) { P.vx = this.dir(s.side) * (7 + this.rand() * 4); P.vy = (this.rand() - 0.5) * 10; P.vz = 1.5 + this.rand() * 2; }
        else { P.vx = -P.vx * 0.25; P.vy += (this.rand() - 0.5) * 9; P.vz = 1.2 + this.rand() * 2; }
        P.spin = 0;
        if (s.blocker) this.lastTouch = s.blocker.side;
      }
    }
    if (s && this.now > s.at + 0.2 && s.outcome !== 'goal') this.shot = null;
    // But : seulement si le tir a été accordé ; sinon le ballon est repoussé sur la ligne.
    if (P.inGoal) {
      if (this.shot && this.shot.outcome === 'goal') { this.goal(out); return; }
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
    else if (kind === 'corner') taker = this.players.get(setPieceTaker(T, 'corner', (mp) => eff(mp, 'pas')).id);
    else if (kind === 'penalty') taker = this.players.get(setPieceTaker(T, 'pen', (mp) => eff(mp, 'tir') * 0.5 + eff(mp, 'sf') * 0.5).id);
    else taker = mates.filter((p) => !p.gk).sort((a, b) => this.dist(a, x, y) - this.dist(b, x, y))[0];
    // Coup franc direct : le spécialiste est désigné dès la faute et vient poser le ballon.
    let direct = false;
    if (kind === 'freekick') {
      const dG = Math.hypot(this.goalX(side) - x, W / 2 - y);
      if (dG < 30 && Math.abs(y - W / 2) < 18 && this.rand() < 0.4) {
        direct = true;
        const fk = this.players.get(setPieceTaker(T, 'fk', (mp) => eff(mp, 'tir') + eff(mp, 'sf')).id);
        if (fk) taker = fk;
      }
    }
    if (!taker) taker = mates[0];
    this.restart = { kind, side, x, y, taker, t: 0, direct };
    this.poss = side;
    changePossession(m, side, m.zone, taker?.mp);
    if (kind === 'corner') {
      T.stats.corners++; momentum(m, side, 2);
      if (out) emit(m, out, { type: 'corner', side, pid: taker.mp.id, x: x / L, y: y / W, zone: 3 });
    }
    if (kind === 'penalty' && out) emit(m, out, { type: 'penalty', side, pid: taker.mp.id, x: x / L, y: y / W, zone: 3 });
    if (kind === 'freekick' && out) emit(m, out, { type: 'freekick', side, pid: taker.mp.id, x: x / L, y: y / W, zone: m.zone });
    if (kind === 'freekick' || kind === 'penalty') m.stoppages += kind === 'penalty' ? 0.8 : 0.1;
    // Le ballon est posé (ou ramené) à l'endroit de la remise en jeu.
    Object.assign(this.P, { x, y, z: BR, vx: 0, vy: 0, vz: 0, spin: 0, top: 0, inGoal: 0, hitPost: false });
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
      const spots = [[6, -3], [8, 3], [11, 0], [5, 6], [13, -6], [16, 2]];
      const att = this.list(rs.side).filter((p) => p !== t && !p.gk).sort((a, b) => eff(b.mp, 'phy') - eff(a.mp, 'phy'));
      att.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.tx = (gx - dir * (18.5 + (i % 3))) / L; p.ty = (W / 2 + ((i % 6) - 2.5) * 5) / W; return; }
        if (i < spots.length) { p.tx = (gx - dir * spots[i][0]) / L; p.ty = (W / 2 + spots[i][1]) / W; }
      });
      const defs = this.list(D.side).filter((p) => !p.gk);
      defs.forEach((p, i) => {
        if (rs.kind === 'penalty') { p.tx = (gx - dir * (18.5 + ((i + 1) % 3))) / L; p.ty = (W / 2 + ((i % 6) - 2.5) * 5 + 2) / W; return; }
        const a = att[i];
        if (a && i < spots.length) { p.tx = a.tx - (dir * 0.8) / L; p.ty = a.ty; }
      });
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
    const minT = { kickoff: 2.4, throw: 1.4, goalkick: 3.0, corner: 4.2, freekick: nearGoal ? 5.5 : 3.2, penalty: 4.5 }[rs.kind] * (this.tacticalMood(rs.taker?.team || this.m.teams[rs.side]).wasting ? 1.8 : 1);
    const atBall = this.dist(t, rs.x, rs.y) < 1.4;
    if (atBall && !rs.placed && rs.kind !== 'throw' && rs.kind !== 'kickoff') { rs.placed = true; t.place = 0.9; t.face = Math.atan2(rs.y - t.y * W, rs.x - t.x * L); }
    if (rs.kind === 'corner' && rs.placed && rs.t > minT - 1.4 && !rs.signal) { rs.signal = true; t.signal = 1.1; }
    t.hold = rs.kind === 'throw' && atBall ? 1 : 0;   // touche : ballon pris à deux mains
    if (t.hold) { rs.holdT = (rs.holdT || 0) + dt; if (rs.holdT < 1.0 && rs.t < 14) return; }
    if (t.hold) t.face = Math.atan2(W / 2 - rs.y, 0);
    // Engagement : chacun doit être dans sa moitié.
    let settled = true;
    if (rs.kind === 'kickoff' || rs.kind === 'penalty' || rs.kind === 'corner' || (rs.kind === 'freekick' && nearGoal)) {
      for (const p of this.players.values()) {
        if (Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W) > (rs.kind === 'kickoff' ? 7 : 4.5)) { settled = false; break; }
        // Engagement : tout le monde dans sa moitié (et l'adversaire hors du rond central).
        if (rs.kind === 'kickoff' && (p.x * L - L / 2) * this.dir(p.side) > 0.02) { settled = false; break; }
      }
    }
    // Trop long : l'arbitre presse les retardataires, qui sprintent (personne n'est jamais déplacé
    // d'un coup) ; on reprend dès que le tireur est au ballon et que l'engagement est réglementaire.
    if (rs.t > 12) rs.hurry = true;
    const kickoffOk = rs.kind !== 'kickoff' || [...this.players.values()].every((p) => (p.x * L - L / 2) * this.dir(p.side) <= 0.02);
    if (!(atBall && rs.t >= minT && (settled || (rs.hurry && kickoffOk) || rs.t > 30) && !(t.place > 0))) return;
    // Armé de la jambe avant de jouer le ballon (le geste précède le départ du ballon).
    if (rs.kind !== 'throw') {
      if (rs.go == null) { rs.go = this.now + 0.12 * GS; t.kick = 0.28; t.kickPow = ['goalkick', 'corner', 'penalty'].includes(rs.kind) ? 1 : 0.55; t.kickSide = rs.kind === 'kickoff'; t.face = Math.atan2(W / 2 - this.P.y, this.goalX(rs.side) - this.P.x); return; }
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
      const inBox = mates.filter((p) => Math.abs(this.X(p) - this.goalX(rs.side)) < 16).sort((a, b) => eff(b.mp, 'phy') - eff(a.mp, 'phy'));
      if (inBox.length) { this.doCross(t, inBox[Math.floor(this.rand() * Math.min(3, inBox.length))], out); return; }
    }
    if (rs.kind === 'freekick') {
      const dG = Math.hypot(this.goalX(rs.side) - rs.x, W / 2 - rs.y);
      if (rs.direct) { this.doShot(t, 'freekick', out); return; }
      if (dG < 40) {
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
      const want = dist < 0.15 ? 0 : Math.min(maxSp, Math.sqrt(2 * 6 * dist));
      const dvx = dist > 0.01 ? (dx / dist) * want : 0, dvy = dist > 0.01 ? (dy / dist) * want : 0;
      const ax = dvx - p.vx, ay = dvy - p.vy, am = Math.hypot(ax, ay);
      const lim = (want > (p.speed || 0) ? 5.2 : 8.5) * dt;
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
      else target = p.speed > 1.2 ? Math.atan2(p.vy, p.vx) : Math.atan2(P.y - p.y * W, P.x - p.x * L);
      let d = target - (p.face || 0);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.turnGap = Math.abs(d);
      p.face = (p.face || 0) + d * Math.min(1, dt * rate);
      // Foulée réelle : un cycle (deux pas) ≈ 4,4 m en sprint, ≈ 2,8 m en petite foulée.
      p.phase = (p.phase || 0) + p.speed * dt * (1.45 + 0.8 * (1 - Math.min(1, p.speed / 8)));
    };
    for (const p of this.players.values()) {
      const vit = p.mp?.p?.attrs?.vit ?? 60, en = p.mp?.energy ?? 100;
      const withBall = p === this.holder && !this.inHands ? (p.carry?.takeon ? 1.0 : 0.86) * ((p.turnGap || 0) > 1.2 ? 0.35 : (p.turnGap || 0) > 0.6 ? 0.7 : 1) : 1;
      if (p.fall > 0.3 || p.slide > 0.2) { p.tx = p.x; p.ty = p.y; }
      // Arrêt de jeu : on se replace en trottinant (on ne sprinte pas pour un coup franc).
      let cap = Infinity;
      if (this.restart?.hurry) cap = Infinity;   // l'arbitre presse : on court se replacer
      else if (this.restart && p !== this.restart.taker) { const dd = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W); cap = dd > 25 ? 6.4 : dd > 10 ? 5 : 3.4; }
      else if (this.restart) cap = Math.hypot((p.tx - p.x) * L, (p.ty - p.y) * W) > 12 ? 6.5 : 4.2;   // le tireur file vers le ballon
      step(p, Math.min(cap, (6.6 + vit * 0.033) * (en > 70 ? 1 - (100 - en) * 0.002 : 0.94 - (70 - en) * 0.006) * withBall * (p.celeb > 0 ? 0.8 : 1)));
      // Effort réel : ce qu'il court (les sprints coûtent bien plus que le trot).
      if (p.mp && !p.celeb) { const v = p.speed || 0; p.mp.work = (p.mp.work || 0) + v * dt * (0.6 + (v / 6.5) ** 2 * 1.6); }
      const gd = dt / GS;
      if (p.diveDelay != null) { p.diveDelay -= dt; if (p.diveDelay <= 0) { p.diveDelay = null; p.dive = 0.75; } }
      for (const k of ['kick', 'slide', 'dive', 'jump', 'celeb', 'touch', 'fall', 'block', 'throwIn', 'ctrl', 'place', 'signal', 'bump']) if (p[k] > 0) p[k] = Math.max(0, p[k] - gd);
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
          if (-rv > 4.5) { a.bump = Math.max(a.bump || 0, 0.35 * ka * 2); c.bump = Math.max(c.bump || 0, 0.35 * kc * 2); a.bumpDir = Math.atan2(-uy, -ux); c.bumpDir = Math.atan2(uy, ux); }
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
