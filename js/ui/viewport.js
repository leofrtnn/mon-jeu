/**
 * AFFICHAGE : orientation, échelle et mode PC.
 *
 * - Téléphone en paysage : l'écran ne fait que ~390 px de haut ; on dézoome la page
 *   (méta viewport) pour l'afficher comme sur un écran d'environ 550 px de haut.
 * - Téléphone tenu à la verticale : Safari ne permet pas de bloquer la rotation, alors le
 *   jeu se pivote lui-même de 90° (classe « rot ») et reste à l'horizontale.
 * - PC (souris, grand écran) : classe « pc » (survols, raccourcis clavier, mise en page large).
 *
 * Le CSS ne s'appuie pas sur les requêtes « orientation » mais sur les classes posées ici
 * (land, short, narrow, rot, pc) et sur --W / --H, la taille de l'écran telle que le jeu la voit.
 */
const KEY = 'cdp-display';
export function displayMode() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}
export function setDisplayMode(m) {
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  fitViewport();
}

const coarse = () => window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches;
let rotated = false;
let H0 = 0; // hauteur du corps pivoté (= largeur réelle de la fenêtre)

export function fitViewport() {
  const meta = document.querySelector('meta[name=viewport]');
  const mode = displayMode();
  const touch = mode === 'pc' ? false : mode === 'mobile' ? true : coarse();
  const short = Math.min(screen.width, screen.height);
  // Échelle : téléphones seulement (sur PC et tablette, taille réelle).
  const scale = touch && short < 600 ? Math.max(0.66, Math.min(1, Math.round((short / 550) * 100) / 100)) : 1;
  const content = `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover`;
  if (meta && meta.getAttribute('content') !== content) meta.setAttribute('content', content);
  const vw = window.innerWidth, vh = window.innerHeight;
  rotated = touch && vh > vw;               // tenu à la verticale : on pivote le jeu
  const W = rotated ? vh : vw, H = rotated ? vw : vh;
  H0 = H;
  const el = document.documentElement;
  el.style.setProperty('--W', `${W}px`);
  el.style.setProperty('--H', `${H}px`);
  el.style.setProperty('--ui-scale', String(scale));
  el.classList.toggle('rot', rotated);
  el.classList.toggle('land', W >= 640 && W > H * 1.05 || rotated);
  el.classList.toggle('short', H <= 520);
  el.classList.toggle('narrow', W <= 1100);
  el.classList.toggle('pc', !touch && W >= 1000);
  el.classList.toggle('ask-rotate', false);
}

/** Le jeu est-il pivoté (téléphone tenu droit) ? */
export const isRotated = () => rotated;

/** Point écran (clientX/Y) → coordonnées dans le repère du jeu (pivoté ou non). */
export function toLocal(x, y) {
  return rotated ? { x: y, y: H0 - x } : { x, y };
}

/** Rectangle d'un élément dans le repère du jeu. */
export function localRect(el) {
  const r = el.getBoundingClientRect();
  if (!rotated) return r;
  const left = r.top, top = H0 - r.right, width = r.height, height = r.width;
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

/** Remonte l'écran en haut (la page, ou #app quand le jeu est pivoté). */
export function scrollTop(smooth = false) {
  const target = rotated ? document.getElementById('app') : window;
  target?.scrollTo?.({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

export function watchViewport() {
  fitViewport();
  const again = () => { fitViewport(); setTimeout(fitViewport, 300); };
  window.addEventListener('orientationchange', () => setTimeout(again, 120));
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
}
