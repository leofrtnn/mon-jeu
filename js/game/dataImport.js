/**
 * Import / export des noms (clubs, joueurs) via un fichier JSON.
 * Permet d'utiliser de vrais noms fournis par l'utilisateur (le jeu n'en embarque aucun).
 *
 * Format :
 * {
 *   "clubs": [
 *     { "id": 1, "name": "Mon Club", "short": "MCL", "color": "#e63946", "color2": "#ffffff",
 *       "players": ["Prénom Nom", "Prénom Nom", ...] }
 *   ]
 * }
 * "id" est facultatif (sinon les clubs sont pris dans l'ordre). Les joueurs sont
 * renommés dans l'ordre de l'effectif exporté.
 */
import { clubPlayers } from './state.js';

export function exportNames(state) {
  return {
    format: 'coach-de-poche-noms-v1',
    clubs: state.clubs.map((c) => ({
      id: c.id, name: c.name, short: c.short, color: c.color, color2: c.color2,
      players: clubPlayers(state, c).map((p) => `${p.first} ${p.last}`),
    })),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Applique un fichier de noms. Retourne { ok, clubs, players, errors[] }. */
export function importNames(state, data) {
  const errors = [];
  if (!data || !Array.isArray(data.clubs)) return { ok: false, clubs: 0, players: 0, errors: ['Champ "clubs" manquant.'] };
  let nc = 0, np = 0;
  data.clubs.forEach((src, i) => {
    const club = src.id != null ? state.clubs.find((c) => c.id === src.id) : state.clubs[i];
    if (!club) { errors.push(`Club ${i + 1} introuvable.`); return; }
    if (typeof src.name === 'string' && src.name.trim()) { club.name = src.name.trim().slice(0, 40); nc++; }
    if (typeof src.short === 'string' && src.short.trim()) club.short = src.short.trim().toUpperCase().slice(0, 4);
    if (HEX.test(src.color || '')) club.color = src.color;
    if (HEX.test(src.color2 || '')) club.color2 = src.color2;
    if (Array.isArray(src.players)) {
      const squad = clubPlayers(state, club);
      src.players.forEach((full, k) => {
        const p = squad[k];
        if (!p || typeof full !== 'string' || !full.trim()) return;
        const parts = full.trim().split(/\s+/);
        p.first = parts.length > 1 ? parts[0] : '';
        p.last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        p.name = p.first ? `${p.first[0]}. ${p.last}` : p.last;
        np++;
      });
    }
  });
  return { ok: nc + np > 0, clubs: nc, players: np, errors };
}
