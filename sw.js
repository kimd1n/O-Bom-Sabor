/* O Bom Sabor — service worker (v10). Muda CACHE a cada versão para forçar atualização. */
const CACHE = 'bomsabor-v11';
const LOCAIS = ['./', './index.html', './calculos.js', './manifest.webmanifest', './icon-192x192.png', './icon-512x512.png'];
const XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // um arquivo faltando não derruba a instalação
    return Promise.all(LOCAIS.concat([XLSX]).map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Biblioteca de Excel: cache primeiro (versão fixa)
  if (req.url === XLSX) {
    e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
    return;
  }
  // Qualquer outro site (ex.: Google Apps Script da sincronização) passa direto, sem cache
  if (url.origin !== location.origin) return;

  // Páginas: rede primeiro (pega versão nova), cache se estiver offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      const copia = res.clone();
      caches.open(CACHE).then(function (c) { c.put('./index.html', copia); });
      return res;
    }).catch(function () { return caches.match('./index.html'); }));
    return;
  }
  // Ícones e manifest: cache, atualizando em segundo plano
  e.respondWith(caches.match(req).then(function (r) {
    const rede = fetch(req).then(function (res) {
      const copia = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copia); });
      return res;
    }).catch(function () { return r; });
    return r || rede;
  }));
});
