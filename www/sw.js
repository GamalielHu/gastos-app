// Guarda la app en el dispositivo para que abra sin internet.
// Los datos los guarda Firebase por su cuenta; aquí solo van los archivos.
const VERSION = 'cc-__BUILD__';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/main.js', 'js/util.js', 'js/pie.js', 'js/icons.js',
  'js/local-backend.js', 'js/firebase-config.js', 'js/firebase-backend.js', 'js/xlsx-lector.js', 'js/nativo.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (para recibir versiones nuevas); si no hay conexión, usa lo guardado.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
