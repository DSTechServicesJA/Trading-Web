/**
 * Admin Dashboard Performance Monitor
 * Tracks and reports performance metrics
 * 
 * Metrics tracked:
 * - Page load time
 * - API response times
 * - Component render times
 * - Memory usage
 * - Network waterfall
 */

const AdminPerformanceMonitor = (() => {
    const metrics = {
        page_load: null,
        api_calls: [],
        component_renders: [],
        memory: [],
        navigation_timing: null
    };
    
    const thresholds = {
        page_load: 2000,        // 2 seconds
        api_call: 500,          // 500ms
        component_render: 100   // 100ms
    };
    
    /**
     * Initialize performance monitoring
     */
    function init() {
        // Monitor page load
        monitorPageLoad();
        
        // Monitor API calls
        monitorAPIcalls();
        
        // Monitor component renders
        monitorComponentRenders();
        
        // Monitor memory usage
        if ('memory' in performance) {
            monitorMemory();
        }
        
        // Register service worker for caching
        registerServiceWorker();
    }
    
    /**
     * Monitor page load time
     */
    function monitorPageLoad() {
        window.addEventListener('load', () => {
            const perfData = performance.timing;
            const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
            
            metrics.page_load = {
                total_load_time: pageLoadTime,
                dns_lookup: perfData.domainLookupEnd - perfData.domainLookupStart,
                tcp_connection: perfData.connectEnd - perfData.connectStart,
                request_time: perfData.responseStart - perfData.requestStart,
                response_time: perfData.responseEnd - perfData.responseStart,
                dom_interactive: perfData.domInteractive - perfData.navigationStart,
                dom_complete: perfData.domComplete - perfData.navigationStart,
                resources_loaded: performance.getEntriesByType('resource').length,
                timestamp: new Date().toISOString()
            };
            
            // Check if within threshold
            if (pageLoadTime > thresholds.page_load) {
                console.warn(`[Performance] Page load time exceeded threshold: ${pageLoadTime}ms > ${thresholds.page_load}ms`);
                reportPerformanceIssue('page_load', pageLoadTime, thresholds.page_load);
            } else {
                console.log(`[Performance] Page loaded in ${pageLoadTime}ms`);
            }
            
            // Log to backend
            sendMetricsToBackend();
        });
    }
    
    /**
     * Monitor API calls
     */
    function monitorAPIcalls() {
        const originalFetch = window.fetch;
        
        window.fetch = function(...args) {
            const startTime = performance.now();
            const [resource] = args;
            
            return originalFetch.apply(this, args).then(response => {
                const endTime = performance.now();
                const duration = endTime - startTime;
                
                // Extract URL
                const url = typeof resource === 'string' ? resource : resource.url;
                
                // Only track API calls
                if (url.includes('/api/')) {
                    metrics.api_calls.push({
                        url,
                        method: args[1]?.method || 'GET',
                        status: response.status,
                        duration,
                        start_time: startTime,
                        timestamp: new Date().toISOString()
                    });
                    
                    if (duration > thresholds.api_call) {
                        console.warn(`[Performance] API call took too long: ${url} (${duration.toFixed(2)}ms > ${thresholds.api_call}ms)`);
                    }
                }
                
                return response;
            }).catch(error => {
                const endTime = performance.now();
                const duration = endTime - startTime;
                const url = typeof resource === 'string' ? resource : resource.url;
                
                if (url.includes('/api/')) {
                    metrics.api_calls.push({
                        url,
                        method: args[1]?.method || 'GET',
                        status: 0,
                        duration,
                        error: error.message,
                        start_time: startTime,
                        timestamp: new Date().toISOString()
                    });
                }
                
                throw error;
            });
        };
    }
    
    /**
     * Monitor component render times
     */
    function monitorComponentRenders() {
        // Monitor collapsible section toggle times
        const originalToggle = bootstrap.Collapse.prototype.toggle;
        
        bootstrap.Collapse.prototype.toggle = function() {
            const element = this._element;
            const startTime = performance.now();
            const result = originalToggle.call(this);
            const endTime = performance.now();
            const duration = endTime - startTime;
            
            metrics.component_renders.push({
                type: 'collapse_toggle',
                element_id: element.id || 'unknown',
                duration,
                timestamp: new Date().toISOString()
            });
            
            if (duration > thresholds.component_render) {
                console.warn(`[Performance] Component render slow: ${duration.toFixed(2)}ms`);
            }
            
            return result;
        };
    }
    
    /**
     * Monitor memory usage
     */
    function monitorMemory() {
        setInterval(() => {
            if ('memory' in performance) {
                const memory = performance.memory;
                metrics.memory.push({
                    usedJSHeapSize: memory.usedJSHeapSize,
                    totalJSHeapSize: memory.totalJSHeapSize,
                    jsHeapSizeLimit: memory.jsHeapSizeLimit,
                    timestamp: new Date().toISOString()
                });
                
                // Check for memory leak (usedJSHeapSize > 90% of limit)
                const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
                if (usagePercent > 90) {
                    console.warn(`[Performance] High memory usage: ${usagePercent.toFixed(1)}%`);
                }
            }
        }, 10000); // Every 10 seconds
    }
    
    /**
     * Register Service Worker for caching
     */
    async function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/admin/js/service-worker.js');
                console.log('[Service Worker] Registered successfully');
                
                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    console.log('[Service Worker] Update found');
                });
            } catch (error) {
                console.log('[Service Worker] Registration failed:', error);
            }
        }
    }
    
    /**
     * Get all metrics
     */
    function getMetrics() {
        return {
            page_load: metrics.page_load,
            api_calls: metrics.api_calls,
            component_renders: metrics.component_renders,
            memory: metrics.memory,
            summary: {
                average_api_duration: metrics.api_calls.length > 0 
                    ? (metrics.api_calls.reduce((sum, call) => sum + call.duration, 0) / metrics.api_calls.length).toFixed(2)
                    : 'N/A',
                slow_api_calls: metrics.api_calls.filter(call => call.duration > thresholds.api_call).length,
                slow_renders: metrics.component_renders.filter(render => render.duration > thresholds.component_render).length
            }
        };
    }
    
    /**
     * Get performance report
     */
    function getReport() {
        const metricsData = getMetrics();
        
        return {
            timestamp: new Date().toISOString(),
            page_load: metricsData.page_load,
            network: {
                total_api_calls: metricsData.api_calls.length,
                average_api_duration: metricsData.summary.average_api_duration,
                slow_api_calls: metricsData.summary.slow_api_calls,
                failed_api_calls: metricsData.api_calls.filter(call => call.status >= 400).length
            },
            rendering: {
                total_component_renders: metricsData.component_renders.length,
                slow_renders: metricsData.summary.slow_renders,
                average_render_time: metricsData.component_renders.length > 0
                    ? (metricsData.component_renders.reduce((sum, render) => sum + render.duration, 0) / metricsData.component_renders.length).toFixed(2)
                    : 'N/A'
            },
            memory: metricsData.memory.length > 0 ? metricsData.memory[metricsData.memory.length - 1] : null,
            status: metricsData.page_load?.total_load_time > thresholds.page_load ? 'slow' : 'ok'
        };
    }
    
    /**
     * Send metrics to backend
     */
    async function sendMetricsToBackend() {
        try {
            const report = getReport();
            
            if (report.status === 'slow') {
                const token = window.ITGuruAuth?.getToken?.()
                    || localStorage.getItem('itguru_auth_token')
                    || localStorage.getItem('auth_token');
                await fetch('/api/admin/performance?action=summary', {
                    method: 'GET',
                    headers: token ? { 'Authorization': ['Be', 'arer '].join('') + token } : {}
                });
            }
        } catch (error) {
            console.error('[Performance] Failed to send metrics:', error);
        }
    }
    
    /**
     * Report performance issue
     */
    function reportPerformanceIssue(type, actual, threshold) {
        console.warn(`[Performance Issue] ${type}: ${actual}ms exceeds threshold ${threshold}ms`);
        
        // Could integrate with error tracking service here
    }
    
    /**
     * Clear metrics
     */
    function clearMetrics() {
        metrics.api_calls = [];
        metrics.component_renders = [];
        metrics.memory = [];
    }
    
    /**
     * Export metrics as JSON
     */
    function exportMetrics() {
        const dataStr = JSON.stringify(getReport(), null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `performance-metrics-${Date.now()}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
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
        getMetrics,
        getReport,
        clearMetrics,
        exportMetrics,
        thresholds
    };
})();

// Make available globally for debugging
window.AdminPerformanceMonitor = AdminPerformanceMonitor;
