const CACHE="choo-v4";
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./","./index.html"])));self.skipWaiting()});
self.addEventListener("fetch",e=>{ if(e.request.url.includes("script.google")) return; e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});