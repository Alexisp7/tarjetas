// Guarda la app en el dispositivo para que funcione sin internet.
// Siempre intenta descargar la última versión; si no hay conexión, usa la guardada.
const CACHE = 'tarjetas-v1';
const ARCHIVOS = [
  './', 'index.html', 'app.css', 'app.js', 'estilo.css', 'mazos.json',
  'manifest.webmanifest', 'icono-180.png', 'icono-192.png', 'icono-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((claves) =>
    Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
