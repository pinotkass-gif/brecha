// Brecha · service worker de la versión publicada (https). Lo arma `npm run publicar` (versión y lista de archivos).
// Primero la red (siempre la versión nueva); sin conexión, lo último guardado. Las cotizaciones (DolarAPI) no pasan
// por acá: la app ya guarda su propia copia local con su fecha.
const CACHE = 'brecha-3.3.0-af3f4a00f8';
const ARCHIVOS = ["./","web/","src/engine/bonos.mjs","src/engine/conversion.mjs","src/engine/costos.mjs","src/engine/decimal.mjs","src/engine/escenarios.mjs","src/engine/explicacion.mjs","src/engine/format.mjs","src/engine/inversa.mjs","src/engine/matrix.mjs","src/engine/ranking.mjs","src/engine/route.mjs","src/engine/simple.mjs","src/engine/validate.mjs","src/historial/almacen.mjs","src/historial/capturas.mjs","src/historial/modelo.mjs","src/historico/analisis.mjs","src/historico/fuente.mjs","src/historico/preguntas.mjs","src/pwa/apple-touch-icon.png","src/pwa/icono-192.png","src/pwa/icono-512.png","src/pwa/icono-maskable-512.png","src/pwa/icono.svg","src/pwa/manifest.webmanifest","src/quotes/calendario.mjs","src/quotes/calidad.mjs","src/quotes/cliente.mjs","src/quotes/coherencia.mjs","src/quotes/frescura.mjs","src/quotes/markets.mjs","src/quotes/providers/dolarapi.mjs","src/quotes/providers/index.mjs","src/quotes/store.mjs","src/routes/activos.mjs","src/routes/borrador.mjs","src/routes/combinaciones.mjs","src/routes/condiciones.mjs","src/routes/config.mjs","src/routes/desde-simple.mjs","src/routes/perfil.mjs","src/routes/plataformas.mjs","src/routes/referencias.mjs","src/routes/tiempo.mjs","src/ui/analisis.mjs","src/ui/app.mjs","src/ui/bonos.mjs","src/ui/capturas.mjs","src/ui/chat.mjs","src/ui/comun.mjs","src/ui/historial.mjs","src/ui/oportunidades.mjs","src/ui/plataformas.mjs","src/ui/rutas.mjs","src/ui/styles.css","src/vendor/big.LICENCE.md","src/vendor/big.mjs"];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ARCHIVOS.map((a) => c.add(new Request(a, { cache: 'reload' })).catch(() => { /* se guarda al usarlo */ })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('brecha-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const resp = await fetch(r);
      if (resp.ok && resp.type === 'basic') (await caches.open(CACHE)).put(r, resp.clone());
      return resp;
    } catch {
      const c = await caches.open(CACHE);
      const guardado = (await c.match(r, { ignoreSearch: true }))
        ?? (r.mode === 'navigate' ? await c.match(new URL('./', self.registration.scope).href) : undefined);
      return guardado ?? Response.error();
    }
  })());
});
