/**
 * Coups de pied arrêtés travaillés (façon « routines » de FM) : plan d'attaque sur corner et
 * coup franc, organisation défensive, et poids de l'entraîneur des CPA.
 * Partagé par le moteur rapide (match.js) et le moteur en direct (live.js) : même plan, mêmes
 * effets. Les équipes IA jouent le plan par défaut (« auto »), comme avant.
 */

export const CORNER_AIMS = {
  auto: { label: 'Varié (auto)', desc: 'Le staff alterne les combinaisons.' },
  near: { label: 'Premier poteau', desc: 'Ballon tendu au premier poteau, pour une déviation.' },
  far: { label: 'Second poteau', desc: 'Ballon brossé au second poteau, pour le plus grand.' },
  centre: { label: 'Point de penalty', desc: 'Au centre, dans la course des attaquants.' },
  short: { label: 'Joué à deux', desc: 'Passe courte puis centre à un meilleur angle.' },
  low: { label: 'En retrait au sol', desc: 'À ras de terre pour le tireur posté à l\'entrée de la surface.' },
};
export const FK_AIMS = {
  auto: { label: 'Varié (auto)' }, far: { label: 'Second poteau' }, centre: { label: 'Point de penalty' }, low: { label: 'Joué au sol' },
};
export const FK_DIRECT = { auto: 'Selon la distance', often: 'Tenter souvent', never: 'Jamais (toujours centrer)' };
export const MARKING = {
  mixed: { label: 'Mixte', desc: 'Trois joueurs en zone, les autres prennent un attaquant.' },
  zonal: { label: 'En zone', desc: 'Chacun tient une zone : solide au centre et au premier poteau, fragile au second.' },
  man: { label: 'Individuel', desc: 'Chacun suit un attaquant : solide au second poteau, fragile au premier et sur les retraits.' },
};

export const SET_DEFAULT = {
  corner: { aim: 'auto', box: 5, threats: [], lurker: true },
  fk: { aim: 'auto', direct: 'auto' },
  def: { marking: 'mixed', posts: 1, up: 1, wall: 0 },
};

/** Plan complet d'une équipe (valeurs par défaut pour ce qui n'est pas réglé). */
export function setPlanOf(src) {
  const s = src || {};
  const corner = { ...SET_DEFAULT.corner, ...(s.corner || {}) };
  corner.back = Math.max(1, 9 - corner.box - (corner.lurker ? 1 : 0));   // le reste couvre derrière
  return { corner, fk: { ...SET_DEFAULT.fk, ...(s.fk || {}) }, def: { ...SET_DEFAULT.def, ...(s.def || {}) } };
}

/** Combinaison jouée pour ce corner (« auto » : variée, sans tirage au sort). */
export function cornerRoutine(plan, n, minute) {
  const a = plan.corner.aim;
  if (a !== 'auto') return a;
  return ['centre', 'near', 'far', 'centre', 'short', 'near', 'far', 'low'][(n * 5 + Math.floor(minute)) % 8];
}

/**
 * Avantage (en logit) de l'attaque sur un ballon arrêté joué vers `aim`, selon l'organisation
 * défensive adverse et les deux entraîneurs des CPA (notes /20, 0 = pas d'entraîneur).
 */
export function setPieceEdge(atk, dfn, aim, coachA = 10, coachD = 10) {
  const mk = dfn.def.marking;
  const tbl = {
    zonal: { near: -0.25, centre: -0.2, far: 0.3, short: 0.15, low: 0.25 },
    man: { near: 0.25, centre: 0.05, far: -0.3, short: 0.05, low: 0.2 },
    mixed: { near: 0, centre: 0, far: 0, short: 0.05, low: 0.05 },
  }[mk] || {};
  let e = tbl[aim] ?? 0;
  // Défenseurs aux poteaux : moins de buts dans les coins, mais un attaquant de plus est libre.
  e += (aim === 'near' || aim === 'far' ? -0.1 : 0.06) * dfn.def.posts;
  // Joueurs laissés devant par la défense : un marqueur de moins dans la surface.
  e += 0.1 * dfn.def.up;
  // Monde dans la surface côté attaque.
  e += (atk.corner.box - 5) * 0.08;
  // Entraîneurs des CPA (routines répétées, placements, timing des courses).
  e += ((coachA || 6) - 10) * 0.025 - ((coachD || 6) - 10) * 0.025;
  return e;
}

/** Risque de contre après un corner perdu : peu de joueurs restés derrière, adversaires laissés devant. */
export function counterRisk(atk, dfn) {
  return Math.max(0.02, 0.06 + (3 - atk.corner.back) * 0.05 + dfn.def.up * 0.05);
}

/** Probabilité de tenter le coup franc direct (dans la zone de tir). */
export const directFkChance = (plan, base) => (plan.fk.direct === 'never' ? 0 : plan.fk.direct === 'often' ? Math.min(0.9, base * 2.2) : base);
