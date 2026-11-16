/**
 * RECHERCHE DE JOUEURS (filtres façon mode carrière)
 * Filtres : nom, postes, âge, note et potentiel (estimés par vos recruteurs), valeur, salaire,
 * nationalité, championnat, fin de contrat, pied fort, statut (libre, sur la liste, prêtable),
 * dans mon budget. Tri : note, potentiel, valeur, âge, salaire. Les filtres simples passent
 * d'abord ; les estimations (brouillard) ne sont calculées que pour les joueurs restants.
 */
import { overall } from '../engine/ratings.js';
import { knowledge, est } from './scouting.js';
import { askingPrice } from './transfers.js';
import { clubById } from './state.js';
import { ensureBoard } from './board.js';
import { DIVISIONS } from '../data/world.js';
import { ROLES } from '../data/constants.js';

export const DEFAULT_FILTERS = { q: '', pos: [], role: '', loanable: false, ageMin: 15, ageMax: 40, ovrMin: 0, potMin: 0, valueMax: 0, wageMax: 0, nat: '', div: '', country: '', contract: false, foot: '', status: 'all', budget: false, sort: 'ovr' };

const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const POS_GROUPS = { DEF: ['DC', 'DG', 'DD'], MIL: ['MDC', 'MC', 'MG', 'MD', 'MO'], ATT: ['AG', 'AD', 'BU'] };

/** Estimations (fourchettes centrées) de note et potentiel, comme les voient vos recruteurs. */
function guess(state, p) {
  const k = knowledge(state, p);
  const [a, b] = est(state, p, 'ovr', overall(p), k);
  const [c, d] = est(state, p, 'pot', p.pot, Math.max(0, k - 15));
  return { ovr: (a + b) / 2, pot: (c + d) / 2 };
}

/**
 * Adéquation d'un joueur à un rôle (0-100) : moyenne pondérée des qualités qui comptent
 * pour ce rôle (vit, tir, pas, dri, def, phy, vis, sf = sang-froid).
 */
const ROLE_W = {
  gk_libero: { arr: 0.6, pas: 0.25, vit: 0.15 },
  relanceur: { def: 0.45, pas: 0.35, vis: 0.2 }, stoppeur: { def: 0.5, phy: 0.4, vit: 0.1 }, couvreur: { def: 0.5, vit: 0.35, sf: 0.15 }, libero: { def: 0.35, dri: 0.3, pas: 0.25, vis: 0.1 },
  lat_def: { def: 0.6, phy: 0.2, vit: 0.2 }, piston: { vit: 0.4, pas: 0.3, phy: 0.3 }, lat_complet: { vit: 0.3, pas: 0.25, dri: 0.25, def: 0.2 }, lat_inv: { pas: 0.4, vis: 0.3, def: 0.3 },
  pivot: { def: 0.45, pas: 0.35, sf: 0.2 }, demi_def: { def: 0.4, pas: 0.4, sf: 0.2 }, recup: { def: 0.55, phy: 0.35, vit: 0.1 }, regista: { pas: 0.45, vis: 0.45, sf: 0.1 }, volante: { phy: 0.3, tir: 0.3, def: 0.25, vit: 0.15 },
  meneur: { pas: 0.4, vis: 0.4, dri: 0.2 }, b2b: { phy: 0.35, def: 0.25, pas: 0.2, tir: 0.2 }, mezzala: { dri: 0.35, pas: 0.3, tir: 0.2, vit: 0.15 }, carrilero: { def: 0.35, pas: 0.35, phy: 0.3 },
  mil_large: { phy: 0.35, pas: 0.3, def: 0.2, vit: 0.15 }, mil_int: { pas: 0.4, vis: 0.35, dri: 0.25 },
  trequartista: { dri: 0.4, vis: 0.35, tir: 0.25 }, enganche: { vis: 0.5, pas: 0.4, sf: 0.1 }, ombre: { tir: 0.45, vit: 0.25, sf: 0.3 },
  ailier: { vit: 0.4, dri: 0.35, pas: 0.25 }, interieur: { dri: 0.4, tir: 0.4, vit: 0.2 }, ailier_inv: { dri: 0.4, pas: 0.35, vis: 0.25 }, raumdeuter: { vit: 0.4, tir: 0.35, sf: 0.25 },
  renard: { tir: 0.55, sf: 0.35, vit: 0.1 }, pointe: { phy: 0.55, tir: 0.3, pas: 0.15 }, faux9: { pas: 0.35, vis: 0.35, dri: 0.3 }, profondeur: { vit: 0.5, tir: 0.4, sf: 0.1 },
  presseur: { phy: 0.45, vit: 0.35, def: 0.2 }, complet: { tir: 0.3, phy: 0.25, dri: 0.25, pas: 0.2 },
};
export function roleFit(p, role) {
  const w = ROLE_W[role];
  if (!w) return null;
  let s = 0;
  for (const [k, v] of Object.entries(w)) s += (p.attrs?.[k] || 0) * v;
  return Math.round(s);
}

/** Recherche : retourne { total, rows: [{ p, price, g }] } (rows triées, limitées). */
export function searchPlayers(state, f, limit = 60) {
  const F = { ...DEFAULT_FILTERS, ...f };
  const q = fold(F.q).trim();
  const posSet = new Set(F.pos.flatMap((x) => POS_GROUPS[x] || [x]));
  const ids = [...state.freeAgents];
  for (const c of state.clubs) if (c.id !== state.userClubId) ids.push(...c.playerIds);
  const budget = F.budget ? ensureBoard(state).transferBudget : Infinity;
  const cand = [];
  for (const id of ids) {
    const p = state.players[id];
    if (!p || p.onLoanFrom) continue;
    if (posSet.size && !posSet.has(p.pos) && !(p.pos2 || []).some((x) => posSet.has(x))) continue;
    if (p.age < F.ageMin || p.age > F.ageMax) continue;
    if (F.nat && p.nat !== F.nat) continue;
    if (F.foot && p.foot && p.foot !== F.foot) continue;
    if (F.contract && !(p.clubId && p.contract <= 1)) continue;
    if (F.status === 'free' && p.clubId) continue;
    if (F.status === 'listed' && !(p.listed || p.requested)) continue;
    if (F.status === 'loan' && !p.clubId) continue;
    if (F.loanable && !(p.clubId && p.age <= 24)) continue;
    if (F.role && ROLES[F.role]?.pos && !ROLES[F.role].pos.includes(p.pos) && !(p.pos2 || []).some((x) => ROLES[F.role].pos.includes(x))) continue;
    if (F.wageMax && p.wage > F.wageMax) continue;
    if (F.valueMax && (p.value || 0) > F.valueMax * 1.4) continue;
    const c = p.clubId ? clubById(state, p.clubId) : null;
    if (F.div && (!c || c.div !== +F.div)) continue;
    if (F.country && (!c || c.country !== F.country)) continue;
    if (q && !fold(`${p.first || ''} ${p.last || ''} ${p.name}`).includes(q)) continue;
    cand.push(p);
  }
  // Estimations (seulement pour les candidats), puis note / potentiel.
  let rows = [];
  for (const p of cand) {
    const g = guess(state, p);
    if (g.ovr < F.ovrMin || g.pot < F.potMin) continue;
    rows.push({ p, g, rf: F.role ? roleFit(p, F.role) : null });
  }
  const key = { role: (r) => -(r.rf ?? r.g.ovr), ovr: (r) => -r.g.ovr, pot: (r) => -r.g.pot, age: (r) => r.p.age, value: (r) => -(r.p.value || 0), wage: (r) => r.p.wage, cheap: (r) => r.p.value || 0 }[F.sort] || ((r) => -r.g.ovr);
  rows.sort((a, b) => key(a) - key(b));
  if (F.desc === false) rows.reverse();
  // Prix demandé (calcul coûteux) : seulement pour la page affichée.
  const out = [];
  for (const r of rows) {
    const price = r.p.clubId ? askingPrice(state, r.p) : 0;
    if (F.valueMax && price > F.valueMax) continue;
    if (price > budget) continue;
    out.push({ ...r, price });
    if (out.length >= limit) break;
  }
  return { total: rows.length, rows: out };
}

/** Listes pour les menus déroulants (nationalités et championnats présents). */
export function filterOptions(state) {
  const nats = new Map();
  for (const p of Object.values(state.players)) if (p.nat) nats.set(p.nat, (nats.get(p.nat) || 0) + 1);
  const divs = Object.entries(DIVISIONS).map(([id, d]) => ({ id: +id, name: d.name, country: d.country }));
  return { nats: [...nats.entries()].filter(([, n]) => n >= 3).map(([n]) => n).sort((a, b) => a.localeCompare(b, 'fr')), divs };
}
