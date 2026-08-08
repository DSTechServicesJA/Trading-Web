(function (global) {
  "use strict";

  const DEFAULT_PING_INTERVAL_MS = 12000;
  const DEFAULT_RECONNECT_BASE_MS = 1000;
  const DEFAULT_RECONNECT_MAX_MS = 30000;

  function sanitizeToken(value) {
    return String(value || "").trim();
  }

  function scrubUrl(url) {
    const clean = new URL(url.href);
    clean.hash = "";
    ["access_token", "token", "code", "state"].forEach((key) => clean.searchParams.delete(key));
    return clean.pathname + clean.search + clean.hash;
  }

  function captureOAuthToken(options) {
    const opts = options || {};
    const storageKey = opts.storageKey || "deriv_token";
    const locationObj = opts.location || global.location;
    const session = opts.sessionStorage || global.sessionStorage;
    const logger = typeof opts.logger === "function" ? opts.logger : null;

    const hash = String(locationObj.hash || "").replace(/^#/, "");
    const hashParams = new URLSearchParams(hash);
    const searchParams = new URLSearchParams(locationObj.search || "");

    const accessToken = sanitizeToken(
      hashParams.get("access_token") ||
      searchParams.get("access_token") ||
      hashParams.get("token") ||
      searchParams.get("token")
    );
    const authCode = sanitizeToken(hashParams.get("code") || searchParams.get("code"));

    if (accessToken) {
      session.setItem(storageKey, accessToken);
      if (global.history && typeof global.history.replaceState === "function") {
        global.history.replaceState({}, global.document.title, scrubUrl(locationObj));
      }
      return { accessToken, tokenType: "bearer" };
    }

    if (authCode) {
      if (logger) {
        logger("Deriv OAuth returned an authorization code. Exchange it for access and refresh tokens before WebSocket authorize.");
      }
      if (global.history && typeof global.history.replaceState === "function") {
        global.history.replaceState({}, global.document.title, scrubUrl(locationObj));
      }
      return { code: authCode };
    }

    return null;
  }

  function buildOAuthUrl(options) {
    const opts = options || {};
    const appId = opts.appId;
    const redirectUri = opts.redirectUri;
    const responseType = opts.responseType || "token";
    const url = new URL("https://oauth.deriv.com/oauth2/authorize");
    url.searchParams.set("app_id", String(appId));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", responseType);
    if (opts.scope) url.searchParams.set("scope", opts.scope);
    if (opts.state) url.searchParams.set("state", opts.state);
    return url.toString();
  }

  function createSubscriptionManager() {
    const tracked = new Map();
    const pending = new Set();

    function makeKey(type, key) {
      return `${type}::${String(key)}`;
    }

    function send(socket, payload) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(payload));
      return true;
    }

    function markRequested(type, key) {
      pending.add(makeKey(type, key));
    }

    function remember(type, key, subscriptionId) {
      if (!subscriptionId) return;
      const mapKey = makeKey(type, key);
      tracked.set(mapKey, subscriptionId);
      pending.delete(mapKey);
    }

    function forget(socket, type, key) {
      const mapKey = makeKey(type, key);
      const subscriptionId = tracked.get(mapKey);
      if (subscriptionId) send(socket, { forget: subscriptionId });
      tracked.delete(mapKey);
      pending.delete(mapKey);
    }

    function forgetType(socket, type) {
      const prefix = `${type}::`;
      for (const [mapKey, subscriptionId] of tracked.entries()) {
        if (!mapKey.startsWith(prefix)) continue;
        if (subscriptionId) send(socket, { forget: subscriptionId });
        tracked.delete(mapKey);
      }
      for (const mapKey of Array.from(pending)) {
        if (mapKey.startsWith(prefix)) pending.delete(mapKey);
      }
    }

    function clear() {
      tracked.clear();
      pending.clear();
    }

    function sync(socket, type, keys, buildRequest) {
      const desiredKeys = Array.from(new Set((keys || []).map((key) => String(key))));
      const desiredSet = new Set(desiredKeys);
      const prefix = `${type}::`;

      for (const [mapKey, subscriptionId] of Array.from(tracked.entries())) {
        if (!mapKey.startsWith(prefix)) continue;
        const key = mapKey.slice(prefix.length);
        if (!desiredSet.has(key)) {
          if (subscriptionId) send(socket, { forget: subscriptionId });
          tracked.delete(mapKey);
        }
      }

      for (const mapKey of Array.from(pending)) {
        if (!mapKey.startsWith(prefix)) continue;
        const key = mapKey.slice(prefix.length);
        if (!desiredSet.has(key)) pending.delete(mapKey);
      }

      desiredKeys.forEach((key) => {
        const mapKey = makeKey(type, key);
        if (tracked.has(mapKey) || pending.has(mapKey)) return;
        markRequested(type, key);
        send(socket, buildRequest(key));
      });
    }

    return {
      has(type, key) {
        const mapKey = makeKey(type, key);
        return tracked.has(mapKey) || pending.has(mapKey);
      },
      markRequested,
      remember,
      forget,
      forgetType,
      clear,
      sync,
    };
  }

  global.DerivWsUtils = {
    DEFAULT_PING_INTERVAL_MS,
    DEFAULT_RECONNECT_BASE_MS,
    DEFAULT_RECONNECT_MAX_MS,
    sanitizeToken,
    captureOAuthToken,
    buildOAuthUrl,
    createSubscriptionManager,
    nextReconnectDelay(attempt, baseMs, maxMs) {
      return Math.min(
        (baseMs || DEFAULT_RECONNECT_BASE_MS) * Math.pow(2, Math.max(0, attempt)),
        maxMs || DEFAULT_RECONNECT_MAX_MS
      );
    },
  };
})(window);
