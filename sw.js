/**
 * Service worker : jeu jouable hors ligne, mais mises à jour immédiates.
 * Stratégie : RÉSEAU D'ABORD pour les fichiers du jeu (revalidation rapide : le serveur
 * répond « pas modifié » si rien n'a changé), copie locale si le réseau est absent ou trop lent.
 * version.json n'est jamais mis en cache : le jeu s'en sert pour détecter une nouvelle version.
 * VERSION est incrémentée par scripts/update-sw.js à chaque livraison.
 */
const IMG_CACHE = 'cdp-img';
const VERSION = 'cdp-v191';
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
  './js/data/fm27_bel.js',
  './js/data/fm27_eng.js',
  './js/data/fm27_eng2.js',
  './js/data/fm27_esp.js',
  './js/data/fm27_fra.js',
  './js/data/fm27_ita.js',
  './js/data/fm27_ned.js',
  './js/data/fm27_por.js',
  './js/data/generator.js',
  './js/data/logos.js',
  './js/data/names.js',
  './js/data/nations.js',
  './js/data/pressTexts.js',
  './js/data/realWorld.js',
  './js/data/stadiums.js',
  './js/data/top100.js',
  './js/data/top500.js',
  './js/data/world.js',
  './js/engine/ai.js',
  './js/engine/analysis.js',
  './js/engine/body.js',
  './js/engine/commentary.js',
  './js/engine/contact.js',
  './js/engine/diag.js',
  './js/engine/gesture.js',
  './js/engine/intent.js',
  './js/engine/live.js',
  './js/engine/match.js',
  './js/engine/positions.js',
  './js/engine/ratings.js',
  './js/engine/setPlays.js',
  './js/engine/tacticalEdge.js',
  './js/game/afterlife.js',
  './js/game/agents.js',
  './js/game/board.js',
  './js/game/captain.js',
  './js/game/career.js',
  './js/game/chat.js',
  './js/game/coach.js',
  './js/game/cohesion.js',
  './js/game/dataImport.js',
  './js/game/dates.js',
  './js/game/deadline.js',
  './js/game/deals.js',
  './js/game/debrief.js',
  './js/game/drills.js',
  './js/game/economy.js',
  './js/game/fans.js',
  './js/game/fm27.js',
  './js/game/friends.js',
  './js/game/humans.js',
  './js/game/inbox.js',
  './js/game/injuries.js',
  './js/game/international.js',
  './js/game/life.js',
  './js/game/managers.js',
  './js/game/media.js',
  './js/game/needs.js',
  './js/game/negotiate.js',
  './js/game/options.js',
  './js/game/owners.js',
  './js/game/people.js',
  './js/game/physique.js',
  './js/game/preseason.js',
  './js/game/press.js',
  './js/game/progression.js',
  './js/game/ratingsImport.js',
  './js/game/referee.js',
  './js/game/relations.js',
  './js/game/scouting.js',
  './js/game/search.js',
  './js/game/season.js',
  './js/game/stars.js',
  './js/game/state.js',
  './js/game/store.js',
  './js/game/traits.js',
  './js/game/transfers.js',
  './js/game/upgrade.js',
  './js/game/versatility.js',
  './js/game/weather.js',
  './js/game/worker.js',
  './js/i18n.js',
  './js/main.js',
  './js/online/backend.js',
  './js/online/config.js',
  './js/online/duel.js',
  './js/online/mgrTrade.js',
  './js/online/multi.js',
  './js/ui/animSync.js',
  './js/ui/app.js',
  './js/ui/audio.js',
  './js/ui/avatar.js',
  './js/ui/ballPhysics.js',
  './js/ui/broadcast.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/ui/files.js',
  './js/ui/images.js',
  './js/ui/logo.js',
  './js/ui/match3d.js',
  './js/ui/matchView.js',
  './js/ui/mhPlayer.js',
  './js/ui/mocapData.js',
  './js/ui/newspaper.js',
  './js/ui/screens/auth.js',
  './js/ui/screens/club.js',
  './js/ui/screens/clubInfo.js',
  './js/ui/screens/coachEditor.js',
  './js/ui/screens/dayReport.js',
  './js/ui/screens/deadlineUI.js',
  './js/ui/screens/deals.js',
  './js/ui/screens/duelUI.js',
  './js/ui/screens/endSeason.js',
  './js/ui/screens/friends.js',
  './js/ui/screens/home.js',
  './js/ui/screens/inboxUI.js',
  './js/ui/screens/mailbox.js',
  './js/ui/screens/match.js',
  './js/ui/screens/mgrDeals.js',
  './js/ui/screens/negotiation.js',
  './js/ui/screens/online.js',
  './js/ui/screens/playerSheet.js',
  './js/ui/screens/preseasonUI.js',
  './js/ui/screens/schedule.js',
  './js/ui/screens/settings.js',
  './js/ui/screens/squad.js',
  './js/ui/screens/start.js',
  './js/ui/screens/stats.js',
  './js/ui/screens/tactics.js',
  './js/ui/sim.js',
  './js/ui/trophies.js',
  './js/ui/tutorial.js',
  './js/ui/viewport.js',
  './js/vendor/THREE-LICENSE.txt',
  './js/vendor/supabase/591.supabase.js',
  './js/vendor/supabase/LICENSE.txt',
  './js/vendor/supabase/supabase.js',
  './js/vendor/three-post/CopyShader.js',
  './js/vendor/three-post/EffectComposer.js',
  './js/vendor/three-post/LuminosityHighPassShader.js',
  './js/vendor/three-post/MaskPass.js',
  './js/vendor/three-post/OutputPass.js',
  './js/vendor/three-post/OutputShader.js',
  './js/vendor/three-post/Pass.js',
  './js/vendor/three-post/README.txt',
  './js/vendor/three-post/RenderPass.js',
  './js/vendor/three-post/ShaderPass.js',
  './js/vendor/three-post/UnrealBloomPass.js',
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
  const u = new URL(e.request.url);
  if (u.origin === location.origin && u.pathname.endsWith('/version.json')) return; // toujours le réseau
  const mine = u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!mine) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
      return res;
    });
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (!hit) return net;
    // Réseau d'abord ; s'il ne répond pas en 4 s (ou hors ligne), la copie locale.
    const slow = new Promise((r) => setTimeout(() => r(null), 4000));
    try {
      const res = await Promise.race([net, slow]);
      return res || hit;
    } catch { return hit; }
  })());
});
