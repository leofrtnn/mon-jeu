/**
 * Petits composants d'interface (chaînes HTML) : badges, jauges, lignes de joueurs.
 */
import { imgTag, face } from './images.js';
import { POSITION_GROUP } from '../data/constants.js';
import { overall } from '../engine/ratings.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Couleur de texte lisible sur une couleur d'accent. */
export function accentInk(hex) {
  const v = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return l > 0.6 ? '#0d1117' : '#ffffff';
}

/** Couleur d'accent lisible sur fond sombre (couleur 1 ou 2 du club, sinon éclaircie). */
export function clubAccent(club) {
  const lum = (h) => { const v = parseInt(h.slice(1), 16); return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
  const sat = (h) => { const v = parseInt(h.slice(1), 16); const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255; return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
  for (const c of [club.color, club.color2]) if (c && lum(c) > 0.32 && lum(c) < 0.92 && sat(c) > 0.25) return c;
  const v = parseInt(club.color.slice(1), 16);
  const mix = (x) => Math.round(x + (255 - x) * 0.45);
  return '#' + [mix((v >> 16) & 255), mix((v >> 8) & 255), mix(v & 255)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function crest(club, size = '') {
  if (club?.logo) return `<span class="crest ${size} has-img" style="background:${club.color};color:${club.color2}">${imgTag(club.logo, size === 'lg' ? 160 : 80, 'logo')}<i>${esc(club.short)}</i></span>`;
  return `<span class="crest ${size}" style="background:${club.color};color:${club.color2}">${esc(club.short)}</span>`;
}

/* ---------------- Échelle « façon FM » ---------------- */

/** Attribut interne (0-100) → note sur 20. */
export const a20 = (v) => Math.max(1, Math.min(20, Math.round(v / 5)));
/** Couleur d'un attribut sur 20 (comme FM : gris, jaune, vert, vert vif). */
export const color20 = (n) => (n >= 16 ? '#3ddc84' : n >= 13 ? '#9bd35a' : n >= 10 ? '#e3b341' : n >= 6 ? '#d0a060' : '#8b949e');

let STAR_REF = 72;
let starKey = '';
/** Référence des étoiles : niveau moyen des titulaires du championnat de l'utilisateur. */
export function refreshStarRef(state) {
  const uc = state?.clubs?.find((c) => c.id === state.userClubId) || state?.clubs?.[0];
  if (!uc) return;
  const key = `${state.seed}-${state.season}-${state.day}-${uc.div}`;
  if (key === starKey) return;
  starKey = key;
  const tops = state.clubs.filter((c) => c.div === uc.div).map((c) => {
    const o = c.playerIds.map((id) => state.players[id]).filter(Boolean).map(overall).sort((a, b) => b - a).slice(0, 11);
    return o.reduce((a, v) => a + v, 0) / Math.max(1, o.length);
  });
  STAR_REF = tops.reduce((a, v) => a + v, 0) / Math.max(1, tops.length);
}
/** Niveau (actuel ou potentiel) en étoiles, de 0,5 à 5, relatif au championnat (comme FM). */
export const abilityStars = (v) => Math.max(0.5, Math.min(5, Math.round((2.5 + (v - STAR_REF) / 4) * 2) / 2));

/** 5 étoiles avec remplissage partiel (demi-étoiles). */
export function starBar(n, cls = '') {
  return `<span class="starbar ${cls}" title="${String(n).replace('.', ',')} / 5"><span>★★★★★</span><span class="fill" style="width:${n / 5 * 100}%">★★★★★</span></span>`;
}

export function posBadge(pos) {
  return `<span class="posb pos-${POSITION_GROUP[pos]}">${pos}</span>`;
}

/** Niveau d'un joueur : étoiles (plus de note sur 100). */
export function ovrChip(v) {
  return `<span class="stars-chip">${starBar(abilityStars(v))}</span>`;
}

/** Couleur d'une valeur 0-100 (rouge -> vert). */
export function scaleColor(v) {
  if (v >= 70) return 'var(--good)';
  if (v >= 50) return '#9bd35a';
  if (v >= 35) return 'var(--ok)';
  return 'var(--bad)';
}

export function formDot(form) {
  return `<span class="dot" title="Forme" style="background:${scaleColor(form)}"></span>`;
}

export function moraleIcon(m) {
  const sym = m >= 70 ? '▲' : m >= 45 ? '●' : '▼';
  return `<span title="Moral" style="color:${scaleColor(m)};font-size:11px;width:12px;text-align:center">${sym}</span>`;
}

export function condBar(fatigue) {
  const c = 100 - (fatigue || 0);
  return `<span class="mini" title="Condition"><i style="width:${c}%;background:${scaleColor(c)}"></i></span>`;
}

export function gauge(v, color) {
  return `<div class="gauge"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color || scaleColor(v)}"></i></div>`;
}

export function formPills(form) {
  return `<span class="row" style="gap:4px">${(form || []).map((r) => `<span class="pill ${r}">${r}</span>`).join('')}</span>`;
}

/** Badges d'état (blessure, suspension, prêt, liste des transferts). */
export function statusTags(p) {
  const t = [];
  if (p.injury > 0) t.push(`<span class="tag bad" title="${esc(p.injuryName)}">✚ ${p.injury}</span>`);
  if (p.suspended > 0) t.push(`<span class="tag bad">🟥 ${p.suspended}</span>`);
  if (p.onLoanFrom) t.push('<span class="tag">Prêt</span>');
  if (p.listed) t.push('<span class="tag ok">€</span>');
  if (p.contract <= 1 && p.clubId) t.push('<span class="tag ok">Fin</span>');
  return t.join('');
}

/** Ligne de joueur cliquable. */
export function playerRow(p, { act = 'player', extra = '', right = null, dim = false, club = null } = {}) {
  const o = overall(p);
  return `<div class="prow ${dim ? 'dim' : ''}" data-act="${act}" data-id="${p.id}">
    ${p.photo || p.real ? face(p, club) : ''}${posBadge(p.pos)}
    <div class="pname"><b>${esc(p.name)}</b><small>${p.age} ans ${extra}</small></div>
    <div class="icons">${statusTags(p)}${formDot(p.form)}${moraleIcon(p.morale)}${condBar(p.fatigue)}</div>
    ${right ?? ovrChip(o)}
  </div>`;
}

export function ratingChip(r) {
  const c = r >= 8 ? '#2ea043' : r >= 7 ? '#3fb950' : r >= 6.3 ? '#9bd35a' : r >= 5.5 ? '#d29922' : '#f85149';
  return `<span class="rating" style="background:${c};color:#0d1117">${r.toFixed(1)}</span>`;
}

/** Barre de comparaison (stats de match). */
export function cmpBar(label, a, b, colors, fmt = (v) => v) {
  const tot = a + b || 1;
  return `<div class="cmp"><div class="lbl"><b>${fmt(a)}</b><span>${label}</span><b>${fmt(b)}</b></div>
    <div class="bar"><i style="width:${a / tot * 100}%;background:${colors[0]}"></i><i style="width:${b / tot * 100}%;background:${colors[1]}"></i></div></div>`;
}

export function stars(n, max = 5) {
  if (max === 5) return starBar(n);
  return `<span style="color:#e3b341;letter-spacing:1px">${'★'.repeat(Math.round(n))}<span style="color:var(--line)">${'★'.repeat(max - Math.round(n))}</span></span>`;
}

/** Potentiel estimé en étoiles (le recruteur n'est pas infaillible : arrondi). */
export function potentialStars(p) {
  return abilityStars(p.pot);
}

export function seg(name, options, current, labels) {
  return `<div class="seg">${options.map((o) => `<button data-act="${name}" data-v="${o}" class="${o === current ? 'on' : ''}">${esc(labels ? labels[o] : o)}</button>`).join('')}</div>`;
}

export { face };
