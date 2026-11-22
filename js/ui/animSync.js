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
 * les anciens indicateurs du moteur ne les pilotent plus. Les autres gestes (tacles, têtes, gardien,
 * touche, chutes, célébrations…) gardent leurs anciens indicateurs (statut : non migrés, 6c-6d).
 */
export const DELAY = 0.15;                 // différé d'affichage (s) ≥ la plus longue anticipation ci-dessous
const KICK = { pre: 0.38, contact: 0.55 };  // fractions de l'animation de frappe (armé, contact) — comme avant
const LEAD_KICK_FREE = 0.15;              // frappe sans armé : élan compressé dans les 0,15 s avant le contact
const TOUCH = { lead: 0.112, post: 0.112 }; // touche de conduite : contact au sommet du geste
const CTRL = { lead: 0.12, post: 0.24 };   // contrôle : le corps se présente 0,12 s avant, amortit 0,24 s après
/** Cinématique inverse (s) : montée du poids avant le contact, descente après. */
/** Rotation d'affichage vers un ballon touché derrière ou sur le côté (touches, contrôles) : fenêtre plus large que la jambe. */
const TURN = { rise: 0.22, fall: 0.18, free: Math.PI / 3, max: Math.PI * 0.75 };
const IK = { kick: { rise: 0.1, fall: 0.05 }, touch: { rise: 0.08, fall: 0.04 }, ctrl: { rise: 0.1, fall: 0.05 } };
const KICKS = new Set(['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied']);
const CTRLS = new Set(['contrôle', 'subi']);
/** Familles migrées en 6b (le rendu ne lit plus les anciens indicateurs pour elles). */
export const MIGRATED = new Set([...KICKS, ...CTRLS, 'touche de conduite']);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

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
  /** Gestes migrés : champs de geste recalculés depuis le contrat (anciens indicateurs ignorés). */
  applyContract(tD, simNow) {
    const G = this.v.live.gest;
    const by = new Map();
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
      if (kick) { d._ik = ikOf(kick.g, IK.kick.rise, IK.kick.fall, (kick.g.style?.foot || d.kickFoot) === 'L' ? 0 : 1); d._ik.wy = 0; }   // (frappe : orientation du moteur)
      else if (touch) { d._ik = ikOf(touch.g, IK.touch.rise, IK.touch.fall, null); d._ik.turn = TURN; }   // (la jambe la plus proche du ballon : le pied de touche du moteur suit la foulée)
      else if (ctrl && ctrl.g.kind === 'contrôle') {
        d._ik = ikOf(ctrl.g, IK.ctrl.rise, IK.ctrl.fall, null); d._ik.turn = TURN;
        if (d._ik && ctrl.g.cPart && ctrl.g.cPart !== 'pied') d._ik.part = ctrl.g.cPart;   // cuisse, poitrine, tête : le corps se porte vers le ballon
      }
    }
  }
}
