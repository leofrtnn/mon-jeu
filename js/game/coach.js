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
};

export const LOOK = {
  skins: ['#f6d2b3', '#eebd94', '#d9a066', '#c68642', '#8d5524', '#5c3a21'],
  hairStyles: { short: 'Court', bald: 'Chauve', receding: 'Dégarni', curly: 'Bouclé', long: 'Mi-long', slick: 'Plaqué' },
  hairColors: ['#1b1410', '#3d2a1a', '#6b4423', '#a8743c', '#d9b26b', '#8a8a8a', '#d6d6d6', '#b33a1f'],
  beards: { none: 'Aucune', stubble: 'Naissante', full: 'Fournie', moustache: 'Moustache', goatee: 'Bouc' },
  outfits: { suit: 'Costume', tracksuit: 'Survêtement', coat: 'Manteau' },
  outfitColors: ['#1c2333', '#2b2f36', '#0f3d2e', '#5a1d24', '#203a6b', '#e8e8e8', '#6b4f2a'],
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
    beard: pick(Object.keys(LOOK.beards)), glasses: r() < 0.3, outfit: pick(Object.keys(LOOK.outfits)), outfitColor: pick(LOOK.outfitColors),
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
  coach.created = coach.created ?? false;
  return coach;
}

export const coachName = (c) => `${c.firstName} ${c.lastName}`.trim();
export const skillsTotal = (s) => SKILL_KEYS.reduce((a, k) => a + (s[k] || 0), 0);

/** Effets des compétences dans le jeu. */
export function coachMods(coach) {
  const s = coach?.skills || defaultSkills();
  return {
    perf: 1 + (s.tactics - 10) * 0.0016,          // ±1,6 % à ±10 points
    talk: 0.7 + s.motivation * 0.03,              // causeries
    cards: clamp(1.2 - s.discipline * 0.02, 0.8, 1.15),
    youth: 0.8 + s.youth * 0.02,                  // progression des jeunes
    youthPot: (s.youth - 10) * 0.6,               // potentiel des recrues du centre
    recovery: (s.fitness - 10) * 0.6,             // récupération quotidienne
    fatigue: clamp(1.1 - s.fitness * 0.01, 0.9, 1.06), // fatigue en match
  };
}

/** Points gagnés en fin de saison (expérience + trophées). */
export function grantSeasonPoints(coach, trophies) {
  coach.points = (coach.points || 0) + 2 + trophies;
}
