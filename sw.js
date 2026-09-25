"use strict";

/*
 * Choo Cottage Service Worker
 *
 * IMPORTANT:
 * Change CACHE_VERSION whenever you deploy changes to:
 * - index.html
 * - dashboard.html
 * - images
 * - manifest
 * - JavaScript or CSS
 */

const CACHE_VERSION = "v5";
const STATIC_CACHE = `choo-cottage-static-${CACHE_VERSION}`;
const PAGE_CACHE = `choo-cottage-pages-${CACHE_VERSION}`;

const OFFLINE_PAGE = "./index.html";

const STATIC_ASSETS = [
  "./choo.jpeg",
  "./qr.png",
  "./apple-touch-icon.png",
  "./favicon.ico",
  "./site.webmanifest"
];

/**
 * Install:
 * Cache static files only.
 * HTML is not precached because it must remain network-first.
 */
self.addEventListener("install", event => {
  console.log(`[Service Worker] Installing ${CACHE_VERSION}`);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async asset => {
          try {
            const request = new Request(asset, {
              cache: "reload"
            });

            const response = await fetch(request);

            if (!response.ok) {
              throw new Error(
                `${asset} returned HTTP ${response.status}`
              );
            }

            await cache.put(asset, response);
            console.log(`[Service Worker] Cached: ${asset}`);
          } catch (error) {
            console.warn(
              `[Service Worker] Failed to cache: ${asset}`,
              error
            );
          }
        })
      );

      const successful = results.filter(
        result => result.status === "fulfilled"
      ).length;

      console.log(
        `[Service Worker] Cached ${successful}/${STATIC_ASSETS.length} assets`
      );

      await self.skipWaiting();
    })()
  );
});

/**
 * Activate:
 * Delete every old Choo Cottage cache.
 * Enable navigation preload if available.
 * Immediately control currently opened pages.
 */
self.addEventListener("activate", event => {
  console.log(`[Service Worker] Activating ${CACHE_VERSION}`);

  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter(cacheName => {
            const isChooCache =
              cacheName.startsWith("choo-cottage-");

            const isCurrentCache =
              cacheName === STATIC_CACHE ||
              cacheName === PAGE_CACHE;

            return isChooCache && !isCurrentCache;
          })
          .map(cacheName => {
            console.log(
              `[Service Worker] Deleting old cache: ${cacheName}`
            );

            return caches.delete(cacheName);
          })
      );

      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
          console.log(
            "[Service Worker] Navigation preload enabled"
          );
        } catch (error) {
          console.warn(
            "[Service Worker] Navigation preload unavailable",
            error
          );
        }
      }

      await self.clients.claim();

      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      for (const client of clients) {
        client.postMessage({
          type: "SERVICE_WORKER_ACTIVATED",
          version: CACHE_VERSION
        });
      }
    })()
  );
});

/**
 * Fetch:
 *
 * Navigation/HTML:
 * Network first with cache fallback.
 *
 * Same-origin static files:
 * Cache first with background update.
 *
 * Supabase/API/CDN:
 * Not intercepted by this service worker.
 */
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (!url.protocol.startsWith("http")) {
    return;
  }

  const isSameOrigin =
    url.origin === self.location.origin;

  const isNavigation =
    request.mode === "navigate";

  const isHtml =
    request.destination === "document" ||
    url.pathname.endsWith(".html");

  /*
   * Never cache or intercept:
   * - Supabase requests
   * - Telegram/API requests
   * - Google Fonts
   * - jsDelivr CDN
   * - Other third-party resources
   */
  if (!isSameOrigin) {
    return;
  }

  /*
   * Always use network-first for HTML/navigation.
   * This prevents old index.html or dashboard.html
   * from staying permanently cached.
   */
  if (isNavigation || isHtml) {
    event.respondWith(handleNavigation(event));
    return;
  }

  /*
   * Same-origin static files use stale-while-revalidate.
   */
  event.respondWith(handleStaticAsset(request));
});

/**
 * Network-first navigation handler.
 */
async function handleNavigation(event) {
  const request = event.request;

  try {
    /*
     * Use navigation preload response when available.
     */
    const preloadResponse = await event.preloadResponse;

    if (preloadResponse && preloadResponse.ok) {
      await saveResponse(
        PAGE_CACHE,
        request,
        preloadResponse.clone()
      );

      return preloadResponse;
    }

    /*
     * cache: "no-store" prevents the normal browser HTTP
     * cache from returning an older HTML page.
     */
    const networkResponse = await fetch(request, {
      cache: "no-store"
    });

    if (networkResponse && networkResponse.ok) {
      await saveResponse(
        PAGE_CACHE,
        request,
        networkResponse.clone()
      );
    }

    return networkResponse;
  } catch (error) {
    console.warn(
      "[Service Worker] Navigation network failed:",
      request.url,
      error
    );

    /*
     * Try the exact cached URL first.
     */
    const cachedPage = await caches.match(request);

    if (cachedPage) {
      return cachedPage;
    }

    /*
     * For application routes, fall back to index.html.
     */
    const cachedIndex =
      await caches.match("./index.html");

    if (cachedIndex) {
      return cachedIndex;
    }

    return new Response(
      createOfflineHtml(),
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}

/**
 * Static assets:
 * Return cache immediately, then update it in background.
 */
async function handleStaticAsset(request) {
  const cachedResponse = await caches.match(request);

  const networkPromise = fetch(request, {
    cache: "no-cache"
  })
    .then(async response => {
      if (
        response &&
        response.ok &&
        response.type === "basic"
      ) {
        await saveResponse(
          STATIC_CACHE,
          request,
          response.clone()
        );
      }

      return response;
    })
    .catch(error => {
      console.warn(
        "[Service Worker] Static fetch failed:",
        request.url,
        error
      );

      return null;
    });

  if (cachedResponse) {
    /*
     * Update the cached asset without delaying the response.
     */
    void networkPromise;
    return cachedResponse;
  }

  const networkResponse = await networkPromise;

  if (networkResponse) {
    return networkResponse;
  }

  return new Response("Resource unavailable", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

/**
 * Safely store a response in the selected cache.
 */
async function saveResponse(
  cacheName,
  request,
  response
) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (error) {
    console.warn(
      "[Service Worker] Cache write failed:",
      request.url,
      error
    );
  }
}

/**
 * Handle messages from index.html/dashboard.html.
 */
self.addEventListener("message", event => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "CLEAR_APP_CACHE") {
    event.waitUntil(
      (async () => {
        const cacheNames = await caches.keys();

        await Promise.all(
          cacheNames
            .filter(name =>
              name.startsWith("choo-cottage-")
            )
            .map(name => caches.delete(name))
        );

        if (event.source) {
          event.source.postMessage({
            type: "APP_CACHE_CLEARED"
          });
        }
      })()
    );
  }
});

/**
 * Minimal offline fallback.
 */
function createOfflineHtml() {
  return `
    <!DOCTYPE html>
    <html lang="ms">
    <head>
      <meta charset="UTF-8">
      <meta
        name="viewport"
        content="width=device-width,initial-scale=1"
      >
      <title>Choo Cottage - Offline</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          background: #fdfbf7;
          color: #333333;
          font-family: Arial, sans-serif;
          text-align: center;
        }

        .offline-card {
          width: 100%;
          max-width: 420px;
          padding: 28px;
          background: #ffffff;
          border: 1px solid #f0e6db;
          border-radius: 22px;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
        }

        h1 {
          margin: 0 0 12px;
          color: #8b6b4a;
          font-size: 26px;
        }

        p {
          margin: 0 0 20px;
          color: #666666;
          line-height: 1.6;
        }

        button {
          border: 0;
          border-radius: 999px;
          padding: 13px 22px;
          background: #8b6b4a;
          color: #ffffff;
          font-weight: bold;
          cursor: pointer;
        }
      </style>
    </head>

    <body>
      <div class="offline-card">
        <h1>Choo Cottage</h1>

        <p>
          Tiada sambungan internet.
          Sila semak sambungan dan cuba semula.
        </p>

        <button onclick="location.reload()">
          Cuba Semula
        </button>
      </div>
    </body>
    </html>
  `;
}