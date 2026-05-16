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

  /** Check if the user has a valid session */
  function isLoggedIn() {
    return !!sessionStorage.getItem(SESSION_KEY);
  }

  /** Get stored auth token */
  function getToken() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  /** Get stored user info */
  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch { return null; }
  }

  /** Get granted strategy keys for the current user */
  function getStrategies() {
    try {
      return JSON.parse(sessionStorage.getItem(STRATEGIES_KEY) || "[]");
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

    /* Persist "remember me" if requested */
    if (data.token) {
      const remembered = localStorage.getItem(REMEMBER_ME_KEY);
      if (remembered === "1") {
        localStorage.setItem(SAVED_USER_KEY, username);
      }
    }

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
        updateNavUI();
        return true;
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
    initLoginGate
  };
})();
