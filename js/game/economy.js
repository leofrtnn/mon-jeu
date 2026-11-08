/**
 * Économie : valeurs de marché, salaires, revenus de match, primes.
 * Montants en euros. Un "jour" de calendrier = une semaine de salaires.
 */
import { overall } from '../engine/ratings.js';

const round = (v, step) => Math.max(step, Math.round(v / step) * step);

/** Valeur de marché cohérente : note, âge, potentiel, contrat. */
export function playerValue(p) {
  const o = overall(p);
  let v = 250000 * Math.pow(1.125, o - 50);
  if (p.age <= 21) v *= 1 + Math.max(0, p.pot - o) * 0.045;
  else if (p.age <= 24) v *= 1 + Math.max(0, p.pot - o) * 0.02;
  else if (p.age >= 30) v *= Math.max(0.2, 1 - (p.age - 29) * 0.13);
  if (p.contract <= 1) v *= 0.75;
  return round(v, 25000);
}

/** Salaire hebdomadaire demandé. */
export function playerWage(p) {
  const o = overall(p);
  let w = 1700 * Math.pow(1.105, o - 50);
  if (p.age >= 31) w *= 1.1; // expérience
  return round(w, 100);
}

/** Masse salariale hebdomadaire d'une liste de joueurs. */
export function wageBill(players) {
  return players.reduce((a, p) => a + (p.loanedOut ? p.wage * 0.3 : p.wage), 0);
}

/** Revenus d'un match à domicile : affluence selon réputation, forme, adversaire. */
export function matchdayRevenue(club, opponent, formPts = 0.5, cup = false) {
  const appeal = 0.55 + club.rep / 250 + (opponent ? opponent.rep / 600 : 0) + (formPts - 0.5) * 0.2 + (cup ? 0.05 : 0);
  const attendance = Math.round(Math.min(1, appeal) * club.stadium);
  const price = 8 + club.rep * 0.12;
  return { attendance, revenue: Math.round(attendance * price) };
}

/** Sponsors : versement hebdomadaire selon réputation et division. */
export function sponsorIncome(club) {
  return round((club.div === 1 ? 30000 : 25000) + club.rep * club.rep * (club.div === 1 ? 20 : 15), 1000);
}

/** Primes de fin de saison selon la place et la division. */
export function prizeMoney(div, position) {
  if (div === 1) return round(8_000_000 * Math.pow(0.88, position - 1), 50000);
  return round(3_000_000 * Math.pow(0.9, position - 1), 25000);
}

/** Primes de coupe par tour atteint (index de tour gagné). */
export const CUP_PRIZES = [150000, 300000, 600000, 1200000, 3000000];

/** Formatage des montants : 1,2 M€ / 350 k€. */
export function money(v) {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} M€`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)} k€`;
  return `${sign}${Math.round(a)} €`;
}
