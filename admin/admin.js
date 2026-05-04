/* =========================================================
   IT Guru – Admin Dashboard JS
   ========================================================= */

"use strict";

const ADMIN_API = (typeof window !== "undefined" && window.ITGURU_AUTH_API_BASE)
  ? window.ITGURU_AUTH_API_BASE.replace(/\/auth\/?$/, "")
  : "https://trading.dsitservicesja.com/api";

/* ── State ── */
let allStrategies   = [];   /* [{ key, label }] */
let currentPage     = 1;
let currentFilters  = {};
let editingUserId   = null;
let editingUserStrategies = [];
let deletingUser    = null; /* { id, username } */
const userCache     = new Map(); /* id → user object from last load */

/* ═══════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  /* ── Guard: only admins may enter ── */
  if (!ITGuruAuth.isLoggedIn()) {
    showLoginOverlay();
    return;
  }

  const valid = await ITGuruAuth.verify();
  if (!valid) {
    ITGuruAuth.logout();
    showLoginOverlay();
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

  /* Logout */
  document.getElementById("adminLogoutBtn").addEventListener("click", () => {
    ITGuruAuth.logout();
    location.reload();
  });

  /* Load strategy list then users */
  await loadStrategies();
  buildStrategyChecks("editStrategyChecks",  []);
  buildStrategyChecks("newStrategyChecks",   []);
  await loadUsers();
  bindToolbar();
  bindModals();
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
  /* php fallback */
  if (resp.status === 404 && !path.endsWith(".php")) {
    const fallback = await fetch(url + ".php", { ...options, headers });
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
  for (const s of allStrategies) {
    const label = document.createElement("label");
    label.className = "strategy-check-item";
    const cb = document.createElement("input");
    cb.type     = "checkbox";
    cb.value    = s.key;
    cb.checked  = granted.has(s.key);
    cb.dataset.stratKey = s.key;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(s.label));
    container.appendChild(label);
  }
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
  tbody.innerHTML = `<tr><td colspan="9" class="table-empty">Loading…</td></tr>`;

  try {
    const resp = await apiRequest("/admin/users?" + params);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty" style="color:var(--danger-soft)">
        Error: ${escHtml(err.error || "Failed to load users")}
      </td></tr>`;
      return;
    }

    const data = await resp.json();
    renderTable(data.users || []);
    renderPagination(data.page, data.last_page, data.total, data.per_page);
    updateStats(data.total, data.stats || {});
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty" style="color:var(--danger-soft)">
      Network error — ${escHtml(e.message)}
    </td></tr>`;
  }
}

/* ── Render rows ── */
function renderTable(users) {
  const tbody = document.getElementById("userTableBody");
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No users found.</td></tr>`;
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
      const label = allStrategies.find(s => s.key === k)?.label || k;
      return `<span class="strategy-tag">${escHtml(label)}</span>`;
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

    tr.innerHTML = `
      <td><strong>${escHtml(u.username)}</strong></td>
      <td class="ts">${escHtml(u.email || "—")}</td>
      <td><span class="badge badge-${escHtml(u.role)}">${escHtml(u.role)}</span></td>
      <td><span class="badge badge-${escHtml(u.status)}">${escHtml(u.status)}</span></td>
      <td><span class="badge badge-${escHtml(u.subscription_status)}">${escHtml(u.subscription_status)}</span></td>
      <td>${expiryText}</td>
      <td class="ts">${u.last_login_at ? fmtDateTime(u.last_login_at) : "—"}</td>
      <td class="strategies-cell">${strategies}</td>
      <td class="actions-cell">
        <button type="button" class="btn-icon btn-sm" data-action="toggle-status" data-id="${u.id}" data-status="${escHtml(u.status)}" title="${u.status === 'active' ? 'Lock account' : 'Unlock account'}">
          ${u.status === "active" ? "🔒" : "🔓"}
        </button>
        <button type="button" class="btn-icon btn-sm" data-action="edit" data-id="${u.id}" title="Edit user">✏️</button>
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
  el("statActiveSubs").textContent = stats.active_subs   ?? "—";
  el("statTrial").textContent      = stats.trial_subs    ?? "—";
  el("statLocked").textContent     = stats.locked_count  ?? "—";
  el("statExpiring").textContent   = stats.expiring_soon ?? "—";
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

  if (action === "delete") {
    openDeleteModal({ id, username: btn.dataset.username });
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

  /* Pre-fill expiry date (convert datetime to date-only for the date input) */
  const expiryInput = el("editSubExpiry");
  expiryInput.value = u.subscription_expires_at
    ? u.subscription_expires_at.split(" ")[0].split("T")[0]
    : "";

  document.getElementById("editError").textContent = "";

  editingUserStrategies = strategies;
  buildStrategyChecks("editStrategyChecks", strategies);
  document.getElementById("editModal").style.display = "flex";
}

/* ── Save edit ── */
async function saveEdit() {
  const btn     = document.getElementById("editSaveBtn");
  const errEl   = document.getElementById("editError");
  errEl.textContent = "";
  btn.disabled  = true;
  btn.textContent = "Saving…";

  const status  = el("editStatus").value;
  const role    = el("editRole").value;
  const sub     = el("editSubStatus").value;
  const expiry  = el("editSubExpiry").value || null;
  const newStrats = getCheckedStrategies("editStrategyChecks");

  try {
    /* Update user fields */
    const resp = await apiRequest("/admin/user?id=" + editingUserId, {
      method: "PATCH",
      body: JSON.stringify({ status, role, subscription_status: sub, subscription_expires_at: expiry }),
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
      await apiRequest("/admin/strategy_access", {
        method: "POST",
        body: JSON.stringify({ user_id: editingUserId, strategy_key: key }),
      });
    }
    for (const key of toRevoke) {
      await apiRequest("/admin/strategy_access", {
        method: "DELETE",
        body: JSON.stringify({ user_id: editingUserId, strategy_key: key }),
      });
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
  el("newUsername").value  = "";
  el("newEmail").value     = "";
  el("newPassword").value  = "";
  el("newRole").value      = "user";
  el("newSubStatus").value = "inactive";
  el("newSubExpiry").value = "";
  el("newUserError").textContent = "";
  buildStrategyChecks("newStrategyChecks", []);
  document.getElementById("newUserModal").style.display = "flex";
}

async function saveNewUser() {
  const btn   = document.getElementById("newUserSaveBtn");
  const errEl = document.getElementById("newUserError");
  errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Creating…";

  const username  = el("newUsername").value.trim();
  const email     = el("newEmail").value.trim();
  const password  = el("newPassword").value;
  const role      = el("newRole").value;
  const sub       = el("newSubStatus").value;
  const expiry    = el("newSubExpiry").value || null;
  const strategies = getCheckedStrategies("newStrategyChecks");

  if (!username || !password) {
    errEl.textContent = "Username and password are required";
    btn.disabled = false; btn.textContent = "Create User";
    return;
  }

  try {
    const resp = await apiRequest("/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, email, password, role, subscription_status: sub, subscription_expires_at: expiry, strategies }),
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

  document.getElementById("newUserSaveBtn").addEventListener("click",   saveNewUser);
  document.getElementById("newUserCancelBtn").addEventListener("click", () => closeModal("newUserModal"));

  document.getElementById("deleteConfirmBtn").addEventListener("click", confirmDelete);
  document.getElementById("deleteCancelBtn").addEventListener("click",  () => closeModal("deleteModal"));

  /* Close on backdrop click */
  ["editModal", "newUserModal", "deleteModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  /* Enter key in delete confirm */
  document.getElementById("deleteConfirmInput").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmDelete();
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
