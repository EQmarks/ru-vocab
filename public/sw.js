// public/sw.js — Service Worker：应用壳缓存优先，词库网络优先。
// 只处理同源 GET；api.github.com 等跨域请求完全不拦截。

const VERSION = 'v1.0.0';
const SHELL_CACHE = 'rv-shell-' + VERSION;
const DATA_CACHE = 'rv-data-' + VERSION;
const DATA_PATH = '/data/words.json';

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/audio.js',
  './js/store.js',
  './js/srs.js',
  './js/sync.js',
  './js/sync-ui.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 逐个缓存：个别文件缺失（例如图标还没生成）不影响整体安装。
    await Promise.all(SHELL_ASSETS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api.github.com') === 0) return;

  if (url.pathname.slice(-DATA_PATH.length) === DATA_PATH) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (err) {
    if (cached) return cached;
    return new Response('离线且未缓存', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.open(SHELL_CACHE);
      const index = await shell.match(fallbackUrl, { ignoreSearch: true });
      if (index) return index;
    }
    return new Response('离线且无缓存，请联网后重试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
