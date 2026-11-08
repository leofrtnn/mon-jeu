/**
 * État global de la partie + sauvegarde automatique (localStorage).
 * L'état est un objet JSON simple : facile à sérialiser et à déboguer.
 */
import { createRng, hashSeed } from '../core/rng.js';
import { getNextId, setNextId } from '../data/generator.js';

export const SAVE_VERSION = 2;

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
  if (state.messages.length > 60) state.messages.length = 60;
}

/** Les messages importants pour l'accueil (3 max). */
export function topMessages(state, n = 3) {
  return state.messages
    .filter((m) => !m.read)
    .sort((a, b) => a.prio - b.prio || (b.season - a.season) || (b.day - a.day))
    .slice(0, n);
}

/* ---------------- Sauvegarde : 3 emplacements, compression gzip ---------------- */

const SLOT_KEY = (n) => `cdp-slot-${n}`;
const META_KEY = 'cdp-meta';
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
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}

/** Résumé des emplacements pour l'écran d'accueil. */
export function slotsInfo() {
  if (!hasLS()) return {};
  const meta = readMeta();
  for (const n of SLOTS) if (!localStorage.getItem(SLOT_KEY(n))) delete meta[n];
  return meta;
}

let saveTimer = null;
let saving = Promise.resolve();
/** Sauvegarde (différée par défaut) dans l'emplacement courant. */
export function save(state, immediate = false) {
  if (!hasLS() || !state) return Promise.resolve();
  state.nextId = getNextId();
  const slot = currentSlot;
  const write = () => (saving = saving.then(async () => {
    try {
      const packed = await packState(state);
      localStorage.setItem(SLOT_KEY(slot), packed);
      const meta = readMeta();
      const club = state.clubs.find((c) => c.id === state.userClubId);
      meta[slot] = { club: club?.name, color: club?.color, color2: club?.color2, short: club?.short, season: state.season, day: state.day, at: Date.now(), size: packed.length };
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('Sauvegarde impossible', e);
    }
  }));
  clearTimeout(saveTimer);
  if (immediate) return write();
  saveTimer = setTimeout(write, 400);
  return Promise.resolve();
}

/** Valide et prépare un état chargé (version, compteur d'identifiants). */
export function adoptState(s) {
  if (!s || s.version !== SAVE_VERSION || !s.clubs || !s.players) return null;
  setNextId(s.nextId);
  return s;
}

export async function load(slot = currentSlot) {
  if (!hasLS()) return null;
  try { return adoptState(await unpackState(localStorage.getItem(SLOT_KEY(slot)))); } catch { return null; }
}

export function hasSave(slot = currentSlot) {
  try { return !!localStorage.getItem(SLOT_KEY(slot)); } catch { return false; }
}

export function deleteSave(slot = currentSlot) {
  try {
    localStorage.removeItem(SLOT_KEY(slot));
    const meta = readMeta(); delete meta[slot]; localStorage.setItem(META_KEY, JSON.stringify(meta));
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

/** Sauvegarde synchrone non compressée (fermeture de l'app : pas le temps de compresser). */
export function saveSync(state) {
  if (!hasLS() || !state) return;
  try {
    state.nextId = getNextId();
    localStorage.setItem(SLOT_KEY(currentSlot), 'json:' + JSON.stringify(state));
  } catch (e) { console.warn('Sauvegarde impossible', e); }
}
