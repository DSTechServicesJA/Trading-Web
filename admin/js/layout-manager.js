/**
 * Admin Dashboard Layout Manager
 * Handles saving, loading, and managing widget layouts
 * 
 * Features:
 * - Save current layout as named preset
 * - Load previously saved layouts
 * - Drag-and-drop widget reordering (requires Sortable.js)
 * - Export/import layouts
 * - Default layout restoration on login
 */

const AdminLayoutManager = (() => {
    const API_BASE = '/api/admin/layouts';
    const STORAGE_KEY = 'admin-dashboard-current-layout';
    
    // DOM elements
    let layoutModal = null;
    let layoutManagerBtn = null;
    
    /**
     * Initialize layout manager
     */
    function init() {
        createLayoutManagerUI();
        loadDefaultLayout();
        bindEvents();
    }
    
    /**
     * Create layout manager UI components
     */
    function createLayoutManagerUI() {
        // Create layout manager button
        const headerNav = document.querySelector('.admin-top-nav');
        if (!headerNav) return;
        
        const layoutManagerBtn = document.createElement('button');
        layoutManagerBtn.className = 'btn btn-sm btn-outline-secondary';
        layoutManagerBtn.innerHTML = '<i class="fas fa-th-large"></i> Layouts';
        layoutManagerBtn.id = 'layout-manager-btn';
        layoutManagerBtn.style.marginLeft = '10px';
        
        const navRight = headerNav.querySelector('.ms-auto') || headerNav;
        navRight.appendChild(layoutManagerBtn);
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'layout-manager-modal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Layouts</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <ul class="nav nav-tabs mb-3" id="layoutTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="saved-layouts-tab" data-bs-toggle="tab" 
                                        data-bs-target="#saved-layouts" type="button" role="tab">
                                    Saved Layouts
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="save-layout-tab" data-bs-toggle="tab" 
                                        data-bs-target="#save-layout" type="button" role="tab">
                                    Save Current
                                </button>
                            </li>
                        </ul>
                        
                        <div class="tab-content" id="layoutTabContent">
                            <div class="tab-pane fade show active" id="saved-layouts" role="tabpanel">
                                <div id="layout-list" class="layout-list">
                                    <p class="text-muted">Loading layouts...</p>
                                </div>
                            </div>
                            
                            <div class="tab-pane fade" id="save-layout" role="tabpanel">
                                <form id="save-layout-form">
                                    <div class="mb-3">
                                        <label for="layout-name" class="form-label">Layout Name</label>
                                        <input type="text" class="form-control" id="layout-name" 
                                               placeholder="e.g., Executive View, Trading Focus" required>
                                        <small class="form-text text-muted">
                                            The current dashboard configuration will be saved with this name
                                        </small>
                                    </div>
                                    
                                    <div class="mb-3">
                                        <label for="layout-description" class="form-label">Description (optional)</label>
                                        <textarea class="form-control" id="layout-description" 
                                                  rows="2" placeholder="What this layout is for..."></textarea>
                                    </div>
                                    
                                    <button type="submit" class="btn btn-primary">Save Layout</button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Store references
        layoutModal = modal;
        layoutManagerBtn = layoutManagerBtn;
    }
    
    /**
     * Bind event listeners
     */
    function bindEvents() {
        if (!layoutManagerBtn) return;
        
        // Open modal
        layoutManagerBtn.addEventListener('click', () => {
            const modal = new bootstrap.Modal(layoutModal);
            loadLayoutsList();
            modal.show();
        });
        
        // Save layout form
        const saveForm = document.getElementById('save-layout-form');
        if (saveForm) {
            saveForm.addEventListener('submit', (e) => {
                e.preventDefault();
                saveCurrentLayout();
            });
        }
    }
    
    /**
     * Load and display saved layouts list
     */
    async function loadLayoutsList() {
        const layoutList = document.getElementById('layout-list');
        if (!layoutList) return;
        
        try {
            layoutList.innerHTML = '<p class="text-muted"><i class="fas fa-spin fa-spinner"></i> Loading...</p>';
            
            const response = await fetch(API_BASE);
            const data = await response.json();
            
            if (!data.success || !data.layouts) {
                layoutList.innerHTML = '<p class="text-danger">Failed to load layouts</p>';
                return;
            }
            
            if (data.layouts.length === 0) {
                layoutList.innerHTML = '<p class="text-muted">No saved layouts yet. Create one to save your current configuration.</p>';
                return;
            }
            
            let html = '<div class="list-group">';
            
            for (const layout of data.layouts) {
                const defaultBadge = layout.is_default ? 
                    '<span class="badge bg-primary ms-2">Default</span>' : '';
                
                html += `
                    <div class="list-group-item">
                        <div class="d-flex w-100 justify-content-between align-items-center">
                            <div class="flex-grow-1">
                                <h6 class="mb-1">
                                    ${escapeHtml(layout.name)}
                                    ${defaultBadge}
                                </h6>
                                <small class="text-muted">
                                    Updated: ${new Date(layout.updated_at).toLocaleString()}
                                </small>
                            </div>
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-outline-primary load-layout-btn" data-id="${layout.id}">
                                    Load
                                </button>
                                <button class="btn btn-outline-secondary set-default-btn" data-id="${layout.id}"
                                        ${layout.is_default ? 'disabled' : ''}>
                                    Set Default
                                </button>
                                <button class="btn btn-outline-danger delete-layout-btn" data-id="${layout.id}">
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            html += '</div>';
            layoutList.innerHTML = html;
            
            // Bind action buttons
            layoutList.querySelectorAll('.load-layout-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const layoutId = parseInt(e.currentTarget.dataset.id);
                    loadLayout(layoutId);
                });
            });
            
            layoutList.querySelectorAll('.set-default-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const layoutId = parseInt(e.currentTarget.dataset.id);
                    setDefaultLayout(layoutId);
                });
            });
            
            layoutList.querySelectorAll('.delete-layout-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const layoutId = parseInt(e.currentTarget.dataset.id);
                    deleteLayout(layoutId);
                });
            });
            
        } catch (error) {
            console.error('Error loading layouts:', error);
            layoutList.innerHTML = '<p class="text-danger">Error loading layouts. Please try again.</p>';
        }
    }
    
    /**
     * Save current dashboard layout
     */
    async function saveCurrentLayout() {
        const nameInput = document.getElementById('layout-name');
        const descInput = document.getElementById('layout-description');
        
        if (!nameInput.value.trim()) {
            alert('Please enter a layout name');
            return;
        }
        
        const currentLayout = captureCurrentLayout();
        
        try {
            const response = await fetch(API_BASE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: nameInput.value.trim(),
                    description: descInput.value.trim(),
                    widgets: currentLayout
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                alert('Error saving layout: ' + (data.error || 'Unknown error'));
                return;
            }
            
            // Clear form
            nameInput.value = '';
            descInput.value = '';
            
            // Show success message
            showNotification('Layout saved successfully!', 'success');
            
            // Reload list
            loadLayoutsList();
            
            // Switch back to layouts list tab
            const tab = new bootstrap.Tab(document.getElementById('saved-layouts-tab'));
            tab.show();
            
        } catch (error) {
            console.error('Error saving layout:', error);
            alert('Error saving layout. Please try again.');
        }
    }
    
    /**
     * Load a saved layout
     */
    async function loadLayout(layoutId) {
        try {
            const response = await fetch(`${API_BASE}/${layoutId}`);
            const data = await response.json();
            
            if (!data.success) {
                alert('Error loading layout: ' + (data.error || 'Unknown error'));
                return;
            }
            
            // Store layout in localStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data.layout.widgets));
            
            // Apply layout
            applyLayout(data.layout.widgets);
            
            // Close modal
            bootstrap.Modal.getInstance(layoutModal)?.hide();
            
            showNotification(`Layout "${data.layout.name}" loaded successfully!`, 'success');
            
        } catch (error) {
            console.error('Error loading layout:', error);
            alert('Error loading layout. Please try again.');
        }
    }
    
    /**
     * Set layout as default
     */
    async function setDefaultLayout(layoutId) {
        try {
            const response = await fetch(`${API_BASE}/${layoutId}/apply`, {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (!data.success) {
                alert('Error setting default layout');
                return;
            }
            
            showNotification('Layout set as default', 'success');
            loadLayoutsList();
            
        } catch (error) {
            console.error('Error setting default layout:', error);
            alert('Error setting default layout. Please try again.');
        }
    }
    
    /**
     * Delete a layout
     */
    async function deleteLayout(layoutId) {
        if (!confirm('Are you sure you want to delete this layout?')) {
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/${layoutId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (!data.success) {
                alert('Error deleting layout: ' + (data.error || 'Unknown error'));
                return;
            }
            
            showNotification('Layout deleted', 'success');
            loadLayoutsList();
            
        } catch (error) {
            console.error('Error deleting layout:', error);
            alert('Error deleting layout. Please try again.');
        }
    }
    
    /**
     * Capture current dashboard layout configuration
     */
    function captureCurrentLayout() {
        const layout = {
            sections: {},
            timestamp: new Date().toISOString()
        };
        
        // Capture collapsible section states
        document.querySelectorAll('[data-section-id]').forEach(section => {
            const sectionId = section.getAttribute('data-section-id');
            const isCollapsed = section.classList.contains('collapsed');
            
            layout.sections[sectionId] = {
                collapsed: isCollapsed,
                order: Array.from(section.parentElement.children).indexOf(section)
            };
        });
        
        // Capture pagination preferences
        const pageSize = localStorage.getItem('admin-pagination-size') || '25';
        layout.pageSize = pageSize;
        
        // Capture theme preference
        const theme = localStorage.getItem('admin-theme') || 'light';
        layout.theme = theme;
        
        // Capture search preferences
        const searchHistory = localStorage.getItem('admin-search-history');
        layout.searchHistoryEnabled = true;
        
        return layout;
    }
    
    /**
     * Apply saved layout
     */
    function applyLayout(layout) {
        // Restore section collapse states
        if (layout.sections) {
            Object.entries(layout.sections).forEach(([sectionId, state]) => {
                const section = document.querySelector(`[data-section-id="${sectionId}"]`);
                if (section) {
                    if (state.collapsed) {
                        section.classList.add('collapsed');
                    } else {
                        section.classList.remove('collapsed');
                    }
                }
            });
        }
        
        // Restore pagination size
        if (layout.pageSize) {
            localStorage.setItem('admin-pagination-size', layout.pageSize);
        }
        
        // Restore theme
        if (layout.theme) {
            localStorage.setItem('admin-theme', layout.theme);
            setTheme(layout.theme);
        }
    }
    
    /**
     * Load default layout on page load
     */
    async function loadDefaultLayout() {
        // Check if there's a default layout for this admin
        try {
            const response = await fetch(API_BASE);
            const data = await response.json();
            
            if (data.success && data.layouts && data.layouts.length > 0) {
                const defaultLayout = data.layouts.find(l => l.is_default);
                
                if (defaultLayout) {
                    // Load the default layout automatically
                    const layoutResp = await fetch(`${API_BASE}/${defaultLayout.id}`);
                    const layoutData = await layoutResp.json();
                    
                    if (layoutData.success) {
                        // Store in localStorage for this session
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutData.layout.widgets));
                        
                        // Apply after page load
                        setTimeout(() => {
                            applyLayout(layoutData.layout.widgets);
                        }, 500);
                    }
                }
            }
        } catch (error) {
            console.error('Error loading default layout:', error);
        }
    }
    
    /**
     * Helper: Escape HTML special characters
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Helper: Show notification
     */
    function showNotification(message, type = 'info') {
        // Try to use existing notification system
        if (window.AdminNotification) {
            window.AdminNotification.show(message, type);
        } else {
            // Fallback to alert
            alert(message);
        }
    }
    
    /**
     * Helper: Set theme
     */
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    }
    
    // Public API
    return {
        init,
        captureCurrentLayout,
        applyLayout,
        saveCurrentLayout,
        loadLayout,
        setDefaultLayout,
        deleteLayout
    };
})();

// Initialize on document ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        AdminLayoutManager.init();
    });
} else {
    AdminLayoutManager.init();
}
