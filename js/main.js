import { APP_VERSION } from './version.js';
/**
 * Point d'entrée : démarrage de l'interface, reprise du dernier emplacement,
 * enregistrement du service worker (hors ligne).
 */
import { app } from './ui/app.js';
import { installI18n } from './i18n.js';
import { watchViewport } from './ui/viewport.js';

watchViewport();
import { load, setSlot, saveSync, setAccount, lastKey, setCloudHook, claimDeviceSaves } from './game/state.js';
import { getBackend } from './online/backend.js';

app.init();
installI18n(); // langue choisie (traduction de l'interface à la volée)
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
  // Jamais en plein match : on attend la fin du match pour recharger (sinon la partie serait coupée).
  const reloadWhenIdle = () => {
    if (document.querySelector('.match-screen')) { setTimeout(reloadWhenIdle, 5000); return; }
    if (app.state?.userClubId) saveSync(app.state);
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    // Garde-fou anti-boucle : au plus un rechargement automatique par minute.
    let last = 0;
    try { last = +localStorage.getItem('cdp-swreload') || 0; } catch { /* ignore */ }
    if (Date.now() - last < 60000) return;
    try { localStorage.setItem('cdp-swreload', String(Date.now())); } catch { /* ignore */ }
    reloadWhenIdle();
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
  // Garde-fou anti-boucle : UN SEUL redémarrage automatique par version. L'hébergeur garde
  // parfois les anciens fichiers en cache quelques minutes : au lieu de recharger en boucle,
  // on affiche un petit bandeau « mise à jour disponible » (la partie continue normalement).
  let done = null;
  try { done = localStorage.getItem('cdp-upd-v'); } catch { /* ignore */ }
  if (done === String(v)) { updateBanner(v); return; }
  try { localStorage.setItem('cdp-upd-v', String(v)); } catch { /* ignore */ }
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
/** Bandeau discret : mise à jour prête, l'utilisateur recharge quand il veut. */
function updateBanner(v) {
  if (document.getElementById('upd-banner') || document.querySelector('.match-screen')) return;
  const b = document.createElement('button');
  b.id = 'upd-banner';
  b.textContent = `⬆ Version ${v} disponible · toucher pour mettre à jour`;
  b.onclick = () => { try { if (app.state?.userClubId) saveSync(app.state); } catch { /* ignore */ } location.reload(); };
  document.body.appendChild(b);
}
checkUpdate();
setInterval(checkUpdate, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
window.addEventListener('focus', checkUpdate);
window.addEventListener('online', checkUpdate);

// Exposé pour le débogage depuis la console.
window.__app = app;
