/**
 * Téléphones en paysage : l'écran ne fait que ~390 px de haut, l'interface paraissait
 * « zoomée ». On dézoome la page (méta viewport) pour l'afficher comme sur un écran
 * d'environ 550 px de haut : plus d'informations visibles, textes encore lisibles.
 */
export function fitViewport() {
  const meta = document.querySelector('meta[name=viewport]');
  if (!meta) return;
  const short = Math.min(screen.width, screen.height);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? window.innerWidth > window.innerHeight;
  const scale = coarse && landscape && short < 600 ? Math.max(0.66, Math.min(1, Math.round((short / 550) * 100) / 100)) : 1;
  const content = `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover`;
  if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export function watchViewport() {
  fitViewport();
  window.addEventListener('orientationchange', () => setTimeout(fitViewport, 250));
  window.addEventListener('resize', () => fitViewport());
}
