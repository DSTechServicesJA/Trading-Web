# Admin Dashboard Troubleshooting Guide

## Quick Diagnostics

### Check System Status

Open browser developer console (F12) and run:

```javascript
// Check all system components
console.log('Performance Report:', AdminPerformanceMonitor?.getReport());
console.log('Module Status:', AdminModuleLoader?.getMetrics());
console.log('Mobile Nav Status:', AdminMobileNav?.getCurrentBreakpoint());
console.log('Accessibility Issues:', AdminAccessibilityAudit?.runFullAudit());
```

---

## Common Issues

### 1. Dashboard Won't Load

**Symptoms:**
- Blank page
- "Loading..." forever
- White screen with no content

**Diagnosis:**
```javascript
// Check API connectivity
fetch('/api/admin/dashboard')
  .then(r => r.json())
  .then(d => console.log('API OK:', d))
  .catch(e => console.error('API Error:', e))
```

**Solutions:**

#### A. API Endpoint Error
```
❌ GET /api/admin/dashboard 404
```

**Fix:**
1. Check `.htaccess` file has `layouts` and `optimize-db` endpoints
2. Verify file exists: `/api/admin/dashboard.php`
3. Check file permissions: `ls -la /api/admin/dashboard.php`
4. Verify PHP is executable: `php -v`

#### B. Database Connection Error
```
Error: "Cannot connect to database"
```

**Fix:**
1. Check database credentials in config
2. Verify MySQL is running: `sudo systemctl status mysql`
3. Test connection: `mysql -u root -p -e "SELECT 1"`
4. Check database exists: `mysql -u root -p -e "SHOW DATABASES"`

#### C. Authentication Error
```
Error: "Session expired" or "Not authorized"
```

**Fix:**
1. Clear cookies: `localStorage.clear(); sessionStorage.clear()`
2. Log out and log back in
3. Check admin role in database:
   ```sql
   SELECT id, email, role FROM users WHERE role='admin' LIMIT 1;
   ```

### 2. Slow Performance

**Symptoms:**
- Dashboard takes > 2 seconds to load
- Charts are sluggish
- Search is unresponsive

**Diagnosis:**
```javascript
// Performance metrics
const report = AdminPerformanceMonitor.getReport();
console.log('Page Load:', report.page_load.total_load_time, 'ms');
console.log('API Calls:', report.network.total_api_calls);
console.log('Slow APIs:', report.network.slow_api_calls);
```

**Solutions:**

#### A. Optimize Database
Run optimization API:
```bash
curl -X POST https://your-domain/api/admin/optimize-db \
  -H "Authorization: ******"
```

Check results:
```javascript
// In browser console
fetch('/api/admin/optimize-db', { method: 'POST' })
  .then(r => r.json())
  .then(d => console.log('Optimization:', d))
```

#### B. Clear Cache
```javascript
// Clear performance cache
if ('caches' in window) {
  caches.keys().then(names => {
    names.forEach(name => caches.delete(name));
  });
}
```

#### C. Check Memory Usage
```javascript
if ('memory' in performance) {
  const mem = performance.memory;
  console.log('Memory Used:', (mem.usedJSHeapSize / 1048576).toFixed(2), 'MB');
  console.log('Memory Limit:', (mem.jsHeapSizeLimit / 1048576).toFixed(2), 'MB');
}
```

### 3. Search Not Working

**Symptoms:**
- Search modal won't open (Ctrl+K)
- No search results
- Search returns errors

**Diagnosis:**
```javascript
// Test global search
GlobalSearch.performSearch('test')
```

**Solutions:**

#### A. API Endpoint Missing
Check if endpoint exists:
```bash
curl https://your-domain/api/admin/search?q=test
```

Should return JSON, not 404.

**Fix:**
1. Verify `.htaccess` has `search` endpoint:
   ```
   RewriteRule ^api/admin/search$ api/admin/search.php [L,QSA]
   ```
2. Verify file exists: `/api/admin/search.php`

#### B. Database Search Indexes Missing
```sql
-- Check if search indexes exist
SHOW INDEX FROM users WHERE Key_name LIKE 'idx%';
SHOW INDEX FROM trades WHERE Key_name LIKE 'idx%';
SHOW INDEX FROM signals WHERE Key_name LIKE 'idx%';
```

**Fix:**
Run database optimization (see above)

#### C. Recent Searches Disabled
```javascript
// Clear and rebuild recent searches
localStorage.removeItem('admin-search-history');
```

### 4. Mobile Menu Not Working

**Symptoms:**
- Hamburger menu won't open
- Swipe gestures don't work
- Menu stuck open

**Diagnosis:**
```javascript
// Check mobile detection
console.log('Viewport:', window.innerWidth, 'x', window.innerHeight);
console.log('Breakpoint:', AdminMobileNav.getCurrentBreakpoint());
console.log('Is Mobile:', AdminMobileNav.isMobile());
console.log('Is Tablet:', AdminMobileNav.isTablet());
console.log('Is Desktop:', AdminMobileNav.isDesktop());
```

**Solutions:**

#### A. Module Not Loaded
```javascript
// Reload mobile nav
if (window.AdminMobileNav) {
  AdminMobileNav.init();
} else {
  console.error('AdminMobileNav not loaded');
}
```

#### B. CSS Not Applied
```javascript
// Check media queries
const sheet = document.styleSheets[document.styleSheets.length - 1];
console.log('Last stylesheet:', sheet.href);
console.log('Viewport < 1024px:', window.innerWidth < 1024);
```

**Fix:**
1. Ensure `mobile-optimization.css` is linked:
   ```html
   <link rel="stylesheet" href="css/mobile-optimization.css" />
   ```
2. Check file exists: `/admin/css/mobile-optimization.css`

#### C. Touch Events Not Working
```javascript
// Test touch support
console.log('Touch support:', 'ontouchstart' in window);
document.addEventListener('touchstart', (e) => {
  console.log('Touch detected at:', e.touches[0].clientX, e.touches[0].clientY);
});
```

### 5. Layout Save/Load Not Working

**Symptoms:**
- Layouts won't save
- Saved layouts don't apply
- Layout list is empty

**Diagnosis:**
```javascript
// Test layout API
fetch('/api/admin/layouts')
  .then(r => r.json())
  .then(d => console.log('Saved layouts:', d))
  .catch(e => console.error('Layout API error:', e))
```

**Solutions:**

#### A. API Endpoint Missing
Check `.htaccess`:
```
RewriteRule ^api/admin/layouts$ api/admin/layouts.php [L,QSA]
```

**Fix:**
1. Verify file exists: `/api/admin/layouts.php`
2. Check PHP permissions

#### B. Database Table Missing
```sql
SHOW TABLES LIKE 'admin_dashboard_layouts';
```

Should show: `admin_dashboard_layouts`

**Fix:**
Run database migration:
```bash
mysql -u root -p < database/schema.sql
```

#### C. Storage Quota Exceeded
```javascript
// Check localStorage usage
let size = 0;
for (let key in localStorage) {
  size += localStorage[key].length + key.length;
}
console.log('LocalStorage used:', (size / 1024).toFixed(2), 'KB');
```

**Fix:**
```javascript
// Clear old layouts
localStorage.removeItem('admin-pagination-size');
localStorage.removeItem('admin-theme');
```

### 6. Export Not Working

**Symptoms:**
- Export buttons don't work
- "Method not allowed" error
- Downloaded file is empty/corrupted

**Diagnosis:**
```javascript
// Test export
AuditTrailExport.exportToCSV();
// Check browser console for errors
```

**Solutions:**

#### A. External Libraries Not Loaded
```javascript
// Check if export libraries loaded
console.log('XLSX loaded:', window.XLSX ? 'Yes' : 'No');
console.log('jsPDF loaded:', window.jsPDF ? 'Yes' : 'No');
```

**Fix:**
The module loader will auto-load these on first use.

#### B. No Data to Export
```javascript
// Check if audit trail has data
const data = document.getElementById('auditList');
const count = data?.querySelectorAll('.audit-entry').length || 0;
console.log('Audit entries:', count);
```

**Fix:**
Load/filter audit trail data first before exporting.

### 7. Accessibility Issues

**Symptoms:**
- Screen reader not reading content
- Keyboard navigation not working
- High contrast mode issues

**Diagnosis:**
```javascript
// Run accessibility audit
const report = AdminAccessibilityAudit.runFullAudit();
console.log('Accessibility Issues:', report);
```

**Solutions:**

#### A. Missing ARIA Labels
```javascript
// Find elements without labels
const unlabeled = document.querySelectorAll('button:not([aria-label]):not(:has(text))');
console.log('Unlabeled buttons:', unlabeled.length);
```

**Fix:**
Add `aria-label` to interactive elements:
```html
<button aria-label="Open menu">☰</button>
```

#### B. Poor Color Contrast
```javascript
// Test contrast ratio
const style = window.getComputedStyle(element);
const fg = style.color;
const bg = style.backgroundColor;
// Calculate luminance and contrast
```

**Fix:**
Adjust colors using CSS variables:
```css
--text-primary: #000 (on light background)
--text-secondary: #666
```

### 8. Performance Issues on Load

**Symptoms:**
- Charts take long to load
- Tables are unresponsive initially
- Memory usage is high

**Diagnosis:**
```javascript
// Check module loading status
console.log('Modules loaded:', AdminModuleLoader.getMetrics());
console.log('Performance report:', AdminPerformanceMonitor.getReport());
```

**Solutions:**

#### A. Module Lazy Loading Not Working
```javascript
// Force load module
AdminModuleLoader.load('charts').then(() => {
  console.log('Charts loaded');
  // Manually initialize charts
})
```

#### B. Service Worker Not Caching
```javascript
// Check service worker status
navigator.serviceWorker.getRegistrations().then(registrations => {
  console.log('Service workers:', registrations);
});
```

**Fix:**
Re-register service worker:
```javascript
navigator.serviceWorker.register('/admin/js/service-worker.js')
  .then(r => console.log('SW registered:', r))
  .catch(e => console.error('SW error:', e))
```

---

## Advanced Debugging

### Enable Verbose Logging

```javascript
// Enable all debug logs
localStorage.setItem('admin-debug', 'true');
// Reload page
location.reload();
```

### Export Debug Information

```javascript
// Generate debug report
const debugReport = {
  browser: navigator.userAgent,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  performance: AdminPerformanceMonitor?.getReport(),
  modules: AdminModuleLoader?.getMetrics(),
  localStorage: { ...localStorage },
  console_logs: console.logs || []
};

const blob = new Blob([JSON.stringify(debugReport, null, 2)], 
  { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'debug-report.json';
a.click();
```

### Check Browser Compatibility

```javascript
// Test feature support
console.log('Fetch API:', 'fetch' in window);
console.log('LocalStorage:', typeof localStorage !== 'undefined');
console.log('Service Worker:', 'serviceWorker' in navigator);
console.log('Intersection Observer:', 'IntersectionObserver' in window);
console.log('Touch Events:', 'ontouchstart' in window);
console.log('Performance API:', 'performance' in window);
```

---

## Contact Support

When contacting support, include:

1. **Browser Info**: `navigator.userAgent`
2. **Viewport Size**: `window.innerWidth x window.innerHeight`
3. **Performance Report**: Output of `AdminPerformanceMonitor.getReport()`
4. **Debug Report**: Use export debug information above
5. **Steps to Reproduce**: Exact steps that cause the issue
6. **Screenshots/Video**: Visual evidence of the problem
7. **Console Errors**: Browser console messages (F12)
8. **Network Errors**: Network tab showing failed requests

---

## Emergency Contacts

- **Technical Support**: support@example.com
- **System Administrator**: admin@example.com
- **On-Call Engineer**: +1-XXX-XXX-XXXX

---

## FAQ

**Q: How do I reset the dashboard to factory settings?**
A: Clear all localStorage data:
```javascript
// WARNING: This will reset all preferences
['admin-theme', 'admin-pagination-size', 'admin-search-history', 
 'admin-dashboard-current-layout'].forEach(k => localStorage.removeItem(k));
```

**Q: Can I use the dashboard offline?**
A: Yes! The Service Worker caches static assets. You can browse previously loaded pages offline, but API features won't work.

**Q: How often is the database optimized?**
A: Indexes are created on first optimization run. Run `GET /api/admin/optimize-db` to manually optimize.

**Q: What's the maximum concurrent users?**
A: System is tested for 100+ concurrent users. Higher loads require server scaling.

**Q: Can I customize the dashboard layout?**
A: Yes! Save custom layouts for different workflows. Each admin has independent layout settings.
