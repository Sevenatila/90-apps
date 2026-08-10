const BASE  = "./";
const CACHE = "eva-jejum_intermitente_es-v1";
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([BASE])).catch(()=>{}));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url; try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;             // cross-origin → browser
  if (url.pathname.indexOf('/api/validar.php') === 0) return;  // NUNCA cachear validação de domínio
  if (e.request.mode === 'navigate') {
    // network-first, sem cachear o HTML (respeita gate de assinatura/licença ao vivo);
    // offline → shell cacheado no install
    e.respondWith(fetch(e.request).catch(() => caches.match(BASE)));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => {
    if (r && r.status === 200 && (url.pathname.endsWith('.png') || url.pathname.endsWith('manifest.json'))) {
      const cc = r.clone(); caches.open(CACHE).then(x => x.put(e.request, cc));
    }
    return r;
  })));
});
