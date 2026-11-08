/**
 * Point d'entrée : démarrage de l'interface et enregistrement du service worker (hors ligne).
 */
import { app } from './ui/app.js';
import { load } from './game/state.js';

app.init();
const saved = load();
if (saved && saved.userClubId) app.state = saved;
app.render();

// Sauvegarde de sécurité quand l'app passe en arrière-plan.
document.addEventListener('visibilitychange', () => { if (document.hidden) app.save(true); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// Exposé pour le débogage depuis la console.
window.__app = app;
