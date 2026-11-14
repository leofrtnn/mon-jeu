/**
 * PARAMÈTRES DE PARTIE (choisis au lancement d'une nouvelle carrière)
 * Difficulté, budget de départ, mercato, blessures, limogeage, brouillard des notes,
 * vitesse de progression des joueurs. Stockés dans state.opts.
 */
export const GAME_OPTIONS = {
  career: { label: 'Mode de carrière', def: 'free', opts: {
    free: { label: 'Carrière libre', desc: 'Vous choisissez n\'importe quel club du monde.' },
    real: { label: 'Carrière réaliste', desc: 'Vous créez votre coach : seuls les clubs qui croient en vous (selon votre parcours et votre réputation) vous proposent un poste.' },
  } },
  difficulty: { label: 'Difficulté', def: 'normal', opts: {
    easy: { label: 'Facile', desc: 'Direction patiente, équipe un peu plus performante.', perf: 1.02, sack: 6, patience: 1.4 },
    normal: { label: 'Normal', desc: 'L\'expérience prévue : réaliste et exigeante.', perf: 1, sack: 14, patience: 1 },
    hard: { label: 'Difficile', desc: 'Direction impatiente, adversaires plus coriaces.', perf: 0.985, sack: 20, patience: 0.8 },
    legend: { label: 'Légende', desc: 'Le moindre faux pas se paie. Pour les experts.', perf: 0.97, sack: 26, patience: 0.65 },
  } },
  budget: { label: 'Budget de départ', def: 'normal', opts: {
    low: { label: 'Serré', desc: '60 % du budget réel du club.', mult: 0.6 },
    normal: { label: 'Réel', desc: 'Le budget du club tel quel.', mult: 1 },
    high: { label: 'Généreux', desc: '+50 % pour recruter dès l\'été.', mult: 1.5 },
    tycoon: { label: 'Mécène', desc: 'Un nouveau propriétaire triple le budget.', mult: 3 },
  } },
  windows: { label: 'Mercato', def: 'real', opts: {
    real: { label: 'Fenêtres réelles', desc: 'Été (mi-juin → 1er sept.) et hiver (janvier).' },
    always: { label: 'Toujours ouvert', desc: 'Achats et ventes à tout moment de la saison.' },
  } },
  injuries: { label: 'Blessures', def: 'normal', opts: {
    low: { label: 'Rares', desc: 'Moitié moins de blessures.', mult: 0.5 },
    normal: { label: 'Réalistes', desc: 'Fréquence réelle.', mult: 1 },
    high: { label: 'Fréquentes', desc: 'Il faudra un vrai effectif.', mult: 1.6 },
  } },
  sacking: { label: 'Limogeage', def: 'on', opts: {
    on: { label: 'Possible', desc: 'Les mauvais résultats peuvent vous coûter votre poste.' },
    off: { label: 'Jamais', desc: 'Vous restez en poste quoi qu\'il arrive.' },
  } },
  fog: { label: 'Notes des joueurs adverses', def: 'on', opts: {
    on: { label: 'Estimées', desc: 'Vos recruteurs donnent une fourchette, à affiner en les observant.' },
    off: { label: 'Exactes', desc: 'Toutes les notes sont visibles.' },
  } },
  progression: { label: 'Progression des joueurs', def: 'normal', opts: {
    slow: { label: 'Lente', desc: 'Les jeunes mettent plus de temps à éclore.', mult: 0.8 },
    normal: { label: 'Réaliste', desc: 'Rythme réel.', mult: 1 },
    fast: { label: 'Rapide', desc: 'Les talents explosent plus vite.', mult: 1.3 },
  } },
};

export const defaultOptions = () => Object.fromEntries(Object.entries(GAME_OPTIONS).map(([k, o]) => [k, o.def]));
/** Valeur d'un paramètre (anciennes parties : valeurs par défaut). */
export const opt = (state, key) => state?.opts?.[key] ?? GAME_OPTIONS[key].def;
/** Fiche détaillée d'un paramètre ({ label, desc, mult… }). */
export const optInfo = (state, key) => GAME_OPTIONS[key].opts[opt(state, key)];
