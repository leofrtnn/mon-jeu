/**
 * MISE À NIVEAU DES PARTIES EN COURS
 * ------------------------------------------------------------------
 * Une partie commencée sur une ancienne version profite de TOUT ce qui est nouveau
 * (gameplay, interface, nouveaux systèmes) : on complète les champs qui manquent, sans
 * toucher à ce qui appartient à la partie — notes des joueurs, effectifs, transferts,
 * résultats, finances. Appelée à chaque chargement (rapide : chaque étape ne travaille
 * qu'une fois grâce aux marqueurs de version).
 */
import { ensureContis } from './season.js';
import { ensureCoachProfile } from './coach.js';
import { ensureManagers, onUserArrives } from './managers.js';
import { ensureStaff } from './career.js';
import { ensureBoard } from './board.js';
import { ensureLife } from './life.js';
import { assignAllTraits } from './traits.js';
import { assignAllStars } from './stars.js';
import { playerValue } from './economy.js';
import { TOP100_V } from './ratingsImport.js';
import { markFM27, fm27Pending } from './fm27.js';
import { userClub } from './state.js';

/** Version des mises à niveau : à augmenter quand une nouvelle étape est ajoutée ci-dessous. */
export const UPGRADE_V = 1;

const STAT_DEFAULTS = { apps: 0, goals: 0, lgoals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0, minutes: 0, motm: 0 };

export function upgradeSave(state) {
  if (!state?.clubs || !state.players) return state;
  const started = !!state.userClubId;
  // Systèmes créés paresseusement (idempotents).
  state.settings ||= {};
  state.messages ||= []; state.news ||= []; state.history ||= []; state.pendingOffers ||= [];
  state.freeAgents ||= []; state.scout ||= {}; state.scoutQueue ||= []; state.nations ||= {};
  state.friends ||= { teams: [] };
  if (started) {
    // Nouvelles options du coach (3D, tempérament…) : l'interface a des valeurs par défaut.
    if (state.coach) { ensureCoachProfile(state.coach); state.coach.look ||= {}; }
    if (!state.managers) { ensureManagers(state); onUserArrives(state, userClub(state)); }
    ensureStaff(state);
    ensureBoard(state);
    ensureLife(state);
    ensureContis(state);
  }
  // Notes : les bases intégrées ne réécrivent JAMAIS une partie en cours (on marque seulement).
  if (state.world === 'real' && state.top100V !== TOP100_V) state.top100V = TOP100_V;
  if (fm27Pending(state)) markFM27(state);
  // Nouveaux attributs des joueurs (traits, étoiles), calculés d'après leurs notes actuelles.
  if (state.traitsV !== 1) assignAllTraits(state);
  if (state.starsV !== 1) assignAllStars(state);
  if (state.valueV !== 2) { for (const p of Object.values(state.players)) p.value = playerValue(p); state.valueV = 2; }
  if ((state.upgradeV || 0) < UPGRADE_V) {
    for (const p of Object.values(state.players)) {
      p.stats = { ...STAT_DEFAULTS, ...(p.stats || {}) };
      p.attrs ||= {};
      p.form ??= 50; p.morale ??= 65; p.fatigue ??= 0; p.injury ??= 0; p.suspended ??= 0; p.yellowAcc ??= 0;
    }
    for (const c of state.clubs) {
      c.playerIds ||= []; c.youthIds ||= []; c.finances ||= { history: [] }; c.finances.history ||= [];
      c.shortSquad = c.playerIds.length < 18;
    }
    state.upgradeV = UPGRADE_V;
  }
  return state;
}
