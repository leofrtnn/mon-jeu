/**
 * IMPORT DE NOTES (fichier fourni par l'utilisateur)
 * ------------------------------------------------------------------
 * Le jeu n'embarque aucune base de notes tierce. L'utilisateur peut importer son propre
 * fichier (par exemple une liste de joueurs exportée depuis son jeu de gestion : texte
 * avec des « | », CSV, ou page HTML) ; les notes sont converties sur 100 et appliquées
 * aux joueurs de la partie (recherche par nom, puis par nom + club).
 *
 * Colonnes reconnues (en-têtes en français ou en anglais, sans tenir compte des accents) :
 *  - Nom / Name / Joueur / Player           (obligatoire)
 *  - Club / Team / Équipe                   (facultatif, aide à départager les homonymes)
 *  - CA / Capacité actuelle / Current Ability (0-200)  → note sur 100
 *  - PA / Capacité potentielle / Potential   (0-200)  → potentiel sur 100
 *  - Note / Rating / OVR / Général           (déjà sur 100)
 *  - Attributs sur 20 (Fin, Pas, Dri, Tac, Vit, For, Vis, Sf, Réf…) → profil détaillé
 * Le fichier reste sur l'appareil ; une copie compacte (nom → note) est gardée pour
 * l'appliquer aussi aux prochaines parties.
 */
import { overall } from '../engine/ratings.js';
import { fitToLevel } from '../data/generator.js';
import { playerValue, playerWage } from './economy.js';
import { TOP100 } from '../data/top100.js';
import { TOP500 } from '../data/top500.js';

const KEY = 'cdp-ratings-import';
const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Nom comparable : accents, ponctuation, « Jr » = « Júnior ». */
const foldName = (t) => fold(t).replace(/\bjr\b/g, 'junior');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Capacité (0-200, échelle des jeux de gestion) → note sur 100 de ce jeu. */
export const abilityTo100 = (ca) => clamp(Math.round(25 + ca * 0.36), 30, 96);

/* ---------- Lecture du fichier ---------- */

/** Découpe le texte en lignes de cellules (HTML, texte à « | », CSV ; , ou tabulations). */
export function parseTable(text) {
  text = String(text || '').replace(/^﻿/, '');
  if (/<table/i.test(text)) {
    const rows = [];
    for (const tr of text.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map((c) => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim());
      if (cells.length) rows.push(cells);
    }
    return rows;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^[\s|\-+=]+$/.test(l));
  if (!lines.length) return [];
  const head = lines[0];
  const sep = head.includes('|') ? '|' : ['\t', ';', ','].map((s) => [s, head.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => {
    let cells = sep === '|' ? l.split('|') : splitCsv(l, sep);
    if (sep === '|') { if (!cells[0].trim()) cells.shift(); if (cells.length && !cells[cells.length - 1].trim()) cells.pop(); }
    return cells.map((c) => c.trim().replace(/^"|"$/g, ''));
  });
}

function splitCsv(line, sep) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const COLS = {
  name: ['nom', 'name', 'joueur', 'player', 'nom du joueur'],
  club: ['club', 'team', 'equipe'],
  ca: ['ca', 'current ability', 'capacite actuelle', 'cap act', 'ca actuelle', 'actuelle', 'ability'],
  pa: ['pa', 'potential ability', 'capacite potentielle', 'cap pot', 'potentielle', 'potentiel', 'potential'],
  note: ['note', 'rating', 'ovr', 'overall', 'general', 'note generale'],
};
// Attributs sur 20 → attributs du jeu (moyenne des colonnes trouvées).
const ATTR_COLS = {
  vit: ['pac', 'acc', 'vit', 'acceleration', 'pace', 'vitesse'],
  tir: ['fin', 'finition', 'finishing', 'lon', 'tirs de loin', 'long shots', 'tdl'],
  pas: ['pas', 'passing', 'passes', 'cen', 'crossing', 'centres'],
  dri: ['dri', 'dribbling', 'dribble', 'tec', 'technique', 'technique', 'fir', 'cont', 'controle'],
  def: ['tck', 'tac', 'tacles', 'tackling', 'mar', 'marquage', 'marking', 'pla', 'placement', 'positioning'],
  phy: ['str', 'for', 'force', 'strength', 'sta', 'end', 'endurance', 'stamina', 'nat', 'condition physique'],
  vis: ['vis', 'vision', 'cre', 'creativite', 'dec', 'decisions'],
  sf: ['cmp', 'sf', 'sang froid', 'composure', 'det', 'determination'],
  arr: ['ref', 'reflexes', 'han', 'pri', 'prise de balle', 'handling', '1v1', 'un contre un', 'one on ones'],
};

function findCol(header, names) {
  const h = header.map(fold);
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
  return -1;
}

/** Lit le fichier : liste de { name, club, note, pot, attrs } (notes sur 100). */
export function readRatings(text) {
  const rows = parseTable(text);
  // Ligne d'en-tête : la première qui contient une colonne « nom ».
  const hi = rows.findIndex((r) => findCol(r, COLS.name) >= 0);
  if (hi < 0) return { error: 'Colonne « Nom » (ou « Name ») introuvable dans le fichier.', list: [] };
  const header = rows[hi];
  const ci = Object.fromEntries(Object.entries(COLS).map(([k, v]) => [k, findCol(header, v)]));
  const ai = Object.fromEntries(Object.entries(ATTR_COLS).map(([k, v]) => [k, v.map((n) => findCol(header, [n])).filter((i) => i >= 0)]));
  const nAttr = Object.values(ai).filter((a) => a.length).length;
  if (ci.ca < 0 && ci.note < 0 && nAttr < 4) return { error: 'Aucune colonne de note trouvée (CA, Note, ou attributs).', list: [] };
  const num = (v) => { const x = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : null; };
  const list = [];
  for (const r of rows.slice(hi + 1)) {
    const name = r[ci.name];
    if (!name || fold(name) === fold(header[ci.name])) continue;
    let note = null, pot = null;
    if (ci.ca >= 0) { const v = num(r[ci.ca]); if (v != null) note = v > 100 || ci.note < 0 ? abilityTo100(v) : v; }
    if (note == null && ci.note >= 0) { const v = num(r[ci.note]); if (v != null) note = v > 100 ? abilityTo100(v) : v; }
    if (ci.pa >= 0) { const v = num(r[ci.pa]); if (v != null && v > 0) pot = v > 100 ? abilityTo100(v) : v; }
    let attrs = null;
    if (nAttr >= 4) {
      attrs = {};
      for (const [k, idx] of Object.entries(ai)) {
        const vals = idx.map((i) => num(r[i])).filter((v) => v != null && v > 0 && v <= 20);
        if (vals.length) attrs[k] = clamp(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 5 - 2), 5, 99);
      }
    }
    if (note == null && !attrs) continue;
    list.push({ name: String(name).replace(/\s*-\s*Pick Player.*$/i, '').trim(), club: ci.club >= 0 ? r[ci.club] || '' : '', note: note != null ? clamp(Math.round(note), 25, 97) : null, pot, attrs });
  }
  return { list };
}

/* ---------- Application à la partie ---------- */

function indexPlayers(state) {
  const full = new Map(), last = new Map(), first = new Map();
  const clubName = new Map(state.clubs.map((c) => [c.id, fold(c.name)]));
  for (const p of Object.values(state.players)) {
    const k = foldName(`${p.first || ''} ${p.last || ''}`);
    if (!full.has(k)) full.set(k, []);
    full.get(k).push(p);
    const l = foldName(p.last || p.name);
    if (!last.has(l)) last.set(l, []);
    last.get(l).push(p);
    const f = foldName(p.first || '');
    if (f) { if (!first.has(f)) first.set(f, []); first.get(f).push(p); }
  }
  return { full, last, first, clubName };
}

function pick(cands, club, idx) {
  if (!cands?.length) return null;
  if (cands.length === 1 && !club) return cands[0];
  const cf = fold(club);
  if (cf) {
    const hit = cands.filter((p) => { const cn = idx.clubName.get(p.clubId) || ''; return cn && (cn.includes(cf) || cf.includes(cn) || cn.split(' ').some((w) => w.length > 3 && cf.includes(w))); });
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
    return cands.length === 1 ? cands[0] : null;
  }
  return null;
}

/** Applique la liste à la partie. Retourne { matched, total, missing: [noms] }. */
export function applyRatings(state, list, { best = false } = {}) {
  const idx = indexPlayers(state);
  let matched = 0;
  const missing = [];
  const used = new Set();
  for (const row of list) {
    const nf = foldName(row.name);
    const words = nf.split(' ');
    let p = pick((idx.full.get(nf) || []).filter((q) => !row.pos || q.pos === row.pos), row.club, idx);
    // « Kylian Mbappé » ↔ « K. Mbappé » / nom seul : par le nom de famille (+ club).
    // (le prénom doit commencer pareil : « Son Heung-min » n'est pas « David Min »)
    const sameInitial = (q) => !q.first || foldName(q.first).startsWith(words[0][0]);
    for (let k = 1; k < words.length && !p; k++) { const q = pick(idx.last.get(words.slice(k).join(' ')), row.club, idx); if (q && sameInitial(q)) p = q; }
    // Nom d'un seul mot : nom de famille / surnom (Rodri, Pedri) ; un prénom seulement si le club concorde (Alisson Becker).
    const clubOk = (q) => { const cn = idx.clubName.get(q.clubId) || '', cf = fold(row.club); return !!cf && !!cn && (cn.includes(cf) || cf.includes(cn) || cn.split(' ').some((w) => w.length > 3 && cf.includes(w))); };
    const firstOk = (idx.first.get(nf) || []).filter(clubOk);
    if (!p && words.length === 1) p = pick([...(idx.last.get(nf) || []), ...firstOk].filter((q) => !row.pos || q.pos === row.pos), row.club, idx);
    if (!p && best) {
      // Homonymes : pour une liste de stars, le meilleur joueur portant ce nom est le bon.
      const cands = [...(idx.full.get(nf) || []), ...(words.length > 1 ? idx.last.get(words.slice(1).join(' ')) || [] : []),
        ...(words.length === 1 ? [...(idx.last.get(nf) || []), ...firstOk] : [])]
        .filter((q) => !used.has(q) && (!row.pos || q.pos === row.pos) && (words.length === 1 || foldName(q.first || '').startsWith(words[0][0])));
      p = cands.sort((a, b) => overall(b) - overall(a))[0] || null;
    }
    if (p && used.has(p)) p = null;
    if (!p) { missing.push(row.name); continue; }
    used.add(p);
    const rowAttrs = row.raw ? top100Attrs(p, row.raw) : row.attrs;
    if (rowAttrs) {
      p.attrs = { ...p.attrs, ...rowAttrs };
      if (p.pos === 'GB' && rowAttrs.arr == null) p.attrs.arr = p.attrs.arr || 60;
    }
    if (row.note != null) fitToLevel(p, row.note);
    const o = overall(p);
    p.pot = Math.max(o, row.pot != null ? Math.round(row.pot) : (p.pot || o));
    p.wage = Math.max(p.wage || 0, playerWage(p));
    p.value = playerValue(p);
    p.imported = true;
    if (row.extra) {
      // Pied fort, régularité (écarts de performance d'un match à l'autre), leadership.
      if (row.extra.foot) p.foot = row.extra.foot;
      if (row.extra.cons != null) p.cons = row.extra.cons;
      if (row.extra.lead != null) p.lead = row.extra.lead;
    }
    matched++;
  }
  return { matched, total: list.length, missing };
}

/* ---------- Mémoire pour les prochaines parties ---------- */

export function storeRatings(list) {
  try {
    const compact = list.map((r) => [r.name, r.club, r.note, r.pot, r.attrs]);
    localStorage.setItem(KEY, JSON.stringify(compact));
    return true;
  } catch { return false; }
}
export function storedRatings() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Array.isArray(a) ? a.map(([name, club, note, pot, attrs]) => ({ name, club, note, pot, attrs })) : null;
  } catch { return null; }
}
export function clearStoredRatings() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/* ---------- Top 100 intégré au jeu ---------- */
export const TOP100_V = 4;

/**
 * Attributs clés du top 100 (sur 20) → profil du jeu (sur 100), selon le poste du joueur :
 * technique → dribble, mental → vision et sang-froid, physique, passes, finition → tir,
 * placement → défense pour un défenseur / milieu défensif, arrêts pour un gardien
 * (pour un attaquant, le placement est offensif : on ne touche pas à sa défense).
 */
function top100Attrs(p, [tech, ment, phys, pass, fin, plac]) {
  const v = (x) => clamp(Math.round(x * 5 - 2), 5, 97);
  const a = { dri: v(tech), vis: v(ment), sf: v(ment), phy: v(phys), pas: v(pass) };
  // Finition : ignorée pour les défenseurs et gardiens (les fichiers fournis y mettent parfois n'importe quoi).
  if (!['GB', 'DC', 'DG', 'DD'].includes(p.pos)) a.tir = v(fin);
  if (p.pos === 'GB') a.arr = v(plac);
  else if (['DC', 'DG', 'DD', 'MDC'].includes(p.pos)) a.def = v(plac);
  else if (p.pos === 'MC') a.def = Math.round((v(plac) + (p.attrs.def ?? 60)) / 2);
  return a;
}

/** Applique le top 100 intégré (CA / PA → notes sur 100, attributs clés). Une fois par version. */
export function applyTop100(state) {
  if (state.world !== 'real' || state.top100V === TOP100_V) return null;
  // Ancien top 200 d'abord, puis la base de 500 joueurs (plus récente et plus complète) par-dessus.
  const names500 = new Set(TOP500.map((r) => foldName(r[0])));
  const list = TOP100.filter((r) => !names500.has(foldName(r[0]))).map(([name, club, ca, pa, pos, raw]) => ({ name, club, pos, raw, note: abilityTo100(ca), pot: abilityTo100(pa), attrs: null }));
  applyRatings(state, list, { best: true });
  const list5 = TOP500.map(([name, club, ca, pa, pos, attrs, foot, cons, lead]) => ({ name, club, pos: null, note: abilityTo100(ca), pot: abilityTo100(pa), attrs, extra: { foot, cons, lead } }));
  const r = applyRatings(state, list5, { best: true });
  state.top100V = TOP100_V;
  return r;
}
