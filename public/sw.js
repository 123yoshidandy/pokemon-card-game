// オフラインでも開けるようにする service worker
// 自分のファイルはネットワークを先に使い（更新がすぐ届く）、つながらないときだけキャッシュから返す。
// 文字（Google Fonts）は変わらないので、キャッシュを先に使う。
const CACHE = 'pcg-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', 'index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
        .then(() => self.clients.claim()));
});

// 初めて開いたときは、この service worker が動く前に読み込みが終わっている。
// ページから読み込んだファイルの一覧を受け取り、キャッシュに入れておく。
self.addEventListener('message', event => {
    if (event.data?.type !== 'cache-urls') return;
    const urls = event.data.urls.filter(url => new URL(url).origin === self.location.origin);
    event.waitUntil(caches.open(CACHE).then(cache => Promise.all(urls.map(url => cache.match(url)
        .then(hit => hit || cache.add(url).catch(() => {}))))));
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (FONT_HOSTS.includes(url.hostname)) {
        event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
            return response;
        })));
        return;
    }
    if (url.origin !== self.location.origin) return;
    event.respondWith(fetch(request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
    }).catch(() => caches.match(request, { ignoreSearch: true })
        .then(hit => hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
