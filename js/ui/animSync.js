/**
 * SYNCHRONISATION ANIMATION ↔ CONTACT (étape 6b) — côté rendu uniquement.
 *
 * Problème : un contrôle, une touche de conduite ou une frappe sans armé ne sont connus du moteur
 * qu'à l'instant du contact ; une animation qui démarre au contact montre toujours le contact trop
 * tard. Solution : l'affichage montre la partie avec un léger différé `DELAY` (0,15 s). Quand un
 * contact a lieu au temps moteur t, l'image du temps t − DELAY est encore à venir à l'écran : le
 * geste peut y commencer avant le contact, et le contact animé tombe exactement sur l'image du contact.
 *
 * Ce module ne modifie jamais les objets du moteur : il enregistre, à chaque pas, une copie des
 * champs d'affichage des joueurs et du ballon, puis construit des objets d'affichage pour l'instant
 * t_aff = now − DELAY (positions interpolées entre deux pas). Pour les gestes MIGRÉS (frappes, passes,
 * centres, dégagements, remises en jeu au pied, contrôles, touches de conduite), les champs de geste
 * que lit le rendu (kick, touch, ctrl…) sont recalculés à partir du contrat (js/engine/gesture.js) ;
 * les anciens indicateurs du moteur ne les pilotent plus. Étape 6c-A : gestes aériens des joueurs de
 * champ (saut de tête, tête, saut, contrôles hauts) migrés de la même façon (minuteur `jump`). Étape 6c-B :
 * gardien — contact des mains (plongeon, sortie aérienne, mains debout, prise) piloté par le contrat :
 * résultat lu dans l'enregistrement (capté, repoussé, dévié), mains au ballon au contact réel, parade
 * debout et petit saut calés sur le contact, relance ballon en main (lâcher puis frappe au genou) ; le
 * plongeon lui-même garde le minuteur du moteur (déjà calé sur sa cinématique). Les autres gestes (tacles,
 * touche, chutes, célébrations, gestes techniques) gardent leurs anciens indicateurs (6c-C à 6d).
 */
export const DELAY = 0.15;                 // différé d'affichage (s) ≥ la plus longue anticipation ci-dessous
const KICK = { pre: 0.38, contact: 0.55 };  // fractions de l'animation de frappe (armé, contact) — comme avant
const LEAD_KICK_FREE = 0.15;              // frappe sans armé : élan compressé dans les 0,15 s avant le contact
const TOUCH = { lead: 0.112, post: 0.112 }; // touche de conduite : contact au sommet du geste
const CTRL = { lead: 0.12, post: 0.24 };   // contrôle : le corps se présente 0,12 s avant, amortit 0,24 s après
/** Cinématique inverse (s) : montée du poids avant le contact, descente après. */
/** Rotation d'affichage vers un ballon touché derrière ou sur le côté (touches, contrôles) : fenêtre plus large que la jambe. */
const TURN = { rise: 0.22, fall: 0.18, free: Math.PI / 3, max: Math.PI * 0.75 };
const IK = { kick: { rise: 0.1, fall: 0.05 }, touch: { rise: 0.08, fall: 0.04 }, ctrl: { rise: 0.1, fall: 0.05 }, air: { rise: 0.12, fall: 0.06 } };
/**
 * Saut (6c-A) : minuteur `jump` du moteur, 0,45 « unité de geste » = 0,72 s de jeu (GS = 1,6) ; le coup
 * de tête de l'animation (sommet du saut, tête qui frappe vers l'avant) est à la phase 0,5 (étalonnage
 * `calib6`). Tête sans saut préalable (geste réflexe) : élan compressé dans les 0,15 s avant le contact.
 */
export const JUMP = { dur: 0.45 * 1.6, uc: 0.5, lead: 0.15 };
/** Gestes aériens migrés en 6c-A (joueurs de champ ; le saut du gardien, partie « mains », relève de 6c-B). */
export const AIR = new Set(['saut de tête', 'tête', 'saut']);
const KICKS = new Set(['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied']);
const CTRLS = new Set(['contrôle', 'subi']);
/** Familles migrées en 6b (le rendu ne lit plus les anciens indicateurs pour elles). */
export const MIGRATED = new Set([...KICKS, ...CTRLS, 'touche de conduite', ...AIR]);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** Gardien (6c-B) : gestes à contact des mains ; fenêtre de cinématique inverse des bras autour du contact (s). */
export const GK = new Set(['plongeon', 'saut', 'mains']);
const GKW = { rise: 0.14, fall: 0.16, hold: 0.45, holdCatch: 0.9, block: 0.4, blockLead: 0.12 };
/**
 * Relance du gardien ballon en main (6c-B) : le moteur frappe le ballon là où il le tient (≈ 1,05 m de haut,
 * sans armé). À l'affichage : le ballon est lâché dans les 0,15 s avant le contact et frappé à hauteur de
 * genou (PUNT.z), puis rejoint la trajectoire du moteur en PUNT.blend s.
 */
export const PUNT = { z: 0.6, lead: 0.15, blend: 0.12 };
/**
 * Tacles (6c-C) : phase des images clés (KEYS.stand / KEYS.slide du rendu) calée sur la cinématique du moteur
 * (contact.js · TACKLE : t1 = pied au plus loin, dur = fin du geste) au lieu du minuteur `slide` (1,6 fois plus
 * long). Fente : pied tendu (phase 0,5) à t1. Glissé : au sol, jambe tendue (phase 0,26) en 0,3 s, tenu jusqu'à
 * dur, puis relevé. Fenêtres de cinématique inverse du pied (contact ballon ou sur l'homme).
 */
export const TK = { stand: { t1: 0.36, dur: 0.55, up: 0.35 }, slide: { t1: 0.6, dur: 0.9, down: 0.3, up: 0.6 }, rise: 0.1, fall: 0.1 };
export function tacklePhase(kind, s) {
  if (s < 0) return null;
  if (kind === 'stand') { const T = TK.stand; if (s < T.t1) return 0.5 * s / T.t1; const u = 0.5 + 0.5 * (s - T.t1) / (T.dur - T.t1 + T.up); return u < 1 ? u : null; }
  const T = TK.slide; if (s < T.down) return 0.26 * s / T.down; if (s < T.dur) return 0.26 + 0.29 * (s - T.down) / (T.dur - T.down);
  const u = 0.55 + 0.45 * (s - T.dur) / T.up; return u < 1 ? u : null;
}


/** Phase (0-1) de l'animation de frappe à l'instant d'affichage `t`, ou null hors du geste. */
export function kickPhase(g, t, simNow) {
  const dur = g.anim?.dur || 0.512, strike = (KICK.contact - KICK.pre) * dur;
  const known = g.tContact != null && g.tContact <= simNow + 1e-9;
  const tC = known ? g.tContact : g.tPlan;
  const tS = g.reflex ? (known ? g.tContact - LEAD_KICK_FREE : null) : (g.t0re ?? g.t0);
  if (tS == null || t < tS) return null;
  if (!known) {
    // Contact pas encore constaté (armé en cours ou suspendu) : élan vers l'armé, tenu au sommet.
    if (g.end != null && t >= g.end) return null;   // armé abandonné / interrompu : le geste s'arrête
    const until = (tC ?? tS + 0.6 * dur) - strike;
    return KICK.pre * clamp01((t - tS) / Math.max(1e-3, until - tS));
  }
  if (t < tC - strike) return KICK.pre * clamp01((t - tS) / Math.max(1e-3, tC - strike - tS));
  if (t < tC) return KICK.pre + (KICK.contact - KICK.pre) * (t - (tC - strike)) / strike;
  const u = KICK.contact + (1 - KICK.contact) * (t - tC) / ((1 - KICK.contact) * dur);
  return u < 1 ? u : null;
}
/**
 * Phase (0-1) du saut à l'instant d'affichage `t`, ou null hors du geste. Contact animé (phase 0,5) =
 * contact physique s'il est connu, sinon contact prévu par le moteur ; saut sans instant prévu (mur) :
 * calé comme le moteur (début du geste). Geste réflexe (tête sans saut préalable, contrôle haut) :
 * montée compressée dans les 0,15 s avant le contact.
 */
export function jumpPhase(g, t, simNow) {
  const known = g.tContact != null && g.tContact <= simNow + 1e-9;
  if (g.reflex) {
    if (!known) return null;
    const tC = g.tContact; if (t < tC - JUMP.lead) return null;
    const u = t < tC ? JUMP.uc * (t - (tC - JUMP.lead)) / JUMP.lead : JUMP.uc + (t - tC) / JUMP.dur;
    return u < 1 ? u : null;
  }
  const T = known ? g.tContact : (g.tPlan ?? (g.t0re ?? g.t0) + JUMP.uc * JUMP.dur);
  const tS = T - JUMP.uc * JUMP.dur;
  if (t < tS) return null;
  if (g.outcome === 'interrompu' && g.end != null && t >= g.end) return null;   // chute pendant le saut : le geste s'arrête
  const u = (t - tS) / JUMP.dur;
  return u < 1 ? u : null;
}
/** Phase (0-1, sommet 0,5 au contact) d'un geste à contact central (touche, contrôle). */
export function peakPhase(tC, t, lead, post) {
  if (t < tC - lead || t > tC + post) return null;
  return t < tC ? 0.5 * (t - (tC - lead)) / Math.max(1e-6, lead) : 0.5 + 0.5 * (t - tC) / Math.max(1e-6, post);
}

export class DisplayBuffer {
  constructor(view) { this.v = view; this.snaps = []; this.keys = new Map(); this.disp = new Map(); this.ball = { rot: { a: 0, b: 0 } }; this.ballN = { x: 0.5, y: 0.5, h: 0 }; this.probe = null; this.extra = 0; }
  reset() { this.snaps.length = 0; }
  /** Copie des champs d'affichage (valeurs simples) d'un joueur ; liste des clés revue chaque seconde. */
  _keysOf(id, p, t) {
    let k = this.keys.get(id);
    if (!k || t - k.t > 1) { k = { t, list: Object.keys(p).filter((x) => x[0] !== '_' && ['number', 'string', 'boolean'].includes(typeof p[x])) }; this.keys.set(id, k); }
    return k.list;
  }
  /** Après chaque pas du moteur. */
  record() {
    const L = this.v.live, t = L.now, P = this.v.phys;
    const ps = new Map();
    for (const [id, p] of this.v.players) { const o = {}; for (const k of this._keysOf(id, p, t)) o[k] = p[k]; ps.set(id, o); }
    this.snaps.push({ t, ps, holder: L.holder ? L.holder.mp.id : null, inHands: L.inHands, restart: !!L.restart,
      b: { x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz: P.vz, ra: P.rot?.a || 0, rb: P.rot?.b || 0, spin: P.spin || 0, inGoal: P.inGoal || 0 } });
    while (this.snaps.length > 2 && this.snaps[1].t < t - DELAY - 0.1 - this.extra) this.snaps.shift();   // (extra : sonde de contrôle visuel)
  }
  /**
   * Objets d'affichage à l'instant t_aff = now − DELAY. mode : 'contrat' (gestes migrés pilotés par
   * le contrat) ou 'ancien' (même différé, anciens indicateurs : comparaison avant / après).
   */
  sample(mode = 'contrat', tAt = null) {
    const L = this.v.live, S = this.snaps;
    if (S.length < 2) return false;
    const tD = tAt ?? L.now - DELAY;
    let i = S.length - 1; while (i > 0 && S[i].t > tD) i--;
    const s0 = S[i], s1 = S[Math.min(S.length - 1, i + 1)], a = s1.t > s0.t ? clamp01((tD - s0.t) / (s1.t - s0.t)) : 0;
    const lerpA = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * a;
    for (const [id, p] of this.v.players) {
      const q0 = s0.ps.get(id), q1 = s1.ps.get(id) || q0;
      if (!q0) { this.disp.set(id, p); continue; }
      const d = this.disp.get(id) && this.disp.get(id) !== p ? this.disp.get(id) : {};
      for (const k in d) if (!(k in q0)) delete d[k];
      Object.assign(d, q0);
      d.x = q0.x + (q1.x - q0.x) * a; d.y = q0.y + (q1.y - q0.y) * a; d.face = lerpA(q0.face || 0, q1.face || 0);
      d.speed = q0.speed + ((q1.speed ?? q0.speed) - q0.speed) * a; d.phase = (q0.phase || 0) + ((q1.phase || 0) - (q0.phase || 0)) * a;
      d.mp = p.mp; d.id = p.id; d.side = p.side; d.gk = p.gk;
      this.disp.set(id, d);
    }
    for (const id of [...this.disp.keys()]) if (!this.v.players.has(id)) this.disp.delete(id);
    const b0 = s0.b, b1 = s1.b, B = this.ball;
    B.x = b0.x + (b1.x - b0.x) * a; B.y = b0.y + (b1.y - b0.y) * a; B.z = b0.z + (b1.z - b0.z) * a;
    B.vx = b0.vx; B.vy = b0.vy; B.vz = b0.vz; B.rot.a = b0.ra + (b1.ra - b0.ra) * a; B.rot.b = b0.rb; B.spin = b0.spin; B.inGoal = b0.inGoal;
    this.ballN.x = B.x / 105; this.ballN.y = B.y / 68; this.ballN.h = Math.max(0, B.z - 0.11) / 26;
    this.holder = s0.holder; this.inHands = s0.inHands; this.tD = tD;
    if (mode === 'contrat') this.applyContract(tD, tAt != null ? tD + DELAY : L.now);
    return true;
  }
  /** Position du ballon (m) à l'instant t du moteur, d'après l'enregistrement (interpolée). */
  ballAt(t) {
    const S = this.snaps; if (!S.length) return null;
    let i = S.length - 1; while (i > 0 && S[i].t > t) i--;
    const a = S[i], b = S[Math.min(S.length - 1, i + 1)], k = b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
    return { x: a.b.x + (b.b.x - a.b.x) * k, y: a.b.y + (b.b.y - a.b.y) * k, z: a.b.z + (b.b.z - a.b.z) * k };
  }
  /** Position (m) du joueur `pid` à l'instant t du moteur, d'après l'enregistrement. */
  posAt(pid, t) {
    const S = this.snaps; if (!S.length) return null;
    let i = S.length - 1; while (i > 0 && S[i].t > t) i--;
    const q = S[i].ps.get(pid); return q ? { x: q.x * 105, y: q.y * 68, face: q.face || 0 } : null;
  }
  /**
   * Plongeon (6c-B) : côté du plongeon DANS LE REPÈRE DU GARDIEN (+1 : sa gauche, −1 : sa droite), lu sur son
   * déplacement réel (le moteur le fait glisser vers le point d'interception, souvent en diagonale) ; null si
   * le déplacement n'est pas encore lisible.
   */
  diveSide(g, simNow) {
    const a = this.posAt(g.pid, g.t0), b = this.posAt(g.pid, Math.min(simNow, g.t0 + 0.45));
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y; if (Math.hypot(dx, dy) < 0.12) return null;
    const lat = -Math.sin(a.face) * dx + Math.cos(a.face) * dy;
    return lat >= 0 ? 1 : -1;
  }
  /** Ballon tenu par `pid` à l'instant t du moteur (d'après l'enregistrement) ? */
  heldAt(pid, t) {
    const S = this.snaps; if (!S.length) return false;
    let i = S.length - 1; while (i > 0 && S[i].t > t) i--;
    const s = S[Math.min(S.length - 1, i + 1)];
    return s.holder === pid && !!s.inHands;
  }
  /**
   * Gardien (6c-B) : contact des mains d'après le contrat. Résultat lu dans l'enregistrement (l'affichage
   * a 0,15 s d'avance) : capté (ballon tenu juste après), dévié (le ballon garde l'essentiel de sa vitesse
   * et de sa direction) ou repoussé. Renvoie null hors de la fenêtre du contact.
   */
  gkContact(gs, tD, simNow) {
    for (let j = gs.length - 1; j >= 0; j--) {
      const g = gs[j];
      if (!GK.has(g.kind) || (g.kind === 'saut' && g.part !== 'mains') || g.tContact == null || g.tContact > simNow) continue;
      const x = tD - g.tContact; if (x < -GKW.rise || x > GKW.holdCatch) continue;
      const tC = g.tContact, a0 = this.ballAt(tC - 0.03), a1 = this.ballAt(tC - 0.005);
      const vin = { x: (a1.x - a0.x) / 0.025, y: (a1.y - a0.y) / 0.025, z: (a1.z - a0.z) / 0.025 };
      let res = 'capté';
      if (!this.heldAt(g.pid, Math.min(simNow, tC + 0.03))) {
        const b0 = this.ballAt(Math.min(simNow, tC + 0.02)), b1 = this.ballAt(Math.min(simNow, tC + 0.05)), dt = Math.max(1e-3, Math.min(simNow, tC + 0.05) - Math.min(simNow, tC + 0.02));
        const vo = { x: (b1.x - b0.x) / dt, y: (b1.y - b0.y) / dt, z: (b1.z - b0.z) / dt };
        const ni = Math.hypot(vin.x, vin.y, vin.z), no = Math.hypot(vo.x, vo.y, vo.z), cos = ni && no ? (vin.x * vo.x + vin.y * vo.y + vin.z * vo.z) / (ni * no) : -1;
        res = ni && no / ni > 0.6 && cos > Math.cos(35 * Math.PI / 180) ? 'dévié' : 'repoussé';
      }
      if (res !== 'capté' && x > GKW.hold) continue;   // (prise : fenêtre prolongée jusqu'à la fin d'un plongeon, sans saut du corps)
      return { g, x, res, vin, at: this.ballAt(tC) };
    }
    return null;
  }
  /** Gestes migrés : champs de geste recalculés depuis le contrat (anciens indicateurs ignorés). */
  applyContract(tD, simNow) {
    const G = this.v.live.gest;
    const by = new Map(); this.rel = null;
    for (const g of G.gestures) { if (g.t0 > tD + DELAY + 0.05) continue; let a = by.get(g.pid); if (!a) by.set(g.pid, (a = [])); a.push(g); }
    for (const [id, d] of this.disp) {
      if (d === this.v.players.get(id)) continue;
      const gs = by.get(id) || [];
      // Frappes : toujours pilotées par le contrat (toutes leurs sources sont migrées).
      let kick = null;
      for (let j = gs.length - 1; j >= 0 && !kick; j--) { const g = gs[j]; if (!KICKS.has(g.kind)) continue; const u = kickPhase(g, tD, simNow); if (u != null) kick = { g, u }; }
      if (kick) {
        const s = kick.g.style || {}, km = s.kickMax || kick.g.anim?.dur / 1.6 || 0.32;
        d.kick = km * (1 - kick.u); d.kickMax = km; d.kickFoot = s.foot || d.kickFoot; d.kickPow = s.pow ?? d.kickPow; d.kickSide = !!s.side; d.kickLoft = !!s.loft; d.kickOut = s.out ? 0.3 : 0;
      } else { d.kick = 0; d.kickOut = 0; }
      // Touches de conduite et contrôles : pilotés par le contrat si le dernier contact du joueur
      // appartient à une famille migrée ; sinon (tacle, geste technique…) anciens indicateurs.
      let touch = null, ctrl = null, lastKind = null;
      for (let j = gs.length - 1; j >= 0; j--) {
        const g = gs[j]; if (g.tContact == null || g.tContact > simNow) continue;
        if (lastKind == null && g.tContact <= tD) lastKind = g.kind;   // (dernier contact visible : d'où vient l'ancien minuteur affiché)
        if (!touch && g.kind === 'touche de conduite') { const u = peakPhase(g.tContact, tD, TOUCH.lead, TOUCH.post); if (u != null) touch = { g, u }; }
        if (!ctrl && CTRLS.has(g.kind)) { const u = g.kind === 'subi' ? (tD >= g.tContact ? peakPhase(g.tContact, tD, 0, CTRL.post) : null) : peakPhase(g.tContact, tD, CTRL.lead, CTRL.post); if (u != null) ctrl = { g, u }; }
        if (touch && ctrl) break;
      }
      const migratedLast = lastKind == null || MIGRATED.has(lastKind);
      if (touch) { const s = touch.g.style || {}, tm = s.touchMax || 0.14; d.touch = tm * (1 - touch.u); d.touchMax = tm; d.touchFoot = s.touchFoot || d.touchFoot; d.touchIn = !!s.touchIn; }
      else if (migratedLast) d.touch = 0;
      if (ctrl) { d.ctrl = 0.3 * (1 - ctrl.u); d.ctrlH = ctrl.g.style?.h ?? d.ctrlH; }
      else if (migratedLast) d.ctrl = 0;
      d._g6 = kick?.g || touch?.g || ctrl?.g || null;   // (geste migré affiché : sonde de contact visuel)
      // Cinématique inverse autour du contact : poids croissant jusqu'au contact physique, puis décroissant.
      d._ik = null;
      // Cible : le ballon À L'INSTANT DU CONTACT (connu grâce au différé) — le pied et le ballon s'y rejoignent exactement au contact.
      // (présent pendant tout le geste : hors de la fenêtre de poids, il sert seulement à empêcher le pied d'entrer dans le ballon)
      const ikOf = (g, rise, fall, leg) => { if (g.tContact == null || g.tContact > simNow) return { w: 0, leg, at: null, dtc: 1, gid: g.id }; const x = tD - g.tContact; let w = x < 0 ? 1 - Math.min(1, -x / rise) : 1 - Math.min(1, x / fall); w = Math.max(0, w); let wy = 1 - Math.min(1, Math.abs(x) / (x < 0 ? TURN.rise : TURN.fall)); wy = Math.max(0, wy); return { w: w * w * (3 - 2 * w), wy: wy * wy * (3 - 2 * wy), leg, at: this.ballAt(g.tContact), dtc: x, gid: g.id }; };
      // Gestes aériens (6c-A) : saut piloté par le contrat ; le saut du gardien (6c-B) garde l'ancien indicateur.
      let air = null;
      if (!d.gk) {
        for (let j = gs.length - 1; j >= 0 && !air; j--) { const g = gs[j]; if (!AIR.has(g.kind) || g.part === 'mains') continue; const u = jumpPhase(g, tD, simNow); if (u != null) air = { g, u }; }
        // Contrôle haut (tête, poitrine) : petit saut réflexe ; l'amplitude est réglée au rendu (0 si le ballon est à hauteur).
        if (!air && ctrl && ctrl.g.kind === 'contrôle' && (ctrl.g.cPart === 'tête' || ctrl.g.cPart === 'poitrine')) { const u = jumpPhase(ctrl.g, tD, simNow); if (u != null) air = { g: ctrl.g, u, ctrl: true }; }
      }
      if (air) {
        const g = air.g, known = g.tContact != null && g.tContact <= simNow + 1e-9, T = known ? g.tContact : (g.tPlan ?? null);
        d.jump = 0.45 * (1 - air.u) || 1e-6;
        d._air = { gid: g.id, u: air.u, contact: known, part: known ? (g.cPart || 'tête') : 'tête', ctrl: !!air.ctrl, at: T != null ? this.ballAt(Math.min(T, simNow)) : null };
      } else if (!d.gk) { d.jump = 0; d._air = null; }
      else d._air = null;
      // Gardien (6c-B) : mains au ballon au contact réel ; parade debout calée sur le contact (et non lancée
      // après lui) ; plongeon ou sortie sans contact : les gants ne touchent jamais le ballon.
      if (d.gk) {
        d._gk = null; d.diveSide = null;
        if (d.dive > 0) { const gd = gs.findLast?.((g) => g.kind === 'plongeon' && g.t0 <= tD + 0.02) ?? [...gs].reverse().find((g) => g.kind === 'plongeon' && g.t0 <= tD + 0.02); if (gd) d.diveSide = this.diveSide(gd, simNow); }
        const c = this.gkContact(gs, tD, simNow);
        if (c) {
          const x = c.x; let w = x < 0 ? 1 - Math.min(1, -x / GKW.rise) : c.res === 'capté' ? 1 : 1 - Math.min(1, x / GKW.fall); w = Math.max(0, w);
          d._gk = { w: w * w * (3 - 2 * w), dtc: x, res: c.res, vin: c.vin, at: c.at, gid: c.g.id, kind: c.g.kind, part: c.g.cPart, tC: c.g.tContact };
          const standing = c.g.kind === 'mains' && !(d.dive > 0);
          // Ballon bas touché debout à plus d'un mètre : plongeon court vers lui, calé sur le contact (corps au sol
          // au moment du contact ; pose du plongeon à sa phase de pleine extension).
          const me = this.posAt(c.g.pid, c.g.tContact);
          if (standing && me && (c.at?.z ?? 9) < 0.7 && Math.hypot(c.at.x - me.x, c.at.y - me.y) > 1.0) {
            const t = 0.45 + (tD - c.g.tContact) / 0.5;
            if (t > 0 && t < 1) { d.dive = 0.75 * (1 - t); d.diveH = Math.min(1, c.at.z / 2.2); const lat = -Math.sin(me.face) * (c.at.x - me.x) + Math.cos(me.face) * (c.at.y - me.y); d.diveSide = lat >= 0 ? 1 : -1; d.block = 0; d._gk.shortDive = true; }
          }
          if (d._gk.shortDive) { /* (plongeon court : pas de parade debout) */ }
          else if (standing && c.res !== 'capté' && (c.at?.z ?? 0) <= 1.7) { const u = (tD - (c.g.tContact - GKW.blockLead)) / GKW.block; d.block = u >= 0 && u < 1 ? GKW.block * (1 - u) : 0; }
          else if (standing) d.block = 0;
          if (standing && (c.at?.z ?? 0) > 1.7 && !(d.jump > 0 && gs.some((g) => g.kind === 'saut' && g.part === 'mains' && g.end == null))) {
            // Ballon haut touché debout : petit saut calé sur le contact (montée compressée dans les 0,15 s avant).
            const u = jumpPhase({ reflex: true, tContact: c.g.tContact }, tD, simNow); d.jump = u != null ? 0.45 * (1 - u) || 1e-6 : 0; d.claimHigh = u != null ? 0.5 : 0;
          }
        } else {
          // Hors contact : la parade debout et le petit saut lancés par le moteur APRÈS le contact sont remplacés par
          // ceux calés ci-dessus ; un geste sans contact (plongeon battu, sortie manquée) garde sa pose, mains à distance.
          const late = gs.some((g) => g.kind === 'mains' && g.tContact != null && g.tContact <= simNow && tD - g.tContact > -GKW.rise && tD - g.tContact < 0.6);
          if (late) { d.block = 0; if (!gs.some((g) => g.kind === 'saut' && g.part === 'mains' && tD - g.t0 < 1)) { d.jump = 0; d.claimHigh = 0; } }
          const nc = gs.find((g) => (g.kind === 'plongeon' || (g.kind === 'saut' && g.part === 'mains')) && g.tContact == null && g.t0 <= tD + 0.02 && (g.end == null || tD < g.end + 0.4));
          if (nc) d._gk = { avoid: true, gid: nc.id, kind: nc.kind };
        }
      }
      d._rel = null;
      if (d.gk) for (let j = gs.length - 1; j >= 0; j--) {
        const g = gs[j]; if (!KICKS.has(g.kind) || g.tContact == null || g.tContact > simNow) continue;
        if (tD < g.tContact - PUNT.lead || tD > g.tContact + PUNT.blend) break;
        if (this.heldAt(g.pid, g.tContact - 0.012)) { const ph = this.ballAt(g.tContact); d._rel = this.rel = { gid: g.id, pid: g.pid, tC: g.tContact, phys: ph, at: { x: ph.x, y: ph.y, z: Math.min(ph.z, PUNT.z) } }; }
        break;
      }
      // Tacles (6c-C) : phase calée sur la cinématique du moteur ; pied d'attaque au ballon au contact, ou sur les
      // jambes de l'adversaire au contact sur l'homme ; tacle sans contact ballon : pieds tenus à distance du ballon.
      d._tkU = null; d._tkMiss = false; let tkIK = null;
      for (let j = gs.length - 1; j >= 0; j--) {
        const g = gs[j]; if (!g.kind.startsWith('tacle')) continue;
        const kind = g.kind === 'tacle (glissé)' ? 'slide' : 'stand', u = tacklePhase(kind, tD - g.t0);
        if (u == null) { if (tD - g.t0 < 3) d.slide = 0; break; }   // (fin du geste : l'ancien minuteur, plus long, ne le prolonge pas)
        d._tkU = u; d.tk = kind; d.slide = Math.max(d.slide || 0, 0.05);
        const leg = (d.id ?? 0) % 2 === 1 ? 0 : 1;   // (jambe d'attaque des images clés, comme le rendu les applique)
        const ballC = g.tContact != null && g.tContact <= simNow;
        d._tkMiss = !ballC;
        const man = (g.notes || []).find((n) => /homme/.test(n.what) && n.t <= simNow);
        if (ballC) { tkIK = ikOf(g, TK.rise, TK.fall, leg); tkIK.wy = 0; tkIK.noShift = true; }
        else if (man) {
          // Jambes de l'adversaire touché : le plus proche du pied du tacleur à l'instant noté par le moteur.
          const me = this.posAt(g.pid, man.t); let vic = null, vd = Infinity;
          if (me) for (const [id2, q2] of this.disp) { if (q2.side === d.side) continue; const pv = this.posAt(id2, man.t); if (!pv) continue; const dd = Math.hypot(pv.x - me.x, pv.y - me.y); if (dd < vd) { vd = dd; vic = pv; } }
          if (vic && vd < 2.2) {
            const ux = (me.x - vic.x) / (vd || 1), uy = (me.y - vic.y) / (vd || 1), x = tD - man.t;
            let w = x < 0 ? 1 - Math.min(1, -x / TK.rise) : 1 - Math.min(1, x / TK.fall); w = Math.max(0, w);
            tkIK = { w: w * w * (3 - 2 * w), wy: 0, leg, at: { x: vic.x + ux * 0.02, y: vic.y + uy * 0.02, z: 0.11 + 0.08 }, dtc: x, gid: g.id, noShift: true, man: true };   // (bout du pied à ~11 cm du centre de la victime : sur son tibia)
          }
        }
        break;
      }
      if (tkIK) { d._ik = tkIK; }
      else if (kick) { d._ik = ikOf(kick.g, IK.kick.rise, IK.kick.fall, (kick.g.style?.foot || d.kickFoot) === 'L' ? 0 : 1); d._ik.wy = 0; if (d._rel && d._rel.gid === kick.g.id && d._ik.at) d._ik.at = { ...d._rel.at }; }   // (frappe : orientation du moteur)
      else if (touch) { d._ik = ikOf(touch.g, IK.touch.rise, IK.touch.fall, null); d._ik.turn = TURN; }   // (la jambe la plus proche du ballon : le pied de touche du moteur suit la foulée)
      else if (air && !air.ctrl && air.g.tContact != null && air.g.tContact <= simNow) {
        // Contact de la tête (ou d'une autre partie du corps) pendant un saut : le corps se porte vers le ballon au contact.
        d._ik = ikOf(air.g, IK.air.rise, IK.air.fall, null); d._ik.part = ['tête', 'poitrine', 'cuisse'].includes(air.g.cPart) ? air.g.cPart : 'tête'; d._ik.turn = TURN;
      }
      else if (ctrl && ctrl.g.kind === 'contrôle') {
        d._ik = ikOf(ctrl.g, IK.ctrl.rise, IK.ctrl.fall, null); d._ik.turn = TURN;
        if (d._ik && ctrl.g.cPart && ctrl.g.cPart !== 'pied') { d._ik.part = ctrl.g.cPart; d._ik.ctrlAir = true; }   // cuisse, poitrine, tête : le corps se porte vers le ballon
      }
    }
  }
}
