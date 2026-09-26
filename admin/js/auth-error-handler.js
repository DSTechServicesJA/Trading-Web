/**
 * admin/js/auth-error-handler.js
 * ───────────────────────────────
 * Centralized auth error handling for all admin API calls.
 * Prevents infinite retry loops by tracking auth failures and stopping polling/retries.
 */

const AdminAuthErrorHandler = (() => {
    // Track failed auth attempts per endpoint
    const failedAttempts = new Map();
    const MAX_RETRIES = 3;
    const FAILURE_TIMEOUT = 300000; // 5 minutes before retry is allowed
    
    // Active polling intervals and timers
    const activeTimers = new Set();
    
    return {
        /**
         * Record an auth failure and check if we should continue retrying
         * @param {string} endpoint - The API endpoint that failed
         * @param {number} statusCode - HTTP status code (401 or 403)
         * @returns {boolean} - True if should retry, false if max retries exceeded
         */
        recordFailure(endpoint, statusCode) {
            if (statusCode !== 401 && statusCode !== 403) {
                return true; // Not an auth error
            }
            
            const now = Date.now();
            let attempt = failedAttempts.get(endpoint) || { count: 0, lastFailed: 0 };
            
            // Reset count if timeout has passed
            if (now - attempt.lastFailed > FAILURE_TIMEOUT) {
                attempt = { count: 0, lastFailed: 0 };
            }
            
            attempt.count++;
            attempt.lastFailed = now;
            failedAttempts.set(endpoint, attempt);
            
            if (attempt.count >= MAX_RETRIES) {
                console.error(`Auth failures for ${endpoint}: Max retries (${MAX_RETRIES}) exceeded. Stopping retry attempts.`);
                
                // Logout user
                if (window.ITGuruAuth?.logout) {
                    window.ITGuruAuth.logout();
                }
                
                // Redirect to login
                if (statusCode === 401) {
                    setTimeout(() => {
                        window.location.href = window.location.origin + (window.location.pathname.includes('/admin') ? '/admin' : '/');
                    }, 1000);
                }
                
                return false;
            }
            
            return true;
        },
        
        /**
         * Clear failure records for an endpoint (e.g., after successful auth recovery)
         * @param {string} endpoint - The API endpoint
         */
        clearFailure(endpoint) {
            failedAttempts.delete(endpoint);
        },
        
        /**
         * Get current failure count for an endpoint
         * @param {string} endpoint - The API endpoint
         * @returns {number} - Number of failed attempts
         */
        getFailureCount(endpoint) {
            const attempt = failedAttempts.get(endpoint);
            return attempt ? attempt.count : 0;
        },
        
        /**
         * Register a polling timer so it can be cleared on auth failure
         * @param {number} timerId - The timer ID from setInterval/setTimeout
         */
        registerTimer(timerId) {
            activeTimers.add(timerId);
        },
        
        /**
         * Unregister a timer
         * @param {number} timerId - The timer ID to remove
         */
        unregisterTimer(timerId) {
            activeTimers.delete(timerId);
            clearInterval(timerId);
            clearTimeout(timerId);
        },
        
        /**
         * Stop all polling on auth failure
         */
        stopAllPolling() {
            console.log(`Stopping ${activeTimers.size} active polling timers due to auth failure`);
            activeTimers.forEach(timerId => {
                clearInterval(timerId);
                clearTimeout(timerId);
            });
            activeTimers.clear();
        },
        
        /**
         * Wrap a fetch-based API call with auth error handling
         * @param {string} endpoint - The API endpoint
         * @param {Function} fetchFn - The fetch function to call
         * @param {Object} options - Options (retry:boolean, stopPollingOnFailure: boolean)
         * @returns {Promise<Response>}
         */
        async fetchWithAuthHandling(endpoint, fetchFn, options = {}) {
            const { retry = true, stopPollingOnFailure = true } = options;
            
            try {
                const response = await fetchFn();
                
                if (response.ok) {
                    this.clearFailure(endpoint);
                    return response;
                }
                
                // Handle auth errors
                if (response.status === 401 || response.status === 403) {
                    console.warn(`Auth error (${response.status}) on ${endpoint}`);
                    
                    if (stopPollingOnFailure) {
                        this.stopAllPolling();
                    }
                    
                    if (retry) {
                        const shouldContinue = this.recordFailure(endpoint, response.status);
                        if (!shouldContinue) {
                            throw new Error(`Authentication failed. Max retries exceeded for ${endpoint}`);
                        }
                    } else {
                        this.recordFailure(endpoint, response.status);
                    }
                }
                
                return response;
            } catch (error) {
                console.error(`Fetch error on ${endpoint}:`, error);
                throw error;
            }
        }
    };
})();

// Auto-stop polling on session invalidation
document.addEventListener('ITGuruAuthLogout', () => {
    console.log('Auth logout detected - stopping all polling');
    AdminAuthErrorHandler.stopAllPolling();
});
