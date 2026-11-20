/**
 * ARBITRAGE DES INTENTIONS DE DÉPLACEMENT (étape 5a).
 *
 * Module pur et déterministe (aucun hasard) : il est le SEUL à décider de la cible de déplacement
 * d'un joueur. Les systèmes du moteur (placement collectif, porteur, receveur, coupe de passe,
 * poursuite du ballon, gardien…) ne font que PROPOSER une intention dans leur créneau.
 *
 * Proposition : { slot, id, pri, src, x, y (m), value (0..1), ttl (s), end?(): bool, glide?, track?, why }
 *  - track : intention qui SUIT un adversaire ou le porteur (marquage, contenir, second presseur, repli) :
 *            une réaction défensive, jamais lissée (point mis à jour à chaque proposition) ;
 *  - slot  : créneau de la source (une source qui révise sa proposition la remplace : pas de concurrence) ;
 *  - id    : identifiant stable de l'intention (pour une mission P3 : identifiant de mission) ;
 *  - pri   : P1 placement · P2 soutien · P3 mission · P4 urgence · P5 action sur le ballon
 *            (P6, le geste en cours, est hors arbitrage : géré par le moteur) ;
 *  - value : intérêt NORMALISÉ dans [0, 1], comparable entre intentions de même priorité :
 *            chance d'arriver / d'agir à temps (P4), adéquation à la mission ou à la place (P1-P3) ;
 *  - ttl   : durée de validité depuis la DERNIÈRE proposition valide ; end() : condition de fin explicite.
 *
 * Règles :
 *  1. Une intention expire si elle n'a pas été reproposée depuis ttl, ou si sa condition de fin est vraie.
 *  2. Préemption : une intention de priorité supérieure remplace immédiatement l'intention en cours.
 *     Quand elle se termine, le joueur reprend la meilleure intention encore valide (retour).
 *  3. À priorité égale entre créneaux différents : l'intention en cours est conservée au moins
 *     DWELL s, et n'est remplacée que si la rivale vaut au moins RATIO × plus.
 *     Dans un même créneau, un changement d'identifiant (hors montée en urgence P4-P5) attend DWELL s,
 *     et un retour à l'intention qu'on vient de quitter attend FLAP s (anti aller-retour).
 *  4. Ordre fixe de départage : priorité ↓, valeur ↓, rang de source ↑, identifiant ↑.
 *  5. Point visé : P4-P5 → mis à jour immédiatement (une réaction n'est jamais lissée) ;
 *     P1-P3 → la cible ne SAUTE jamais pour une même intention : à sa place, elle ne repart que si
 *     le point s'éloigne de plus de JUMP[pri] m (3 m en P1, 1,5 m en P2-P3) ; elle glisse alors à
 *     l'allure `glide` (m/s) jusqu'à SETTLE[pri] m du point (1 m en P1, 0,4 m en P2-P3) ; au-delà de
 *     FAR m d'écart (grand déplacement du bloc), rattrapage accéléré (CATCH m/s par mètre au-delà).
 *     Un saut de cible n'a lieu qu'au changement d'intention.
 * Ces seuils sont des valeurs initiales, à valider par les diagnostics.
 */

export const P = { PLACEMENT: 1, SOUTIEN: 2, MISSION: 3, URGENCE: 4, BALLON: 5, GESTE: 6 };
export const ARB = { DWELL: 0.6, FLAP: 1.2, RATIO: 1.25, CATCH: 1.5, FAR: 30, JUMP: { 1: 3, 2: 1.5, 3: 1.5 }, SETTLE: { 1: 1, 2: 0.4, 3: 0.4 }, TTL: { 1: 0.6, 2: 1.5, 3: 0.6, 4: 0.6, 5: 0.12 } };

/** Rang fixe des sources (départage à priorité et valeur égales : le plus petit l'emporte). */
export const SRC_RANK = ['gardien', 'porteur', 'receveur', 'tireur', 'coupe', 'duel aérien', 'attaque du centre', 'poursuite', 'pressing', 'ballon coincé',
  'appel', 'marquage', 'repli', 'dédoublement', 'surface', 'second presseur', 'couverture', 'contenir', 'soutien', 'espacement', 'remise en jeu', 'engagement', 'formation'];
const rank = (src) => { const i = SRC_RANK.indexOf(src); return i < 0 ? SRC_RANK.length : i; };

/** Ordre fixe : priorité ↓, valeur ↓, rang de source ↑, identifiant ↑. */
export function better(a, b) {
  if (a.pri !== b.pri) return a.pri > b.pri;
  if (a.value !== b.value) return a.value > b.value;
  const ra = rank(a.src), rb = rank(b.src);
  if (ra !== rb) return ra < rb;
  return a.id < b.id;
}

/** État d'arbitrage d'un joueur. */
export function newArbiter() { return { slots: new Map(), cur: null, ax: null, ay: null, settled: false }; }

/** Dépose (ou remplace) la proposition d'un créneau. */
export function propose(st, now, prop) {
  const e = st.slots.get(prop.slot);
  // Même créneau, nouvel identifiant trop tôt (rôle qui « clignote ») : seule une montée en urgence
  // (P4-P5) ou une réaction défensive de suivi (marquage, repli…) passe immédiatement ; sinon l'intention en cours garde la main jusqu'à la fin du délai.
  // Retour à l'intention qu'on vient de quitter (aller-retour) : il faut avoir tenu la nouvelle FLAP s.
  const hold = prop.id === st.prev?.[0] ? ARB.FLAP : ARB.DWELL;
  if (e && e.prop.id !== prop.id && !(prop.pri > e.prop.pri && (prop.pri >= P.URGENCE || prop.track)) && st.cur && st.cur.slot === prop.slot && st.cur.id === e.prop.id && now - st.cur.since < hold) {
    // Même créneau, même priorité, nouvel identifiant trop tôt : l'intention en cours garde la main
    // (son point suit la révision) jusqu'à la fin du délai minimal.
    e.prop = { ...prop, id: e.prop.id, src: e.prop.src, value: e.prop.value, pri: e.prop.pri, end: e.prop.end }; e.last = now; e.next = prop;
    return;
  }
  st.slots.set(prop.slot, { prop, last: now, next: null });
}

/**
 * Arbitre : renvoie { x, y, cur, event } ou null (aucune intention valide : cible inchangée).
 * event ∈ { null, 'début', 'préemption', 'retour', 'remplacement', 'fin' }.
 */
export function arbitrate(st, now, dt) {
  // 1. Expiration (temps depuis la dernière proposition valide) et conditions de fin explicites.
  st.dropped = null;   // (diagnostic : intentions abandonnées à ce pas et pourquoi)
  for (const [k, e] of st.slots) {
    if (e.next && now - (st.cur?.since ?? -Infinity) >= (e.next.id === st.prev?.[0] ? ARB.FLAP : ARB.DWELL)) { e.prop = e.next; e.next = null; }
    const ttl = e.prop.ttl ?? ARB.TTL[e.prop.pri] ?? 0.6;
    const expired = now - e.last > ttl + 1e-9;
    if (expired || (e.prop.end && e.prop.end())) { st.slots.delete(k); (st.dropped ||= []).push({ id: e.prop.id, src: e.prop.src, pri: e.prop.pri, why: expired ? 'expiration' : 'fin' }); }
  }
  if (!st.slots.size) { const had = st.cur; st.cur = null; st.event = had ? 'fin' : null; return had ? { x: null, y: null, cur: null, event: 'fin' } : null; }
  // 2. Candidats dans l'ordre fixe.
  const cands = [...st.slots.values()].map((e) => e.prop).sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const top = cands[0];
  const curE = st.cur ? st.slots.get(st.cur.slot) : null;
  const curP = curE && curE.prop.id === st.cur.id ? curE.prop : null;
  let chosen, event = null;
  if (!curP) { chosen = top; event = st.cur ? (st.prev?.some((q) => q === top.id) ? 'retour' : 'fin') : 'début'; }
  else if (top.pri > curP.pri) { chosen = top; event = 'préemption'; }
  else {
    chosen = curP;
    const rival = cands.find((c) => c.pri === curP.pri && c.slot !== curP.slot);
    if (rival && now - st.cur.since >= ARB.DWELL && rival.value >= curP.value * ARB.RATIO && rival.value > 0) { chosen = rival; event = 'remplacement'; }
  }
  // 3. Point visé.
  const switched = !st.cur || chosen.id !== st.cur.id || chosen.slot !== st.cur.slot;
  if (switched) {
    if (st.cur) { st.prev = [st.cur.id, ...(st.prev || [])].slice(0, 4); }
    st.cur = { slot: chosen.slot, id: chosen.id, pri: chosen.pri, since: now };
    st.ax = chosen.x; st.ay = chosen.y; st.settled = false;
    if (!event) event = 'début';
  } else if (chosen.pri >= P.URGENCE || chosen.track || st.ax == null) { st.ax = chosen.x; st.ay = chosen.y; st.settled = false; }   // réaction : jamais lissée
  else {
    const d = Math.hypot(chosen.x - st.ax, chosen.y - st.ay);
    // Hystérésis : à sa place (« settled »), il ne repart que si le point s'éloigne de plus de
    // JUMP[pri] m ; une fois reparti, il glisse jusqu'à SETTLE[pri] m du point.
    if (st.settled ? d > ARB.JUMP[chosen.pri] : d > ARB.SETTLE[chosen.pri]) {
      // Glissement continu (jamais de saut pour une même intention) à l'allure `glide` (il se replace
      // en marchant) ; au-delà de FAR m d'écart, rattrapage d'autant plus rapide que l'écart est grand.
      const v = (chosen.glide ?? 2.5) + Math.max(0, d - ARB.FAR) * ARB.CATCH;
      const k = Math.min(1, (v * dt) / Math.max(d, 1e-6));
      st.ax += (chosen.x - st.ax) * k; st.ay += (chosen.y - st.ay) * k;
      st.settled = false;
    } else st.settled = true;
  }
  st.event = switched ? event : null;   // (diagnostic)
  return { x: st.ax, y: st.ay, cur: chosen, event: switched ? event : null };
}
