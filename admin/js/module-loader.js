/**
 * Admin Dashboard Module Loader
 * Handles lazy loading and code splitting for dashboard components
 * 
 * Features:
 * - Lazy load Charts.js only when needed
 * - Lazy load DataTables.js for large tables
 * - Deferred loading of non-critical components
 * - Module dependency management
 * - Performance monitoring
 */

const AdminModuleLoader = (() => {
    const modules = {};
    const loadedModules = new Set();
    const loadingModules = new Map();
    const performanceMetrics = {};
    
    /**
     * Register a module definition
     */
    function registerModule(name, definition) {
        modules[name] = {
            name,
            dependencies: definition.dependencies || [],
            load: definition.load || (() => Promise.resolve()),
            loaded: false,
            singleton: definition.singleton !== false
        };
    }
    
    /**
     * Load a module and its dependencies
     */
    async function load(moduleName) {
        const startTime = performance.now();
        
        // Check if already loaded
        if (loadedModules.has(moduleName)) {
            return;
        }
        
        // Check if currently loading
        if (loadingModules.has(moduleName)) {
            return loadingModules.get(moduleName);
        }
        
        const module = modules[moduleName];
        if (!module) {
            throw new Error(`Module not found: ${moduleName}`);
        }
        
        // Create loading promise
        const loadPromise = (async () => {
            try {
                // Load dependencies first
                if (module.dependencies.length > 0) {
                    await Promise.all(module.dependencies.map(dep => load(dep)));
                }
                
                // Load the module
                await module.load();
                
                loadedModules.add(moduleName);
                module.loaded = true;
                
                // Record metrics
                const endTime = performance.now();
                performanceMetrics[moduleName] = {
                    duration: endTime - startTime,
                    timestamp: new Date().toISOString(),
                    dependencies: module.dependencies
                };
                
                console.log(`[ModuleLoader] Loaded ${moduleName} in ${(endTime - startTime).toFixed(2)}ms`);
                
            } catch (error) {
                console.error(`[ModuleLoader] Failed to load ${moduleName}:`, error);
                throw error;
            }
        })();
        
        loadingModules.set(moduleName, loadPromise);
        
        try {
            await loadPromise;
        } finally {
            loadingModules.delete(moduleName);
        }
    }
    
    /**
     * Load module when element is visible (Intersection Observer)
     */
    function loadWhenVisible(moduleName, triggerElement = null) {
        if (!triggerElement) {
            triggerElement = document.querySelector(`[data-load-module="${moduleName}"]`);
        }
        
        if (!triggerElement) {
            // No trigger element, just load immediately
            load(moduleName).catch(err => console.error(err));
            return;
        }
        
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        load(moduleName).catch(err => console.error(err));
                        observer.unobserve(entry.target);
                    }
                });
            }, { rootMargin: '50px' });
            
            observer.observe(triggerElement);
        } else {
            // Fallback for browsers without Intersection Observer
            load(moduleName).catch(err => console.error(err));
        }
    }
    
    /**
     * Load module after a delay (deferred loading)
     */
    function loadDeferred(moduleName, delayMs = 1000) {
        setTimeout(() => {
            load(moduleName).catch(err => console.error(err));
        }, delayMs);
    }
    
    /**
     * Register built-in modules
     */
    function registerBuiltInModules() {
        // Charts.js - Lazy load only when charts are needed
        registerModule('charts', {
            dependencies: [],
            load: async () => {
                if (window.Chart) return; // Already loaded
                
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
                    script.integrity = 'sha384-c/1R96GDC87YZm2vp+Z9B7MZG5qXu3LoNLvNlNvtNcJLEpFRBMi4ORDmJ3plJG8VX';
                    script.crossOrigin = 'anonymous';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
        });
        
        // DataTables.js - Lazy load for large tables
        registerModule('datatables', {
            dependencies: [],
            load: async () => {
                if (window.DataTable) return; // Already loaded
                
                return Promise.all([
                    loadExternalScript('https://code.jquery.com/jquery-3.7.1.min.js'),
                    loadExternalScript('https://cdn.jsdelivr.net/npm/datatables.net/js/jquery.dataTables.min.js'),
                    loadExternalCSS('https://cdn.jsdelivr.net/npm/datatables.net-dt/css/jquery.dataTables.min.css')
                ]);
            }
        });
        
        // Sortable.js - Lazy load for drag-and-drop
        registerModule('sortable', {
            dependencies: [],
            load: async () => {
                if (window.Sortable) return; // Already loaded
                
                return loadExternalScript('https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js');
            }
        });
        
        // ApexCharts - Lazy load alternative to Charts.js
        registerModule('apexcharts', {
            dependencies: [],
            load: async () => {
                if (window.ApexCharts) return; // Already loaded
                
                return loadExternalScript('https://cdn.jsdelivr.net/npm/apexcharts/dist/apexcharts.min.js');
            }
        });
        
        // SheetJS - Lazy load for Excel export
        registerModule('xlsx', {
            dependencies: [],
            load: async () => {
                if (window.XLSX) return; // Already loaded
                
                return loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js');
            }
        });
        
        // jsPDF - Lazy load for PDF export
        registerModule('jspdf', {
            dependencies: [],
            load: async () => {
                if (window.jsPDF) return; // Already loaded
                
                return loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
            }
        });
    }
    
    /**
     * Load external script
     */
    function loadExternalScript(src) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    /**
     * Load external CSS
     */
    function loadExternalCSS(href) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (document.querySelector(`link[href="${href}"]`)) {
                resolve();
                return;
            }
            
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }
    
    /**
     * Get performance metrics
     */
    function getMetrics() {
        return {
            modules_loaded: loadedModules.size,
            performance: performanceMetrics,
            total_load_time: Object.values(performanceMetrics).reduce((sum, m) => sum + (m.duration || 0), 0)
        };
    }
    
    /**
     * Get module status
     */
    function getStatus(moduleName) {
        const module = modules[moduleName];
        if (!module) return null;
        
        return {
            name: moduleName,
            loaded: module.loaded,
            loading: loadingModules.has(moduleName),
            dependencies: module.dependencies,
            metrics: performanceMetrics[moduleName] || null
        };
    }
    
    /**
     * Initialize module loader
     */
    function init() {
        registerBuiltInModules();
        
        // Auto-load modules marked with data-load-module attribute
        document.querySelectorAll('[data-load-module]').forEach(el => {
            const moduleName = el.getAttribute('data-load-module');
            const loadType = el.getAttribute('data-load-type') || 'visible'; // visible, deferred, immediate
            
            if (loadType === 'immediate') {
                load(moduleName).catch(err => console.error(err));
            } else if (loadType === 'deferred') {
                const delay = parseInt(el.getAttribute('data-load-delay') || '1000');
                loadDeferred(moduleName, delay);
            } else {
                // visible (default)
                loadWhenVisible(moduleName, el);
            }
        });
    }
    
    // Initialize on document ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Public API
    return {
        registerModule,
        load,
        loadWhenVisible,
        loadDeferred,
        getMetrics,
        getStatus,
        init
    };
})();
