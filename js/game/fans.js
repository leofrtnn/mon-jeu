/**
 * SUPPORTERS (ambiance du stade) et SPONSORS (contrats liés à l'image du club).
 */
import { clamp, hashSeed } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubById, clubPlayers, pushMessage } from './state.js';
import { sponsorIncome, money } from './economy.js';
import { overall } from '../engine/ratings.js';
import { pushDecision, registerDecision } from './inbox.js';
import { minutesShare } from './people.js';

const F = BAL.fans;
const S = BAL.sponsors;

/* ---------------- Supporters ---------------- */

/** Avantage du terrain selon l'ambiance (lu par le moteur). */
export const homeAdvantage = (club) => F.homeAdv[0] + (F.homeAdv[1] - F.homeAdv[0]) * clamp(club.atmosphere ?? 55, 0, 100) / 100;
/** Multiplicateur de billetterie (ambiance × politique tarifaire). */
export const gateMult = (club) => (F.revenue[0] + (F.revenue[1] - F.revenue[0]) * clamp(club.atmosphere ?? 55, 0, 100) / 100) * (F.ticket[club.ticket || 'normal']?.price ?? 1);
const atmBase = (c) => 40 + c.rep * 0.35;

/** Après un match à domicile. */
export function atmosphereAfterMatch(state, club, gf, ga) {
  let d = gf > ga ? F.win : gf < ga ? F.loss : F.draw;
  if (gf >= 3 && gf > ga) d += F.bigWin;
  d += F.ticket[club.ticket || 'normal']?.atm ?? 0;
  d += (atmBase(club) - (club.atmosphere ?? 55)) * F.revert;
  club.atmosphere = clamp((club.atmosphere ?? 55) + d, 0, 100);
}

/** Événements de tribune (club de l'utilisateur), après un match à domicile. */
export function standsEvents(state, rng, gf, ga) {
  const uc = userClub(state);
  const a = uc.atmosphere;
  const form = state.life.streak.slice(-4);
  const b = state.board;
  if (form.length >= 4 && form.every((r) => r === 'L') && rng.chance(0.6)) {
    b.parts.results = clamp(b.parts.results - 4, 0, 100);
    pushMessage(state, { prio: 1, icon: '📢', title: 'Manifestation devant le stade', text: 'Après cette série noire, des centaines de supporters réclament des comptes. Le board est sous pression.' });
  } else if (gf < ga && a < 35 && rng.chance(0.5)) {
    pushMessage(state, { prio: 2, icon: '😤', title: 'Sifflets à la fin du match', text: 'Le public a fait entendre son mécontentement.' });
  } else if (gf - ga >= 2 && a > 70 && rng.chance(0.35)) {
    uc.image = clamp((uc.image ?? 50) + 1, 0, 100);
    pushMessage(state, { prio: 3, icon: '🎆', title: 'Tifo géant et chants', text: 'Une soirée magique : le stade a vibré du début à la fin.' });
  } else if (rng.chance(0.08)) {
    pushMessage(state, { prio: 3, icon: '🏳', title: 'Banderole en tribune', text: a >= 55 ? `« Coach, on est avec toi ! »` : `« Du respect pour le maillot ! »` });
  }
  if (a < F.boardPressure) b.parts.results = clamp(b.parts.results - 0.5, 0, 100);
}

/** Un joueur adoré quitte le club. */
export function favouriteLeaves(state, p) {
  const uc = userClub(state);
  if (!p || (p.stats?.apps ?? 0) + (p.career?.apps ?? 0) < 60 && !p.homegrown) return;
  uc.atmosphere = clamp(uc.atmosphere + F.favouriteSold, 0, 100);
  state.board.fans = clamp(state.board.fans - 4, 0, 100);
  pushMessage(state, { prio: 2, icon: '💔', title: `Les supporters pleurent ${p.name}`, text: 'Le départ d\'un joueur adoré passe mal en tribune.' });
}

/** Politique tarifaire. */
export const TICKETS = { low: 'Populaire', normal: 'Normal', high: 'Élevé' };

/* ---------------- Sponsors ---------------- */

const BRANDS = ['Volta Énergie', 'Brasserie du Nord', 'Aéro Lignes', 'Banque Hexa', 'Mutuelle Atlas', 'TéléPlus', 'Optique Lumen', 'Kiwi Mobile', 'Assur Horizon', 'Caravelle Auto', 'Pâtes Rossi', 'Cloud Nimbus'];
const REQS = {
  star: 'Titulariser la star',
  primetime: 'Gros matchs en prime time',
  top: 'Finir dans la 1re moitié',
  none: 'Aucune exigence',
};

function makeDeal(state, uc, seed, kind) {
  const total = sponsorIncome(uc) * (1 - S.baseShare);
  const imageK = 0.75 + (uc.image ?? 50) / 200;
  const h = hashSeed(seed);
  const req = ['star', 'primetime', 'top', 'none'][h % 4];
  const weekly = Math.round(total / 2 * imageK * (req === 'none' ? 0.85 : 1.1) / 500) * 500;
  return { id: seed, name: BRANDS[h % BRANDS.length], kind, weekly, years: 1 + (h % 3), req, sat: 60, winBonus: Math.round(weekly * S.winBonus / 100) * 100 };
}

export function ensureSponsors(state) {
  const uc = userClub(state);
  if (state.sponsorDeals) return;
  state.sponsorDeals = [makeDeal(state, uc, `${state.seed}-s1`, 'Maillot'), makeDeal(state, uc, `${state.seed}-s2`, 'Stade')];
}

/** Revenus hebdomadaires de sponsoring du club de l'utilisateur. */
export function userSponsorIncome(state) {
  const uc = userClub(state);
  return Math.round(sponsorIncome(uc) * S.baseShare) + (state.sponsorDeals || []).reduce((a, d) => a + d.weekly, 0);
}

/** Après un match de l'utilisateur : primes, exigences, satisfaction. */
export function sponsorsAfterMatch(state, d, big) {
  const won = d.gf > d.ga;
  let bonus = 0;
  for (const s of state.sponsorDeals || []) {
    if (won) bonus += s.winBonus;
    s.sat = clamp(s.sat + (won ? 1.5 : d.gf < d.ga ? -1.5 : 0) + (55 - s.sat) * S.satRevert, 0, 100);
    if (s.req === 'primetime' && big) {
      s.sat = clamp(s.sat + 3, 0, 100);
      for (const id of d.lineup) { const p = state.players[id]; if (p) p.fatigue = Math.min(90, (p.fatigue || 0) + S.primetimeFatigue); }
    }
  }
  return bonus;
}

/** Contrôle périodique (exigences, départ après scandale ou série noire). */
export function sponsorsCheck(state, rng) {
  const uc = userClub(state);
  const star = clubPlayers(state, uc).filter((p) => !p.onLoanFrom).sort((a, b) => overall(b) - overall(a))[0];
  const T = state.tables[uc.div];
  const ids = Object.keys(T).sort((a, b) => T[b].pts - T[a].pts);
  const pos = ids.indexOf(String(uc.id)) + 1;
  for (const s of (state.sponsorDeals || []).slice()) {
    if (s.req === 'star' && star && (state.seasonStats?.m || 0) >= 5) s.sat = clamp(s.sat + (minutesShare(state, star) >= S.starShare ? S.reqGood : S.reqBad), 0, 100);
    if (s.req === 'top' && (T[uc.id]?.p ?? 0) >= 10) s.sat = clamp(s.sat + (pos <= ids.length / 2 ? S.reqGood : S.reqBad), 0, 100);
    const scandal = (uc.image ?? 50) < S.leaveImage;
    if ((s.sat < S.leaveSat || scandal) && rng.chance(S.leaveChance)) {
      state.sponsorDeals = state.sponsorDeals.filter((x) => x !== s);
      uc.image = clamp((uc.image ?? 50) - 2, 0, 100);
      pushMessage(state, { prio: 1, icon: '🏷', title: `${s.name} rompt son contrat`, text: `${scandal ? 'Image du club dégradée' : 'Exigences non respectées'} : ${money(s.weekly)}/sem en moins.` });
    }
  }
}

/** Fin de saison : contrats qui expirent, nouvelles offres après une bonne saison. */
export function sponsorsEndSeason(state, goodSeason) {
  const uc = userClub(state);
  for (const s of state.sponsorDeals || []) s.years--;
  const expired = (state.sponsorDeals || []).filter((s) => s.years <= 0);
  state.sponsorDeals = (state.sponsorDeals || []).filter((s) => s.years > 0);
  for (const s of expired) if (s.sat >= 50) state.sponsorDeals.push({ ...s, years: 2, weekly: Math.round(s.weekly * (goodSeason ? 1.1 : 1) / 500) * 500, sat: 60 });
  uc.image = clamp((uc.image ?? 50) + (goodSeason ? 4 : -2) + ((30 + uc.rep * 0.4) - (uc.image ?? 50)) * 0.15, 0, 100);
  if (state.sponsorDeals.length < 2 || goodSeason) {
    const a = makeDeal(state, uc, `${state.seed}-${state.season}-o1`, state.sponsorDeals.length ? 'Manche' : 'Maillot');
    const b = makeDeal(state, uc, `${state.seed}-${state.season}-o2`, a.kind);
    pushDecision(state, { kind: 'sponsor', icon: '🏷', title: 'Offres de sponsoring', text: `${a.name} : ${money(a.weekly)}/sem (${REQS[a.req]}) · ${b.name} : ${money(b.weekly)}/sem (${REQS[b.req]}).`,
      data: { a, b }, choices: [{ key: 'a', label: a.name }, { key: 'b', label: b.name }, { key: 'none', label: 'Aucune' }], days: 4 });
  }
}

registerDecision('sponsor', {
  resolve(state, { a, b }, key) {
    if (key === 'none') return { msg: 'Vous déclinez les offres.' };
    const d = key === 'a' ? a : b;
    state.sponsorDeals = state.sponsorDeals || [];
    if (state.sponsorDeals.length >= 3) state.sponsorDeals.sort((x, y) => x.weekly - y.weekly).shift();
    state.sponsorDeals.push(d);
    return { msg: `${d.name} signe : ${money(d.weekly)}/sem, ${d.years} an(s). Exigence : ${REQS[d.req]}.` };
  },
});

export { REQS as SPONSOR_REQS };
