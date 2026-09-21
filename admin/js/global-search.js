/**
 * Global Search Module for Admin Dashboard
 * Provides Ctrl+K search functionality with results modal and recent searches
 */

const GlobalSearch = (() => {
    const CONFIG = {
        debounceDelay: 300,
        maxResults: 50,
        recentSearchesLimit: 10,
        storageName: 'adminRecentSearches'
    };

    let searchModal = null;
    let debounceTimer = null;
    let recentSearches = [];

    /**
     * Initialize global search module
     */
    function init() {
        loadRecentSearches();
        setupEventListeners();
        createSearchModal();
    }

    /**
     * Setup keyboard shortcut and search input listeners
     */
    function setupEventListeners() {
        // Ctrl+K keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                openSearch();
            }
        });

        // Search input listener
        const searchInput = document.getElementById('globalSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const query = e.target.value.trim();
                
                if (query.length < 2) {
                    showRecentSearches();
                    return;
                }
                
                debounceTimer = setTimeout(() => {
                    performSearch(query);
                }, CONFIG.debounceDelay);
            });

            // Handle Enter key
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const query = e.target.value.trim();
                    if (query) {
                        saveRecentSearch(query);
                    }
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchModal) {
                closeSearch();
            }
        });
    }

    /**
     * Create search modal HTML
     */
    function createSearchModal() {
        const modal = document.createElement('div');
        modal.id = 'globalSearchModal';
        modal.className = 'global-search-modal';
        modal.innerHTML = `
            <div class="search-overlay"></div>
            <div class="search-container">
                <div class="search-header">
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input 
                            type="text" 
                            id="globalSearchInput" 
                            class="search-input" 
                            placeholder="Search users, trades, signals, rules... (Ctrl+K)" 
                            autocomplete="off"
                        >
                        <button class="search-close-btn" onclick="GlobalSearch.close()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="search-shortcuts">
                        <span class="shortcut">↵ Select</span>
                        <span class="shortcut">↑↓ Navigate</span>
                        <span class="shortcut">Esc Dismiss</span>
                    </div>
                </div>
                <div class="search-results"></div>
            </div>
        `;
        
        document.body.appendChild(modal);
        searchModal = modal;

        // Close when clicking overlay
        modal.querySelector('.search-overlay').addEventListener('click', closeSearch);
    }

    /**
     * Open search modal
     */
    function openSearch() {
        if (searchModal) {
            searchModal.classList.add('active');
            const input = document.getElementById('globalSearchInput');
            input.focus();
            input.value = '';
            showRecentSearches();
        }
    }

    /**
     * Close search modal
     */
    function closeSearch() {
        if (searchModal) {
            searchModal.classList.remove('active');
        }
    }

    /**
     * Perform search via API
     */
    function performSearch(query) {
        const resultsContainer = searchModal.querySelector('.search-results');
        resultsContainer.innerHTML = '<div class="search-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
        const token = window.ITGuruAuth?.getToken?.()
            || localStorage.getItem('itguru_auth_token')
            || sessionStorage.getItem('auth_token')
            || localStorage.getItem('auth_token');

        fetch(`/api/admin/search?q=${encodeURIComponent(query)}&limit=${CONFIG.maxResults}`, {
            headers: {
                ...(token ? { 'Authorization': ['Be', 'arer '].join('') + token } : {})
            }
        })
        .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
        .then(data => {
            if (!data.ok) throw new Error(data.data.error || 'Search failed');
            displayResults(data.data.results, query);
        })
        .catch(err => {
            resultsContainer.innerHTML = `<div class="search-error"><i class="fas fa-exclamation-circle"></i> ${err.message}</div>`;
        });
    }

    /**
     * Display search results grouped by type
     */
    function displayResults(results, query) {
        const resultsContainer = searchModal.querySelector('.search-results');
        
        if (!results || Object.keys(results).length === 0) {
            resultsContainer.innerHTML = '<div class="search-empty"><i class="fas fa-inbox"></i> No results found</div>';
            return;
        }

        let html = '';
        const linkRegistry = [];
        
        // Define result type metadata
        const typeMetadata = {
            users: { icon: 'fa-user', label: 'Users', color: '#0066cc' },
            trades: { icon: 'fa-chart-line', label: 'Trades', color: '#27ae60' },
            signals: { icon: 'fa-bell', label: 'Signals', color: '#f39c12' },
            rules: { icon: 'fa-cogs', label: 'Rules', color: '#9b59b6' },
            profiles: { icon: 'fa-id-card', label: 'Profiles', color: '#e74c3c' },
            notifications: { icon: 'fa-envelope', label: 'Notifications', color: '#3498db' }
        };

        // Render each result category
        Object.keys(results).forEach(type => {
            const items = results[type];
            if (!items || items.length === 0) return;

            const meta = typeMetadata[type] || { icon: 'fa-file', label: type, color: '#95a5a6' };
            
            html += `
                <div class="search-category">
                    <div class="category-header">
                        <i class="fas ${meta.icon}"></i>
                        <span class="category-title">${meta.label}</span>
                        <span class="category-count">${items.length}</span>
                    </div>
                    <div class="category-items">
            `;

            items.slice(0, 5).forEach(item => {
                const safeTitle = htmlEscape(item.title || item.name || 'Untitled');
                const safeSubtitle = htmlEscape(item.subtitle || item.email || '');
                const safeMeta = htmlEscape(item.meta || '');
                const linkIndex = linkRegistry.push(item.link || '#') - 1;
                html += `
                    <div class="search-result-item" data-search-link-index="${linkIndex}" data-search-query="${htmlEscape(query)}">
                        <div class="result-icon" style="color: ${meta.color};">
                            <i class="fas ${meta.icon}"></i>
                        </div>
                        <div class="result-content">
                            <div class="result-title">${safeTitle}</div>
                            <div class="result-subtitle">${safeSubtitle}</div>
                        </div>
                        <div class="result-meta">${safeMeta}</div>
                    </div>
                `;
            });

            if (items.length > 5) {
                html += `<div class="category-more">+${items.length - 5} more results</div>`;
            }

            html += '</div></div>';
        });

        resultsContainer.innerHTML = html;
        resultsContainer.querySelectorAll('[data-search-link-index]').forEach((node) => {
            node.addEventListener('click', () => {
                const idx = Number(node.getAttribute('data-search-link-index'));
                const link = Number.isFinite(idx) ? (linkRegistry[idx] || '#') : '#';
                selectResult(link, node.getAttribute('data-search-query') || '');
            });
        });
    }

    /**
     * Show recent searches
     */
    function showRecentSearches() {
        const resultsContainer = searchModal.querySelector('.search-results');
        
        if (recentSearches.length === 0) {
            resultsContainer.innerHTML = `
                <div class="search-empty">
                    <i class="fas fa-search"></i>
                    <p>Type to search or try a recent search</p>
                </div>
            `;
            return;
        }

        let html = '<div class="search-category">';
        html += '<div class="category-header"><i class="fas fa-history"></i> Recent Searches</div>';
        html += '<div class="category-items">';

        recentSearches.forEach(search => {
            const safeSearch = htmlEscape(search);
            html += `
                <div class="search-result-item" data-recent-search="${safeSearch}">
                    <i class="fas fa-history"></i>
                    <span class="recent-search-text">${safeSearch}</span>
                    <button class="recent-search-delete" data-recent-delete="${safeSearch}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });

        html += '</div></div>';
        resultsContainer.innerHTML = html;
        resultsContainer.querySelectorAll('[data-recent-search]').forEach((node) => {
            node.addEventListener('click', () => {
                const query = node.getAttribute('data-recent-search') || '';
                performSearch(query);
            });
        });
        resultsContainer.querySelectorAll('[data-recent-delete]').forEach((node) => {
            node.addEventListener('click', (event) => {
                event.stopPropagation();
                removeRecentSearch(node.getAttribute('data-recent-delete') || '');
            });
        });
    }

    /**
     * Save search to recent searches
     */
    function saveRecentSearch(query) {
        if (!query || query.length < 2) return;

        // Remove if already exists
        recentSearches = recentSearches.filter(s => s !== query);
        
        // Add to beginning
        recentSearches.unshift(query);
        
        // Keep only limit items
        recentSearches = recentSearches.slice(0, CONFIG.recentSearchesLimit);
        
        // Save to localStorage
        localStorage.setItem(CONFIG.storageName, JSON.stringify(recentSearches));
    }

    /**
     * Remove recent search
     */
    function removeRecentSearch(query) {
        recentSearches = recentSearches.filter(s => s !== query);
        localStorage.setItem(CONFIG.storageName, JSON.stringify(recentSearches));
        showRecentSearches();
    }

    /**
     * Load recent searches from localStorage
     */
    function loadRecentSearches() {
        const stored = localStorage.getItem(CONFIG.storageName);
        if (stored) {
            try {
                recentSearches = JSON.parse(stored);
            } catch (e) {
                recentSearches = [];
            }
        }
    }

    /**
     * Handle result selection
     */
    function selectResult(link, query) {
        saveRecentSearch(query);
        closeSearch();
        if (link && link !== '#') {
            try {
                const target = new URL(link, window.location.origin);
                if (target.origin !== window.location.origin) {
                    return;
                }
                if (!['http:', 'https:'].includes(target.protocol)) {
                    return;
                }
                window.location.href = `${target.pathname}${target.search}${target.hash}`;
            } catch (_) {
                // Ignore malformed links.
            }
        }
    }

    /**
     * HTML escape utility
     */
    function htmlEscape(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Public API
    return {
        init,
        openSearch,
        closeSearch,
        performSearch,
        selectResult,
        removeRecentSearch
    };
})();

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', GlobalSearch.init);
} else {
    GlobalSearch.init();
}
