// Deixa o app abrir sem internet (busca sempre a versão nova e, se falhar, usa a cópia guardada)
// e mostra as notificações que o servidor manda. Os dados (/api) nunca passam pelo cache.
const CACHE = 'camarada-v7';
const BASE = ['./', 'index.html', 'estilo.css', 'app.js', 'regras.js', 'manifest.webmanifest', 'icones/icone-180.png', 'icones/icone-192.png', 'icones/icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(m.titulo || 'Camarada', {
      body: m.texto || '',
      icon: 'icones/icone-192.png',
      badge: 'icones/icone-192.png',
      tag: m.tag || undefined,
      data: { url: m.url || './' }
    }),
    atualizarSelo(m.contagem)
  ]));
});

// Número vermelho no ícone do app: quantas tarefas estão em A expirar.
function atualizarSelo(n) {
  if (typeof n !== 'number' || !self.navigator.setAppBadge) return Promise.resolve();
  return (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
}

// Tocar na notificação abre o app na tela certa. Se ele já estiver aberto, traz para frente
// e avisa o app por mensagem para trocar de tela (só dar foco não mudava nada).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
    const aberta = janelas.find(j => 'focus' in j);
    if (!aberta) return self.clients.openWindow(destino);
    aberta.postMessage({ abrir: destino });
    return aberta.focus();
  }));
});
