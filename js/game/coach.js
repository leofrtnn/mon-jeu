/**
 * COACH PERSONNALISABLE : identité, apparence (avatar), philosophie, compétences.
 * Les compétences (1-20, façon FM) ont un effet réel dans le jeu (voir coachMods).
 */
import { clamp } from '../core/rng.js';

export const COACH_SKILLS = {
  tactics: { label: 'Tactique', icon: '🧠', desc: "Bonus de performance de l'équipe en match." },
  motivation: { label: 'Motivation', icon: '🔥', desc: 'Causeries plus efficaces, moral plus stable.' },
  discipline: { label: 'Discipline', icon: '📏', desc: 'Moins de cartons pour vos joueurs.' },
  youth: { label: 'Formation des jeunes', icon: '🌱', desc: 'Les jeunes progressent plus vite et sortent meilleurs du centre.' },
  fitness: { label: 'Préparation physique', icon: '💪', desc: 'Meilleure récupération et endurance en match.' },
};
export const SKILL_KEYS = Object.keys(COACH_SKILLS);
export const START_POINTS = 50;
export const SKILL_MIN = 4, SKILL_MAX = 20;

export const PHILOSOPHIES = {
  possession: { label: 'Possession', tactics: { mentality: 'balanced', passing: 'short', tempo: 'low', pressing: 'mid' } },
  pressing: { label: 'Pressing intense', tactics: { mentality: 'offensive', pressing: 'high', line: 'high', tempo: 'high' } },
  counter: { label: 'Contre-attaque', tactics: { mentality: 'defensive', passing: 'direct', counter: 'on', line: 'low' } },
  balanced: { label: 'Équilibrée', tactics: {} },
  wings: { label: 'Jeu sur les ailes', tactics: { width: 'high', crossing: 'high' } },
  tikitaka: { label: 'Tiki-taka', tactics: { mentality: 'balanced', passing: 'short', tempo: 'mid', pressing: 'high', dribbling: 'less' } },
  gegenpress: { label: 'Gegenpressing', tactics: { mentality: 'offensive', pressing: 'high', line: 'high', tempo: 'high', passing: 'direct', tackling: 'hard' } },
  catenaccio: { label: 'Catenaccio', tactics: { mentality: 'defensive', line: 'low', marking: 'man', counter: 'on', overlap: 'stay' } },
  kickrush: { label: 'Jeu direct', tactics: { passing: 'direct', crossing: 'high', tempo: 'high', gkDist: 'long' } },
  midblock: { label: 'Bloc médian', tactics: { mentality: 'balanced', pressing: 'mid', line: 'mid', counter: 'on' } },
  positional: { label: 'Jeu de position', tactics: { passing: 'short', width: 'high', tempo: 'low', overlap: 'join' } },
};

/** Parcours du coach : réputation de départ, respect du vestiaire, points de compétence en plus. */
export const BACKGROUNDS = {
  legend: { label: 'Ancienne star internationale', rep: 14, dressing: 12, points: -4, desc: 'Respecté d\'emblée, mais encore novice sur un banc.' },
  pro: { label: 'Ancien joueur professionnel', rep: 7, dressing: 6, points: 0, desc: 'Une carrière solide : le vestiaire vous écoute.' },
  semi: { label: 'Ancien joueur amateur', rep: 0, dressing: 0, points: 2, desc: 'Parti de rien, vous connaissez le terrain.' },
  analyst: { label: 'Analyste vidéo', rep: -3, dressing: -4, points: 5, desc: 'Un cerveau tactique, encore inconnu du grand public.' },
  academy: { label: 'Formateur de centre', rep: -2, dressing: 2, points: 3, desc: 'Vous savez faire grandir les jeunes.' },
  none: { label: 'Sans passé de joueur', rep: -6, dressing: -6, points: 7, desc: 'Personne ne vous attend : tout reste à prouver.' },
};
/** Diplôme d'entraîneur : réputation auprès des présidents. */
export const LICENCES = { pro: { label: 'Licence UEFA Pro', rep: 4, points: 0 }, a: { label: 'Licence UEFA A', rep: 0, points: 1 }, b: { label: 'Licence UEFA B', rep: -4, points: 3 } };
/** Caractère : effets sur le vestiaire, la discipline et les médias. */
export const PERSONALITIES = {
  calm: { label: 'Calme', desc: 'Moins de cartons, causeries plus douces.', mods: { cards: 0.95, talk: 0.95 } },
  fiery: { label: 'Volcanique', desc: 'Causeries percutantes… et plus de cartons.', mods: { cards: 1.08, talk: 1.15 } },
  charismatic: { label: 'Charismatique', desc: 'Le vestiaire vous suit, les médias vous adorent.', mods: { talk: 1.08 } },
  pragmatic: { label: 'Pragmatique', desc: 'Discours sobre, équipe disciplinée.', mods: { cards: 0.97 } },
  father: { label: 'Paternel', desc: 'Les jeunes s\'épanouissent à vos côtés.', mods: { youth: 1.05 } },
};

export const LOOK = {
  skins: ['#fbe0cb', '#f6d2b3', '#eebd94', '#e0ac7e', '#d9a066', '#c68642', '#a96e3b', '#8d5524', '#6f4320', '#5c3a21', '#3f2715'],
  faces: { oval: 'Ovale', round: 'Rond', square: 'Carré', long: 'Allongé' },
  hairStyles: { short: 'Court', buzz: 'Rasé', bald: 'Chauve', receding: 'Dégarni', sidepart: 'Raie de côté', quiff: 'Banane', slick: 'Plaqué',
    curly: 'Bouclé', afro: 'Afro', long: 'Mi-long', bun: 'Chignon', dreads: 'Dreadlocks', mohawk: 'Crête' },
  hairColors: ['#0e0a08', '#1b1410', '#3d2a1a', '#6b4423', '#8b5a2b', '#a8743c', '#d9b26b', '#efe0b0', '#b33a1f', '#d4622a', '#8a8a8a', '#d6d6d6', '#f7f7f2'],
  eyes: ['#1d1d1d', '#4a2c18', '#2f6b3a', '#2b5d8a', '#6d7f8c'],
  brows: { normal: 'Normaux', thick: 'Épais', thin: 'Fins' },
  mouths: { neutral: 'Neutre', smile: 'Souriant', stern: 'Sévère' },
  beards: { none: 'Aucune', stubble: 'Naissante', full: 'Fournie', long: 'Longue', chinstrap: 'Collier', moustache: 'Moustache', goatee: 'Bouc', mutton: 'Favoris' },
  glasses: { none: 'Aucune', square: 'Carrées', round: 'Rondes', sun: 'Solaires' },
  accessories: { none: 'Aucun', cap: 'Casquette', beanie: 'Bonnet', scarf: 'Écharpe', headset: 'Oreillette' },
  outfits: { suit: 'Costume', tracksuit: 'Survêtement', coat: 'Manteau', polo: 'Polo du club', puffer: 'Doudoune', jacket: 'Blouson', rollneck: 'Col roulé' },
  outfitColors: ['#1c2333', '#2b2f36', '#111111', '#0f3d2e', '#5a1d24', '#203a6b', '#3b2a5c', '#e8e8e8', '#6b4f2a', '#7a7f87', '#c1121f', '#1d6fd1'],
  bgs: ['#1f352b', '#1c2340', '#3a1f2b', '#2b2b2b', '#2d3b55', '#40331c'],
};

export const COACH_NATIONS = ['France', 'Belgique', 'Suisse', 'Espagne', 'Portugal', 'Italie', 'Allemagne', 'Angleterre', 'Écosse', 'Irlande',
  'Pays-Bas', 'Danemark', 'Suède', 'Croatie', 'Serbie', 'Brésil', 'Argentine', 'Uruguay', 'Maroc', 'Algérie', 'Tunisie', 'Sénégal',
  "Côte d'Ivoire", 'Cameroun', 'Mali', 'États-Unis', 'Canada', 'Japon', 'Autre'];

/** Compétences par défaut : 10 partout (50 points). */
export const defaultSkills = () => Object.fromEntries(SKILL_KEYS.map((k) => [k, 10]));

export function randomLook(r = Math.random) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(LOOK.skins), hairStyle: pick(Object.keys(LOOK.hairStyles)), hairColor: pick(LOOK.hairColors),
    beard: pick(Object.keys(LOOK.beards)), glasses: r() < 0.3 ? pick(['square', 'round']) : 'none', outfit: pick(Object.keys(LOOK.outfits)), outfitColor: pick(LOOK.outfitColors),
    face: pick(Object.keys(LOOK.faces)), eyes: pick(LOOK.eyes), brows: pick(Object.keys(LOOK.brows)), mouth: pick(['neutral', 'smile', 'stern']), acc: r() < 0.25 ? pick(['cap', 'scarf', 'headset']) : 'none',
  };
}

/** Complète un coach existant (anciennes sauvegardes) avec les champs de personnalisation. */
export function ensureCoachProfile(coach) {
  coach.firstName = coach.firstName ?? 'Alex';
  coach.lastName = coach.lastName ?? 'Martin';
  coach.nationality = coach.nationality ?? 'France';
  coach.age = coach.age ?? 42;
  coach.look = coach.look ?? randomLook();
  coach.skills = coach.skills ?? defaultSkills();
  coach.philosophy = coach.philosophy ?? 'balanced';
  coach.formation = coach.formation ?? '4-3-3';
  coach.points = coach.points ?? 0;
  coach.background = coach.background ?? 'pro';
  coach.licence = coach.licence ?? 'pro';
  coach.personality = coach.personality ?? 'pragmatic';
  coach.created = coach.created ?? false;
  return coach;
}

export const coachName = (c) => `${c.firstName} ${c.lastName}`.trim();
export const skillsTotal = (s) => SKILL_KEYS.reduce((a, k) => a + (s[k] || 0), 0);

/** Effets des compétences dans le jeu. */
export function coachMods(coach) {
  const s = coach?.skills || defaultSkills();
  const pm = PERSONALITIES[coach?.personality]?.mods || {};
  return {
    perf: 1 + (s.tactics - 10) * 0.0016,          // ±1,6 % à ±10 points
    talk: (0.7 + s.motivation * 0.03) * (pm.talk || 1), // causeries
    cards: clamp(1.2 - s.discipline * 0.02, 0.8, 1.15) * (pm.cards || 1),
    youth: (0.8 + s.youth * 0.02) * (pm.youth || 1), // progression des jeunes
    youthPot: (s.youth - 10) * 0.6,               // potentiel des recrues du centre
    recovery: (s.fitness - 10) * 0.6,             // récupération quotidienne
    fatigue: clamp(1.1 - s.fitness * 0.01, 0.9, 1.06), // fatigue en match
  };
}

/** Points gagnés en fin de saison (expérience + trophées). */
export function grantSeasonPoints(coach, trophies) {
  coach.points = (coach.points || 0) + 2 + trophies;
}
