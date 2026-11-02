/* Tanque ya: service worker. Guarda la app para que abra rápido y sin conexión. */
var CACHE = "tanqueya-v1";
var SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/css/app.css", "assets/js/app.js", "assets/js/store.js",
  "assets/img/icon.svg", "assets/img/icon-192.png",
  "data/venezuela-outline.js", "data/demo-stations.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/markercluster/leaflet.markercluster.js", "vendor/markercluster/MarkerCluster.css",
  "vendor/qrcode/qrcode.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Archivos propios: primero la red (para recibir actualizaciones) y, si no hay, la copia guardada.
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (r) { return r || caches.match("index.html"); });
    })
  );
});
