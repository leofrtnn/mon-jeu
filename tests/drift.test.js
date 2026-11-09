/**
 * Dérive sur 500 saisons (DRIFT_SEASONS pour changer) : aucun système ne doit
 * s'emballer (moral qui s'effondre toujours, clubs tous en faillite, relations
 * toutes hostiles, boîte de réception qui déborde…).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { runDrift, mean, share } from './drift.js';
import { BAL } from '../js/data/balance.js';

const N = +process.env.DRIFT_SEASONS || 500;
let rows;
before(() => { rows = runDrift(N, 2024).rows; });

const fmt = (x) => Math.round(x * 100) / 100;
const firstLast = (k) => {
  const q = Math.max(5, Math.floor(rows.length / 5));
  return [mean(rows.slice(0, q), k), mean(rows.slice(-q), k)];
};

test(`dérive ${N} saisons · 1-2. presse : réputation médias ni effondrée ni saturée`, () => {
  assert.equal(mean(rows, 'interviews'), 38, 'une interview après chaque match de championnat');
  const m = mean(rows, 'media');
  assert.ok(m > 15 && m < 85, `médias moyenne ${fmt(m)}`);
  assert.ok(share(rows, (r) => r.media <= 1 || r.media >= 99) < 0.1, 'médias bloqués aux bornes');
  const [a, b] = firstLast('media');
  assert.ok(Math.abs(a - b) < 25, `pas de tendance : ${fmt(a)} → ${fmt(b)}`);
  const v = mean(rows, 'virals');
  assert.ok(v > 0.2 && v < 12, `clips viraux par saison ${fmt(v)}`);
  assert.ok(rows.every((r) => r.statements <= BAL.press.statementsKept), 'historique limité à 30 déclarations');
});

test(`dérive ${N} saisons · 3. vestiaire : moral et confiance stables`, () => {
  const um = mean(rows, 'userMorale');
  assert.ok(um > 35 && um < 75, `moral moyen de l'effectif ${fmt(um)}`);
  assert.ok(share(rows, (r) => r.userMorale < 25) < 0.05, 'moral effondré trop souvent');
  assert.ok(share(rows, (r) => r.userMorale > 90) < 0.05, 'moral saturé trop souvent');
  const wm = mean(rows, 'worldMorale');
  assert.ok(wm > 45 && wm < 65, `moral moyen du monde ${fmt(wm)}`);
  const [a, b] = firstLast('worldMorale');
  assert.ok(Math.abs(a - b) < 8, `moral du monde sans tendance : ${fmt(a)} → ${fmt(b)}`);
  assert.ok(share(rows, (r) => r.dressing < 5) < 0.05, 'vestiaire bloqué à 0');
});

test(`dérive ${N} saisons · 4. demandes des joueurs : fréquence raisonnable`, () => {
  const q = mean(rows, 'requests');
  assert.ok(q >= 1 && q <= 25, `demandes par saison ${fmt(q)}`);
  assert.ok(rows.every((r) => r.maxOpen <= BAL.requests.maxOpen), 'jamais plus de demandes ouvertes que le maximum');
  assert.ok(rows.every((r) => r.openDecisions <= 8), 'la boîte de réception ne déborde pas de décisions');
  assert.ok(rows.every((r) => r.messages <= 60), 'messages plafonnés');
});

test(`dérive ${N} saisons · 5. propriétaires : environ 1 club sur 10 racheté par saison`, () => {
  const t = mean(rows, 'takeovers') / 80;
  assert.ok(t > 0.04 && t < 0.2, `taux de rachat ${fmt(t * 100)} %`);
});

test(`dérive ${N} saisons · 6-7. relations : pas d'hostilité généralisée`, () => {
  const h = mean(rows, 'hostileShare');
  assert.ok(h < 0.05, `part des paires hostiles ${fmt(h * 100)} %`);
  const rm = mean(rows, 'relMean');
  assert.ok(rm > -25 && rm < 25, `relation moyenne stockée ${fmt(rm)}`);
  assert.ok(rows.every((r) => r.relStored < 3160), 'graphe borné');
  const [a, b] = firstLast('relStored');
  assert.ok(b < a * 2 + 200, `le graphe ne grossit pas indéfiniment : ${fmt(a)} → ${fmt(b)}`);
});

test(`dérive ${N} saisons · 8. finances : pas de faillite généralisée`, () => {
  assert.ok(rows.every((r) => r.crisis < 0.5), 'jamais la moitié des clubs en crise');
  assert.ok(mean(rows, 'crisis') < 0.25, `part moyenne de clubs en crise ${fmt(mean(rows, 'crisis') * 100)} %`);
  assert.ok(rows.every((r) => r.bankrupt < 0.2), 'faillites contenues');
  const [a, b] = firstLast('meanHealth');
  assert.ok(b > 30, `santé financière moyenne finale ${fmt(b)} (début ${fmt(a)})`);
  assert.ok(rows.every((r) => r.relegated === 3), 'toujours 3 relégués (relégation administrative comprise)');
});

test(`dérive ${N} saisons · 10. rumeurs bornées`, () => {
  assert.ok(rows.every((r) => r.rumours <= 12), 'liste de rumeurs bornée');
});

test(`dérive ${N} saisons · 12. supporters : ambiance stable`, () => {
  const a = mean(rows, 'atmosphere');
  assert.ok(a > 35 && a < 85, `ambiance moyenne ${fmt(a)}`);
  const [x, y] = firstLast('atmosphere');
  assert.ok(Math.abs(x - y) < 15, `ambiance sans tendance : ${fmt(x)} → ${fmt(y)}`);
  assert.ok(share(rows, (r) => r.fans <= 1 || r.fans >= 99) < 0.25, 'humeur des supporters pas bloquée aux bornes');
});

test(`dérive ${N} saisons · 13. sponsors : le club n'en perd pas tous définitivement`, () => {
  assert.ok(mean(rows, 'sponsors') >= 0.8, `sponsors moyens ${fmt(mean(rows, 'sponsors'))}`);
  assert.ok(share(rows, (r) => r.sponsors === 0) < 0.45, 'trop de saisons sans sponsor');
});

test(`dérive ${N} saisons · 14. blessures longues et rechutes contenues`, () => {
  assert.ok(mean(rows, 'longInj') < 4, `blessures longues par saison ${fmt(mean(rows, 'longInj'))}`);
  assert.ok(mean(rows, 'relapses') <= mean(rows, 'longInj') + 0.5, 'les rechutes restent plus rares que les blessures longues');
});

test(`dérive ${N} saisons · 15. carrière : pas de valse permanente des clubs`, () => {
  assert.ok(share(rows, (r) => r.moved + r.sacked > 0) < 0.6, 'changements de club trop fréquents');
});
