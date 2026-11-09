/**
 * État global de la partie + sauvegarde automatique (localStorage).
 * L'état est un objet JSON simple : facile à sérialiser et à déboguer.
 */
import { createRng, hashSeed } from '../core/rng.js';
import { getNextId, setNextId } from '../data/generator.js';
import { kvGet, kvSet, kvDel } from './store.js';
import { applyWorld } from '../data/world.js';

export const SAVE_VERSION = 3;
/** Versions de sauvegarde encore lisibles (migrées à la volée). */
export const MIN_SAVE_VERSION = 2;

/** RNG "de partie" persistant : on sauvegarde son état interne. */
export function gameRng(state) {
  const r = createRng(1);
  r.setState(state.rngState);
  // Persister l'avancement après chaque tirage.
  const next = r.next;
  r.next = () => { const v = next(); state.rngState = r.getState(); return v; };
  return r;
}

/** Graine déterministe pour un match. */
export function matchSeed(state, a, b) {
  return hashSeed(`${state.seed}-${state.season}-${state.day}-${a}-${b}`);
}

export const clubById = (state, id) => state.clubs.find((c) => c.id === id);
export const userClub = (state) => clubById(state, state.userClubId);
export const clubPlayers = (state, club) => club.playerIds.map((id) => state.players[id]).filter(Boolean);
export const player = (state, id) => state.players[id];

/** Ajoute un message (prio 1 = important, 3 = info). */
export function pushMessage(state, { prio = 2, icon = '•', title, text = '', action = null }) {
  state.messages.unshift({ id: Date.now() + Math.random(), day: state.day, season: state.season, prio, icon, title, text, action, read: false });
  if (state.messages.length > 60) {
    // On élague les plus anciens messages, jamais une décision encore ouverte.
    for (let i = state.messages.length - 1; i >= 0 && state.messages.length > 60; i--) {
      const m = state.messages[i];
      if (!(m.decision && !m.decision.done)) state.messages.splice(i, 1);
    }
  }
}

/** Les messages importants pour l'accueil (3 max). */
export function topMessages(state, n = 3) {
  return state.messages
    .filter((m) => !m.read)
    .sort((a, b) => a.prio - b.prio || (b.season - a.season) || (b.day - a.day))
    .slice(0, n);
}

/* ---------------- Sauvegarde : 3 emplacements, compression gzip ---------------- */

/* Sauvegardes rangées par compte (plusieurs comptes possibles sur un même appareil). */
let acct = '';
const SLOT_KEY = (n) => (acct ? `cdp-${acct}-slot-${n}` : `cdp-slot-${n}`);
const metaKey = () => (acct ? `cdp-${acct}-meta` : 'cdp-meta');
export const lastKey = () => (acct ? `cdp-${acct}-last` : 'cdp-last');
/** Compte connecté : ses emplacements. Le premier compte récupère les sauvegardes d'avant les comptes. */
export function setAccount(id) {
  acct = id ? String(id).replace(/[^a-zA-Z0-9-]/g, '') : '';
  if (!acct || !hasLS()) return;
  try {
    if (!localStorage.getItem(metaKey()) && localStorage.getItem('cdp-meta') && !localStorage.getItem('cdp-legacy-claimed')) {
      for (const n of [1, 2, 3]) { const v = localStorage.getItem(`cdp-slot-${n}`); if (v) localStorage.setItem(SLOT_KEY(n), v); }
      localStorage.setItem(metaKey(), localStorage.getItem('cdp-meta'));
      localStorage.setItem('cdp-legacy-claimed', acct);
    }
  } catch { /* ignore */ }
}
export const SLOTS = [1, 2, 3];
let currentSlot = 1;
export const setSlot = (n) => { currentSlot = n; };
export const getSlot = () => currentSlot;

const hasLS = () => { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch { return false; } };

/** Compression gzip -> base64 (CompressionStream), repli en JSON brut. */
export async function packState(state) {
  const json = JSON.stringify(state);
  if (typeof CompressionStream === 'undefined') return 'json:' + json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'gz:' + btoa(bin);
}

export async function unpackState(raw) {
  if (!raw) return null;
  if (raw.startsWith('json:')) return JSON.parse(raw.slice(5));
  if (raw.startsWith('{')) return JSON.parse(raw);
  const bin = atob(raw.slice(3));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function readMeta() {
  try { return JSON.parse(localStorage.getItem(metaKey()) || '{}'); } catch { return {}; }
}

/** Résumé des emplacements pour l'écran d'accueil. */
export function slotsInfo() {
  if (!hasLS()) return {};
  const meta = readMeta();
  return meta;
}

let saveTimer = null;
let saving = Promise.resolve();
/** Sauvegarde (différée par défaut) dans l'emplacement courant. */
export function save(state, immediate = false) {
  if (!hasLS() || !state) return Promise.resolve();
  state.nextId = getNextId();
  if (state.online) return saveOnline(state, immediate);
  const slot = currentSlot;
  const write = () => (saving = saving.then(async () => {
    try {
      const packed = await packState(state);
      await kvSet(SLOT_KEY(slot), packed);
      const meta = readMeta();
      const club = state.clubs.find((c) => c.id === state.userClubId);
      meta[slot] = { club: club?.name, color: club?.color, color2: club?.color2, short: club?.short, season: state.season, day: state.day, at: Date.now(), size: packed.length };
      localStorage.setItem(metaKey(), JSON.stringify(meta));
      cloudHook?.(slot, meta[slot], packed);
    } catch (e) {
      console.warn('Sauvegarde impossible', e);
    }
  }));
  clearTimeout(saveTimer);
  if (immediate) return write();
  saveTimer = setTimeout(write, 400);
  return Promise.resolve();
}

/**
 * Migrations de format. v2 → v3 : systèmes « vie du club » (presse, vestiaire,
 * propriétaires, relations, sponsors…). Les nouveaux champs sont créés
 * paresseusement par ensureLife() ; on marque seulement la version ici.
 */
export function migrate(s) {
  if (s.version === 2) {
    s.life = s.life || null;      // créé par ensureLife au premier chargement
    s.ownersReady = false;        // propriétaires, ambiance, relations initiales
    for (const m of s.messages || []) if (m.decision === undefined) m.decision = null;
    s.version = 3;
  }
  return s;
}

/** Copie de secours dans le cloud (compte en ligne) : branchée par l'interface. */
let cloudHook = null;
export const setCloudHook = (fn) => { cloudHook = fn; };
/** Écrit une sauvegarde reçue du cloud dans un emplacement local. */
export async function restoreSlot(slot, meta, packed) {
  await kvSet(SLOT_KEY(slot), packed);
  const m = readMeta(); m[slot] = meta; localStorage.setItem(metaKey(), JSON.stringify(m));
}

/** Carrière en ligne : copie locale de la dernière version (reprise rapide, hors emplacements). */
const onlineKey = (gameId) => `cdp-online-${acct}-${gameId}`;
function saveOnline(state, immediate) {
  const write = () => (saving = saving.then(async () => {
    try { await kvSet(onlineKey(state.online.gameId), await packState(state)); } catch (e) { console.warn('Copie locale impossible', e); }
  }));
  clearTimeout(saveTimer);
  if (immediate) return write();
  saveTimer = setTimeout(write, 600);
  return Promise.resolve();
}
export async function loadOnlineCopy(gameId) {
  try { return await unpackState(await kvGet(onlineKey(gameId))); } catch { return null; }
}

/** Valide et prépare un état chargé (version, compteur d'identifiants). */
export function adoptState(s) {
  if (!s || !s.clubs || !s.players || !(s.version >= MIN_SAVE_VERSION && s.version <= SAVE_VERSION)) return null;
  migrate(s);
  applyWorld(s.world || 'fictional', s.worldDivs || (s.world === 'real' ? [1, 2, 3, 4, 5] : null));
  setNextId(s.nextId);
  return s;
}

export async function load(slot = currentSlot) {
  if (!hasLS()) return null;
  try { return adoptState(await unpackState(await kvGet(SLOT_KEY(slot)))); } catch { return null; }
}

export function hasSave(slot = currentSlot) {
  try { return !!readMeta()[slot]; } catch { return false; }
}

export function deleteSave(slot = currentSlot) {
  try {
    kvDel(SLOT_KEY(slot));
    const meta = readMeta(); delete meta[slot]; localStorage.setItem(metaKey(), JSON.stringify(meta));
  } catch { /* ignore */ }
}

/** Fichier d'export : JSON lisible, versionné. */
export function exportFile(state) {
  return JSON.stringify({ format: 'coach-de-poche-save', exportedAt: new Date().toISOString(), state });
}
export function importFile(text) {
  const data = JSON.parse(text);
  return adoptState(data.format === 'coach-de-poche-save' ? data.state : data);
}

/** Nettoyage de l'ancienne sauvegarde v1 (structure incompatible). */
export function legacySave() {
  try { return !!localStorage.getItem('fm-light-save-v1'); } catch { return false; }
}
export function dropLegacy() { try { localStorage.removeItem('fm-light-save-v1'); } catch { /* ignore */ } }

/** Sauvegarde immédiate (l'app passe en arrière-plan) : écriture IndexedDB lancée tout de suite. */
export function saveSync(state) {
  if (!hasLS() || !state) return;
  save(state, true);
}
