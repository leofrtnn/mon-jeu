/**
 * Images des clubs et des joueurs (monde réel), affichées depuis Wikimedia — jamais
 * copiées dans le dépôt. Pour qu'elles restent affichées en permanence (y compris hors
 * ligne), on vise directement les vignettes de upload.wikimedia.org (adresse stable,
 * calculée comme MediaWiki : md5 du nom de fichier), que le service worker garde en cache
 * sur l'appareil. Repli : ancienne adresse Special:FilePath, puis écusson / initiales.
 */

/* MD5 compact (adresses de vignettes MediaWiki). */
function md5(str) {
  const bytes = new TextEncoder().encode(str);
  const n = ((bytes.length + 8) >>> 6) + 1;
  const w = new Uint32Array(n * 16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  w[n * 16 - 2] = bytes.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const T = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < w.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      const x = (a + f + T[i] + w[o + g]) >>> 0;
      const sft = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << sft) | (x >>> (32 - sft)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_, k) => ((v >>> (k * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

const norm = (file) => String(file).trim().replace(/ /g, '_');
const enc = (s) => encodeURIComponent(s).replace(/%2C/g, ',');

/** Vignette directe : wiki = 'en' (logos, souvent non libres) ou 'commons' (photos). */
export function thumbUrl(file, w, wiki) {
  const name = norm(file);
  const h = md5(name);
  const thumb = `${w}px-${name}${/\.svg$/i.test(name) ? '.png' : ''}`;
  return `https://upload.wikimedia.org/wikipedia/${wiki}/thumb/${h[0]}/${h.slice(0, 2)}/${enc(name)}/${enc(thumb)}`;
}
/** Repli : redirection Wikipédia (fonctionne pour tous les fichiers, mais moins fiable). */
export const filePathUrl = (file, w) => `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(norm(file))}?width=${w}`;

const size = (w) => (w <= 120 ? 120 : 250); // tailles « standard » déjà générées par Wikimedia
const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** <img> avec deux sources de secours ; s'il échoue tout à fait, il se retire (le repli reste visible). */
export function imgTag(file, w, kind = 'logo') {
  const s = size(w);
  const first = thumbUrl(file, s, kind === 'logo' ? 'en' : 'commons');
  const second = kind === 'logo' ? thumbUrl(file, s, 'commons') : filePathUrl(file, s);
  return `<img src="${escAttr(first)}" data-alt="${escAttr(second)}" data-alt2="${escAttr(filePathUrl(file, s))}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer"
    onload="this.classList.add(this.naturalHeight>this.naturalWidth*1.15?'tall':this.naturalWidth>this.naturalHeight*1.15?'wide':'sq');this.parentNode&&this.parentNode.classList.add('img-ok')"
    onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=this.dataset.alt2||'';this.dataset.alt2=''}else{this.remove()}">`;
}

/** Visage d'un joueur : photo si disponible, sinon initiales aux couleurs du club. */
export function face(p, club, sz = '') {
  const ini = `${(p.first || '')[0] || ''}${(p.last || '')[0] || ''}`.toUpperCase();
  const bg = club?.color || '#2a3340', fg = club?.color2 || '#fff';
  return `<span class="face ${sz} ${p.photo ? 'has-img' : ''}" style="background:${bg};color:${fg}">${p.photo ? imgTag(p.photo, 250, 'photo') : ''}<i>${escAttr(ini)}</i></span>`;
}

/**
 * Télécharge une fois tous les logos du monde réel pour qu'ils soient dans le cache de
 * l'appareil (affichage immédiat, même hors ligne). Discret : 4 à la fois, en arrière-plan.
 */
export async function prefetchLogos(clubs) {
  if (typeof fetch === 'undefined' || !navigator.onLine) return 0;
  const files = clubs.filter((c) => c.logo).map((c) => c.logo);
  let ok = 0;
  const one = async (f) => {
    for (const url of [thumbUrl(f, 120, 'en'), thumbUrl(f, 120, 'commons')]) {
      try { const r = await fetch(url, { mode: 'cors' }); if (r.ok) { ok++; return; } } catch { /* suivant */ }
    }
  };
  for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(one));
  return ok;
}
