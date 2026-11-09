import { APP_VERSION } from './version.js';
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
  // Un nouveau service worker a pris la main : on recharge une fois (fichiers à jour).
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (app.state?.userClubId) saveSync(app.state);
    location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update(); setInterval(() => reg.update(), 5 * 60 * 1000); })
    .catch(() => {}));
}

/*
 * MISES À JOUR IMMÉDIATES ET OBLIGATOIRES : le jeu lit version.json (jamais en cache) au
 * démarrage, au retour dans l'appli et toutes les 30 s. Si une version plus récente est en
 * ligne, il sauvegarde et redémarre tout seul (après le match en cours, le cas échéant).
 */
let updating = false;
async function checkUpdate() {
  if (updating || location.protocol === 'file:' || !navigator.onLine) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (+v > APP_VERSION) forceUpdate(+v);
  } catch { /* hors ligne : on réessaiera */ }
}
function forceUpdate(v) {
  if (updating) return;
  // Pas en plein match : on attend qu'il se termine.
  if (document.querySelector('.match-screen')) { setTimeout(() => forceUpdate(v), 5000); return; }
  // Garde-fou : si le serveur sert déjà version.json mais pas encore les nouveaux fichiers,
  // on ne redémarre pas en boucle (3 essais par version, puis nouvel essai 2 min plus tard).
  let tries = {};
  try { tries = JSON.parse(sessionStorage.getItem('cdp-upd') || '{}'); } catch { /* ignore */ }
  const t = tries[v] || { n: 0, at: 0 };
  if (t.n >= 3 && Date.now() - t.at < 120000) return;
  if (t.n >= 3) t.n = 0;
  tries[v] = { n: t.n + 1, at: Date.now() };
  try { sessionStorage.setItem('cdp-upd', JSON.stringify(tries)); } catch { /* ignore */ }
  updating = true;
  try { if (app.state?.userClubId) saveSync(app.state); } catch { /* ignore */ }
  const o = document.createElement('div');
  o.id = 'updating';
  o.innerHTML = `<div class="spinner"></div><b>Mise à jour vers la version ${v}…</b><small>Votre partie est sauvegardée. Le jeu redémarre.</small>`;
  document.body.appendChild(o);
  (async () => {
    try {
      // On jette les anciens fichiers du jeu (les logos et photos sont gardés) puis on recharge.
      for (const k of await caches.keys()) if (k !== 'cdp-img') await caches.delete(k);
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    } catch { /* ignore */ }
    setTimeout(() => location.reload(), 600);
  })();
}
checkUpdate();
setInterval(checkUpdate, 30 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
window.addEventListener('focus', checkUpdate);
window.addEventListener('online', checkUpdate);

// Exposé pour le débogage depuis la console.
window.__app = app;
