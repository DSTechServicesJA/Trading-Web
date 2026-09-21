/**
 * Admin Dashboard Mobile Navigation
 * Off-canvas menu, touch optimization, and responsive navigation
 * 
 * Features:
 * - Off-canvas sidebar menu for mobile
 * - Swipe gesture support for menu
 * - Touch-optimized buttons and forms
 * - Simplified modals for small screens
 * - Responsive dropdowns
 */

const AdminMobileNav = (() => {
    const breakpoints = {
        sm: 576,
        md: 768,
        lg: 1024,
        xl: 1440
    };
    
    let isOffcanvasOpen = false;
    
    /**
     * Initialize mobile navigation
     */
    function init() {
        // Create off-canvas menu for tablets and below
        if (window.innerWidth < breakpoints.lg) {
            createOffcanvasMenu();
        }
        
        // Setup touch optimizations
        setupTouchOptimizations();
        
        // Setup swipe gestures
        setupSwipeGestures();
        
        // Setup responsive behavior
        window.addEventListener('resize', () => {
            handleResize();
        });
    }
    
    /**
     * Create off-canvas sidebar menu
     */
    function createOffcanvasMenu() {
        // Check if already exists
        if (document.querySelector('.sidebar-offcanvas')) {
            return;
        }
        
        // Create offcanvas container
        const offcanvas = document.createElement('div');
        offcanvas.className = 'sidebar-offcanvas';
        offcanvas.id = 'navOffcanvas';
        offcanvas.innerHTML = `
            <div class="offcanvas-header" style="border-bottom: 1px solid var(--border-color);">
                <h5 class="offcanvas-title">Admin Menu</h5>
                <button type="button" class="btn-close" id="closeOffcanvas" aria-label="Close"></button>
            </div>
            <nav class="offcanvas-body">
                <ul class="navbar-nav flex-column gap-2">
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/dashboard-home.html">
                            <i class="fas fa-chart-line me-2"></i>Dashboard
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/index.html">
                            <i class="fas fa-users me-2"></i>User Admin
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/user-management.html">
                            <i class="fas fa-user-cog me-2"></i>User Management
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/strategy-management.html">
                            <i class="fas fa-chess me-2"></i>Strategies
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/adaptive-intelligence.html">
                            <i class="fas fa-brain me-2"></i>Adaptive Intelligence
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/audit-trail.html">
                            <i class="fas fa-history me-2"></i>Audit Trail
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/admin/logs.html">
                            <i class="fas fa-file-alt me-2"></i>System Logs
                        </a>
                    </li>
                </ul>
            </nav>
        `;
        
        document.body.appendChild(offcanvas);
        
        // Create toggle button if doesn't exist
        const navbar = document.querySelector('.navbar');
        if (navbar && !document.querySelector('[id*="hamburger"]')) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'navbar-toggler hamburger ms-auto';
            toggleBtn.type = 'button';
            toggleBtn.id = 'hamburger-menu';
            toggleBtn.innerHTML = `
                <span></span>
                <span></span>
                <span></span>
            `;
            
            const navContainer = navbar.querySelector('.navbar-collapse') || 
                                 navbar.querySelector('.container-fluid');
            if (navContainer) {
                navContainer.appendChild(toggleBtn);
            }
        }
        
        // Bind events
        const openBtn = document.getElementById('hamburger-menu');
        const closeBtn = document.getElementById('closeOffcanvas');
        
        if (openBtn) {
            openBtn.addEventListener('click', toggleOffcanvas);
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeOffcanvas);
        }
        
        // Close when clicking a link
        offcanvas.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', closeOffcanvas);
        });
        
        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (isOffcanvasOpen && 
                !e.target.closest('.sidebar-offcanvas') && 
                !e.target.closest('#hamburger-menu')) {
                closeOffcanvas();
            }
        });
    }
    
    /**
     * Toggle offcanvas menu
     */
    function toggleOffcanvas() {
        if (isOffcanvasOpen) {
            closeOffcanvas();
        } else {
            openOffcanvas();
        }
    }
    
    /**
     * Open offcanvas menu
     */
    function openOffcanvas() {
        const offcanvas = document.getElementById('navOffcanvas');
        if (offcanvas) {
            offcanvas.classList.add('show');
            document.body.style.overflow = 'hidden';
            isOffcanvasOpen = true;
        }
    }
    
    /**
     * Close offcanvas menu
     */
    function closeOffcanvas() {
        const offcanvas = document.getElementById('navOffcanvas');
        if (offcanvas) {
            offcanvas.classList.remove('show');
            document.body.style.overflow = '';
            isOffcanvasOpen = false;
        }
    }
    
    /**
     * Setup touch optimizations
     */
    function setupTouchOptimizations() {
        // Ensure touch-friendly sizing
        const isTouchDevice = () => {
            return (('ontouchstart' in window) ||
                    (navigator.maxTouchPoints > 0) ||
                    (navigator.msMaxTouchPoints > 0));
        };
        
        if (isTouchDevice()) {
            document.documentElement.classList.add('touch-device');
            
            // Add visual feedback on touch
            document.addEventListener('touchstart', (e) => {
                const btn = e.target.closest('button, a.btn, .btn, [role="button"]');
                if (btn) {
                    btn.classList.add('active');
                }
            }, false);
            
            document.addEventListener('touchend', (e) => {
                const btn = e.target.closest('button, a.btn, .btn, [role="button"]');
                if (btn) {
                    btn.classList.remove('active');
                }
            }, false);
        }
    }
    
    /**
     * Setup swipe gestures
     */
    function setupSwipeGestures() {
        let touchStartX = 0;
        let touchEndX = 0;
        
        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, false);
        
        document.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, false);
        
        function handleSwipe() {
            const swipeThreshold = 50; // Minimum swipe distance
            const diff = touchStartX - touchEndX;
            
            // Swipe left - open menu
            if (diff > swipeThreshold && !isOffcanvasOpen) {
                openOffcanvas();
            }
            
            // Swipe right - close menu
            if (diff < -swipeThreshold && isOffcanvasOpen) {
                closeOffcanvas();
            }
        }
    }
    
    /**
     * Handle window resize
     */
    function handleResize() {
        const width = window.innerWidth;
        const offcanvas = document.getElementById('navOffcanvas');
        
        // Hide offcanvas on desktop
        if (width >= breakpoints.lg) {
            if (offcanvas) {
                offcanvas.classList.remove('show');
                isOffcanvasOpen = false;
                document.body.style.overflow = '';
            }
            
            const hamburger = document.getElementById('hamburger-menu');
            if (hamburger) {
                hamburger.style.display = 'none';
            }
        } else {
            // Ensure offcanvas exists on mobile
            if (!offcanvas) {
                createOffcanvasMenu();
            }
        }
    }
    
    /**
     * Simplify modals for mobile
     */
    function optimizeModalForMobile(modalElement) {
        if (!modalElement) return;
        
        const width = window.innerWidth;
        
        if (width < breakpoints.md) {
            // Full screen modal on small devices
            modalElement.classList.add('modal-fullscreen-sm-down');
            
            // Reduce padding
            const header = modalElement.querySelector('.modal-header');
            const body = modalElement.querySelector('.modal-body');
            const footer = modalElement.querySelector('.modal-footer');
            
            if (header) header.style.padding = '0.75rem';
            if (body) body.style.padding = '0.75rem';
            if (footer) footer.style.padding = '0.5rem';
        }
    }
    
    /**
     * Get current breakpoint
     */
    function getCurrentBreakpoint() {
        const width = window.innerWidth;
        
        if (width < breakpoints.sm) return 'xs';
        if (width < breakpoints.md) return 'sm';
        if (width < breakpoints.lg) return 'md';
        if (width < breakpoints.xl) return 'lg';
        return 'xl';
    }
    
    /**
     * Check if mobile
     */
    function isMobile() {
        return window.innerWidth < breakpoints.md;
    }
    
    /**
     * Check if tablet
     */
    function isTablet() {
        return window.innerWidth >= breakpoints.md && window.innerWidth < breakpoints.lg;
    }
    
    /**
     * Check if desktop
     */
    function isDesktop() {
        return window.innerWidth >= breakpoints.lg;
    }
    
    // Initialize on document ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Public API
    return {
        init,
        openOffcanvas,
        closeOffcanvas,
        toggleOffcanvas,
        getCurrentBreakpoint,
        isMobile,
        isTablet,
        isDesktop,
        optimizeModalForMobile
    };
})();

// Make available globally
window.AdminMobileNav = AdminMobileNav;
