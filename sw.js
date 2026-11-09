/**
 * Service worker : met en cache l'application pour un jeu 100 % hors ligne.
 * Stratégie : cache d'abord, puis réseau (et mise à jour du cache en arrière-plan).
 * Pensez à incrémenter VERSION à chaque livraison.
 */
const IMG_CACHE = 'cdp-img';
const VERSION = 'cdp-v27';
const ASSETS = [
  './',
  './css/style.css',
  './data/real-world.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './index.html',
  './js/core/rng.js',
  './js/data/balance.js',
  './js/data/constants.js',
  './js/data/generator.js',
  './js/data/names.js',
  './js/data/pressTexts.js',
  './js/data/realWorld.js',
  './js/data/world.js',
  './js/engine/ai.js',
  './js/engine/commentary.js',
  './js/engine/match.js',
  './js/engine/positions.js',
  './js/engine/ratings.js',
  './js/game/agents.js',
  './js/game/board.js',
  './js/game/career.js',
  './js/game/coach.js',
  './js/game/dataImport.js',
  './js/game/dates.js',
  './js/game/deadline.js',
  './js/game/economy.js',
  './js/game/fans.js',
  './js/game/friends.js',
  './js/game/humans.js',
  './js/game/inbox.js',
  './js/game/injuries.js',
  './js/game/life.js',
  './js/game/managers.js',
  './js/game/media.js',
  './js/game/owners.js',
  './js/game/people.js',
  './js/game/preseason.js',
  './js/game/press.js',
  './js/game/progression.js',
  './js/game/relations.js',
  './js/game/scouting.js',
  './js/game/season.js',
  './js/game/state.js',
  './js/game/store.js',
  './js/game/transfers.js',
  './js/game/worker.js',
  './js/main.js',
  './js/online/backend.js',
  './js/online/config.js',
  './js/online/multi.js',
  './js/ui/app.js',
  './js/ui/audio.js',
  './js/ui/avatar.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/ui/files.js',
  './js/ui/images.js',
  './js/ui/match3d.js',
  './js/ui/matchView.js',
  './js/ui/screens/auth.js',
  './js/ui/screens/club.js',
  './js/ui/screens/clubInfo.js',
  './js/ui/screens/coachEditor.js',
  './js/ui/screens/dayReport.js',
  './js/ui/screens/deadlineUI.js',
  './js/ui/screens/endSeason.js',
  './js/ui/screens/friends.js',
  './js/ui/screens/home.js',
  './js/ui/screens/inboxUI.js',
  './js/ui/screens/match.js',
  './js/ui/screens/negotiation.js',
  './js/ui/screens/online.js',
  './js/ui/screens/playerSheet.js',
  './js/ui/screens/preseasonUI.js',
  './js/ui/screens/schedule.js',
  './js/ui/screens/settings.js',
  './js/ui/screens/squad.js',
  './js/ui/screens/start.js',
  './js/ui/screens/tactics.js',
  './js/ui/sim.js',
  './js/ui/viewport.js',
  './js/vendor/THREE-LICENSE.txt',
  './js/vendor/supabase/591.supabase.js',
  './js/vendor/supabase/LICENSE.txt',
  './js/vendor/supabase/supabase.js',
  './js/vendor/three.module.min.js',
  './js/version.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' : on contourne le cache HTTP du navigateur pour ne jamais remettre d'anciens fichiers.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== IMG_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
  // NB : le cache des images (logos, photos) « cdp-img » est conservé d'une version à l'autre.
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Logos et photos (Wikimedia) : cache d'abord, gardé sur l'appareil.
  if (new URL(e.request.url).hostname === 'upload.wikimedia.org') {
    e.respondWith(caches.open(IMG_CACHE).then((c) => c.match(e.request, { ignoreVary: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
        const u = new URL(e.request.url);
        if (res && (res.ok || res.type === 'opaque') && (u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
