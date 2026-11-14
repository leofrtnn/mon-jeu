/**
 * TRAITS DE JOUEURS
 * ------------------------------------------------------------------
 * Des signatures qui distinguent un joueur de ceux qui ne les ont pas (Magicien, Maestro,
 * Renard des surfaces…). Ils sont attribués d'après ses VRAIES qualités (attributs, poste,
 * taille, âge, régularité, leadership) et évoluent : un joueur qui progresse débloque un
 * trait, un joueur qui décline le perd (avec une petite marge pour éviter les va-et-vient).
 * Chaque trait a un effet concret dans le moteur de match (voir engine/live.js et match.js).
 */
import { overall } from '../engine/ratings.js';

const A = (p, k) => p.attrs?.[k] ?? 0;
const POS = (p, ...l) => l.includes(p.pos);
const H = (p) => p.height || 180;

/** k : clé ; good : positif ; need(p, m) : condition (m = marge, 0 pour obtenir, -3 pour garder). */
export const TRAITS = {
  magicien: { name: 'Magicien', icon: '🪄', desc: 'Dribbleur hors norme : élimine bien plus souvent son vis-à-vis.', need: (p, m) => A(p, 'dri') >= 86 + m },
  maestro: { name: 'Maestro', icon: '🎼', desc: 'Dicte le tempo par la passe : perd très peu de ballons.', need: (p, m) => A(p, 'pas') >= 84 + m && A(p, 'vis') >= 80 + m && POS(p, 'MC', 'MDC', 'MO') },
  visionnaire: { name: 'Visionnaire', icon: '🔭', desc: 'Voit la passe que personne ne voit : passes décisives et ballons en profondeur.', need: (p, m) => A(p, 'vis') >= 86 + m },
  metronome: { name: 'Métronome', icon: '⏱️', desc: 'Jeu simple et juste : passes courtes quasi infaillibles.', need: (p, m) => A(p, 'pas') >= 80 + m && A(p, 'sf') >= 80 + m && !POS(p, 'GB') },
  sniper: { name: 'Frappe de mule', icon: '💥', desc: 'Dangereux de loin : ses frappes hors de la surface font mouche.', need: (p, m) => A(p, 'tir') >= 84 + m && !POS(p, 'GB', 'DC') },
  renard: { name: 'Renard des surfaces', icon: '🦊', desc: 'Toujours au bon endroit : finition supérieure dans la surface.', need: (p, m) => A(p, 'tir') >= 80 + m && A(p, 'sf') >= 78 + m && POS(p, 'BU', 'AG', 'AD', 'MO') },
  tueur: { name: 'Tueur', icon: '🧊', desc: 'Glacial face au but et aux penalties.', need: (p, m) => A(p, 'sf') >= 86 + m && A(p, 'tir') >= 75 + m },
  fusee: { name: 'Fusée', icon: '🚀', desc: 'Vitesse de pointe exceptionnelle.', need: (p, m) => A(p, 'vit') >= 90 + m },
  provocateur: { name: 'Provocateur', icon: '⚡', desc: 'Percussion balle au pied : tente et réussit plus de un-contre-un.', need: (p, m) => A(p, 'dri') >= 80 + m && A(p, 'vit') >= 84 + m && POS(p, 'AG', 'AD', 'MO', 'BU', 'MG', 'MD') },
  centreur: { name: 'Centreur de génie', icon: '🎯', desc: 'Centres précis : ses ballons aériens trouvent preneur.', need: (p, m) => A(p, 'pas') >= 80 + m && POS(p, 'AG', 'AD', 'DG', 'DD', 'MG', 'MD') },
  coupsfrancs: { name: 'Spécialiste des coups francs', icon: '🌀', desc: 'Coups francs directs redoutables.', need: (p, m) => A(p, 'tir') >= 80 + m && A(p, 'sf') >= 78 + m && A(p, 'pas') >= 75 + m },
  tete: { name: 'Joueur de tête', icon: '🗣️', desc: 'Puissant dans les airs : têtes cadrées et duels aériens gagnés.', need: (p, m) => A(p, 'phy') >= 80 + m && H(p) >= 185 + m / 3 && !POS(p, 'GB') },
  tour: { name: 'Tour de contrôle', icon: '🗼', desc: 'Défenseur dominant dans les airs.', need: (p, m) => POS(p, 'DC') && A(p, 'phy') >= 82 + m && H(p) >= 188 + m / 3 },
  roc: { name: 'Roc', icon: '🪨', desc: 'Tacles propres et décisifs : difficile à passer.', need: (p, m) => A(p, 'def') >= 85 + m },
  aspirateur: { name: 'Aspirateur', icon: '🌪️', desc: 'Récupère des ballons partout : interceptions en série.', need: (p, m) => POS(p, 'MDC', 'MC', 'DC') && A(p, 'def') >= 80 + m && A(p, 'phy') >= 76 + m },
  lateral: { name: 'Piston', icon: '↗️', desc: 'Latéral offensif : dédouble et centre sans cesse.', need: (p, m) => POS(p, 'DG', 'DD') && A(p, 'vit') >= 82 + m && A(p, 'pas') >= 74 + m },
  infatigable: { name: 'Infatigable', icon: '🫁', desc: 'Box-to-box : se fatigue beaucoup moins que les autres.', need: (p, m) => A(p, 'phy') >= 82 + m && POS(p, 'MC', 'MDC', 'MO', 'DG', 'DD', 'MG', 'MD') },
  guerrier: { name: 'Guerrier', icon: '🛡️', desc: 'Physique dominant : gagne les duels, encaisse les efforts.', need: (p, m) => A(p, 'phy') >= 87 + m },
  mur: { name: 'Mur', icon: '🧱', desc: 'Gardien infranchissable : arrêts supplémentaires.', need: (p, m) => POS(p, 'GB') && A(p, 'arr') >= 86 + m },
  chat: { name: 'Chat', icon: '🐈', desc: 'Réflexes et sorties : capte plus de ballons au lieu de les relâcher.', need: (p, m) => POS(p, 'GB') && A(p, 'arr') >= 80 + m && A(p, 'sf') >= 72 + m },
  relanceur: { name: 'Relanceur', icon: '📤', desc: 'Gardien qui joue au pied : relances précises.', need: (p, m) => POS(p, 'GB') && A(p, 'pas') >= 72 + m },
  stoppeur: { name: 'Arrêteur de penalties', icon: '🧤', desc: 'Lit les tireurs : penalties souvent arrêtés.', need: (p, m) => POS(p, 'GB') && A(p, 'arr') >= 82 + m && A(p, 'sf') >= 78 + m },
  leader: { name: 'Leader', icon: '👑', desc: 'Meneur d\'hommes : son équipe ne lâche rien.', need: (p, m) => (p.lead ?? 0) >= 17 + m / 3 || (A(p, 'sf') >= 84 + m && p.age >= 28 && overall(p) >= 78 + m) },
  clutch: { name: 'Homme des grands soirs', icon: '🌟', desc: 'Monte en régime dans le dernier quart d\'heure.', need: (p, m) => A(p, 'sf') >= 84 + m && overall(p) >= 80 + m },
  veteran: { name: 'Expérience', icon: '🎖️', desc: 'Ne panique jamais : moins d\'erreurs sous pression.', need: (p, m) => p.age >= 32 && overall(p) >= 74 + m },
  pepite: { name: 'Pépite', icon: '💎', desc: 'Talent rare : progresse plus vite que les autres.', need: (p, m) => p.age <= 21 && (p.pot || 0) >= 84 + m },
  polyvalent: { name: 'Polyvalent', icon: '🔄', desc: 'Joue à plusieurs postes sans perdre en rendement.', need: (p, m) => (p.pos2 || []).length >= 2 + (m < 0 ? -1 : 0) },
  regulier: { name: 'Régulier', icon: '📏', desc: 'Toujours au même niveau, match après match.', need: (p, m) => (p.cons ?? 0) >= 17 + m / 3 },
  rugueux: { name: 'Rugueux', icon: '🦵', desc: 'Engagement total : récupère des ballons… et commet des fautes.', bad: true, need: (p, m) => A(p, 'def') >= 76 + m && A(p, 'sf') < Math.min(66, overall(p) - 8) - m },
  sangchaud: { name: 'Tête brûlée', icon: '😡', desc: 'Nerveux : prend plus de cartons.', bad: true, need: (p, m) => A(p, 'sf') < Math.min(50, overall(p) - 24) - m && !POS(p, 'GB') },
  fragile: { name: 'Fragile', icon: '🩹', desc: 'Se blesse plus souvent.', bad: true, need: (p, m) => (p.injHist?.length || 0) >= 4 + m / 3 },
  irregulier: { name: 'Irrégulier', icon: '🎢', desc: 'Capable du meilleur comme du pire.', bad: true, need: (p, m) => p.cons != null && p.cons <= 7 - m / 3 },
};
export const TRAIT_KEYS = Object.keys(TRAITS);

/**
 * Met à jour les traits d'un joueur. Retourne { gained, lost } (listes de clés).
 * Pour garder un trait, on tolère 3 points sous le seuil d'obtention.
 */
export function updateTraits(p) {
  const had = new Set(p.traits || []);
  const now = [];
  for (const k of TRAIT_KEYS) {
    const T = TRAITS[k];
    let ok = false;
    try { ok = had.has(k) ? T.need(p, -3) : T.need(p, 0); } catch { ok = false; }
    if (ok) now.push(k);
  }
  // Au plus 5 traits positifs (les plus rares d'abord : ordre de la liste) + les traits négatifs.
  const good = now.filter((k) => !TRAITS[k].bad).slice(0, 5), bad = now.filter((k) => TRAITS[k].bad);
  p.traits = [...good, ...bad];
  const gained = p.traits.filter((k) => !had.has(k)), lost = [...had].filter((k) => !p.traits.includes(k));
  return { gained, lost };
}

/** Tous les joueurs (nouvelle partie, ancienne sauvegarde). */
export function assignAllTraits(state) {
  for (const p of Object.values(state.players)) updateTraits(p);
  state.traitsV = 1;
}

export const hasTrait = (p, k) => !!p?.traits?.includes(k);
