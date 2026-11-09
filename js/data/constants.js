/**
 * Constantes du jeu : postes, attributs, formations, réglages tactiques.
 * Coordonnées de formation : x = profondeur (0 = propre but, 1 = but adverse),
 * y = latéral (0 = gauche, 1 = droite) du point de vue de l'équipe qui attaque.
 */

export const POSITIONS = ['GB', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MO', 'AG', 'AD', 'BU'];

export const POSITION_LABELS = {
  GB: 'Gardien', DC: 'Défenseur central', DG: 'Latéral gauche', DD: 'Latéral droit',
  MDC: 'Milieu défensif', MC: 'Milieu central', MO: 'Milieu offensif',
  AG: 'Ailier gauche', AD: 'Ailier droit', BU: 'Buteur',
};

/** Groupe de poste (tri, couleurs). */
export const POSITION_GROUP = {
  GB: 'G', DC: 'D', DG: 'D', DD: 'D', MDC: 'M', MC: 'M', MO: 'M', AG: 'A', AD: 'A', BU: 'A',
};

export const ATTRS = ['vit', 'tir', 'pas', 'dri', 'def', 'phy', 'vis', 'sf', 'arr'];
export const ATTR_LABELS = {
  vit: 'Vitesse', tir: 'Tir', pas: 'Passe', dri: 'Dribble', def: 'Défense',
  phy: 'Physique', vis: 'Vision', sf: 'Sang-froid', arr: 'Arrêts',
};

/** Poids des attributs pour la note globale à chaque poste (somme = 1). */
export const POSITION_WEIGHTS = {
  GB: { arr: 0.7, sf: 0.1, phy: 0.1, pas: 0.1 },
  DC: { def: 0.45, phy: 0.25, vit: 0.1, sf: 0.1, pas: 0.1 },
  DG: { def: 0.3, vit: 0.25, pas: 0.15, phy: 0.15, dri: 0.1, vis: 0.05 },
  DD: { def: 0.3, vit: 0.25, pas: 0.15, phy: 0.15, dri: 0.1, vis: 0.05 },
  MDC: { def: 0.3, pas: 0.25, phy: 0.15, vis: 0.15, sf: 0.15 },
  MC: { pas: 0.3, vis: 0.25, dri: 0.15, def: 0.1, phy: 0.1, sf: 0.1 },
  MO: { pas: 0.2, vis: 0.25, dri: 0.25, tir: 0.2, sf: 0.1 },
  AG: { vit: 0.3, dri: 0.3, pas: 0.15, tir: 0.15, vis: 0.1 },
  AD: { vit: 0.3, dri: 0.3, pas: 0.15, tir: 0.15, vis: 0.1 },
  BU: { tir: 0.4, sf: 0.2, vit: 0.15, phy: 0.1, dri: 0.15 },
};

/** Compatibilité poste naturel -> poste joué (1 = parfait). */
const RELATED = {
  GB: {},
  DC: { MDC: 0.88, DG: 0.84, DD: 0.84 },
  DG: { DD: 0.9, DC: 0.85, AG: 0.84, MC: 0.78 },
  DD: { DG: 0.9, DC: 0.85, AD: 0.84, MC: 0.78 },
  MDC: { MC: 0.94, DC: 0.88, MO: 0.82 },
  MC: { MDC: 0.93, MO: 0.93, AG: 0.82, AD: 0.82 },
  MO: { MC: 0.93, AG: 0.88, AD: 0.88, BU: 0.86 },
  AG: { AD: 0.92, MO: 0.88, BU: 0.85, DG: 0.78 },
  AD: { AG: 0.92, MO: 0.88, BU: 0.85, DD: 0.78 },
  BU: { MO: 0.85, AG: 0.85, AD: 0.85 },
};
/** Aptitude d'un JOUEUR à un poste : poste principal, ou postes secondaires (comme FM, ≈ 0,96). */
export function playerFit(p, played) {
  let f = positionFit(p.pos, played);
  if (f < 1 && p.pos2) for (const x of p.pos2) f = Math.max(f, x === played ? 0.96 : positionFit(x, played) * 0.95);
  return f;
}

export function positionFit(natural, played) {
  if (natural === played) return 1;
  if (natural === 'GB' || played === 'GB') return 0.4;
  return RELATED[natural][played] ?? 0.7;
}

const s = (pos, x, y) => ({ pos, x, y });
export const FORMATIONS = {
  '4-4-2': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88),
    s('AG', .48, .13), s('MC', .45, .38), s('MC', .45, .62), s('AD', .48, .87), s('BU', .74, .38), s('BU', .74, .62)],
  '4-3-3': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88),
    s('MDC', .37, .5), s('MC', .5, .3), s('MC', .5, .7), s('AG', .72, .15), s('BU', .78, .5), s('AD', .72, .85)],
  '4-2-3-1': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88),
    s('MDC', .38, .36), s('MDC', .38, .64), s('AG', .62, .15), s('MO', .6, .5), s('AD', .62, .85), s('BU', .79, .5)],
  '3-5-2': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75),
    s('DG', .45, .08), s('MDC', .38, .5), s('MC', .5, .3), s('MC', .5, .7), s('DD', .45, .92),
    s('BU', .75, .38), s('BU', .75, .62)],
  '5-3-2': [s('GB', .04, .5), s('DG', .26, .08), s('DC', .19, .3), s('DC', .17, .5), s('DC', .19, .7), s('DD', .26, .92),
    s('MC', .47, .27), s('MDC', .41, .5), s('MC', .47, .73), s('BU', .73, .38), s('BU', .73, .62)],
};
export const FORMATION_NAMES = Object.keys(FORMATIONS);

export const MENTALITIES = ['defensive', 'balanced', 'offensive'];
export const MENTALITY_LABELS = { defensive: 'Défensive', balanced: 'Équilibrée', offensive: 'Offensive' };
export const LEVELS = ['low', 'mid', 'high'];
export const PRESSING_LABELS = { low: 'Bas', mid: 'Moyen', high: 'Haut' };
export const TEMPO_LABELS = { low: 'Lent', mid: 'Normal', high: 'Rapide' };
export const WIDTH_LABELS = { low: 'Étroit', mid: 'Normal', high: 'Large' };

export const DEFAULT_TACTICS = {
  formation: '4-4-2', mentality: 'balanced', pressing: 'mid', tempo: 'mid', width: 'mid',
  // Consignes d'équipe avancées (valeurs neutres par défaut).
  line: 'mid', passing: 'mixed', focus: 'mixed', counter: 'off', offsideTrap: 'off', tackling: 'normal',
  marking: 'zonal', timeWasting: 'off', gkDist: 'mixed', longShots: 'mid', crossing: 'mid',
};

/** Consignes d'équipe : options et libellés (écran Tactique et pause du match). */
export const TEAM_INSTRUCTIONS = [
  { key: 'line', label: 'Ligne défensive', opts: { low: 'Basse', mid: 'Normale', high: 'Haute' }, help: 'Haute : on récupère plus haut, mais attention aux ballons dans le dos.' },
  { key: 'passing', label: 'Style de passe', opts: { short: 'Court', mixed: 'Mixte', direct: 'Direct' }, help: 'Court : passes plus sûres. Direct : on avance plus vite mais on perd plus de ballons.' },
  { key: 'focus', label: 'Couloir privilégié', opts: { left: 'Gauche', mixed: 'Mixte', center: 'Axe', right: 'Droite' }, help: 'Côté vers lequel l\'équipe oriente le jeu.' },
  { key: 'crossing', label: 'Centres', opts: { low: 'Rares', mid: 'Normaux', high: 'Fréquents' } },
  { key: 'longShots', label: 'Tirs de loin', opts: { low: 'Rarement', mid: 'Parfois', high: 'Souvent' } },
  { key: 'counter', label: 'Contre-attaque', opts: { off: 'Non', on: 'Oui' }, help: 'Projection rapide dès la récupération du ballon.' },
  { key: 'offsideTrap', label: 'Piège du hors-jeu', opts: { off: 'Non', on: 'Oui' }, help: 'Plus de hors-jeu signalés… et plus de risques si le piège échoue.' },
  { key: 'tackling', label: 'Tacles', opts: { soft: 'Prudents', normal: 'Normaux', hard: 'Engagés' }, help: 'Engagés : plus de ballons récupérés, plus de fautes et de cartons.' },
  { key: 'marking', label: 'Marquage', opts: { zonal: 'En zone', man: 'Individuel' }, help: 'Individuel : plus dur à dribbler, mais plus fatigant.' },
  { key: 'gkDist', label: 'Relance du gardien', opts: { short: 'Courte', mixed: 'Mixte', long: 'Longue' } },
  { key: 'timeWasting', label: 'Gagner du temps', opts: { off: 'Non', on: 'Oui' }, help: 'Quand on mène : moins d\'actions, plus de temps additionnel… et un arbitre agacé.' },
];

/** Consignes individuelles (par poste du onze). */
export const PLAYER_INSTRUCTIONS = [
  { key: 'duty', label: 'Mission', opts: { def: 'Défense', sup: 'Soutien', att: 'Attaque' }, def: 'sup' },
  { key: 'shoot', label: 'Tirs', opts: { less: 'Moins', normal: 'Normal', more: 'Plus' }, def: 'normal' },
  { key: 'dribble', label: 'Dribbles', opts: { less: 'Moins', normal: 'Normal', more: 'Plus' }, def: 'normal' },
  { key: 'runs', label: 'Montées', opts: { stay: 'Rester', normal: 'Normal', join: 'Monter' }, def: 'normal' },
];

/** Postes d'une tactique : formation personnalisée si elle existe, sinon formation de base. */
export const slotsOf = (tactics) => (tactics.custom && tactics.custom.length === 11 ? tactics.custom : FORMATIONS[tactics.formation] || FORMATIONS['4-4-2']);

/** Poste déduit d'un emplacement sur le terrain (x = profondeur, y = latéral). */
export function posFromXY(x, y, isGk) {
  if (isGk) return 'GB';
  const wide = y < 0.24 || y > 0.76;
  const left = y < 0.5;
  if (x < 0.3) return wide ? (left ? 'DG' : 'DD') : 'DC';
  if (x < 0.43) return wide ? (left ? 'DG' : 'DD') : 'MDC';
  if (x < 0.6) return wide ? (left ? 'AG' : 'AD') : 'MC';
  if (x < 0.7) return wide ? (left ? 'AG' : 'AD') : 'MO';
  return wide ? (left ? 'AG' : 'AD') : 'BU';
}

export const SQUAD_SIZE = 25;
export const MAX_SUBS = 5;
export const BENCH_SIZE = 9;

/** Rôles individuels (consignes par poste) et leurs effets dans le moteur. */
export const ROLES = {
  std: { label: 'Standard', pos: null, desc: 'Comportement classique du poste.' },
  meneur: { label: 'Meneur', pos: ['MC', 'MO', 'MDC'], desc: 'Aimante le ballon et cherche la passe vers l\'avant.' },
  pivot: { label: 'Pivot', pos: ['MDC', 'MC'], desc: 'Reste devant la défense, sécurise la relance.' },
  piston: { label: 'Piston', pos: ['DG', 'DD'], desc: 'Monte très haut et multiplie les centres.' },
  renard: { label: 'Renard', pos: ['BU'], desc: 'Vit dans la surface, tire dès qu\'il peut.' },
  pointe: { label: 'Pivot de pointe', pos: ['BU'], desc: 'Cible des centres et des longs ballons.' },
  interieur: { label: 'Ailier intérieur', pos: ['AG', 'AD', 'MO'], desc: 'Repique dans l\'axe pour dribbler et frapper.' },
};
export const rolesFor = (pos) => Object.keys(ROLES).filter((r) => !ROLES[r].pos || ROLES[r].pos.includes(pos));
