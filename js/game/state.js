/**
 * État global de la partie + sauvegarde automatique (localStorage).
 * L'état est un objet JSON simple : facile à sérialiser et à déboguer.
 */
import { createRng, hashSeed } from '../core/rng.js';
import { getNextId, setNextId } from '../data/generator.js';

const SAVE_KEY = 'fm-light-save-v1';
export const SAVE_VERSION = 1;

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

/* ---------------- Sauvegarde ---------------- */

let saveTimer = null;
export function save(state, immediate = false) {
  if (typeof localStorage === 'undefined') return;
  state.nextId = getNextId();
  const write = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Sauvegarde impossible', e);
    }
  };
  clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = setTimeout(write, 300);
}

export function load() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.version !== SAVE_VERSION) return null;
    setNextId(s.nextId);
    return s;
  } catch {
    return null;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
