/**
 * Point d'entrée : démarrage de l'interface, reprise du dernier emplacement,
 * enregistrement du service worker (hors ligne).
 */
import { app } from './ui/app.js';
import { load, setSlot, saveSync } from './game/state.js';

app.init();
(async () => {
  let last = 1;
  try { last = +(localStorage.getItem('cdp-last') || 1); } catch { /* ignore */ }
  const saved = await load(last);
  if (saved && saved.userClubId) { setSlot(last); app.state = saved; }
  app.render();
})();

// Sauvegarde de sécurité quand l'app passe en arrière-plan.
document.addEventListener('visibilitychange', () => { if (document.hidden && app.state?.userClubId) saveSync(app.state); else if (!document.hidden) app.save(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Mise à jour : dès qu'une nouvelle version est installée, on recharge la page une fois.
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (app.state?.userClubId) saveSync(app.state);
    location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update(); setInterval(() => reg.update(), 60 * 60 * 1000); })
    .catch(() => {}));
}

// Exposé pour le débogage depuis la console.
window.__app = app;
