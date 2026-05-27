/* =========================================================
   IT Guru – Admin Dashboard JS
   ========================================================= */

"use strict";

const ADMIN_API = (typeof window !== "undefined" && window.ITGURU_AUTH_API_BASE)
  ? window.ITGURU_AUTH_API_BASE.replace(/\/auth\/?$/, "")
  : "https://trading.dsitservicesja.com/api";

const THEME_KEY  = "itguru_admin_theme";
const THEME_DARK  = "dark";
const THEME_LIGHT = "light";

/* ── State ── */
let allStrategies   = [];   /* [{ key, label }] */
let currentPage     = 1;
let currentFilters  = {};
let editingUserId   = null;
let editingUserStrategies = [];
let deletingUser    = null; /* { id, username } */
let resetPwUser     = null; /* { id, username } */
const userCache     = new Map(); /* id → user object from last load */

/* Bot strategy keys — rendered/styled separately from indicator strategies */
const BOT_STRATEGY_KEYS = new Set(['bot_hc_1hz75v', 'bot_normal']);

/* ═══════════════════════════════════════════════
   Theme
   ═══════════════════════════════════════════════ */

/** Return current theme ("dark" | "light"), defaulting to dark. */
function getTheme() {
  return localStorage.getItem(THEME_KEY) === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
}

/** Apply a theme and persist to localStorage. */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.textContent = theme === THEME_LIGHT ? "🌙 Dark" : "☀️ Light";
    btn.title       = theme === THEME_LIGHT ? "Switch to dark theme" : "Switch to light theme";
  }
}

/** Toggle between light and dark. */
function toggleTheme() {
  applyTheme(getTheme() === THEME_LIGHT ? THEME_DARK : THEME_LIGHT);
}

/* ═══════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  /* Wire the login button immediately so it responds even while the async
     token-verify request is in flight (overlay is visible via CSS until
     initApp() hides it). initLoginGate's duplicate guard prevents double
     registration if showLoginOverlay() is called again later. */
  ITGuruAuth.initLoginGate({
    onLogin: async () => {
      const user = ITGuruAuth.getUser();
      if (!user || user.role !== "admin") {
        showAccessDenied();
        return;
      }
      initApp(user);
    }
  });

  if (!ITGuruAuth.isLoggedIn()) {
    /* Overlay already visible and button already wired — nothing more to do */
    return;
  }

  /* User appears logged in — re-show overlay while we verify the token,
     so the button remains visible and usable during the async request. */
  const overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "flex";

  const valid = await ITGuruAuth.verify();
  if (!valid) {
    ITGuruAuth.logout();
    /* Overlay is already visible; button handler is already registered */
    return;
  }

  const user = ITGuruAuth.getUser();
  if (!user || user.role !== "admin") {
    showAccessDenied();
    return;
  }

  initApp(user);
});

/* ── Show login overlay ── */
function showLoginOverlay() {
  ITGuruAuth.initLoginGate({
    onLogin: async () => {
      const user = ITGuruAuth.getUser();
      if (!user || user.role !== "admin") {
        showAccessDenied();
        return;
      }
      initApp(user);
    }
  });
}

/* ── Access denied (non-admin logged in) ── */
function showAccessDenied() {
  const overlay = document.getElementById("loginOverlay");
  if (overlay) {
    overlay.innerHTML = `
      <div class="login-card" style="text-align:center;">
        <h2>🚫 Access Denied</h2>
        <p style="margin:16px 0;">Your account does not have admin privileges.</p>
        <button type="button" class="login-action-btn" onclick="ITGuruAuth.logout(); location.reload();">
          Logout
        </button>
      </div>`;
    overlay.style.display = "flex";
  }
}

/* ── Init after confirmed admin ── */
async function initApp(user) {
  document.getElementById("loginOverlay").style.display  = "none";
  document.getElementById("appWrapper").style.display    = "";

  const lbl = document.getElementById("adminUserLabel");
  if (lbl) lbl.textContent = "👤 " + (user.displayName || user.username);

  /* Theme: apply saved preference and wire toggle button */
  applyTheme(getTheme());
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  /* Logout */
  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      ITGuruAuth.logout();
      location.reload();
    });
  }

  /* Load strategy list then users */
  await loadStrategies();
  buildStrategyChecks("editStrategyChecks",  []);
  buildStrategyChecks("newStrategyChecks",   []);
  await loadUsers();
  bindToolbar();
  bindModals();
  await loadProfiles();
  bindProfileModals();
}

/* ═══════════════════════════════════════════════
   API helpers
   ═══════════════════════════════════════════════ */
async function apiRequest(path, options = {}) {
  const token = ITGuruAuth.getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": "Bearer " + token } : {}),
    ...(options.headers || {}),
  };

  const url  = ADMIN_API + path;
  const resp = await fetch(url, { ...options, headers });
  /* Fallback: if .htaccess URL rewriting is not available (e.g. Nginx without rewrite rules),
     retry with explicit .php extension so the endpoint is always reachable. */
  if (resp.status === 404 && !path.endsWith(".php")) {
    const phpPath = path.includes("?") ? path.replace("?", ".php?") : path + ".php";
    const fallback = await fetch(ADMIN_API + phpPath, { ...options, headers });
    return fallback;
  }
  return resp;
}

/* ═══════════════════════════════════════════════
   Strategies
   ═══════════════════════════════════════════════ */
async function loadStrategies() {
  try {
    const resp = await apiRequest("/admin/strategies");
    const data = await resp.json();
    allStrategies = data.strategies || [];
  } catch {
    allStrategies = [];
  }
}

function buildStrategyChecks(containerId, grantedKeys) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  const granted = new Set(grantedKeys);

  const botStrategies = allStrategies.filter(s => BOT_STRATEGY_KEYS.has(s.key));
  const indStrategies = allStrategies.filter(s => !BOT_STRATEGY_KEYS.has(s.key));

  function renderSection(sectionLabel, items, isBotSection) {
    if (!items.length) return;
    const heading = document.createElement("div");
    heading.className = "strategy-section-label";
    heading.textContent = sectionLabel;
    container.appendChild(heading);
    const group = document.createElement("div");
    group.className = "strategy-check-group";
    for (const s of items) {
      const label = document.createElement("label");
      label.className = "strategy-check-item" + (isBotSection ? " strategy-check-bot" : "");
      const cb = document.createElement("input");
      cb.type  = "checkbox";
      cb.value = s.key;
      cb.checked = granted.has(s.key);
      cb.dataset.stratKey = s.key;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(s.label));
      group.appendChild(label);
    }
    container.appendChild(group);
  }

  renderSection("🤖 Bot Access", botStrategies, true);
  renderSection("📊 Indicator Strategies", indStrategies, false);
}

function getCheckedStrategies(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[type=checkbox]:checked"))
    .map(cb => cb.value);
}

/* ═══════════════════════════════════════════════
   Load users
   ═══════════════════════════════════════════════ */
async function loadUsers(page = currentPage, filters = currentFilters) {
  currentPage    = page;
  currentFilters = filters;

  const params = new URLSearchParams({
    page,
    per_page: 25,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.subscription ? { subscription: filters.subscription } : {}),
    ...(filters.role ? { role: filters.role } : {}),
  });

  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = `<tr><td colspan="11" class="table-empty">Loading…</td></tr>`;

  try {
    const resp = await apiRequest("/admin/users?" + params);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      tbody.innerHTML = `<tr><td colspan="11" class="table-empty" style="color:var(--danger-soft)">
        Error: ${escHtml(err.error || "Failed to load users")}
      </td></tr>`;
      return;
    }

    const data = await resp.json();
    renderTable(data.users || []);
    renderPagination(data.page, data.last_page, data.total, data.per_page);
    updateStats(data.total, data.stats || {});
    loadTelegramStats();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty" style="color:var(--danger-soft)">
      Network error — ${escHtml(e.message)}
    </td></tr>`;
  }
}

/* ── Render rows ── */
function renderTable(users) {
  const tbody = document.getElementById("userTableBody");
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  const now = Date.now();

  for (const u of users) {
    userCache.set(u.id, u);
    const expiresMs = u.subscription_expires_at ? new Date(u.subscription_expires_at).getTime() : null;
    const isExpired      = expiresMs && expiresMs < now;
    const isExpiringSoon = expiresMs && !isExpired && (expiresMs - now) < 7 * 86400 * 1000;

    const tr = document.createElement("tr");
    if (isExpired)      tr.classList.add("row-expired");
    else if (isExpiringSoon) tr.classList.add("row-expiring-soon");

    const strategies = (u.strategies || []).map(k => {
      const label    = allStrategies.find(s => s.key === k)?.label || k;
      const isBotKey = BOT_STRATEGY_KEYS.has(k);
      return `<span class="strategy-tag${isBotKey ? ' strategy-tag-bot' : ''}">${escHtml(label)}</span>`;
    }).join("") || '<span style="color:var(--text-muted);font-size:11px;">none</span>';

    const expiryBadge = expiresMs
      ? (isExpired
          ? `<span class="badge badge-expired">Expired</span> `
          : isExpiringSoon
            ? `<span class="badge badge-expiring">⚠ Soon</span> `
            : "")
      : "";

    const expiryText = u.subscription_expires_at
      ? `<span class="ts">${expiryBadge}${fmtDate(u.subscription_expires_at)}</span>`
      : `<span class="ts">—</span>`;

    const planLabel = u.subscription_plan
      ? u.subscription_plan.charAt(0).toUpperCase() + u.subscription_plan.slice(1)
      : "—";

    /* Telegram cell — show linked status + per-user action buttons */
    let tgCell;
    if (u.telegram_linked) {
      const tgName = u.telegram_username ? `@${escHtml(u.telegram_username)}` : "linked";
      tgCell = `
        <div class="tg-cell">
          <span class="badge badge-active" title="Linked since ${u.telegram_linked_at ? escHtml(fmtDate(u.telegram_linked_at)) : 'unknown'}">✅ ${tgName}</span>
          <div class="tg-actions">
            <button type="button" class="btn-tg-user-sync" data-action="tg-sync" data-id="${u.id}" aria-label="Sync Telegram group membership" title="Add to group if active subscription, remove if inactive">📱 Sync</button>
            <button type="button" class="btn-tg-user-kick" data-action="tg-kick" data-id="${u.id}" data-username="${escHtml(u.username)}" aria-label="Force kick from Telegram group" title="Force-remove this user from the Telegram group now">🚫 Kick</button>
            <button type="button" class="btn-tg-user-unlink" data-action="tg-unlink" data-id="${u.id}" data-username="${escHtml(u.username)}" aria-label="Unlink Telegram account" title="Unlink Telegram (does not kick from group)">🔓 Unlink</button>
          </div>
        </div>`;
    } else {
      const savedName = u.telegram_username ? ` · @${escHtml(u.telegram_username)}` : "";
      const notLinkedTitle = u.telegram_username
        ? `@${escHtml(u.telegram_username)} saved but not yet linked via bot`
        : "No Telegram account linked";
      tgCell = `<span class="tg-not-linked" title="${notLinkedTitle}">⚠ not linked${savedName}</span>`;
    }

    tr.innerHTML = `
      <td><strong>${escHtml(u.username)}</strong></td>
      <td class="ts">${escHtml(u.email || "—")}</td>
      <td><span class="badge badge-${escHtml(u.role)}">${escHtml(u.role)}</span></td>
      <td><span class="badge badge-${escHtml(u.status)}">${escHtml(u.status)}</span></td>
      <td><span class="badge badge-${escHtml(u.subscription_status)}">${escHtml(u.subscription_status)}</span></td>
      <td class="ts">${escHtml(planLabel)}</td>
      <td>${expiryText}</td>
      <td class="ts">${u.last_login_at ? fmtDateTime(u.last_login_at) : "—"}</td>
      <td class="tg-col">${tgCell}</td>
      <td class="strategies-cell">${strategies}</td>
      <td class="actions-cell">
        <button type="button" class="btn-icon btn-sm" data-action="toggle-status" data-id="${u.id}" data-status="${escHtml(u.status)}" title="${u.status === 'active' ? 'Lock account' : 'Unlock account'}">
          ${u.status === "active" ? "🔒" : "🔓"}
        </button>
        <button type="button" class="btn-icon btn-sm" data-action="edit" data-id="${u.id}" title="Edit user">✏️</button>
        <button type="button" class="btn-icon btn-sm" data-action="reset-password" data-id="${u.id}" data-username="${escHtml(u.username)}" title="Reset password">🔑</button>
        <button type="button" class="btn-icon btn-sm btn-danger" data-action="delete" data-id="${u.id}" data-username="${escHtml(u.username)}" title="Delete user">🗑️</button>
      </td>`;

    tbody.appendChild(tr);
  }

  /* Attach row action handlers */
  tbody.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", handleRowAction);
  });
}

/* ── Stats bar ── */
function updateStats(total, stats) {
  el("statTotal").textContent      = total;
  el("statActiveSubs").textContent = stats.active_subs    ?? "—";
  el("statTrial").textContent      = stats.trial_subs     ?? "—";
  el("statLocked").textContent     = stats.locked_count   ?? "—";
  el("statExpiring").textContent   = stats.expiring_soon  ?? "—";
  const botEl = el("statBotAccess");
  if (botEl) botEl.textContent     = stats.bot_access_count ?? "—";
  /* Telegram stats loaded separately */
}

/* ── Load and display Telegram stats ── */
async function loadTelegramStats() {
  try {
    const resp = await apiRequest("/admin/telegram");
    if (!resp.ok) return;
    const data = await resp.json();
    const s = data.stats || {};
    el("statTgLinked").textContent        = s.total_linked      ?? "—";
    el("statTgActiveUnlinked").textContent = s.active_unlinked  ?? "—";
  } catch {
    /* non-critical, silently ignore */
  }
}

/* ── Pagination ── */
function renderPagination(page, lastPage, total, perPage) {
  const container = document.getElementById("pagination");
  container.innerHTML = "";

  if (lastPage <= 1) return;

  const prev = mkBtn("← Prev", page <= 1, () => loadUsers(page - 1));
  if (page <= 1) prev.disabled = true;
  container.appendChild(prev);

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = `Page ${page} / ${lastPage}`;
  container.appendChild(info);

  const next = mkBtn("Next →", page >= lastPage, () => loadUsers(page + 1));
  if (page >= lastPage) next.disabled = true;
  container.appendChild(next);
}

function mkBtn(label, disabled, onClick) {
  const b = document.createElement("button");
  b.type      = "button";
  b.className = "page-btn";
  b.textContent = label;
  b.disabled  = disabled;
  if (!disabled) b.addEventListener("click", onClick);
  return b;
}

/* ═══════════════════════════════════════════════
   Toolbar bindings
   ═══════════════════════════════════════════════ */
function bindToolbar() {
  let debounceTimer;
  const doSearch = () => {
    currentFilters = {
      search:       el("searchInput").value.trim(),
      status:       el("filterStatus").value,
      subscription: el("filterSub").value,
      role:         el("filterRole").value,
    };
    loadUsers(1, currentFilters);
  };

  el("searchInput").addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 350);
  });
  el("filterStatus").addEventListener("change", doSearch);
  el("filterSub").addEventListener("change",    doSearch);
  el("filterRole").addEventListener("change",   doSearch);

  el("newUserBtn").addEventListener("click", openNewUserModal);

  const syncAllBtn = el("syncAllTgBtn");
  if (syncAllBtn) {
    syncAllBtn.addEventListener("click", async () => {
      if (!confirm("Sync ALL linked Telegram accounts with group membership?\n\nThis will add active subscribers and remove inactive ones. This may take a moment.")) return;
      syncAllBtn.disabled = true;
      syncAllBtn.textContent = "📱 Syncing…";
      try {
        const resp = await apiRequest("/admin/telegram?action=sync_all", { method: "POST" });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          alert("Sync error: " + (data.error || "Unknown error"));
        } else {
          alert(`Sync complete:\n✅ Added: ${data.added ?? 0}\n❌ Kicked: ${data.kicked ?? 0}\n⚠ Errors: ${data.errors ?? 0}`);
          await loadUsers();
        }
      } catch (e) {
        alert("Network error: " + e.message);
      } finally {
        syncAllBtn.disabled = false;
        syncAllBtn.textContent = "📱 Sync All Telegram";
      }
    });
  }
}

/* ═══════════════════════════════════════════════
   Row action handler
   ═══════════════════════════════════════════════ */
async function handleRowAction(e) {
  const btn    = e.currentTarget;
  const action = btn.dataset.action;
  const id     = parseInt(btn.dataset.id, 10);

  if (action === "toggle-status") {
    const current = btn.dataset.status;
    const next    = current === "active" ? "locked" : "active";
    if (!confirm(`${next === "locked" ? "Lock" : "Unlock"} this account?`)) return;
    btn.disabled = true;
    try {
      const resp = await apiRequest("/admin/user?id=" + id, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert("Error: " + (err.error || "Could not update status"));
      } else {
        await loadUsers();
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === "edit") {
    openEditModal(id);
    return;
  }

  if (action === "reset-password") {
    openResetPwModal({ id, username: btn.dataset.username });
    return;
  }

  if (action === "delete") {
    openDeleteModal({ id, username: btn.dataset.username });
    return;
  }

  if (action === "tg-sync") {
    btn.disabled = true;
    try {
      const resp = await apiRequest("/admin/telegram?action=sync_user&id=" + id, { method: "POST" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert("Telegram sync error: " + (data.error || "Unknown error"));
      } else {
        alert(data.message || "Sync complete");
        await loadUsers();
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === "tg-kick") {
    const username = btn.dataset.username || ("user #" + id);
    if (!confirm(`Force-kick ${username} from the Telegram group?\n\nThis removes them from the group immediately regardless of subscription status. Their Telegram account remains linked.`)) return;
    btn.disabled = true;
    try {
      const resp = await apiRequest("/admin/telegram?action=kick&id=" + id, { method: "POST" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert("Kick error: " + (data.error || "Unknown error"));
      } else {
        alert(data.message || "User kicked from group");
        await loadUsers();
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === "tg-unlink") {
    const username = btn.dataset.username || ("user #" + id);
    if (!confirm(`Unlink Telegram from ${username}? This does not kick them from the group.`)) return;
    btn.disabled = true;
    try {
      const resp = await apiRequest("/admin/telegram?id=" + id, { method: "DELETE" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert("Unlink error: " + (data.error || "Unknown error"));
      } else {
        await loadUsers();
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }
}

/* ═══════════════════════════════════════════════
   Edit Modal
   ═══════════════════════════════════════════════ */
function openEditModal(userId) {
  editingUserId = userId;

  /* Use cached user data populated during renderTable */
  const u = userCache.get(userId);
  if (!u) {
    alert("User data not found. Please reload the page.");
    return;
  }

  const strategies = u.strategies || [];

  /* Populate modal */
  document.getElementById("editModalTitle").textContent = u.username;
  setSelectValue("editStatus",    u.status || "active");
  setSelectValue("editRole",      u.role   || "user");
  setSelectValue("editSubStatus", u.subscription_status || "inactive");
  setSelectValue("editSubPlan",   u.subscription_plan || "");

  /* Pre-fill expiry date using ISO extraction for reliable cross-browser handling */
  const expiryInput = el("editSubExpiry");
  expiryInput.value = u.subscription_expires_at
    ? new Date(u.subscription_expires_at).toISOString().split("T")[0]
    : "";

  /* Pre-fill telegram username (strip leading @ if present) */
  const tgInput = el("editTelegramUsername");
  if (tgInput) {
    tgInput.value = u.telegram_username ? u.telegram_username.replace(/^@/, "") : "";
  }

  document.getElementById("editError").textContent = "";

  editingUserStrategies = strategies;
  buildStrategyChecks("editStrategyChecks", strategies);

  /* Load profiles section */
  loadEditModalProfiles(userId);

  document.getElementById("editModal").style.display = "flex";
}

/* ── Profiles section inside the Edit modal ── */
async function loadEditModalProfiles(userId) {
  const listEl   = el("editProfilesList");
  const selectEl = el("editProfileSelect");
  if (!listEl || !selectEl) return;

  listEl.textContent = "Loading…";
  selectEl.innerHTML = `<option value="">— Select a profile to assign —</option>`;

  try {
    /* Fetch assigned profiles for this user and all available profiles in parallel */
    const [assignedResp, allResp] = await Promise.all([
      apiRequest("/admin/profiles?action=assignments&user_id=" + userId),
      apiRequest("/admin/profiles"),
    ]);

    const assignedData  = assignedResp.ok ? await assignedResp.json() : { assignments: [] };
    const allData       = allResp.ok      ? await allResp.json()      : { profiles: [] };

    const assigned    = assignedData.assignments || [];
    const allProfiles = allData.profiles || [];
    const assignedIds = new Set(assigned.map(p => p.id));

    /* Render currently assigned profiles */
    if (!assigned.length) {
      listEl.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">No profiles assigned yet.</span>`;
    } else {
      listEl.innerHTML = "";
      for (const p of assigned) {
        const tag = document.createElement("span");
        tag.className = "profile-assigned-tag";
        tag.innerHTML = `${escHtml(p.name)} <button type="button" class="btn-unassign-profile" data-pid="${p.id}" title="Remove profile" aria-label="Remove profile ${escHtml(p.name)}">✕</button>`;
        tag.querySelector(".btn-unassign-profile").addEventListener("click", async () => {
          await unassignProfileFromEditModal(userId, p.id);
        });
        listEl.appendChild(tag);
      }
    }

    /* Populate select with profiles not yet assigned */
    const unassigned = allProfiles.filter(p => !assignedIds.has(p.id));
    if (unassigned.length) {
      for (const p of unassigned) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + (p.is_admin_profile ? " ⭐" : "");
        selectEl.appendChild(opt);
      }
    }
  } catch (e) {
    listEl.textContent = "Failed to load profiles.";
  }
}

async function unassignProfileFromEditModal(userId, profileId) {
  try {
    const resp = await apiRequest("/admin/profiles?action=unassign", {
      method: "DELETE",
      body: JSON.stringify({ profile_id: profileId, user_id: userId }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert("Error: " + (err.error || "Could not remove profile"));
      return;
    }
    await loadEditModalProfiles(userId);
    await loadProfiles();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function assignProfileFromEditModal(userId) {
  const selectEl  = el("editProfileSelect");
  const profileId = parseInt(selectEl?.value || "0", 10);
  if (!profileId) return;

  const btn = el("editProfileAssignBtn");
  if (btn) btn.disabled = true;
  try {
    const resp = await apiRequest("/admin/profiles?action=assign", {
      method: "POST",
      body: JSON.stringify({ profile_id: profileId, user_id: userId }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert("Error: " + (err.error || "Could not assign profile"));
      return;
    }
    await loadEditModalProfiles(userId);
    await loadProfiles();
  } catch (e) {
    alert("Network error: " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ── Save edit ── */
async function saveEdit() {
  const btn     = document.getElementById("editSaveBtn");
  const errEl   = document.getElementById("editError");
  errEl.textContent = "";
  btn.disabled  = true;
  btn.textContent = "Saving…";

  const status   = el("editStatus").value;
  const role     = el("editRole").value;
  const sub      = el("editSubStatus").value;
  const plan     = el("editSubPlan").value || null;
  const expiry   = el("editSubExpiry").value || null;
  const telegramUsername = (el("editTelegramUsername")?.value || "").trim().replace(/^@/, "") || null;
  const newStrats = getCheckedStrategies("editStrategyChecks");

  try {
    /* Update user fields */
    const resp = await apiRequest("/admin/user?id=" + editingUserId, {
      method: "PATCH",
      body: JSON.stringify({ status, role, subscription_status: sub, subscription_plan: plan, subscription_expires_at: expiry, telegram_username: telegramUsername }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save");
    }

    /* Sync strategies: grant new, revoke removed */
    const prev    = new Set(editingUserStrategies);
    const next    = new Set(newStrats);
    const toGrant = [...next].filter(k => !prev.has(k));
    const toRevoke = [...prev].filter(k => !next.has(k));

    for (const key of toGrant) {
      const grantResp = await apiRequest("/admin/strategy_access", {
        method: "POST",
        body: JSON.stringify({ user_id: editingUserId, strategy_key: key }),
      });
      if (!grantResp.ok) {
        const grantErr = await grantResp.json().catch(() => ({}));
        throw new Error(grantErr.error || `Failed to grant strategy: ${key}`);
      }
    }
    for (const key of toRevoke) {
      const revokeResp = await apiRequest("/admin/strategy_access", {
        method: "DELETE",
        body: JSON.stringify({ user_id: editingUserId, strategy_key: key }),
      });
      if (!revokeResp.ok) {
        const revokeErr = await revokeResp.json().catch(() => ({}));
        throw new Error(revokeErr.error || `Failed to revoke strategy: ${key}`);
      }
    }

    closeModal("editModal");
    await loadUsers();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

/* ═══════════════════════════════════════════════
   New User Modal
   ═══════════════════════════════════════════════ */
function openNewUserModal() {
  el("newUsername").value          = "";
  el("newEmail").value             = "";
  el("newPassword").value          = "";
  el("newRole").value              = "user";
  el("newSubStatus").value         = "inactive";
  el("newSubPlan").value           = "";
  el("newSubExpiry").value         = "";
  el("newTelegramUsername").value  = "";
  el("newUserError").textContent   = "";
  buildStrategyChecks("newStrategyChecks", []);
  document.getElementById("newUserModal").style.display = "flex";
}

async function saveNewUser() {
  const btn   = document.getElementById("newUserSaveBtn");
  const errEl = document.getElementById("newUserError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creating…";

  const username       = el("newUsername").value.trim();
  const email          = el("newEmail").value.trim();
  const password       = el("newPassword").value;
  const role           = el("newRole").value;
  const sub            = el("newSubStatus").value;
  const plan           = el("newSubPlan").value || null;
  const expiry         = el("newSubExpiry").value || null;
  const telegramUsername = (el("newTelegramUsername")?.value || "").trim().replace(/^@/, "") || null;
  const strategies     = getCheckedStrategies("newStrategyChecks");

  if (!username || !password) {
    errEl.textContent = "Username and password are required";
    btn.disabled = false; btn.textContent = "Create User";
    return;
  }

  try {
    const resp = await apiRequest("/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, email, password, role, subscription_status: sub, subscription_plan: plan, subscription_expires_at: expiry, telegram_username: telegramUsername, strategies }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to create user");

    closeModal("newUserModal");
    await loadUsers(1);
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Create User";
  }
}

/* ═══════════════════════════════════════════════
   Reset Password Modal
   ═══════════════════════════════════════════════ */
function openResetPwModal(user) {
  resetPwUser = user;
  document.getElementById("resetPwModalTitle").textContent = user.username;
  document.getElementById("resetPwNew").value     = "";
  document.getElementById("resetPwConfirm").value = "";
  document.getElementById("resetPwError").textContent = "";
  document.getElementById("resetPwModal").style.display = "flex";
  document.getElementById("resetPwNew").focus();
}

async function saveResetPassword() {
  const btn   = document.getElementById("resetPwSaveBtn");
  const errEl = document.getElementById("resetPwError");
  errEl.textContent = "";

  const newPw     = document.getElementById("resetPwNew").value;
  const confirmPw = document.getElementById("resetPwConfirm").value;

  if (!newPw) {
    errEl.textContent = "New password is required";
    return;
  }
  if (newPw.length < 8) {
    errEl.textContent = "Password must be at least 8 characters";
    return;
  }
  if (newPw !== confirmPw) {
    errEl.textContent = "Passwords do not match";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const resp = await apiRequest("/admin/user?id=" + encodeURIComponent(resetPwUser.id), {
      method: "PATCH",
      body: JSON.stringify({ password: newPw }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || "Failed to reset password");
    }
    closeModal("resetPwModal");
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Reset Password";
  }
}

/* ═══════════════════════════════════════════════
   Delete Modal
   ═══════════════════════════════════════════════ */
function openDeleteModal(user) {
  deletingUser = user;
  document.getElementById("deleteModalUsername").textContent = user.username;
  document.getElementById("deleteConfirmInput").value = "";
  document.getElementById("deleteError").textContent  = "";
  document.getElementById("deleteModal").style.display = "flex";
  document.getElementById("deleteConfirmInput").focus();
}

async function confirmDelete() {
  const input = el("deleteConfirmInput").value.trim();
  const errEl = document.getElementById("deleteError");
  errEl.textContent = "";

  if (input !== deletingUser.username) {
    errEl.textContent = "Username does not match";
    return;
  }

  const btn = document.getElementById("deleteConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Deleting…";

  try {
    const resp = await apiRequest("/admin/user?id=" + deletingUser.id, { method: "DELETE" });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete user");
    }
    closeModal("deleteModal");
    await loadUsers();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Delete";
  }
}

/* ═══════════════════════════════════════════════
   Modal bindings
   ═══════════════════════════════════════════════ */
function bindModals() {
  document.getElementById("editSaveBtn").addEventListener("click",   saveEdit);
  document.getElementById("editCancelBtn").addEventListener("click", () => closeModal("editModal"));

  const assignBtn = el("editProfileAssignBtn");
  if (assignBtn) {
    assignBtn.addEventListener("click", () => assignProfileFromEditModal(editingUserId));
  }

  document.getElementById("resetPwSaveBtn").addEventListener("click",   saveResetPassword);
  document.getElementById("resetPwCancelBtn").addEventListener("click", () => closeModal("resetPwModal"));

  document.getElementById("newUserSaveBtn").addEventListener("click",   saveNewUser);
  document.getElementById("newUserCancelBtn").addEventListener("click", () => closeModal("newUserModal"));

  document.getElementById("deleteConfirmBtn").addEventListener("click", confirmDelete);
  document.getElementById("deleteCancelBtn").addEventListener("click",  () => closeModal("deleteModal"));

  /* Close on backdrop click */
  ["editModal", "newUserModal", "resetPwModal", "deleteModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  /* Enter key in delete confirm */
  document.getElementById("deleteConfirmInput").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmDelete();
  });

  /* Enter key in reset-password fields */
  ["resetPwNew", "resetPwConfirm"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") saveResetPassword();
    });
  });
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

/* ═══════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════ */
function el(id) { return document.getElementById(id); }

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setSelectValue(selectId, value) {
  const sel = el(selectId);
  if (!sel) return;
  for (const opt of sel.options) {
    if (opt.value === value || opt.text.trim().toLowerCase() === value.toLowerCase()) {
      sel.value = opt.value;
      return;
    }
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/* ═══════════════════════════════════════════════
   Profiles Management
   ═══════════════════════════════════════════════ */
let assigningProfileId   = null;  /* profile id open in assign modal */
let assigningProfileName = "";

async function loadProfiles() {
  const tbody = document.getElementById("profilesTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading…</td></tr>`;

  try {
    const resp = await apiRequest("/admin/profiles");
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color:var(--danger-soft)">
        Error: ${escHtml(err.error || "Failed to load profiles")}
      </td></tr>`;
      return;
    }
    const data = await resp.json();
    renderProfilesTable(data.profiles || []);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color:var(--danger-soft)">
      Network error — ${escHtml(e.message)}
    </td></tr>`;
  }
}

function renderProfilesTable(profiles) {
  const tbody = document.getElementById("profilesTableBody");
  if (!tbody) return;
  if (!profiles.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No profiles yet. Click "＋ New Profile" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  for (const p of profiles) {
    const tr = document.createElement("tr");
    const typeBadge = p.is_admin_profile
      ? `<span class="badge-admin-profile">⭐ Admin</span>`
      : `<span class="badge-user-profile">👤 User</span>`;

    tr.innerHTML = `
      <td><strong>${escHtml(p.name)}</strong></td>
      <td>${typeBadge}</td>
      <td class="ts">${escHtml(p.created_by_username || "—")}</td>
      <td class="ts">${p.assignment_count} user${p.assignment_count === 1 ? "" : "s"}</td>
      <td class="ts">${fmtDate(p.updated_at)}</td>
      <td class="actions-cell">
        <button type="button" class="btn-icon btn-sm" data-paction="assign" data-pid="${p.id}" data-pname="${escHtml(p.name)}" title="Assign to users">📌</button>
        <button type="button" class="btn-icon btn-sm btn-danger" data-paction="delete" data-pid="${p.id}" data-pname="${escHtml(p.name)}" title="Delete profile">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-paction]").forEach(btn => {
    btn.addEventListener("click", handleProfileAction);
  });
}

async function handleProfileAction(e) {
  const btn    = e.currentTarget;
  const action = btn.dataset.paction;
  const id     = parseInt(btn.dataset.pid, 10);
  const name   = btn.dataset.pname;

  if (action === "assign") {
    openAssignProfileModal(id, name);
    return;
  }

  if (action === "delete") {
    if (!confirm(`Delete profile "${name}"?\n\nThis will also remove all user assignments.`)) return;
    btn.disabled = true;
    try {
      const resp = await apiRequest("/admin/profiles?id=" + id, { method: "DELETE" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert("Error: " + (err.error || "Could not delete profile"));
      } else {
        await loadProfiles();
      }
    } finally {
      btn.disabled = false;
    }
  }
}

/* ── New Profile Modal ── */
function openNewProfileModal() {
  el("newProfileName").value      = "";
  el("newProfileSettings").value  = "";
  el("newProfileIsAdmin").checked = false;
  el("newProfileError").textContent = "";
  el("newProfileModal").style.display = "flex";
  el("newProfileName").focus();
}

async function saveNewProfile() {
  const btn   = el("newProfileSaveBtn");
  const errEl = el("newProfileError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creating…";

  const name    = el("newProfileName").value.trim();
  const isAdmin = el("newProfileIsAdmin").checked;
  const rawJson = el("newProfileSettings").value.trim();

  if (!name) {
    errEl.textContent = "Profile name is required";
    btn.disabled = false; btn.textContent = "Create Profile";
    return;
  }

  let settings = {};
  if (rawJson) {
    try { settings = JSON.parse(rawJson); }
    catch {
      errEl.textContent = "Settings JSON is invalid — check for syntax errors";
      btn.disabled = false; btn.textContent = "Create Profile";
      return;
    }
  }

  try {
    const resp = await apiRequest("/admin/profiles", {
      method: "POST",
      body: JSON.stringify({ name, settings, is_admin_profile: isAdmin }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to create profile");
    closeModal("newProfileModal");
    await loadProfiles();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Profile";
  }
}

/* ── Assign Profile Modal ── */
function openAssignProfileModal(profileId, profileName) {
  assigningProfileId   = profileId;
  assigningProfileName = profileName;
  el("assignProfileModalTitle").textContent = profileName;
  el("profileAssignSearch").value  = "";
  el("profileAssignSearchResults").innerHTML = "";
  el("assignProfileError").textContent = "";
  el("assignProfileModal").style.display = "flex";
  el("profileAssignSearch").focus();
}

async function searchUsersForAssign(query) {
  const container = el("profileAssignSearchResults");
  if (!query) { container.innerHTML = ""; return; }

  container.innerHTML = `<div class="assign-user-row" style="color:var(--text-muted)">Searching…</div>`;

  try {
    /* Load first page filtered by search, then show top results */
    const params = new URLSearchParams({ page: 1, per_page: 10, search: query });
    const resp   = await apiRequest("/admin/users?" + params);
    if (!resp.ok) { container.innerHTML = ""; return; }

    const data  = await resp.json();
    const users = data.users || [];

    /* Fetch which user IDs already have this profile assigned */
    const assResp = await apiRequest("/admin/profiles?action=assignments_for_profile&profile_id=" + assigningProfileId);
    let assignedUserIds = new Set();
    if (assResp.ok) {
      const assData = await assResp.json();
      (assData.assigned_user_ids || []).forEach(id => assignedUserIds.add(id));
    }

    if (!users.length) {
      container.innerHTML = `<div class="assign-user-row" style="color:var(--text-muted)">No users found</div>`;
      return;
    }

    container.innerHTML = "";
    for (const u of users) {
      const isAssigned = assignedUserIds.has(u.id);
      const row = document.createElement("div");
      row.className = "assign-user-row";
      row.innerHTML = `
        <span>${escHtml(u.username)}${u.email ? ` <span style="color:var(--text-muted);font-size:11px;">(${escHtml(u.email)})</span>` : ""}</span>
        <button type="button" class="${isAssigned ? "btn-unassign-user" : "btn-assign-user"}"
                data-uid="${u.id}" data-uname="${escHtml(u.username)}">
          ${isAssigned ? "Remove" : "Assign"}
        </button>`;
      row.querySelector("button").addEventListener("click", async (ev) => {
        const btn    = ev.currentTarget;
        const uid    = parseInt(btn.dataset.uid, 10);
        const remove = btn.classList.contains("btn-unassign-user");
        btn.disabled = true;
        try {
          let resp;
          if (remove) {
            resp = await apiRequest("/admin/profiles?action=unassign", {
              method: "DELETE",
              body: JSON.stringify({ profile_id: assigningProfileId, user_id: uid }),
            });
          } else {
            resp = await apiRequest("/admin/profiles?action=assign", {
              method: "POST",
              body: JSON.stringify({ profile_id: assigningProfileId, user_id: uid }),
            });
          }
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            el("assignProfileError").textContent = err.error || "Request failed";
          } else {
            /* Toggle button state */
            btn.textContent = remove ? "Assign" : "Remove";
            btn.className   = remove ? "btn-assign-user" : "btn-unassign-user";
            await loadProfiles(); /* refresh assignment count */
          }
        } finally {
          btn.disabled = false;
        }
      });
      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div class="assign-user-row" style="color:var(--danger-soft)">${escHtml(e.message)}</div>`;
  }
}

/* ── Bind profile modal buttons ── */
function bindProfileModals() {
  const newBtn = el("newProfileBtn");
  if (newBtn) newBtn.addEventListener("click", openNewProfileModal);

  const refreshBtn = el("refreshProfilesBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", loadProfiles);

  const saveBtn = el("newProfileSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveNewProfile);

  const cancelBtn = el("newProfileCancelBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeModal("newProfileModal"));

  const closeAssign = el("assignProfileCloseBtn");
  if (closeAssign) closeAssign.addEventListener("click", () => closeModal("assignProfileModal"));

  /* Live search in assign modal */
  const searchInput = el("profileAssignSearch");
  if (searchInput) {
    let timer;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => searchUsersForAssign(searchInput.value.trim()), 500);
    });
  }

  /* Close on backdrop click */
  ["newProfileModal", "assignProfileModal"].forEach(id => {
    const el_ = document.getElementById(id);
    if (el_) el_.addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  /* Enter key in new profile name */
  const nameInput = el("newProfileName");
  if (nameInput) nameInput.addEventListener("keydown", e => { if (e.key === "Enter") saveNewProfile(); });
}

