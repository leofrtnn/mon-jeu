/**
 * Économie : valeurs de marché, salaires, revenus de match, primes.
 * Montants en euros. Un "jour" de calendrier = une semaine de salaires.
 */
import { overall } from '../engine/ratings.js';
import { DIVISIONS, LEAGUE_WEALTH } from '../data/world.js';

const round = (v, step) => Math.max(step, Math.round(v / step) * step);

/**
 * Valeur de marché, calée sur les ordres de grandeur réels (pas de données copiées) :
 * 93 → ~200 M€ (les meilleurs du monde), 85 → ~52 M€, 80 → ~23 M€, 75 → ~10 M€,
 * 70 → ~4,4 M€, 65 → ~1,9 M€, 60 → ~850 k€. Les jeunes valent leur potentiel (un crack de
 * 19 ans se paie déjà comme une star), la valeur fond après 29 ans, et un contrat qui
 * se termine fait chuter le prix.
 */
export function playerValue(p) {
  const o = overall(p);
  const gap = Math.max(0, (p.pot ?? o) - o);
  const w = p.age <= 19 ? 0.6 : p.age <= 21 ? 0.45 : p.age <= 23 ? 0.3 : p.age <= 25 ? 0.15 : 0;
  let v = 160000 * Math.pow(1.18, o + gap * w - 50);
  if (p.age >= 30) v *= Math.max(0.12, 1 - (p.age - 29) * 0.15);
  if (p.contract <= 1) v *= 0.65;
  return roundMoney(v);
}

/**
 * Salaire hebdomadaire demandé : ~500 k€/sem. pour les tout meilleurs, ~80 k€ à 80,
 * ~19 k€ à 70, ~4,5 k€ à 60.
 */
export function playerWage(p) {
  const o = overall(p);
  let w = 2200 * Math.pow(1.155, o - 55);
  if (p.age >= 31) w *= 1.1; // expérience
  return round(w, w >= 1e4 ? 1000 : 100);
}

/** Arrondi lisible selon l'ordre de grandeur (100 k€, 25 k€, 5 k€). */
function roundMoney(v) {
  return round(v, v >= 2e7 ? 1e6 : v >= 5e6 ? 250000 : v >= 1e6 ? 50000 : 5000);
}

/** Masse salariale hebdomadaire d'une liste de joueurs. */
export function wageBill(players) {
  return players.reduce((a, p) => a + (p.loanedOut ? p.wage * 0.3 : p.onLoanFrom && p.loanShare != null ? p.wage * p.loanShare : p.wage), 0);
}

/** Richesse du championnat d'un club (droits TV, sponsors, prix des places). */
export const wealthOf = (club) => LEAGUE_WEALTH[DIVISIONS[club.div]?.country ?? club.country] ?? 0.6;
const levelOf = (club) => DIVISIONS[club.div]?.level ?? 1;

/**
 * Taille économique d'un club (€/an) : à peu près ce que coûte l'effectif qu'il aligne
 * (calé sur la masse salariale des effectifs réels : ~9 M€ à 60 de réputation, ~150 M€ à 94).
 */
export function clubScale(club) {
  return 8.6e6 * Math.pow(1.0855, club.rep - 60);
}

/** Revenus d'un match à domicile : affluence selon réputation, forme, adversaire. */
export function matchdayRevenue(club, opponent, formPts = 0.5, cup = false) {
  const appeal = 0.55 + club.rep / 250 + (opponent ? opponent.rep / 600 : 0) + (formPts - 0.5) * 0.2 + (cup ? 0.05 : 0);
  const attendance = Math.round(Math.min(1, appeal) * club.stadium);
  // Prix moyen d'une place (loges comprises) : ~25 € dans un petit club, ~45 € chez les géants.
  const price = (8 + club.rep * 0.32) * (0.7 + 0.3 * wealthOf(club));
  return { attendance, revenue: Math.round(attendance * price) };
}

/** Droits TV + sponsors : versement hebdomadaire selon la taille du club et la richesse du championnat. */
export function sponsorIncome(club) {
  const w = wealthOf(club);
  const lvl2 = levelOf(club) === 2 ? 0.8 : 1;
  return round(clubScale(club) * 0.42 * (0.85 + 0.25 * w) * lvl2 / 52, 1000);
}

/**
 * Primes de fin de saison selon la place (droits TV au mérite) : ~25 M€ pour un champion
 * d'un grand championnat, quelques centaines de k€ en bas d'un petit.
 * `level` = niveau de la division (1 ou 2), `club` sert à lire la richesse du championnat.
 */
export function prizeMoney(level, position, club) {
  const w = club ? wealthOf(club) : 1;
  if (level === 1) return round(25_000_000 * w * Math.pow(0.88, position - 1), 50000);
  return round(5_000_000 * w * Math.pow(0.9, position - 1), 25000);
}

/** Primes de coupe par tour atteint (index de tour gagné). */
export const CUP_PRIZES = [400000, 800000, 1600000, 3500000, 8000000];

/** Formatage des montants : 1,2 M€ / 350 k€. */
export function money(v) {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} M€`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)} k€`;
  return `${sign}${Math.round(a)} €`;
}
