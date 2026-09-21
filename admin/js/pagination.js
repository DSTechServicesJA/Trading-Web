(function (window, document) {
  'use strict';

  const PAGE_SIZES = [25, 50, 100, 250, 500];
  const DEFAULT_PAGE_SIZE = 50;
  const STORAGE_PREFIX = 'itguru_admin_page_size_';

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

  class PaginationController {
    constructor(options) {
      this.options = Object.assign({
        pageSizes: PAGE_SIZES,
        pageSize: DEFAULT_PAGE_SIZE,
        page: 1,
        total: 0,
        debounceMs: 250,
        key: 'default',
        method: 'GET',
        limitParam: 'limit',
        offsetParam: 'offset',
        pageParam: 'page',
        pageSizeParam: 'per_page',
        mode: 'offset',
        renderError: null,
        onData: null,
        query: null,
        endpoint: ''
      }, options || {});

      this.state = {
        page: Number(this.options.page) || 1,
        pageSize: this.loadPageSize(),
        total: Number(this.options.total) || 0,
        loading: false,
        lastResponse: null
      };

      this.container = typeof this.options.container === 'string'
        ? document.querySelector(this.options.container)
        : this.options.container;
      this.summary = typeof this.options.summary === 'string'
        ? document.querySelector(this.options.summary)
        : this.options.summary;
      this._debouncedLoad = debounce(() => this.load(1), this.options.debounceMs);
      if (this.container) this.render();
    }

    loadPageSize() {
      const saved = Number(window.localStorage.getItem(STORAGE_PREFIX + this.options.key));
      return this.options.pageSizes.includes(saved) ? saved : this.options.pageSize;
    }

    savePageSize() {
      window.localStorage.setItem(STORAGE_PREFIX + this.options.key, String(this.state.pageSize));
    }

    setTotal(total) {
      this.state.total = Math.max(0, Number(total) || 0);
      this.render();
    }

    totalPages() {
      return Math.max(1, Math.ceil(this.state.total / this.state.pageSize));
    }

    buildParams(pageOverride) {
      const page = Math.max(1, Number(pageOverride || this.state.page));
      const params = new URLSearchParams();
      const extra = typeof this.options.query === 'function' ? this.options.query() : (this.options.query || {});
      Object.entries(extra || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') params.set(key, value);
      });

      if (this.options.mode === 'page') {
        params.set(this.options.pageParam, String(page));
        params.set(this.options.pageSizeParam, String(this.state.pageSize));
      } else {
        params.set(this.options.limitParam, String(this.state.pageSize));
        params.set(this.options.offsetParam, String((page - 1) * this.state.pageSize));
      }
      return params;
    }

    async load(pageOverride) {
      const page = Math.max(1, Number(pageOverride || this.state.page));
      this.state.page = page;
      this.state.loading = true;
      this.render();

      try {
        const params = this.buildParams(page);
        const url = this.options.endpoint + (this.options.endpoint.includes('?') ? '&' : '?') + params.toString();
        const response = await fetch(url, {
          method: this.options.method,
          headers: Object.assign({ 'Content-Type': 'application/json' }, this.options.headers || {}),
          credentials: this.options.credentials || 'include'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to load paginated data');
        this.state.lastResponse = payload;
        this.state.loading = false;
        if (typeof this.options.resolveTotal === 'function') {
          this.state.total = Number(this.options.resolveTotal(payload, this.state.pageSize)) || 0;
        }
        if (typeof this.options.onData === 'function') {
          this.options.onData(payload, { page: this.state.page, pageSize: this.state.pageSize, total: this.state.total, totalPages: this.totalPages() });
        }
        this.render();
        return payload;
      } catch (error) {
        this.state.loading = false;
        this.render();
        if (typeof this.options.renderError === 'function') this.options.renderError(error);
        throw error;
      }
    }

    queueReload() {
      this._debouncedLoad();
    }

    changePageSize(nextSize) {
      this.state.pageSize = Number(nextSize) || DEFAULT_PAGE_SIZE;
      this.savePageSize();
      this.load(1);
    }

    createPageButton(label, page, disabled, active) {
      const li = document.createElement('li');
      li.className = 'page-item' + (disabled ? ' disabled' : '') + (active ? ' active' : '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-link';
      button.innerHTML = label;
      button.disabled = !!disabled;
      if (!disabled && !active) button.addEventListener('click', () => this.load(page));
      li.appendChild(button);
      return li;
    }

    renderSummary() {
      if (!this.summary) return;
      const total = this.state.total;
      if (!total) {
        this.summary.textContent = this.state.loading ? 'Loading…' : '0 results';
        return;
      }
      const start = ((this.state.page - 1) * this.state.pageSize) + 1;
      const end = Math.min(total, start + this.state.pageSize - 1);
      this.summary.textContent = `${start}–${end} of ${total}`;
    }

    render() {
      if (!this.container) return;
      this.renderSummary();
      this.container.innerHTML = '';
      const totalPages = this.totalPages();
      const wrapper = document.createElement('div');
      wrapper.className = 'pagination-wrapper d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3';
      wrapper.innerHTML = `
        <div class="page-size-selector d-flex align-items-center gap-2">
          <label class="small text-muted mb-0" for="pg-size-${escapeHtml(this.options.key)}">Rows per page</label>
          <select id="pg-size-${escapeHtml(this.options.key)}" class="form-select form-select-sm w-auto"></select>
        </div>
        <nav aria-label="Pagination"><ul class="pagination mb-0"></ul></nav>`;

      const select = wrapper.querySelector('select');
      this.options.pageSizes.forEach((size) => {
        const option = document.createElement('option');
        option.value = String(size);
        option.textContent = String(size);
        option.selected = size === this.state.pageSize;
        select.appendChild(option);
      });
      select.addEventListener('change', (event) => this.changePageSize(event.target.value));

      const list = wrapper.querySelector('.pagination');
      list.appendChild(this.createPageButton('&laquo;', this.state.page - 1, this.state.page <= 1 || this.state.loading, false));
      const startPage = Math.max(1, this.state.page - 2);
      const endPage = Math.min(totalPages, this.state.page + 2);
      if (startPage > 1) {
        list.appendChild(this.createPageButton('1', 1, false, this.state.page === 1));
        if (startPage > 2) list.appendChild(this.createPageButton('&hellip;', this.state.page, true, false));
      }
      for (let page = startPage; page <= endPage; page += 1) {
        list.appendChild(this.createPageButton(String(page), page, false, page === this.state.page));
      }
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) list.appendChild(this.createPageButton('&hellip;', this.state.page, true, false));
        list.appendChild(this.createPageButton(String(totalPages), totalPages, false, this.state.page === totalPages));
      }
      list.appendChild(this.createPageButton('&raquo;', this.state.page + 1, this.state.page >= totalPages || this.state.loading, false));
      this.container.appendChild(wrapper);
    }
  }

  window.AdminPagination = {
    PAGE_SIZES,
    PaginationController
  };
})(window, document);
