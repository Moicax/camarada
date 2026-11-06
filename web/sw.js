// Service worker: abre o app sem internet e mostra as notificações.
const VERSAO = 'camarada-v12';
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'api.js', 'config.js', 'icones.js',
  'lib/dates.js', 'lib/tasks.js', 'lib/finance.js', 'lib/camarada.js', 'lib/contas.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== VERSAO) await caches.delete(nome);
    await self.clients.claim();
  })());
});

// Arquivos do app: tenta a rede primeiro (para pegar atualizações) e usa o cache sem internet.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const resposta = await fetch(e.request);
      if (resposta.ok) (await caches.open(VERSAO)).put(e.request, resposta.clone());
      return resposta;
    } catch {
      return (await caches.match(e.request)) || (await caches.match('index.html'));
    }
  })());
});

self.addEventListener('push', (e) => {
  let dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch { dados = { titulo: 'Camarada', corpo: e.data?.text() }; }
  e.waitUntil((async () => {
    if (typeof dados.badge === 'number') {
      try {
        if (dados.badge > 0) await self.navigator.setAppBadge(dados.badge);
        else await self.navigator.clearAppBadge();
      } catch { /* sem suporte */ }
    }
    await self.registration.showNotification(dados.titulo || 'Camarada', {
      body: dados.corpo || '',
      icon: 'icons/icon-192.png',
      tag: dados.tag,
      data: { url: dados.url || './' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || './', self.registration.scope);
  const tela = destino.hash.slice(1);
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if ('focus' in j) {
        await j.focus();
        if (tela) j.postMessage({ tipo: 'abrir', tela });
        return;
      }
    }
    await self.clients.openWindow(destino.href);
  })());
});
