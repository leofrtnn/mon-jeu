/**
 * DIAGNOSTIC PHYSIQUE du moteur en direct (outil de développement, désactivé par défaut).
 *
 * Quand il est branché (`sim.diag = new Diag()`), le moteur y dépose :
 *  - les trajectoires PRÉDITES du ballon après chaque frappe (vraie physique) ;
 *  - les points d'interception PRÉVUS pour le destinataire d'une passe ;
 *  - chaque contact RÉELLEMENT effectué (qui, partie du corps, distance au point de contact,
 *    hauteur et vitesse du ballon) avec un verdict : physiquement possible ou non selon contact.js.
 *
 * Il n'utilise aucun hasard et ne modifie rien : brancher ou non le diagnostic ne change pas le
 * match (vérifié par le test de déterminisme). Le rendu 3D sait l'afficher (match3d.js).
 */
export class Diag {
  constructor({ keep = 12 } = {}) {
    this.keep = keep;          // secondes de jeu conservées pour l'affichage
    this.paths = [];           // { t, pts: [{x,y,z}], by }
    this.plans = [];           // { t, pid, x, y, z, part, eta, margin }
    this.contacts = [];        // { t, pid, kind, x, y, z, speed, part, dist, physical }
    this.counts = { contacts: 0, physical: 0, nonPhysical: 0 };
  }
  _trim(now) {
    const lim = now - this.keep;
    for (const k of ['paths', 'plans', 'contacts']) { const a = this[k]; let i = 0; while (i < a.length && a[i].t < lim) i++; if (i) a.splice(0, i); }
  }
  path(now, pts, by) { this.paths.push({ t: now, pts, by }); this._trim(now); }
  plan(now, p) { this.plans.push({ t: now, ...p }); this._trim(now); }
  contact(now, c) {
    this.contacts.push({ t: now, ...c });
    this.counts.contacts++;
    if (c.physical) this.counts.physical++; else this.counts.nonPhysical++;
    this._trim(now);
  }
}
