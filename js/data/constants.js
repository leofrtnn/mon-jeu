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
  // Systèmes supplémentaires (défense à 4, à 3, à 5).
  '4-4-2 losange': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .37, .5), s('MC', .49, .28), s('MC', .49, .72), s('MO', .62, .5), s('BU', .77, .38), s('BU', .77, .62)],
  '4-4-1-1': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('AG', .48, .13), s('MC', .45, .38), s('MC', .45, .62), s('AD', .48, .87), s('MO', .63, .5), s('BU', .78, .5)],
  '4-1-4-1': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .35, .5), s('AG', .55, .13), s('MC', .52, .36), s('MC', .52, .64), s('AD', .55, .87), s('BU', .78, .5)],
  '4-3-3 offensif': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MC', .45, .3), s('MC', .45, .7), s('MO', .58, .5), s('AG', .72, .15), s('BU', .79, .5), s('AD', .72, .85)],
  '4-2-2-2': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .38, .36), s('MDC', .38, .64), s('MO', .6, .22), s('MO', .6, .78), s('BU', .77, .38), s('BU', .77, .62)],
  '4-3-1-2': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .38, .5), s('MC', .48, .28), s('MC', .48, .72), s('MO', .62, .5), s('BU', .77, .38), s('BU', .77, .62)],
  '4-3-2-1': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .38, .5), s('MC', .46, .28), s('MC', .46, .72), s('MO', .63, .32), s('MO', .63, .68), s('BU', .79, .5)],
  '4-5-1': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('AG', .5, .12), s('MC', .46, .32), s('MDC', .4, .5), s('MC', .46, .68), s('AD', .5, .88), s('BU', .77, .5)],
  '4-2-4': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MC', .45, .38), s('MC', .45, .62), s('AG', .72, .13), s('BU', .77, .38), s('BU', .77, .62), s('AD', .72, .87)],
  '4-6-0 (faux 9)': [s('GB', .04, .5), s('DG', .22, .12), s('DC', .19, .37), s('DC', .19, .63), s('DD', .22, .88), s('MDC', .38, .5), s('MC', .48, .3), s('MC', .48, .7), s('AG', .64, .15), s('MO', .66, .5), s('AD', .64, .85)],
  '3-4-3': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75), s('DG', .48, .1), s('MC', .45, .38), s('MC', .45, .62), s('DD', .48, .9), s('AG', .72, .18), s('BU', .78, .5), s('AD', .72, .82)],
  '3-4-2-1': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75), s('DG', .47, .1), s('MC', .44, .38), s('MC', .44, .62), s('DD', .47, .9), s('MO', .63, .32), s('MO', .63, .68), s('BU', .79, .5)],
  '3-4-1-2': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75), s('DG', .47, .1), s('MC', .44, .38), s('MC', .44, .62), s('DD', .47, .9), s('MO', .62, .5), s('BU', .77, .38), s('BU', .77, .62)],
  '3-1-4-2': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75), s('MDC', .33, .5), s('DG', .5, .1), s('MC', .5, .37), s('MC', .5, .63), s('DD', .5, .9), s('BU', .76, .38), s('BU', .76, .62)],
  '3-5-1-1': [s('GB', .04, .5), s('DC', .2, .25), s('DC', .18, .5), s('DC', .2, .75), s('DG', .45, .08), s('MDC', .38, .5), s('MC', .5, .3), s('MC', .5, .7), s('DD', .45, .92), s('MO', .63, .5), s('BU', .79, .5)],
  '5-4-1': [s('GB', .04, .5), s('DG', .26, .08), s('DC', .19, .3), s('DC', .17, .5), s('DC', .19, .7), s('DD', .26, .92), s('AG', .48, .15), s('MC', .45, .38), s('MC', .45, .62), s('AD', .48, .85), s('BU', .76, .5)],
  '5-2-3': [s('GB', .04, .5), s('DG', .26, .08), s('DC', .19, .3), s('DC', .17, .5), s('DC', .19, .7), s('DD', .26, .92), s('MC', .45, .35), s('MC', .45, .65), s('AG', .7, .18), s('BU', .77, .5), s('AD', .7, .82)],
  '5-2-1-2': [s('GB', .04, .5), s('DG', .26, .08), s('DC', .19, .3), s('DC', .17, .5), s('DC', .19, .7), s('DD', .26, .92), s('MC', .44, .35), s('MC', .44, .65), s('MO', .6, .5), s('BU', .76, .38), s('BU', .76, .62)],
};
export const FORMATION_NAMES = Object.keys(FORMATIONS);
/** Systèmes courants dans le football réel : ceux qu'utilisent les entraîneurs de l'IA. */
export const COMMON_FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-4-1-1', '4-3-1-2', '4-4-2 losange', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '4-2-2-2'];
/** Familles de systèmes (écran Tactique). */
export const FORMATION_GROUPS = [
  ['Défense à 4', FORMATION_NAMES.filter((f) => f.startsWith('4'))],
  ['Défense à 3', FORMATION_NAMES.filter((f) => f.startsWith('3'))],
  ['Défense à 5', FORMATION_NAMES.filter((f) => f.startsWith('5'))],
];

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
  overlap: 'normal', dribbling: 'normal',
};

/** Consignes d'équipe : options et libellés (écran Tactique et pause du match). */
export const TEAM_INSTRUCTIONS = [
  { key: 'line', label: 'Ligne défensive', opts: { low: 'Basse', mid: 'Normale', high: 'Haute' }, help: 'Haute : on récupère plus haut, mais attention aux ballons dans le dos.' },
  { key: 'passing', label: 'Style de passe', opts: { short: 'Court', mixed: 'Mixte', direct: 'Direct' }, help: 'Court : passes plus sûres. Direct : on avance plus vite mais on perd plus de ballons.' },
  { key: 'focus', label: 'Couloir privilégié', opts: { left: 'Gauche', mixed: 'Mixte', center: 'Axe', right: 'Droite' }, help: 'Côté vers lequel l\'équipe oriente le jeu.' },
  { key: 'crossing', label: 'Centres', opts: { low: 'Rares', mid: 'Normaux', high: 'Fréquents' } },
  { key: 'longShots', label: 'Tirs de loin', opts: { low: 'Rarement', mid: 'Parfois', high: 'Souvent' } },
  { key: 'overlap', label: 'Montées des latéraux', opts: { stay: 'Rester', normal: 'Normal', join: 'Monter' }, help: 'Monter : les latéraux débordent et donnent de la largeur, mais laissent de l\'espace dans leur dos.' },
  { key: 'dribbling', label: 'Dribbles', opts: { less: 'Moins', normal: 'Normal', more: 'Plus' }, help: 'Plus : on élimine davantage… et on perd plus de ballons.' },
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
/**
 * Rôles des joueurs (façon FM). fx : comportement dans les deux moteurs —
 *  dIn / dOut : décalage de profondeur avec / sans ballon (fraction du terrain) ;
 *  narrow : rentre dans l'axe avec ballon (0 = non, 1 = plein axe ; négatif = écarte) ;
 *  shot, dribble, cross, long, pass : penchants avec le ballon ;
 *  recv : attractivité comme receveur par zone [défense, construction, création, finition] ;
 *  run : appels en profondeur (moteur en direct) ; air : cible des centres.
 */
export const ROLES = {
  std: { label: 'Standard', pos: null, desc: 'Comportement classique du poste.' },
  // Gardien
  gk_libero: { label: 'Gardien libéro', pos: ['GB'], desc: 'Joue haut, couvre la profondeur et relance au pied.', fx: { dIn: 0.05, dOut: 0.03, long: 0.8, pass: 1.3 } },
  // Défenseurs centraux
  relanceur: { label: 'Défenseur relanceur', pos: ['DC'], desc: 'Casse les lignes par la passe dès la relance.', fx: { long: 1.35, pass: 1.25, recv: [1.4, 1, 1, 1] } },
  stoppeur: { label: 'Stoppeur', pos: ['DC'], desc: 'Sort de sa ligne pour agresser l\'attaquant.', fx: { dOut: 0.035 } },
  couvreur: { label: 'Couvreur', pos: ['DC'], desc: 'Reste en retrait pour couvrir l\'espace dans le dos.', fx: { dOut: -0.035, dIn: -0.02 } },
  libero: { label: 'Libéro', pos: ['DC'], desc: 'Sort balle au pied et monte d\'un cran avec le ballon.', fx: { dIn: 0.08, dribble: 1.4, pass: 1.15 } },
  // Latéraux
  lat_def: { label: 'Latéral défensif', pos: ['DG', 'DD'], desc: 'Reste bas et sécurise son couloir.', fx: { dIn: -0.06, cross: 0.7 } },
  piston: { label: 'Piston', pos: ['DG', 'DD'], desc: 'Monte très haut et multiplie les centres.', fx: { dIn: 0.1, cross: 1.5, narrow: -0.05 } },
  lat_complet: { label: 'Latéral complet', pos: ['DG', 'DD'], desc: 'Couloir entier : déborde, centre, repique parfois.', fx: { dIn: 0.13, cross: 1.3, dribble: 1.25, narrow: -0.08 } },
  lat_inv: { label: 'Latéral inversé', pos: ['DG', 'DD'], desc: 'Rentre dans l\'axe pour construire au milieu.', fx: { dIn: 0.03, narrow: 0.55, cross: 0.5, pass: 1.25, recv: [1, 1.4, 1, 1] } },
  // Milieux défensifs
  pivot: { label: 'Sentinelle', pos: ['MDC', 'MC'], desc: 'Reste devant la défense, sécurise la relance.', fx: { dIn: -0.04, dOut: -0.04, dribble: 0.6, shot: 0.5, recv: [1.5, 1.5, 0.6, 0.6] } },
  demi_def: { label: 'Demi-défenseur', pos: ['MDC'], desc: 'Décroche entre les centraux pour lancer le jeu à trois.', fx: { dIn: -0.09, dOut: -0.03, pass: 1.2, shot: 0.4, recv: [1.8, 1.2, 0.5, 0.4] } },
  recup: { label: 'Récupérateur', pos: ['MDC', 'MC'], desc: 'Harcèle le porteur et coupe les lignes de passe.', fx: { dOut: 0.04, dribble: 0.8, shot: 0.6 } },
  regista: { label: 'Regista', pos: ['MDC', 'MC'], desc: 'Dicte le jeu de loin : longues passes et renversements.', fx: { dIn: -0.03, long: 1.5, pass: 1.3, recv: [1.4, 1.7, 0.8, 0.6] } },
  volante: { label: 'Volante', pos: ['MDC'], desc: 'Part de loin et surgit à l\'entrée de la surface.', fx: { dIn: 0.1, shot: 1.35, run: 0.6 } },
  // Milieux centraux
  meneur: { label: 'Meneur reculé', pos: ['MC', 'MO', 'MDC'], desc: 'Décroche pour aimanter le ballon et jouer vers l\'avant.', fx: { dIn: -0.04, long: 1.2, pass: 1.25, recv: [1, 1.6, 1.6, 1] } },
  b2b: { label: 'Box-to-box', pos: ['MC'], desc: 'Infatigable : défend dans sa surface, attaque l\'autre.', fx: { dIn: 0.06, dOut: -0.02, shot: 1.15, run: 0.5 } },
  mezzala: { label: 'Mezzala', pos: ['MC'], desc: 'S\'écarte dans le demi-espace et attaque la surface.', fx: { dIn: 0.07, narrow: -0.35, dribble: 1.2, shot: 1.15, run: 0.6, recv: [1, 1, 1.4, 1.1] } },
  carrilero: { label: 'Carrilero', pos: ['MC'], desc: 'Couvre le couloir et sécurise le côté du latéral.', fx: { dIn: -0.02, narrow: -0.25, dribble: 0.8, shot: 0.7, pass: 1.1 } },
  // Milieux excentrés
  mil_large: { label: 'Milieu travailleur', pos: ['MG', 'MD'], desc: 'Fait les efforts défensifs dans son couloir.', fx: { dOut: -0.04, dIn: -0.02, cross: 1.1 } },
  mil_int: { label: 'Milieu intérieur', pos: ['MG', 'MD'], desc: 'Part du côté et rentre jouer entre les lignes.', fx: { narrow: 0.45, pass: 1.2, recv: [1, 1.2, 1.3, 1] } },
  // Meneurs offensifs
  trequartista: { label: 'Trequartista', pos: ['MO', 'BU'], desc: 'Libre, peu de défense : dribble et dernier geste.', fx: { dOut: 0.06, dribble: 1.3, shot: 1.1, pass: 1.15, recv: [0.8, 1, 1.6, 1.2] } },
  enganche: { label: 'Enganche', pos: ['MO'], desc: 'Meneur à l\'ancienne : le jeu passe par lui.', fx: { dIn: -0.03, pass: 1.35, dribble: 0.9, recv: [1, 1.3, 1.7, 1] } },
  ombre: { label: 'Attaquant de l\'ombre', pos: ['MO'], desc: 'Surgit dans la surface au départ du milieu.', fx: { dIn: 0.09, shot: 1.35, run: 0.8, recv: [0.8, 0.9, 1.2, 1.5] } },
  // Ailiers
  ailier: { label: 'Ailier débordeur', pos: ['AG', 'AD', 'MG', 'MD'], desc: 'Colle à la ligne, élimine et centre.', fx: { narrow: -0.12, cross: 1.45, dribble: 1.25, shot: 0.8 } },
  interieur: { label: 'Ailier intérieur', pos: ['AG', 'AD', 'MO'], desc: 'Repique dans l\'axe pour dribbler et frapper.', fx: { narrow: 0.4, dribble: 1.3, shot: 1.3, cross: 0.5 } },
  ailier_inv: { label: 'Ailier inversé', pos: ['AG', 'AD', 'MG', 'MD'], desc: 'Rentre sur son bon pied pour combiner et servir.', fx: { narrow: 0.3, dribble: 1.2, pass: 1.25, cross: 0.8 } },
  raumdeuter: { label: 'Chercheur d\'espaces', pos: ['AG', 'AD'], desc: 'Attaque les espaces vides, peu de participation au jeu.', fx: { dIn: 0.06, narrow: 0.3, shot: 1.35, dribble: 0.7, run: 1, recv: [0.6, 0.7, 1, 1.6] } },
  // Attaquants
  renard: { label: 'Renard', pos: ['BU'], desc: 'Vit dans la surface, tire dès qu\'il peut.', fx: { dIn: 0.04, shot: 1.25, recv: [1, 1, 1, 1.7] } },
  pointe: { label: 'Pivot de pointe', pos: ['BU'], desc: 'Cible des centres et des longs ballons, remise pour les autres.', fx: { air: 2, recvLong: 1.5, pass: 1.1 } },
  faux9: { label: 'Faux 9', pos: ['BU'], desc: 'Décroche au milieu pour libérer l\'espace aux ailiers.', fx: { dIn: -0.1, pass: 1.3, shot: 0.8, dribble: 1.15, recv: [1, 1.2, 1.7, 0.8] } },
  profondeur: { label: 'Attaquant de profondeur', pos: ['BU'], desc: 'Joue sur l\'épaule du dernier défenseur, appels dans le dos.', fx: { dIn: 0.07, shot: 1.15, run: 1, recv: [0.8, 0.8, 1, 1.5] } },
  presseur: { label: 'Attaquant pressant', pos: ['BU', 'AG', 'AD'], desc: 'Premier défenseur : presse les centraux sans relâche.', fx: { dOut: 0.07 } },
  complet: { label: 'Attaquant complet', pos: ['BU'], desc: 'Tout faire : décrocher, dribbler, frapper, peser.', fx: { shot: 1.1, dribble: 1.1, pass: 1.1, air: 1.3 } },
};
/** Effets du rôle (objet vide pour « standard » ou un rôle inconnu). */
export const roleFx = (r) => (ROLES[r] && ROLES[r].fx) || {};
export const rolesFor = (pos) => Object.keys(ROLES).filter((r) => !ROLES[r].pos || ROLES[r].pos.includes(pos));
