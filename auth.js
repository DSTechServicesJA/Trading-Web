/* =========================================================
   IT Guru – Shared Authentication Module
   ---------------------------------------------------------
   Client-side login system that authenticates against a
   server-hosted database via REST API.

   Expected server endpoints (implement on your server):
     POST /api/auth/login   { username, password }
       → 200 { token, user: { username, displayName } }
       → 401 { error: "Invalid credentials" }

     POST /api/auth/verify  { token }
       → 200 { valid: true, user: { username, displayName } }
       → 401 { valid: false }

     POST /api/auth/register { username, password, email }
       → 201 { token, user: { username, displayName } }
       → 409 { error: "Username already exists" }

   Usage: include this script before your page's main JS.
   ========================================================= */

"use strict";

const ITGuruAuth = (() => {
  /* -------- Configuration -------- */
  /* Override by setting window.ITGURU_AUTH_API_BASE before loading this script */
  const AUTH_API_BASE = (typeof window !== "undefined" && window.ITGURU_AUTH_API_BASE)
    ? window.ITGURU_AUTH_API_BASE
    : "https://trading.dsitservicesja.com/api/auth";
  const AUTH_NAMESPACE = (() => {
    const fromWindow = (typeof window !== "undefined" && typeof window.ITGURU_AUTH_NAMESPACE === "string")
      ? window.ITGURU_AUTH_NAMESPACE
      : "";
    const fromQuery = (typeof window !== "undefined" && window.location && window.location.search)
      ? (new URLSearchParams(window.location.search).get("auth_ns") || "")
      : "";
    const raw = (fromWindow || fromQuery || "").trim();
    return raw.replace(/[^a-zA-Z0-9_\-]/g, "_");
  })();
  const withNamespace = (baseKey) => AUTH_NAMESPACE ? `${baseKey}__${AUTH_NAMESPACE}` : baseKey;

  const SESSION_KEY      = withNamespace("itguru_auth_token");
  const USER_KEY         = withNamespace("itguru_auth_user");
  const STRATEGIES_KEY   = withNamespace("itguru_auth_strategies");
  const REMEMBER_ME_KEY  = withNamespace("itguru_remember_login");
  const SAVED_USER_KEY   = withNamespace("itguru_saved_user");
  const PERSIST_TOKEN_KEY = withNamespace("itguru_auth_token_persist");
  const PERSIST_USER_KEY  = withNamespace("itguru_auth_user_persist");
  const PERSIST_STRAT_KEY = withNamespace("itguru_auth_strategies_persist");

  /* -------- Helpers -------- */

  /** Safely parse a JSON response, returning a fallback on empty/invalid body */
  async function safeJson(resp) {
    const text = await resp.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch {
      /* Server returned non-JSON (e.g. a PHP error page) — surface what we can */
      return { _raw: text.substring(0, 300) };
    }
  }

  /**
   * Fetch an auth endpoint with automatic .php fallback.
   * Hosts without mod_rewrite / URL rewriting return 404 for clean URLs
   * like /api/auth/login — this helper retries with /api/auth/login.php.
   */
  async function authFetch(endpoint, options) {
    let resp;
    try {
      resp = await fetch(`${AUTH_API_BASE}/${endpoint}`, options);
    } catch {
      throw new Error("Network error — check your connection and try again");
    }

    /* If clean URL returned 404, retry with .php extension */
    if (resp.status === 404) {
      try {
        resp = await fetch(`${AUTH_API_BASE}/${endpoint}.php`, options);
      } catch {
        throw new Error("Network error — check your connection and try again");
      }
    }

    return resp;
  }

  /* -------- Public API -------- */

  /** Check if the user has a valid (non-expired) session */
  function isLoggedIn() {
    let token = sessionStorage.getItem(SESSION_KEY);

    /* Restore persisted session from localStorage (Remember Me) if sessionStorage is empty */
    if (!token && localStorage.getItem(REMEMBER_ME_KEY) === "1") {
      const persisted = localStorage.getItem(PERSIST_TOKEN_KEY);
      if (persisted) {
        token = persisted;
        sessionStorage.setItem(SESSION_KEY, persisted);
        const pUser = localStorage.getItem(PERSIST_USER_KEY);
        if (pUser) sessionStorage.setItem(USER_KEY, pUser);
        const pStrat = localStorage.getItem(PERSIST_STRAT_KEY);
        if (pStrat) sessionStorage.setItem(STRATEGIES_KEY, pStrat);
      }
    }

    if (!token) return false;

    /* Quick client-side expiry check — avoids treating an expired JWT as valid */
    try {
      const parts   = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          /* Token is expired — clear the stale session so the login overlay appears */
          sessionStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(USER_KEY);
          sessionStorage.removeItem(STRATEGIES_KEY);
          localStorage.removeItem(PERSIST_TOKEN_KEY);
          localStorage.removeItem(PERSIST_USER_KEY);
          localStorage.removeItem(PERSIST_STRAT_KEY);
          return false;
        }
      }
    } catch {
      /* Catches DOMException from atob() on invalid base64 and SyntaxError from
         JSON.parse on malformed payloads — treat all such tokens as present but
         undecoded (the server verify() call will catch true invalidity). */
    }

    return true;
  }

  /** Get stored auth token */
  function getToken() {
    let token = sessionStorage.getItem(SESSION_KEY);
    
    /* Restore persisted session from localStorage (Remember Me) if sessionStorage is empty */
    if (!token && localStorage.getItem(REMEMBER_ME_KEY) === "1") {
      const persisted = localStorage.getItem(PERSIST_TOKEN_KEY);
      if (persisted) {
        token = persisted;
        sessionStorage.setItem(SESSION_KEY, persisted);
        const pUser = localStorage.getItem(PERSIST_USER_KEY);
        if (pUser) sessionStorage.setItem(USER_KEY, pUser);
        const pStrat = localStorage.getItem(PERSIST_STRAT_KEY);
        if (pStrat) sessionStorage.setItem(STRATEGIES_KEY, pStrat);
      }
    }
    
    return token || "";
  }

  /** Get stored user info */
  function getUser() {
    try {
      let user = sessionStorage.getItem(USER_KEY);
      /* Restore persisted user from localStorage (Remember Me) if sessionStorage is empty */
      if (!user && localStorage.getItem(REMEMBER_ME_KEY) === "1") {
        const pUser = localStorage.getItem(PERSIST_USER_KEY);
        if (pUser) {
          sessionStorage.setItem(USER_KEY, pUser);
          user = pUser;
        }
      }
      return JSON.parse(user || "null");
    } catch { return null; }
  }

  /** Get granted strategy keys for the current user */
  function getStrategies() {
    try {
      let strat = sessionStorage.getItem(STRATEGIES_KEY);
      /* Restore persisted strategies from localStorage (Remember Me) if sessionStorage is empty */
      if (!strat && localStorage.getItem(REMEMBER_ME_KEY) === "1") {
        const pStrat = localStorage.getItem(PERSIST_STRAT_KEY);
        if (pStrat) {
          sessionStorage.setItem(STRATEGIES_KEY, pStrat);
          strat = pStrat;
        }
      }
      return JSON.parse(strat || "[]");
    } catch { return []; }
  }

  /** Persist user info for the current auth namespace */
  function setUser(user) {
    if (!user) {
      sessionStorage.removeItem(USER_KEY);
      return;
    }
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  /** Login with username + password */
  async function login(username, password) {
    const resp = await authFetch("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      if (data.error) {
        throw new Error(data.error);
      } else if (data._raw) {
        console.error("Server returned non-JSON:", data._raw);
        throw new Error(`Login failed (HTTP ${resp.status}). Check browser console for details or visit /api/auth/status`);
      }
      throw new Error(`Login failed (HTTP ${resp.status})`);
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    setUser(data.user || { username });
    if (Array.isArray(data.user?.strategies)) {
      sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
    }

    /* Persist session to localStorage if "remember me" is active */
    if (localStorage.getItem(REMEMBER_ME_KEY) === "1") {
      localStorage.setItem(PERSIST_TOKEN_KEY, data.token);
      if (data.user) localStorage.setItem(PERSIST_USER_KEY, JSON.stringify(data.user));
      if (Array.isArray(data.user?.strategies)) {
        localStorage.setItem(PERSIST_STRAT_KEY, JSON.stringify(data.user.strategies));
      }
      localStorage.setItem(SAVED_USER_KEY, username);
    }

    checkNotifications();
    return data;
  }

  /** Register a new account */
  async function register(username, password, email) {
    /* Client-side validation matching server requirements */
    if (username.length < 3 || username.length > 50) {
      throw new Error("Username must be 3–50 characters");
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
      throw new Error("Username may only contain letters, numbers, dots, hyphens, and underscores");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Invalid email address");
    }

    const resp = await authFetch("register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email })
    });

    const data = await safeJson(resp);

    if (!resp.ok) {
      /* Surface the server error, or hint at what went wrong */
      if (data.error) {
        throw new Error(data.error);
      } else if (data._raw) {
        console.error("Server returned non-JSON:", data._raw);
        throw new Error(`Registration failed (HTTP ${resp.status}). Check browser console for details or visit /api/auth/status`);
      }
      throw new Error(`Registration failed (HTTP ${resp.status})`);
    }

    if (!data.token) {
      throw new Error("Registration failed — no token returned. Visit /api/auth/status to diagnose.");
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    setUser(data.user || { username });
    if (Array.isArray(data.user?.strategies)) {
      sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
    }
    return data;
  }

  /** Verify existing token is still valid */
  async function verify() {
    const token = getToken();
    if (!token) return false;

    try {
      const resp = await authFetch("verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await safeJson(resp);
      if (data.valid === true) {
        if (data.user) {
          setUser(data.user);
        }
        if (Array.isArray(data.user?.strategies)) {
          sessionStorage.setItem(STRATEGIES_KEY, JSON.stringify(data.user.strategies));
        }
        /* Keep persisted localStorage in sync when Remember Me is active */
        if (localStorage.getItem(REMEMBER_ME_KEY) === "1") {
          const currentToken = getToken();
          if (currentToken) localStorage.setItem(PERSIST_TOKEN_KEY, currentToken);
          if (data.user) localStorage.setItem(PERSIST_USER_KEY, JSON.stringify(data.user));
          if (Array.isArray(data.user?.strategies)) {
            localStorage.setItem(PERSIST_STRAT_KEY, JSON.stringify(data.user.strategies));
          }
        }
        updateNavUI();
        checkNotifications();
        return true;
      }
      /* Subscription expired — end the session and block access */
      if (data.reason === "subscription_expired") {
        showSubscriptionExpired(data.error || "Your subscription has expired. Please renew to regain access.");
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Update nav UI elements that reflect the current auth state:
   *   - #adminNavItem  → shown only for admin users
   *   - #indicatorV2NavItem → shown for admins or users with indicator_v2 access
   *   - #userAccountInfo → subscription status + expiry badge
   * Safe to call at any time; silently no-ops when elements are absent.
   */
  function updateNavUI() {
    try {
      const u = getUser();
      const isAdmin = !!(u && u.role === "admin");
      const strategies = new Set(getStrategies());

      /* Admin nav link */
      const adminNavItem = document.getElementById("adminNavItem");
      if (adminNavItem) {
        adminNavItem.style.display = isAdmin ? "" : "none";
      }

      /* Indicator V2 nav link */
      const indicatorV2NavItem = document.getElementById("indicatorV2NavItem");
      if (indicatorV2NavItem) {
        indicatorV2NavItem.style.display = (isAdmin || strategies.has("indicator_v2")) ? "" : "none";
      }

      /* User account info bar */
      const infoEl = document.getElementById("userAccountInfo");
      if (!infoEl) return;

      if (!u) {
        infoEl.style.display = "none";
        return;
      }

      const sub  = u.subscription_status || "inactive";
      const plan = u.subscription_plan || null;
      const exp  = u.subscription_expires_at;

      let subLabel;
      if (sub === "active")   subLabel = "✅ Active";
      else if (sub === "trial") subLabel = "🔵 Trial";
      else                      subLabel = "⚪ Inactive";

      if (plan && sub !== "inactive") {
        const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
        subLabel += " · " + planLabel;
      }

      let expText = "";
      if (exp) {
        const expDate = new Date(exp);
        const now     = new Date();
        if (expDate < now) {
          expText = " · ⚠️ Expired";
        } else {
          expText = " · Expires " + expDate.toLocaleDateString(undefined,
            { year: "numeric", month: "short", day: "numeric" });
        }
      }

      infoEl.textContent = "👤 " + (u.displayName || u.username) + "  ·  " + subLabel + expText;
      infoEl.style.display = "";
    } catch (_) {}
  }

  /** Logout – clear session */
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(STRATEGIES_KEY);
    localStorage.removeItem(SAVED_USER_KEY);
    localStorage.removeItem(REMEMBER_ME_KEY);
    localStorage.removeItem(PERSIST_TOKEN_KEY);
    localStorage.removeItem(PERSIST_USER_KEY);
    localStorage.removeItem(PERSIST_STRAT_KEY);
  }

  /**
   * Initialize the login gate overlay.
   * Call this from your page's DOMContentLoaded handler.
   * @param {object}   opts
   * @param {Function} [opts.onLogin] – callback when login succeeds
   */
  function initLoginGate(opts = {}) {
    const overlay   = document.getElementById("loginOverlay");
    const loginBtn  = document.getElementById("loginBtn");
    const err       = document.getElementById("loginError");
    const userInput = document.getElementById("loginUsername");
    const passInput = document.getElementById("loginPassword");
    const rememberMe = document.getElementById("loginRememberMe");
    const formLogin  = document.getElementById("loginFormSection");

    if (!overlay) return;

    /* Restore remembered username */
    if (rememberMe && localStorage.getItem(REMEMBER_ME_KEY) === "1") {
      rememberMe.checked = true;
      const savedUser = localStorage.getItem(SAVED_USER_KEY);
      if (savedUser && userInput) userInput.value = savedUser;
    }

    /* Show/hide overlay based on session state */
    if (isLoggedIn()) {
      overlay.style.display = "none";
      updateNavUI();
    } else {
      overlay.style.display = "flex";
    }

    /* Login button handler — guard against duplicate registration */
    if (loginBtn && !loginBtn.dataset.loginBound) {
      loginBtn.dataset.loginBound = "1";
      /* Remember original label so it is restored correctly after each attempt */
      const origBtnText = loginBtn.textContent;

      loginBtn.addEventListener("click", async () => {
        /* Ignore programmatic clicks fired while a login is already in progress */
        if (loginBtn.disabled) return;

        const username = userInput?.value?.trim() || "";
        const password = passInput?.value || "";

        if (!username || !password) {
          if (err) err.textContent = "Enter username and password";
          return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = "Signing in…";
        if (err) err.textContent = "";

        /* Handle "remember me" */
        if (rememberMe) {
          if (rememberMe.checked) {
            localStorage.setItem(REMEMBER_ME_KEY, "1");
            localStorage.setItem(SAVED_USER_KEY, username);
          } else {
            localStorage.removeItem(REMEMBER_ME_KEY);
            localStorage.removeItem(SAVED_USER_KEY);
            localStorage.removeItem(PERSIST_TOKEN_KEY);
            localStorage.removeItem(PERSIST_USER_KEY);
            localStorage.removeItem(PERSIST_STRAT_KEY);
          }
        }

        try {
          await login(username, password);
          overlay.style.display = "none";
          updateNavUI();
          if (opts.onLogin) opts.onLogin();
        } catch (ex) {
          if (err) err.textContent = ex.message || "Login failed";
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = origBtnText;
        }
      });

      /* Allow Enter key to submit login — also guarded by the handler above */
      [userInput, passInput].forEach(el => {
        if (el) {
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") loginBtn?.click();
          });
        }
      });
    }
  }

  /**
   * Block the page with a "subscription expired" overlay and clear the session.
   * Reuses the login overlay when present; otherwise injects a full-screen div.
   */
  function showSubscriptionExpired(message) {
    logout();
    const msg = message || "Your subscription has expired. Please renew to regain access.";

    const overlay = document.getElementById("loginOverlay");
    if (overlay) {
      overlay.style.display = "flex";
      const err = document.getElementById("loginError");
      if (err) err.textContent = "⛔ " + msg;
      return;
    }

    /* No login overlay on this page — inject a blocking overlay */
    let block = document.getElementById("itguruSubExpiredOverlay");
    if (!block) {
      block = document.createElement("div");
      block.id = "itguruSubExpiredOverlay";
      block.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
        "background:rgba(8,10,18,0.96);color:#fff;font-family:Inter,Arial,sans-serif;text-align:center;padding:24px;";
      const card = document.createElement("div");
      card.style.cssText = "max-width:420px;";
      const h = document.createElement("h2");
      h.textContent = "⛔ Subscription Expired";
      const p = document.createElement("p");
      p.style.cssText = "margin:14px 0;line-height:1.5;";
      p.textContent = msg;
      const btn = document.createElement("button");
      btn.textContent = "Back to Login";
      btn.style.cssText =
        "padding:10px 22px;border:0;border-radius:8px;background:#e74c3c;color:#fff;font-weight:600;cursor:pointer;";
      btn.addEventListener("click", () => location.reload());
      card.appendChild(h); card.appendChild(p); card.appendChild(btn);
      block.appendChild(card);
      document.body.appendChild(block);
    }
    block.style.display = "flex";
  }

  /* ── In-app notifications (admin → user) ── */
  const API_ROOT = AUTH_API_BASE.replace(/\/auth\/?$/, "");
  let _notifChecked = false;

  /** Fetch a non-auth API endpoint with automatic .php fallback. */
  async function apiRootFetch(endpoint, options) {
    let resp = await fetch(`${API_ROOT}/${endpoint}`, options);
    if (resp.status === 404) {
      const phpEndpoint = endpoint.includes("?")
        ? endpoint.replace("?", ".php?")
        : endpoint + ".php";
      resp = await fetch(`${API_ROOT}/${phpEndpoint}`, options);
    }
    return resp;
  }

  /**
   * Fetch unread notifications for the logged-in user and display them
   * in a dismissible floating panel. Runs at most once per page load.
   */
  async function checkNotifications() {
    if (_notifChecked) return;
    _notifChecked = true;

    const token = getToken();
    if (!token) return;

    try {
      const resp = await apiRootFetch("notifications", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!resp.ok) return;
      const data = await safeJson(resp);
      const notifs = Array.isArray(data.notifications) ? data.notifications : [];
      if (notifs.length) renderNotificationsPanel(notifs);
    } catch { /* non-fatal — notifications are best-effort */ }
  }

  /** Mark a notification (or all) as read on the server. */
  async function markNotificationRead(payload) {
    const token = getToken();
    if (!token) return;
    try {
      await apiRootFetch("notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      });
    } catch { /* best-effort */ }
  }

  /** Render the floating notifications panel (built with DOM APIs — no HTML injection). */
  function renderNotificationsPanel(notifs) {
    let panel = document.getElementById("itguruNotifPanel");
    if (panel) panel.remove();

    panel = document.createElement("div");
    panel.id = "itguruNotifPanel";
    panel.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:99998;width:340px;max-width:calc(100vw - 32px);" +
      "max-height:70vh;overflow-y:auto;background:#141826;color:#eee;border:1px solid #2c3350;" +
      "border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:Inter,Arial,sans-serif;font-size:13px;";

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #2c3350;";
    const hTitle = document.createElement("strong");
    hTitle.textContent = `🔔 Notifications (${notifs.length})`;
    const dismissAll = document.createElement("button");
    dismissAll.textContent = "Dismiss all";
    dismissAll.style.cssText =
      "background:none;border:0;color:#8ab4ff;cursor:pointer;font-size:12px;";
    dismissAll.addEventListener("click", () => {
      markNotificationRead({ all: true });
      panel.remove();
    });
    header.appendChild(hTitle);
    header.appendChild(dismissAll);
    panel.appendChild(header);

    for (const n of notifs) {
      const item = document.createElement("div");
      item.style.cssText = "padding:10px 14px;border-bottom:1px solid #222840;";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:8px;";
      const t = document.createElement("strong");
      t.textContent = String(n.title || "Notification");
      const x = document.createElement("button");
      x.textContent = "✕";
      x.title = "Dismiss";
      x.style.cssText = "background:none;border:0;color:#889;cursor:pointer;font-size:13px;flex:0 0 auto;";
      x.addEventListener("click", () => {
        markNotificationRead({ id: n.id });
        item.remove();
        if (!panel.querySelector("[data-notif-item]")) panel.remove();
      });
      item.dataset.notifItem = "1";
      row.appendChild(t);
      row.appendChild(x);

      const body = document.createElement("div");
      body.style.cssText = "margin-top:4px;line-height:1.45;white-space:pre-wrap;color:#cfd4e6;";
      body.textContent = String(n.message || "");

      const ts = document.createElement("div");
      ts.style.cssText = "margin-top:6px;font-size:11px;color:#778;";
      try { ts.textContent = new Date(n.created_at.replace(" ", "T") + "Z").toLocaleString(); }
      catch { ts.textContent = String(n.created_at || ""); }

      item.appendChild(row);
      item.appendChild(body);
      item.appendChild(ts);
      panel.appendChild(item);
    }

    document.body.appendChild(panel);
  }

  return {
    isLoggedIn,
    getToken,
    getUser,
    setUser,
    getStrategies,
    login,
    verify,
    logout,
    updateNavUI,
    initLoginGate,
    checkNotifications
  };
})();
