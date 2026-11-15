/**
 * Parties d'anciennes versions : on retire d'une partie les champs ajoutés au fil des versions
 * (comme une vieille sauvegarde), on la met à niveau, puis on continue à jouer sans erreur.
 * Les notes des joueurs ne doivent pas changer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startCareer, completeDay } from '../js/game/season.js';
import { upgradeSave, UPGRADE_V } from '../js/game/upgrade.js';
import { overall } from '../js/engine/ratings.js';

test('mise à niveau : une ancienne partie récupère les nouveautés sans toucher aux notes', () => {
  const s = newGame(11);
  startCareer(s, s.clubs[5].id);
  if (s.preseason) s.preseason.active = false;
  for (const k of ['traitsV', 'starsV', 'valueV', 'contis', 'supers', 'deals', 'matchLog', 'chats', 'legendsSeeded', 'upgradeV']) delete s[k];
  for (const c of s.clubs) for (const k of ['captain', 'vice', 'coh', 'fam', 'trainSeason', 'trainLog', 'posHist', 'arrivals', 'shortSquad']) delete c[k];
  for (const p of Object.values(s.players)) for (const k of ['traits', 'sm', 'wf', 'weight', 'height', 'foot', 'cons', 'lead', 'sharp', 'links', 'joinedAt', 'injHist', 'careerHist']) delete p[k];
  delete s.coach.background; delete s.coach.licence; delete s.coach.personality;
  const before = Object.fromEntries(Object.values(s.players).map((p) => [p.id, overall(p)]));
  upgradeSave(s);
  assert.equal(s.upgradeV, UPGRADE_V);
  const ps = Object.values(s.players);
  assert.ok(ps.every((p) => Array.isArray(p.traits) && p.sm >= 1 && p.wf >= 1), 'traits et étoiles ajoutés');
  assert.ok(ps.every((p) => overall(p) === before[p.id]), 'notes inchangées');
  for (let i = 0; i < 25 && !s.seasonOver; i++) completeDay(s, null);
  assert.ok(s.day >= 20);
});
