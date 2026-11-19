/**
 * DIAGNOSTIC PHYSIQUE du moteur en direct (outil de développement, désactivé par défaut).
 *
 * Quand il est branché (`sim.diag = new Diag()`), le moteur y dépose :
 *  - les trajectoires PRÉDITES du ballon après chaque frappe (vraie physique) ;
 *  - les points d'interception PRÉVUS pour le destinataire d'une passe ;
 *  - chaque PASSE (étape 4c) : cible voulue, erreur d'exécution, point réellement visé, joueurs
 *    qui ont tenté de couper la trajectoire, premier contact réel et issue (reçue, contrôle raté,
 *    interceptée, déviée, manquée) ;
 *  - chaque contact RÉELLEMENT effectué (qui, partie du corps, distance au point de contact,
 *    hauteur et vitesse du ballon) avec un verdict : physiquement possible ou non selon contact.js.
 *
 * Il n'utilise aucun hasard et ne modifie rien : brancher ou non le diagnostic ne change pas le
 * match (vérifié par le test de déterminisme). Le rendu 3D sait l'afficher (match3d.js).
 */
export class Diag {
  constructor({ keep = 12, keepPasses = false } = {}) {
    this.keep = keep;               // secondes de jeu conservées pour l'affichage
    this.keepPasses = keepPasses;   // rapports : garder toutes les passes du match
    this.passes = [];          // { t, pid, to, aim, exec, dAng (°), dLen, sAng (°), interceptors: [{pid, eta, margin}], contact, outcome }
    this.paths = [];           // { t, pts: [{x,y,z}], by }
    this.plans = [];           // { t, pid, x, y, z, part, eta, margin }
    this.contacts = [];        // { t, pid, kind, x, y, z, speed, part, dist, physical }
    this.gks = [];             // interventions du gardien : trajectoire anticipée, réaction, geste, contact, résultat
    this.shots = [];           // tirs : point visé, erreur, cadré, intervention du gardien, issue
    this.aerials = [];         // duels aériens / têtes : joueurs, timing, contact, qualité, geste, résultat
    this.misses = [];          // { t, pid, x, y, reason } : réceptions manquées (trop tard, mal placé)
    this.counts = { contacts: 0, physical: 0, nonPhysical: 0, misses: 0 };
  }
  _trim(now) {
    const lim = now - this.keep;
    for (const k of this.keepPasses ? ['paths', 'plans', 'contacts', 'misses'] : ['paths', 'plans', 'contacts', 'misses', 'passes', 'gks', 'shots', 'aerials']) { const a = this[k]; let i = 0; while (i < a.length && a[i].t < lim) i++; if (i) a.splice(0, i); }
  }
  path(now, pts, by) { this.paths.push({ t: now, pts, by }); this._trim(now); }
  plan(now, p) { this.plans.push({ t: now, ...p }); this._trim(now); }
  pass(now, rec) { rec.t = now; this.passes.push(rec); this.counts.passes = (this.counts.passes || 0) + 1; this._trim(now); }
  gk(now, rec) { rec.t = now; this.gks.push(rec); this._trim(now); }
  shot(now, rec) { rec.t = now; this.shots.push(rec); this._trim(now); }
  aerial(now, rec) { rec.t = now; this.aerials.push(rec); this._trim(now); }
  miss(now, m) { this.misses.push({ t: now, ...m }); this.counts.misses++; this._trim(now); }
  contact(now, c) {
    this.contacts.push({ t: now, ...c });
    this.counts.contacts++;
    if (c.physical) this.counts.physical++; else this.counts.nonPhysical++;
    this._trim(now);
  }
}
