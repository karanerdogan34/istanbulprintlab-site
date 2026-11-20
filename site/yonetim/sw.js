// Yalnızca uygulamanın kendi dosyalarını saklar; içerik ve GitHub istekleri hiçbir zaman önbelleğe alınmaz.
// Ağ önce: internet varken her zaman en yeni sürüm açılır, yoksa aynı dosyanın son kayıtlı sürümü açılır.
const AD = 'ipl-yonetim-v6';
const DOSYALAR = ['/yonetim/', '/yonetim/app.js?v=5', '/yonetim/app.css?v=5', '/yonetim/manifest.webmanifest', '/yonetim/ikon-192.png'];

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
    }).catch(async () => {
      const r = await caches.match(e.request);
      if (r) return r;
      // Sayfa yerine yalnızca sayfa isteklerinde ana ekran döner; betik/stil için asla HTML döndürülmez.
      if (e.request.mode === 'navigate') return (await caches.match('/yonetim/')) || Response.error();
      return Response.error();
    })
  );
});
