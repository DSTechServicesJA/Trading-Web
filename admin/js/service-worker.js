/**
 * Admin Dashboard Service Worker
 * Caches static assets for offline support and faster loading
 * 
 * Features:
 * - Cache static assets (CSS, JS, fonts, images)
 * - Network-first strategy for API calls
 * - Cache-first strategy for static assets
 * - Periodic cache cleanup
 */

const CACHE_VERSION = 'admin-dashboard-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Assets to cache on install
const STATIC_ASSETS = [
    // HTML
    '/admin/dashboard-home.html',
    '/admin/index.html',
    '/admin/audit-trail.html',
    
    // CSS
    '/admin/css/admin-modern.css',
    '/admin/css/global-search.css',
    
    // JavaScript
    '/admin/js/components.js',
    '/admin/js/search.js',
    '/admin/js/pagination.js',
    '/admin/js/layout-manager.js',
    '/admin/js/global-search.js',
    '/admin/js/audit-trail-export.js',
    '/admin/js/module-loader.js',
    
    // External CDN resources
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[Service Worker] Caching static assets');
                return Promise.all(STATIC_ASSETS.map((url) => (
                    cache.add(url).catch(() => {
                        console.warn(`[Service Worker] Could not cache ${url}`);
                    })
                )));
            })
            .then(() => self.skipWaiting())
            .catch((error) => {
                console.error('[Service Worker] Installation failed:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((cacheName) => {
                            return cacheName.startsWith('admin-dashboard-') && 
                                   cacheName !== STATIC_CACHE && 
                                   cacheName !== DYNAMIC_CACHE &&
                                   cacheName !== API_CACHE;
                        })
                        .map((cacheName) => {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return;
    }
    
    // Skip cross-origin requests
    if (url.origin !== self.location.origin && !isAllowedCDN(url.origin)) {
        return;
    }
    
    // API requests - network first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstStrategy(request, API_CACHE));
        return;
    }
    
    // Static assets (CSS, JS, images, fonts) - cache first
    if (isStaticAsset(url.pathname)) {
        event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
        return;
    }
    
    // HTML pages - network first
    if (url.pathname.endsWith('.html') || url.pathname === '/') {
        event.respondWith(networkFirstStrategy(request, DYNAMIC_CACHE));
        return;
    }
    
    // Default - network first
    event.respondWith(networkFirstStrategy(request, DYNAMIC_CACHE));
});

/**
 * Cache-first strategy: try cache first, fall back to network
 */
async function cacheFirstStrategy(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
        return cached;
    }
    
    try {
        const response = await fetch(request);
        
        // Cache successful responses
        if (response.ok) {
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.warn('[Service Worker] Fetch failed for:', request.url, error);
        
        // Return offline page or cached response
        return new Response('Offline - Service unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
                'Content-Type': 'text/plain'
            })
        });
    }
}

/**
 * Network-first strategy: try network first, fall back to cache
 */
async function networkFirstStrategy(request, cacheName) {
    try {
        const response = await fetch(request);
        
        // Cache successful responses
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.warn('[Service Worker] Network request failed, trying cache:', request.url);
        
        const cache = await caches.open(cacheName);
        const cached = await cache.match(request);
        
        if (cached) {
            return cached;
        }
        
        // Return offline response
        return new Response('Offline - Unable to load resource', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
                'Content-Type': 'text/plain'
            })
        });
    }
}

/**
 * Check if URL is a static asset
 */
function isStaticAsset(pathname) {
    const staticExtensions = ['.css', '.js', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'];
    return staticExtensions.some(ext => pathname.endsWith(ext));
}

/**
 * Check if origin is allowed CDN
 */
function isAllowedCDN(origin) {
    const allowedCDNs = [
        'https://cdn.jsdelivr.net',
        'https://cdnjs.cloudflare.com',
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com'
    ];
    return allowedCDNs.includes(origin);
}

/**
 * Message handler for cache management
 */
self.addEventListener('message', (event) => {
    const { action, cacheName } = event.data;
    
    if (action === 'clear-cache') {
        caches.delete(cacheName).then(() => {
            event.ports[0].postMessage({ success: true, message: `Cache ${cacheName} cleared` });
        });
    } else if (action === 'get-cache-size') {
        estimateCacheSize().then((size) => {
            event.ports[0].postMessage({ success: true, size });
        });
    } else if (action === 'list-caches') {
        caches.keys().then((names) => {
            event.ports[0].postMessage({ success: true, caches: names });
        });
    }
});

/**
 * Estimate cache size (bytes)
 */
async function estimateCacheSize() {
    const cacheNames = await caches.keys();
    let totalSize = 0;
    
    for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        
        for (const request of keys) {
            const response = await cache.match(request);
            if (response) {
                const blob = await response.blob();
                totalSize += blob.size;
            }
        }
    }
    
    return totalSize;
}
