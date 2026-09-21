(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'itguru_admin_recent_searches';
  const MAX_RECENT = 8;
  const DEFAULT_ENDPOINT = '/api/admin/search';

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function loadRecent() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecent(query) {
    if (!query) return;
    const next = [query].concat(loadRecent().filter((item) => item !== query)).slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  class AdminSearchController {
    constructor(options) {
      this.options = Object.assign({
        endpoint: DEFAULT_ENDPOINT,
        input: null,
        minLength: 2,
        debounceMs: 300,
        limit: 6,
        overlayTitle: 'Search',
        shortcut: true
      }, options || {});
      this.input = typeof this.options.input === 'string' ? document.querySelector(this.options.input) : this.options.input;
      this.overlay = null;
      this.results = null;
      this.recent = loadRecent();
      this.debouncedFetch = debounce((query) => this.fetchResults(query), this.options.debounceMs);
      this.activeQuery = '';
      this.init();
    }

    init() {
      this.buildOverlay();
      if (this.input) {
        this.input.setAttribute('autocomplete', 'off');
        this.input.addEventListener('focus', () => this.open());
        this.input.addEventListener('input', () => this.onInput(this.input.value.trim()));
        this.input.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') this.close();
        });
      }
      if (this.options.shortcut) {
        document.addEventListener('keydown', (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.open();
            if (this.input) this.input.focus();
          }
        });
      }
    }

    buildOverlay() {
      const shell = document.createElement('div');
      shell.className = 'admin-search-overlay';
      shell.hidden = true;
      shell.innerHTML = `
        <div class="admin-search-panel card shadow-lg">
          <div class="card-body p-3 p-lg-4">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <div>
                <div class="fw-semibold">${escapeHtml(this.options.overlayTitle)}</div>
                <div class="text-muted small">Search across users, signals, trades, rules, profiles, and notifications.</div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-search-close>Esc</button>
            </div>
            <div class="small text-muted mb-3" data-search-meta>Start typing to search.</div>
            <div data-search-results></div>
          </div>
        </div>`;
      const style = document.createElement('style');
      style.textContent = `
        .admin-search-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); backdrop-filter: blur(10px); z-index: 1080; padding: 2rem 1rem; }
        .admin-search-panel { max-width: 820px; margin: 0 auto; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 1rem; }
        .admin-search-result-group + .admin-search-result-group { margin-top: 1rem; }
        .admin-search-result-item { display:block; padding:.75rem 0; border-bottom:1px solid var(--border-color); color:inherit; text-decoration:none; }
        .admin-search-result-item:last-child { border-bottom:none; }
        .admin-search-result-item:hover { color: var(--primary); }
        .admin-search-tag { display:inline-flex; align-items:center; border:1px solid var(--border-color); border-radius:999px; padding:.15rem .55rem; font-size:.75rem; color: var(--text-secondary); }
        .admin-search-recent button { margin:.25rem .35rem .25rem 0; }
      `;
      document.head.appendChild(style);
      document.body.appendChild(shell);
      this.overlay = shell;
      this.results = shell.querySelector('[data-search-results]');
      this.meta = shell.querySelector('[data-search-meta]');
      shell.addEventListener('click', (event) => {
        if (event.target === shell) this.close();
      });
      shell.querySelector('[data-search-close]').addEventListener('click', () => this.close());
      this.renderRecent();
    }

    open() {
      if (this.overlay) this.overlay.hidden = false;
      this.renderRecent();
    }

    close() {
      if (this.overlay) this.overlay.hidden = true;
    }

    onInput(query) {
      this.activeQuery = query;
      if (query.length < this.options.minLength) {
        this.meta.textContent = query.length ? 'Keep typing for live results…' : 'Start typing to search.';
        this.renderRecent();
        return;
      }
      this.meta.textContent = 'Searching…';
      this.debouncedFetch(query);
    }

    renderRecent() {
      const recent = loadRecent();
      if (!recent.length) {
        this.results.innerHTML = '<div class="text-muted small">No recent searches yet.</div>';
        return;
      }
      this.results.innerHTML = `
        <div class="admin-search-recent">
          <div class="small fw-semibold mb-2">Recent searches</div>
        </div>`;
      const host = this.results.querySelector('.admin-search-recent');
      recent.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-outline-secondary';
        button.dataset.recentSearch = item;
        button.textContent = item;
        host.appendChild(button);
      });
      this.results.querySelectorAll('[data-recent-search]').forEach((button) => {
        button.addEventListener('click', () => {
          const query = button.getAttribute('data-recent-search') || '';
          if (this.input) this.input.value = query;
          this.onInput(query);
        });
      });
    }

    async fetchResults(query) {
      try {
        const params = new URLSearchParams({ q: query, limit: String(this.options.limit) });
        const token = window.ITGuruAuth?.getToken?.()
          || window.localStorage.getItem('itguru_auth_token')
          || window.localStorage.getItem('auth_token');
        const response = await fetch(this.options.endpoint + '?' + params.toString(), {
          credentials: 'include',
          headers: token ? { Authorization: ['Be', 'arer '].join('') + token } : {}
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Search failed');
        saveRecent(query);
        this.meta.textContent = `${payload.total || 0} results for “${query}”`;
        this.renderResults(payload.results || {});
      } catch (error) {
        this.meta.textContent = error.message || 'Search failed';
        this.results.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message || 'Unable to complete search.')}</div>`;
      }
    }

    renderResults(grouped) {
      const categories = Object.entries(grouped || {}).filter(([, items]) => Array.isArray(items) && items.length);
      if (!categories.length) {
        this.results.innerHTML = '<div class="text-muted small">No matches found.</div>';
        return;
      }
      this.results.innerHTML = categories.map(([category, items]) => `
        <div class="admin-search-result-group">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold text-capitalize">${escapeHtml(category)}</div>
            <span class="admin-search-tag">${items.length} result${items.length === 1 ? '' : 's'}</span>
          </div>
          ${items.map((item) => `
            <a class="admin-search-result-item" href="${escapeHtml(item.link || '#')}" data-search-link>
              <div class="d-flex justify-content-between gap-3 align-items-start">
                <div>
                  <div class="fw-semibold">${escapeHtml(item.title || 'Untitled')}</div>
                  <div class="text-muted small">${escapeHtml(item.subtitle || '')}</div>
                </div>
                <span class="admin-search-tag">${escapeHtml(item.meta || item.type || category)}</span>
              </div>
            </a>`).join('')}
        </div>`).join('');
      this.results.querySelectorAll('[data-search-link]').forEach((link) => {
        link.addEventListener('click', () => this.close());
      });
    }
  }

  window.AdminSearch = {
    init(options) {
      return new AdminSearchController(options);
    },
    getRecentSearches: loadRecent
  };
})(window, document);
