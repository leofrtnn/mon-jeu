/**
 * Images des clubs et des joueurs (monde réel) : affichées directement depuis
 * Wikipédia / Wikimedia Commons, jamais copiées dans le jeu. Sans connexion, ou si
 * l'image n'existe pas, on retombe sur l'écusson aux couleurs du club / les initiales.
 */
// Tailles « standard » de Wikimedia (vignettes déjà en cache chez eux : chargement rapide, pas de limitation).
export const wikiImg = (file, w = 120) => `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=${w <= 120 ? 120 : 250}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** <img> qui se retire tout seul en cas d'échec (le repli reste visible dessous). */
export function imgTag(file, w, cls = '') {
  return `<img class="${cls}" src="${esc(wikiImg(file, w))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode&&this.parentNode.classList.remove('has-img');this.remove()">`;
}

/** Visage d'un joueur : photo si disponible, sinon initiales aux couleurs du club. */
export function face(p, club, size = '') {
  const ini = `${(p.first || '')[0] || ''}${(p.last || '')[0] || ''}`.toUpperCase();
  const bg = club?.color || '#2a3340', fg = club?.color2 || '#fff';
  return `<span class="face ${size} ${p.photo ? 'has-img' : ''}" style="background:${bg};color:${fg}">${p.photo ? imgTag(p.photo, size === 'lg' ? 240 : 96) : ''}<i>${esc(ini)}</i></span>`;
}
