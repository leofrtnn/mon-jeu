/**
 * Point d'entrée : démarrage de l'interface, reprise du dernier emplacement,
 * enregistrement du service worker (hors ligne).
 */
import { app } from './ui/app.js';
import { watchViewport } from './ui/viewport.js';

watchViewport();
import { load, setSlot, saveSync, setAccount, lastKey, setCloudHook, claimDeviceSaves } from './game/state.js';
import { getBackend } from './online/backend.js';

app.init();
(async () => {
  // Compte obligatoire : on récupère la session (Supabase, ou comptes locaux en repli).
  try { app.backend = await getBackend(); app.user = await app.backend.user(); } catch (e) { console.warn(e); app.user = null; }
  // Compte en ligne : copie de chaque emplacement dans le cloud (au plus toutes les 3 minutes).
  if (app.backend?.kind === 'supabase') {
    const last = {};
    setCloudHook((slot, meta, packed) => {
      if (Date.now() - (last[slot] || 0) < 180000) return;
      last[slot] = Date.now();
      app.backend.putSave(slot, meta, packed).catch((e) => console.warn('Sauvegarde cloud', e));
    });
  }
  if (app.user) {
    setAccount(app.user.id);
    if (app.backend?.kind === 'supabase') await claimDeviceSaves(app.user.id);
    let last = 1;
    try { last = +(localStorage.getItem(lastKey()) || 1); } catch { /* ignore */ }
    const saved = await load(last);
    if (saved && saved.userClubId && !saved.online) { setSlot(last); app.state = saved; }
  }
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
