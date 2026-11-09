/**
 * BOÎTE DE RÉCEPTION À DÉCISIONS
 * Les messages classiques (pushMessage) peuvent porter une décision : 2 à 4 choix,
 * une échéance, et un « gestionnaire » enregistré par le système concerné.
 * Tout passe par l'Accueil : aucune nouvelle page.
 */
import { pushMessage } from './state.js';

const HANDLERS = {};

/**
 * Enregistre un type de décision.
 * def : { resolve(state, data, key) -> { msg, effects?, open? }, expire?(state, data) -> msg? }
 */
export function registerDecision(kind, def) { HANDLERS[kind] = def; }

/** Ajoute une décision dans la boîte de réception. */
export function pushDecision(state, { kind, title, text = '', icon = '❓', prio = 1, choices, data = {}, days = 3 }) {
  pushMessage(state, { prio, icon, title, text });
  const m = state.messages[0];
  m.decision = { kind, choices, data, expires: (state.seasonOver ? 0 : state.day) + days, season: state.season };
  return m;
}

export const openDecisions = (state, kind = null) =>
  state.messages.filter((m) => m.decision && !m.decision.done && (!kind || m.decision.kind === kind));

/** Résout une décision : retourne { ok, msg, effects, open }. */
export function resolveDecision(state, msgId, key) {
  const m = state.messages.find((x) => String(x.id) === String(msgId));
  if (!m?.decision || m.decision.done) return { ok: false, msg: 'Décision déjà prise.' };
  const h = HANDLERS[m.decision.kind];
  if (!h) return { ok: false, msg: 'Type de décision inconnu.' };
  const r = h.resolve(state, m.decision.data, key) || {};
  m.decision.done = key;
  m.read = true;
  m.text = `${m.text} → ${m.decision.choices.find((c) => c.key === key)?.label || key}`;
  return { ok: true, msg: r.msg || 'C\'est noté.', effects: r.effects || null, open: r.open || null };
}

/** Échéances : une décision ignorée applique son effet « par défaut ». */
export function expireDecisions(state) {
  for (const m of state.messages) {
    const d = m.decision;
    if (!d || d.done) continue;
    if (d.season === state.season && state.day < d.expires) continue;
    d.done = 'expired';
    m.read = true;
    const h = HANDLERS[d.kind];
    const msg = h?.expire?.(state, d.data);
    if (msg) m.text = `${m.text} → ${msg}`;
  }
}

/** Pour les tests et la simulation automatique : choisit une réponse au hasard. */
export function autoResolveAll(state, rng) {
  for (const m of openDecisions(state)) resolveDecision(state, m.id, rng.pick(m.decision.choices).key);
}

/** Les effets affichés après un choix : { team: +2, board: -1… } -> lignes lisibles. */
export const EFFECT_LABELS = { team: 'Moral du groupe', target: 'Joueur concerné', board: 'Board', fans: 'Supporters', media: 'Médias', rival: 'Tension avec l\'adversaire', dressing: 'Vestiaire', opp: 'Motivation adverse', pressure: 'Pression sur le groupe' };
