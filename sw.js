/**
 * Service worker : met en cache l'application pour un jeu 100 % hors ligne.
 * Stratégie : cache d'abord, puis réseau (et mise à jour du cache en arrière-plan).
 * Pensez à incrémenter VERSION à chaque livraison.
 */
const VERSION = 'cdp-v4';
const ASSETS = [
  './',
  './css/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './index.html',
  './js/core/rng.js',
  './js/data/constants.js',
  './js/data/generator.js',
  './js/data/names.js',
  './js/data/world.js',
  './js/engine/ai.js',
  './js/engine/commentary.js',
  './js/engine/match.js',
  './js/engine/positions.js',
  './js/engine/ratings.js',
  './js/game/career.js',
  './js/game/dataImport.js',
  './js/game/economy.js',
  './js/game/friends.js',
  './js/game/progression.js',
  './js/game/scouting.js',
  './js/game/season.js',
  './js/game/state.js',
  './js/game/transfers.js',
  './js/game/worker.js',
  './js/main.js',
  './js/ui/app.js',
  './js/ui/audio.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/ui/files.js',
  './js/ui/matchView.js',
  './js/ui/screens/club.js',
  './js/ui/screens/dayReport.js',
  './js/ui/screens/endSeason.js',
  './js/ui/screens/friends.js',
  './js/ui/screens/home.js',
  './js/ui/screens/match.js',
  './js/ui/screens/negotiation.js',
  './js/ui/screens/playerSheet.js',
  './js/ui/screens/schedule.js',
  './js/ui/screens/settings.js',
  './js/ui/screens/squad.js',
  './js/ui/screens/start.js',
  './js/ui/screens/tactics.js',
  './js/ui/sim.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
