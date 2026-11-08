/**
 * MULTIJOUEUR ASYNCHRONE (sans serveur)
 * - Code d'équipe : instantané compressé (compo, tactique, 20 joueurs) à partager.
 * - Défi : match amical contre l'équipe d'un ami.
 * - Ligue entre amis : championnat aller-retour simulé de façon déterministe à partir
 *   des codes. Mêmes codes => mêmes résultats chez tout le monde, sans serveur.
 *
 * Limite assumée : sans serveur, un code peut être modifié à la main ; une somme de
 * contrôle détecte seulement les codes abîmés lors d'un copier-coller.
 */
import { hashSeed, clamp, createRng } from '../core/rng.js';
import { ATTRS, FORMATIONS, MENTALITIES, LEVELS } from '../data/constants.js';
import { userClub, clubPlayers } from './state.js';
import { validateUserLineup, roundRobin } from './season.js';
import { simulateMatch, summarize } from '../engine/match.js';
import { aiPrepare } from '../engine/ai.js';

const PREFIX = 'CDP1-';

async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return 'R' + btoa(unescape(encodeURIComponent(str)));
  const buf = new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return 'Z' + btoa(bin);
}
async function gunzip(s) {
  if (s[0] === 'R') return decodeURIComponent(escape(atob(s.slice(1))));
  const bin = atob(s.slice(1));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
const toUrl = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Le 1er caractère est un drapeau de format (Z = gzip, R = brut), hors base64. */
const fromUrl = (s) => { let b = s.slice(1).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return s[0] + b; };

/** Instantané de l'équipe de l'utilisateur (onze + banc). */
export function snapshotTeam(state) {
  validateUserLineup(state);
  const club = userClub(state);
  const byId = new Map(clubPlayers(state, club).map((p) => [p.id, p]));
  const ids = [...club.lineup, ...club.bench].filter((id) => byId.has(id)).slice(0, 20);
  return {
    v: 1, name: club.name, short: club.short, color: club.color, color2: club.color2,
    tactics: { ...club.tactics }, roles: (club.roles || []).slice(0, 11), nLineup: club.lineup.filter((id) => byId.has(id)).length,
    players: ids.map((id) => { const p = byId.get(id); return [p.name, p.pos, p.age, p.number, ATTRS.map((a) => p.attrs[a])]; }),
  };
}

/** Somme de contrôle (détection d'un code abîmé). */
const checksum = (t) => (hashSeed(JSON.stringify(t.players) + t.name) % 46656).toString(36);

export async function encodeTeam(team) {
  const body = JSON.stringify({ ...team, c: checksum(team) });
  return PREFIX + toUrl((await gzip(body)));
}

/** Décode et valide un code. Lève une erreur lisible si invalide. */
export async function decodeTeam(code) {
  code = (code || '').trim().replace(/\s+/g, '');
  if (!code.startsWith(PREFIX)) throw new Error('Ce n\'est pas un code Coach de Poche.');
  let t;
  try { t = JSON.parse(await gunzip(fromUrl(code.slice(PREFIX.length)))); } catch { throw new Error('Code illisible (incomplet ?).'); }
  if (t.v !== 1 || !Array.isArray(t.players) || t.players.length < 11) throw new Error('Code incomplet.');
  if (t.c !== checksum(t)) throw new Error('Code abîmé (somme de contrôle).');
  if (!FORMATIONS[t.tactics?.formation]) t.tactics = { formation: '4-4-2', mentality: 'balanced', pressing: 'mid', tempo: 'mid', width: 'mid' };
  if (!MENTALITIES.includes(t.tactics.mentality)) t.tactics.mentality = 'balanced';
  for (const k of ['pressing', 'tempo', 'width']) if (!LEVELS.includes(t.tactics[k])) t.tactics[k] = 'mid';
  t.players = t.players.slice(0, 20).map(([name, pos, age, num, attrs]) => [String(name).slice(0, 30), pos, clamp(+age || 25, 15, 45), +num || 0, ATTRS.map((_, i) => clamp(+attrs[i] || 40, 1, 99))]);
  t.name = String(t.name).slice(0, 40); t.short = String(t.short || 'AMI').slice(0, 4);
  t.code = code;
  return t;
}

/** Configuration moteur d'une équipe décodée. baseId évite les collisions d'identifiants. */
export function friendCfg(team, baseId, isAI = true) {
  const players = team.players.map(([name, pos, age, num, attrs], i) => ({
    id: baseId + i, name, pos, age, number: num, attrs: Object.fromEntries(ATTRS.map((a, k) => [a, attrs[k]])),
    form: 50, morale: 65, fatigue: 0, injury: 0, suspended: 0, stats: {},
  }));
  const n = Math.min(11, team.nLineup || 11);
  let lineup = players.slice(0, n).map((p) => p.id);
  let bench = players.slice(n).map((p) => p.id);
  if (lineup.length < 11) { const prep = aiPrepare(players, players, true, createRng(baseId)); lineup = prep.lineup; bench = prep.bench; }
  return {
    club: { id: `F:${baseId}`, name: team.name, short: team.short, color: team.color, color2: team.color2, rep: 70 },
    players, lineup, bench, tactics: { ...team.tactics }, roles: team.roles || [], isAI,
  };
}

/* ---------------- Ligue entre amis ---------------- */

/**
 * Calcule la ligue (aller-retour) à partir des codes, de façon déterministe :
 * codes triés, graine = hachage des codes.
 */
export function computeFriendsLeague(teams) {
  const sorted = teams.slice().sort((a, b) => (a.code < b.code ? -1 : 1));
  const seed = hashSeed(sorted.map((t) => t.code).join('|'));
  const ids = sorted.map((_, i) => i);
  const table = ids.map((i) => ({ i, name: sorted[i].name, short: sorted[i].short, color: sorted[i].color, color2: sorted[i].color2, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  if (sorted.length < 2) return { teams: sorted, table, rounds: [] };
  const list = ids.length % 2 ? [...ids, -1] : ids;
  const rounds = roundRobin(list, createRng(seed)).map((r, ri) => r.filter((f) => f.h >= 0 && f.a >= 0).map((f) => {
    const m = simulateMatch({ seed: hashSeed(`${seed}-${ri}-${f.h}-${f.a}`), home: friendCfg(sorted[f.h], 800000 + f.h * 100), away: friendCfg(sorted[f.a], 800000 + f.a * 100) });
    const s = summarize(m).score;
    for (const [i, gf, ga] of [[f.h, s[0], s[1]], [f.a, s[1], s[0]]]) {
      const r = table[i];
      r.p++; r.gf += gf; r.ga += ga;
      if (gf > ga) { r.w++; r.pts += 3; } else if (gf === ga) { r.d++; r.pts++; } else r.l++;
    }
    return { h: f.h, a: f.a, s };
  }));
  table.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name));
  return { teams: sorted, table, rounds, seed };
}

/** Code de ligue : tous les codes d'équipes en un seul (pour inviter un ami). */
export async function encodeLeague(codes) { return 'CDPL-' + toUrl(await gzip(JSON.stringify(codes))); }
export async function decodeLeague(code) {
  code = (code || '').trim().replace(/\s+/g, '');
  if (!code.startsWith('CDPL-')) throw new Error('Ce n\'est pas un code de ligue.');
  const codes = JSON.parse(await gunzip(fromUrl(code.slice(5))));
  if (!Array.isArray(codes)) throw new Error('Code de ligue invalide.');
  return codes;
}
