// public/sw.js — Service Worker：静态资源先缓存、后台更新；导航与词库网络优先。
// 只处理同源 GET；api.github.com 等跨域请求完全不拦截。

const VERSION = 'v1.0.15';
const SHELL_CACHE = 'rv-shell-' + VERSION;
const DATA_CACHE = 'rv-data-' + VERSION;
const AUDIO_CACHE = 'rv-audio-v1';
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
  './fonts/rv-sans.woff2',
  './fonts/rv-serif.woff2',
  './fonts/rv-hand.woff2',
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
      .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE && key !== AUDIO_CACHE)
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
  // 单词音频：单独缓存（不随版本号清空），支持 Range 以便跳转到单词位置。
  if (url.pathname.indexOf('/audio/') !== -1) {
    event.respondWith(audioFetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function audioFetch(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const range = request.headers.get('range');
  if (cached) {
    if (range) return rangedFrom(cached, range);
    // 后台刷新索引/音频，下次打开拿到新版本。
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
      })
      .catch(() => {});
    return cached;
  }
  // 第一次播放：忽略 Range 拉完整文件（~300KB）存进缓存，再按需返回片段；
  // 否则浏览器发 Range 会拿到 206，无法缓存，导致每个词都重新下载。
  const url = request.url.split('#')[0];
  const full = await fetch(new Request(url, { method: 'GET', credentials: 'same-origin', cache: 'no-cache' }));
  if (full && full.status === 200 && full.type === 'basic') {
    cache.put(request, full.clone()).catch(() => {});
  }
  if (range && full && full.status === 200) return rangedFrom(full, range);
  return full;
}

async function rangedFrom(response, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return response;
  const buffer = await response.clone().arrayBuffer();
  const total = buffer.byteLength;
  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= total) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
  }
  end = Math.min(end, total - 1);
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store',
    },
  });
}

// 静态资源用「先给缓存、后台更新」：装成 App 后也能在联网时自动拿到新版本。
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  return new Response('离线且未缓存', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
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