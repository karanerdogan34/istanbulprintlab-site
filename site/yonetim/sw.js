// Yalnızca uygulamanın kendi dosyalarını saklar; içerik ve GitHub istekleri hiçbir zaman önbelleğe alınmaz.
// Ağ önce: internet varken her zaman en yeni sürüm açılır, yoksa son kayıtlı sürüm açılır.
const AD = 'ipl-yonetim-v1';
const DOSYALAR = ['/yonetim/', '/yonetim/app.js?v=1', '/yonetim/app.css?v=1', '/yonetim/manifest.webmanifest', '/yonetim/ikon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(AD).then((c) => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== AD).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith('/yonetim/') || u.pathname.endsWith('surum.json')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const k = r.clone(); caches.open(AD).then((c) => c.put(e.request, k)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/yonetim/')))
  );
});
