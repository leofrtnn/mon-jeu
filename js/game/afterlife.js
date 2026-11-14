/**
 * APRÈS-CARRIÈRE
 * Quand un vrai joueur raccroche les crampons, il peut devenir entraîneur (il rejoint le marché
 * des entraîneurs), membre d'un staff (adjoint, entraîneur des gardiens, recruteur…), journaliste
 * / consultant (il signe des articles dans les actualités), ou ne plus rien faire dans le foot.
 * Le marché du staff compte aussi d'anciens joueurs connus, reconvertis dans l'encadrement.
 */
import { clamp, createRng, hashSeed } from '../core/rng.js';
import { overall } from '../engine/ratings.js';
import { staffWageFor } from './career.js';
import { news } from './managers.js';
import { SKILL_KEYS, PHILOSOPHIES } from './coach.js';

/** Anciens joueurs reconvertis (entraînement, staff, médias) : noms seulement, rôles fictifs. */
const LEGENDS = [
  ['Thierry', 'Henry', 'France', 'assistant'], ['Patrice', 'Évra', 'France', 'analyst'], ['Steve', 'Mandanda', 'France', 'gk'], ['Hugo', 'Lloris', 'France', 'gk'],
  ['Mathieu', 'Valbuena', 'France', 'scout'], ['Djibril', 'Cissé', 'France', 'fitness'], ['Bacary', 'Sagna', 'France', 'youth'], ['Gaël', 'Clichy', 'France', 'scout'],
  ['Xabi', 'Alonso', 'Espagne', 'assistant'], ['Iker', 'Casillas', 'Espagne', 'gk'], ['Joan', 'Capdevila', 'Espagne', 'youth'], ['David', 'Villa', 'Espagne', 'scout'],
  ['Andrea', 'Pirlo', 'Italie', 'assistant'], ['Gianluigi', 'Buffon', 'Italie', 'gk'], ['Alessandro', 'Nesta', 'Italie', 'assistant'], ['Andrea', 'Barzagli', 'Italie', 'youth'],
  ['Philipp', 'Lahm', 'Allemagne', 'analyst'], ['Per', 'Mertesacker', 'Allemagne', 'youth'], ['Bastian', 'Schweinsteiger', 'Allemagne', 'analyst'], ['Jens', 'Lehmann', 'Allemagne', 'gk'],
  ['Frank', 'Lampard', 'Angleterre', 'assistant'], ['Rio', 'Ferdinand', 'Angleterre', 'analyst'], ['Jamie', 'Carragher', 'Angleterre', 'analyst'], ['Joe', 'Cole', 'Angleterre', 'youth'],
  ['Ricardo', 'Carvalho', 'Portugal', 'assistant'], ['Nuno', 'Gomes', 'Portugal', 'scout'], ['Wesley', 'Sneijder', 'Pays-Bas', 'analyst'], ['Edwin', 'van der Sar', 'Pays-Bas', 'gk'],
  ['Kaká', '', 'Brésil', 'scout'], ['Juninho', 'Pernambucano', 'Brésil', 'scout'], ['Javier', 'Zanetti', 'Argentine', 'assistant'], ['Pablo', 'Aimar', 'Argentine', 'youth'],
  ['Didier', 'Drogba', "Côte d'Ivoire", 'assistant'], ['Samuel', 'Eto\'o', 'Cameroun', 'scout'], ['Michael', 'Essien', 'Ghana', 'fitness'], ['Yaya', 'Touré', "Côte d'Ivoire", 'assistant'],
];

/** Ajoute quelques anciens joueurs connus au marché du staff (une fois par partie). */
export function seedLegendStaff(state, rng) {
  if (state.legendsSeeded) return;
  state.legendsSeeded = true;
  for (const [first, last, nat, role] of rng.shuffle(LEGENDS.slice()).slice(0, 14)) {
    const r = clamp(Math.round(rng.normal(13, 2.5)), 8, 19);
    state.staffPool.push({ id: `L${hashSeed(first + last) >>> 0}`, role, first, last: last || first, name: last ? `${first[0]}. ${last}` : first, nat, age: rng.int(36, 52), rating: r,
      wage: Math.round(staffWageFor(r) * 1.25 / 100) * 100, contract: rng.int(1, 3), exPlayer: true, legend: true, note: 'Ancien international' });
  }
}

/** Rôle de staff naturel selon le poste occupé sur le terrain. */
const ROLE_OF = (p) => (p.pos === 'GB' ? 'gk' : ['MC', 'MDC', 'MO'].includes(p.pos) ? 'assistant' : ['DC', 'DG', 'DD'].includes(p.pos) ? 'youth' : 'scout');

/**
 * Un joueur prend sa retraite : que devient-il ? Retourne un court texte (ou null).
 * Seuls les joueurs ayant compté (bon niveau, sélections, longévité) ont une seconde carrière.
 */
export function retire(state, p, club) {
  const rng = createRng(hashSeed(`retraite-${state.seed}-${p.id}`));
  const o = overall(p);
  const known = o >= 68 || (p.caps || 0) >= 10 || (p.career?.apps || 0) >= 250 || p.real;
  if (!known) return null;
  const full = `${p.first || ''} ${p.last || p.name}`.trim();
  const r = rng.next();
  let path;
  if (r < 0.28) {
    // Entraîneur : il rejoint le marché des entraîneurs.
    const id = 'M' + (state.nextManagerId = (state.nextManagerId || 0) + 1);
    const lvl = clamp(o / 6.5, 5, 16);
    state.managers ||= {};
    state.managers[id] = { id, first: p.first || '', last: p.last || p.name, name: p.name, nat: p.nat, age: p.age + 1, rep: clamp(Math.round(o * 0.7), 25, 75), photo: p.photo || null,
      skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, clamp(Math.round(lvl + rng.normal(0, 2.5)), 3, 18)])), philosophy: rng.pick(Object.keys(PHILOSOPHIES)),
      formation: rng.pick(['4-3-3', '4-2-3-1', '4-4-2', '3-5-2']), contract: 0, conf: 60, w: 0, d: 0, l: 0, history: [], exPlayer: true, clubId: null };
    path = 'coach';
  } else if (r < 0.62) {
    const role = ROLE_OF(p);
    const rating = clamp(Math.round(o / 6 + rng.normal(0, 2)), 6, 18);
    (state.staffPool ||= []).push({ id: `X${p.id}`, role, first: p.first || '', last: p.last || p.name, name: p.name, nat: p.nat, age: p.age + 1, rating,
      wage: staffWageFor(rating), contract: 2, exPlayer: true, photo: p.photo || null, note: club ? `Ancien joueur de ${club.name}` : 'Ancien joueur' });
    path = 'staff';
  } else if (r < 0.8) {
    (state.journalists ||= []).push({ name: full, nat: p.nat, since: state.season, photo: p.photo || null });
    if (state.journalists.length > 30) state.journalists.shift();
    path = 'media';
  } else path = 'none';
  const txt = { coach: `${full} raccroche les crampons et se lance comme entraîneur : il est disponible sur le marché des entraîneurs.`,
    staff: `${full} prend sa retraite et rejoint le monde de l'encadrement : il cherche un poste dans un staff.`,
    media: `${full} met fin à sa carrière et devient consultant : on le lira désormais dans nos colonnes.`,
    none: `${full} prend sa retraite et quitte le monde du football.` }[path];
  if (o >= 72 || (p.caps || 0) >= 15) news(state, 'retire', txt, { pid: p.id, photo: p.photo || null, name: full, path, clubId: club?.id ?? null });
  return txt;
}
