/**
 * CONTRAT MOTEUR → ANIMATION (étape 6a) : descriptif des gestes et des contacts, en LECTURE SEULE.
 *
 * Le moteur appelle cet enregistreur aux endroits où il a DÉJÀ décidé un geste ou constaté un
 * contact physique. L'enregistreur ne décide rien, ne consomme aucun hasard, et le moteur ne lit
 * jamais ce qu'il produit : le match est identique avec ou sans lui (test de déterminisme).
 *
 * TEMPS. Horloge du moteur `sim.now` (secondes de jeu simulé, pas fixe `dt`, 1/96 s dans le jeu).
 * Au pas n, `now` vaut la fin du pas. Un contact balayé à la fraction `frac` ∈ [0, 1] du pas a lieu à
 * t = now − (1 − frac)·dt ; une frappe (impulsion donnée par le moteur au moment de la décision
 * d'exécution) a lieu à t = now (frac = 1). Précision de référence : un pas (dt).
 *
 * GESTE (`p.act`, le dernier geste du joueur ; historique dans `log.gestures` si demandé) :
 *   id        identifiant stable, croissant (unique dans le match)
 *   pid, side joueur
 *   kind      'passe' | 'passe levée' | 'frappe' | 'centre' | 'dégagement' | 'remise en jeu au pied' |
 *             'touche' | 'contrôle' | 'touche de conduite' | 'prise de balle' | 'tacle (fente)' |
 *             'tacle (glissé)' | 'saut de tête' | 'tête' | 'saut' | 'plongeon' | 'mains' | 'geste technique' |
 *             'subi' (le ballon heurte un joueur qui n'a pas réagi)
 *   part      partie du corps prévue : 'pied' | 'tête' | 'mains' | 'jambe' | 'corps'
 *   foot      'G' | 'D' | null
 *   src       endroit du moteur qui a décidé le geste
 *   t0        début du geste (s)
 *   tPlan     instant du contact PRÉVU par le moteur (s), ou null s'il n'est pas planifié (le contact,
 *             s'il a lieu, est constaté par la géométrie : tacle, plongeon, saut défensif…)
 *   anim      représentation actuelle par le rendu (avant migration) : { timer, dur, at } — minuteur
 *             lu par le rendu, durée de l'animation (s) et fraction où le contact est représenté ;
 *             tAnim = t0 + at·dur est l'instant du contact ANIMÉ
 *   contacts  identifiants des contacts physiques rattachés (plusieurs possibles)
 *   tContact  instant du premier contact physique (s) ou null
 *   end       instant de fin (s) ou null tant que le geste est en cours
 *   outcome   'contact' | 'sans contact' (geste exécuté, ballon non touché : feinte, saut disputé
 *             perdu, plongeon battu…) | 'annulé' (armé abandonné avant le contact) | 'interrompu'
 *             (chute, tacle subi, nouveau geste) | 'subi'
 *   why       précision (raison d'annulation, d'interruption…)
 *   reflex    vrai si le geste a été ouvert au contact (aucun armé décidé avant : contrôle, touche de
 *             conduite, frappe sans armé…) ; t0re, rearm / relaunch : armé suspendu ou geste relancé
 * CONTACT (`log.contacts`) : { id, pid, side, kind, part, t, step, frac, gid } — gid = geste rattaché.
 * DÉPLACEMENT (`p.loco`, écrit par move() depuis le modèle 5c) : { speed, vx, vy, acc, face,
 *   mode: 'arrêt' | 'avant' | 'pas chassés' | 'reculons', turn (écart d'orientation restant, rad) }.
 */
export const GESTURE_VERSION = 1;

/** Gestes qui attendent un contact de la partie du corps indiquée (sinon : geste sans contact). */
const PART_OF = {
  'passe': 'pied', 'passe levée': 'pied', 'frappe': 'pied', 'centre': 'pied', 'dégagement': 'pied', 'remise en jeu au pied': 'pied',
  'touche': 'mains', 'contrôle': null, 'touche de conduite': 'pied', 'prise de balle': null, 'tacle (fente)': 'jambe', 'tacle (glissé)': 'jambe',
  'saut de tête': 'tête', 'tête': 'tête', 'saut': null, 'plongeon': 'mains', 'mains': 'mains', 'geste technique': 'pied', 'subi': 'corps',
};

/** Frappes (un geste armé de frappe reçoit le contact de la frappe exécutée, quel qu'en soit le type final). */
const KICKS = new Set(['passe', 'passe levée', 'frappe', 'centre', 'dégagement', 'remise en jeu au pied', 'touche']);
/** Gestes longs qui peuvent recevoir des contacts pendant leur déroulement. */
const LONG = new Set(['tacle (fente)', 'tacle (glissé)', 'saut de tête', 'saut', 'plongeon', 'geste technique']);
/** Contacts qui constituent l'exécution d'une frappe. */
const KICK_CONTACT = new Set(['frappe', 'lancer']);

export class GestureLog {
  /** keep : secondes d'historique gardées (0 = seulement le geste courant de chaque joueur) ; all : tout garder (outils). */
  constructor(sim, { keep = 0, all = false } = {}) {
    this.sim = sim; this.keep = keep; this.all = all;
    this.gid = 0; this.cid = 0;
    this.gestures = []; this.contacts = [];
  }
  get now() { return this.sim.now; }
  _push(arr, x) {
    if (!this.all && !this.keep) return;
    arr.push(x);
    if (!this.all) { const lim = this.now - this.keep; let i = 0; while (i < arr.length && (arr[i].end ?? arr[i].t ?? arr[i].t0) < lim) i++; if (i > 64) arr.splice(0, i); }
  }

  /** Début d'un geste décidé par le moteur. */
  begin(p, kind, { foot = null, tPlan = null, anim = null, src = null, part = null } = {}) {
    const cur = p.act;
    // Le moteur relance le même geste avant tout contact (saut relancé, armé recommencé) : même geste,
    // nouvel instant prévu ; l'animation repart (t0re).
    if (cur && cur.end == null && cur.kind === kind && !cur.contacts.length) {
      cur.t0re = this.now; if (tPlan != null) cur.tPlan = tPlan; if (anim) cur.anim = anim; cur.relaunch = (cur.relaunch || 0) + 1;
      return cur;
    }
    if (cur && cur.end == null) this.finish(p, cur.contacts.length ? 'contact' : 'interrompu', 'nouveau geste : ' + kind);
    const g = { id: ++this.gid, pid: p.mp?.id ?? null, side: p.side, kind, part: part ?? PART_OF[kind] ?? null, foot: foot === 'L' ? 'G' : foot === 'R' ? 'D' : foot,
      src, t0: this.now, tPlan, anim, contacts: [], tContact: null, end: null, outcome: null, why: null };
    p.act = g; this._push(this.gestures, g);
    return g;
  }
  /** Le moteur a déplacé l'instant prévu du contact (geste réarmé). */
  replan(p, tPlan, anim = null, held = false) { const g = p.act; if (g && g.end == null && KICKS.has(g.kind)) { g.tPlan = tPlan; g.t0re = this.now; if (anim) g.anim = anim; if (!g.held) g.rearm = (g.rearm || 0) + 1; g.held = held; } }
  /** Fin du geste (`kicksOnly` : seulement si le geste en cours est une frappe — abandon d'un armé). */
  finish(p, outcome, why = null, kicksOnly = false) {
    const g = p.act;
    if (!g || g.end != null || (kicksOnly && !KICKS.has(g.kind))) return;
    g.end = this.now; g.outcome = outcome; g.why = why;
  }
  /**
   * Contact physique constaté par le moteur, rattaché à un geste :
   *  - au geste en cours s'il l'attend (frappe armée → contact de frappe ; tacle, saut, plongeon,
   *    geste technique → tout contact pendant leur déroulement) : contact PRINCIPAL ;
   *  - pendant l'armé d'une frappe, une touche de conduite est un contact SECONDAIRE (approche) : le
   *    geste de frappe continue ;
   *  - sinon, un geste réflexe est ouvert au contact (`reflex` : type, animation actuelle).
   */
  contact(p, kind, part, { frac = 1, reflex = null, foot = null, anim = null, src = null } = {}) {
    const dt = this.sim._dt || 0, t = this.now - (1 - frac) * dt;
    let g = p.act, role = 'principal';
    const open = g && g.end == null;
    if (open && (LONG.has(g.kind) || (KICKS.has(g.kind) && KICK_CONTACT.has(kind)))) role = 'principal';
    else if (open && KICKS.has(g.kind) && !g.contacts.length) role = 'secondaire';
    else {
      g = reflex ? this.begin(p, reflex, { foot, tPlan: t, anim, src: src || kind, part: PART_OF[reflex] === null ? null : PART_OF[reflex] ?? part }) : null;
      if (g) { g.t0 = t; g.reflex = true; }   // geste ouvert au contact (aucun armé décidé avant)
    }
    const c = { id: ++this.cid, pid: p.mp?.id ?? null, side: p.side, kind, part, t, step: this.sim._stepN || 0, frac, gid: g ? g.id : null, role };
    if (g && role === 'principal') { g.contacts.push(c.id); if (g.tContact == null) { g.tContact = t; g.cPart = part; } }
    else if (g) (g.aux ||= []).push(c.id);
    this._push(this.contacts, c);
    if (this.onContact) this.onContact(c, g);
    return c;
  }
  /** Évènement sans ballon pendant un geste (ex. tacle qui touche la jambe de l'adversaire). */
  note(p, what) { const g = p.act; if (g && g.end == null) (g.notes ||= []).push({ what, t: this.now }); }
  /** Fin naturelle des gestes dont le minuteur d'animation est écoulé (appelé à la fin du pas). */
  sweep(players) {
    for (const p of players) {
      const g = p.act;
      if (!g || g.end != null) continue;
      // Interruption : le joueur tombe, est au sol ou se blesse pendant un geste (hors tacle glissé : la chute en fait partie).
      if (!g.kind.startsWith('tacle') && g.kind !== 'plongeon' && (p.fall > 0.3 || p.hurt > 0)) { this.finish(p, g.contacts.length ? 'contact' : 'interrompu', 'chute / blessure'); continue; }
      const tm = g.anim?.timer;
      const running = tm === '_tk' ? !!p._tk : tm === '_dive' ? !!p._dive : tm ? p[tm] > 0 : false;
      if (!running) this.finish(p, g.contacts.length ? 'contact' : g.kind === 'subi' ? 'subi' : 'sans contact', g.contacts.length ? null : 'animation terminée sans contact');
    }
  }
}
