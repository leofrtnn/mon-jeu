/**
 * BLESSURES LONGUES ET RECHUTES (club de l'utilisateur).
 * Le médecin réduit durées et risques ; le coach décide de forcer un retour ou d'attendre.
 */
import { clamp } from '../core/rng.js';
import { BAL } from '../data/balance.js';
import { userClub, clubPlayers, pushMessage } from './state.js';
import { bestStaff } from './career.js';
import { pushDecision, registerDecision, openDecisions } from './inbox.js';
import { moodShift, persInfo } from './people.js';

const I = BAL.injuries;

/** Durée d'une blessure (avec une petite part de blessures graves). */
export function injuryLength(rng) {
  if (rng.chance(I.severeChance)) return rng.int(I.severe[0], I.severe[1]);
  return rng.chance(0.6) ? rng.int(1, 3) : rng.chance(0.75) ? rng.int(4, 8) : rng.int(9, 20);
}

export const SEVERE_NAMES = ['Rupture des ligaments croisés', 'Fracture du tibia', 'Rupture du tendon d\'Achille', 'Pubalgie chronique'];

/** Enregistre une blessure longue (appelé quand un joueur de l'utilisateur se blesse). */
export function noteInjury(state, p) {
  p.injTotal = p.injury;
  p.injAsked = false;
  if (p.injury >= I.longThreshold) {
    p.injLong = true;
    moodShift(p, -6);
  } else p.injLong = false;
}

const physio = (state) => bestStaff(userClub(state), 'physio');

/** Une journée : moral des blessés longs, proposition de retour anticipé. */
export function injuriesDaily(state) {
  for (const p of clubPlayers(state, userClub(state))) {
    if (p.injury > 0) p.injDays = (p.injDays || 0) + 1;
    if (!p.injLong) continue;
    if (p.injury <= 0) { p.injLong = false; continue; }
    p.morale = clamp(p.morale + I.longMorale * persInfo(p).sens, 5, 99);
    if (!p.injAsked && p.injury <= Math.ceil(p.injTotal * I.earlyReturnAt) && p.injury >= 2 && !openDecisions(state, 'earlyreturn').length) {
      p.injAsked = true;
      const risk = relapseRisk(state, p);
      pushDecision(state, { kind: 'earlyreturn', icon: '🩺', title: `${p.name} peut reprendre plus tôt`, text: `Encore ${p.injury} match(s) d'indisponibilité conseillés. Risque de rechute en cas de retour anticipé : ${Math.round(risk * 100)} %.`,
        data: { pid: p.id }, choices: [{ key: 'force', label: 'Forcer le retour' }, { key: 'wait', label: 'Attendre' }], days: 2 });
    }
  }
}

export function relapseRisk(state, p) {
  const remaining = p.injury / Math.max(1, p.injTotal || p.injury);
  return clamp(I.relapseBase * (0.5 + remaining) * (1 - physio(state) * I.physioCut), 0.03, 0.8);
}

registerDecision('earlyreturn', {
  resolve(state, { pid }, key) {
    const p = state.players[pid];
    if (!p) return { msg: 'Joueur introuvable.' };
    if (key === 'wait') { moodShift(p, -2); return { msg: `${p.name} poursuit sa rééducation.` }; }
    p.relapse = { risk: relapseRisk(state, p), matches: I.relapseMatches, total: p.injTotal };
    p.injury = 0; p.injLong = false;
    moodShift(p, 5);
    return { msg: `${p.name} est de retour… croisons les doigts.`, effects: { target: 5 } };
  },
});

/** Après un match : rechute possible pour les joueurs revenus trop tôt. */
export function relapseCheck(state, d, rng) {
  for (const id of d.played) {
    const p = state.players[id];
    if (!p?.relapse) continue;
    if (rng.chance(p.relapse.risk)) {
      p.injury = Math.round(Math.max(4, p.relapse.total) * I.relapseMult);
      p.injuryName = `Rechute (${p.injuryName || 'blessure'})`;
      p.injTotal = p.injury; p.injLong = true; p.injAsked = true;
      p.relapse = null;
      moodShift(p, -12);
      pushMessage(state, { prio: 1, icon: '✚', title: `Rechute pour ${p.name}`, text: `Retour trop précipité : ${p.injury} match(s) d'absence. Le moral est au plus bas.`, action: { type: 'player', pid: p.id } });
    } else if (--p.relapse.matches <= 0) p.relapse = null;
  }
}

/** Fin de saison : un joueur longtemps blessé voit sa valeur baisser et doute de son avenir. */
export function injuriesEndSeason(state) {
  for (const p of clubPlayers(state, userClub(state))) {
    if ((p.injDays || 0) >= 15) { p.value = Math.round((p.value || 0) * 0.85); moodShift(p, -4); }
    p.injDays = 0;
  }
}
