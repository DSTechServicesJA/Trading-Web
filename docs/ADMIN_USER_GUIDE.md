# Admin Dashboard User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Dashboard Features](#dashboard-features)
3. [Navigation Guide](#navigation-guide)
4. [User Management](#user-management)
5. [Strategy Management](#strategy-management)
6. [Performance Monitoring](#performance-monitoring)
7. [Troubleshooting](#troubleshooting)
8. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

### Login and First Visit

1. Navigate to `/admin/` from your browser
2. Enter your admin credentials
3. You'll be taken to the Executive Dashboard home page
4. The dashboard remembers your preferred layout and theme

### Changing Your Theme

- Click the **Toggle Theme** button in the top navigation
- Your preference is saved automatically
- Supports light mode (default) and dark mode

### Restoring Your Layout

- Click **Layouts** button in the top navigation
- Select any previously saved layout
- Click "Load" to apply it immediately

---

## Dashboard Features

### KPI Cards

The Executive Dashboard displays key performance indicators:

- **Total Users** - All registered users
- **Active Users** - Users with activity in last 24 hours
- **Premium Users** - Paid subscription holders
- **Online Users** - Currently connected users
- **Active Strategies** - Running automated trading strategies
- **Signals Today** - Trading signals generated today
- **Trades Today** - Executed trades
- **Win Rate** - Percentage of profitable trades
- **Telegram Messages** - Notifications sent via Telegram
- **System Health** - Overall system status

### Collapsible Sections

All dashboard sections can be collapsed to manage screen space:

- Click the arrow (▼) to collapse a section
- Sections remember their state after refresh
- Use **Expand All** and **Collapse All** buttons to manage all sections at once

### Charts and Visualizations

Charts display real-time data:

- **Daily Signals** - Signals generated per day
- **Win Rates** - Trading performance trends
- **Users Growth** - User registration trend
- **Subscriptions** - Active vs expired subscriptions
- **Strategy Performance** - Each strategy's profitability

Click on chart elements to drill down into details.

---

## Navigation Guide

### Global Search (Ctrl+K)

Use global search to quickly find users, trades, signals, and more:

1. Press **Ctrl+K** (or Cmd+K on Mac) from any page
2. Type your search term
3. Results appear organized by category
4. Click a result to navigate to details
5. Recent searches are saved for quick access

### Main Navigation Menu

**Desktop/Tablet:**
- Menu items are visible in the top navbar
- Click items to navigate

**Mobile:**
- Click the **☰** (hamburger) icon to open the off-canvas menu
- Swipe right from the left edge to open the menu
- Swipe left or click outside to close

### Available Sections

1. **Dashboard Home** - Executive overview and KPIs
2. **User Admin** - User account management
3. **User Management** - Advanced user controls and bulk actions
4. **Strategies** - Trading strategy configuration
5. **Adaptive Intelligence** - AI learning and optimization
6. **Audit Trail** - Administrative action log
7. **System Logs** - Technical system logs

---

## User Management

### Searching and Filtering Users

1. Go to **User Management**
2. Use the search box for username, email, or Telegram ID
3. Apply filters:
   - **Active** - Currently enabled accounts
   - **Inactive** - Disabled accounts
   - **Premium** - Paid subscribers
   - **Trial** - Free trial users
   - **Expired** - Subscription expired
   - **Admin** - Administrator accounts

### Bulk Actions

Select multiple users using checkboxes, then:

- **Enable** - Activate selected accounts
- **Disable** - Deactivate selected accounts
- **Delete** - Remove selected users
- **Assign Subscription** - Set subscription plan
- **Assign Rules** - Apply trading rules
- **Reset Adaptive Intelligence** - Clear learning data

### Viewing User Details

Click a username to see:
- Account information
- Subscription status
- Recent activity
- Learning profile
- Trade history
- Adaptive settings

---

## Strategy Management

### Viewing Strategies

1. Go to **Strategies**
2. Each strategy has its own dashboard:
   - Grid Scalper MA
   - MTF (Multi-TimeFrame)
   - Breakout Retest
   - Future Strategies

### Strategy Tabs

Each strategy displays:

- **Overview** - Basic information and status
- **Performance** - Profit/loss metrics
- **Signals** - Generated trading signals
- **Adaptive Learning** - AI optimization progress
- **Notifications** - Alert configuration
- **Logs** - Technical execution logs

### Modifying Strategy Settings

1. Navigate to a strategy
2. Click **Edit** button
3. Modify parameters
4. Review changes
5. Click **Save**

---

## Performance Monitoring

### System Performance Panel

Check system health and performance:

1. Go to **System Performance**
2. Monitor real-time metrics:
   - CPU usage
   - Memory usage
   - Database load
   - Signal processing speed
   - Telegram queue depth
   - Active requests
   - Cron jobs status
   - API response times

Panel auto-refreshes every 30 seconds. Click **Pause** to stop auto-refresh.

### Performance Optimization

The dashboard includes automatic optimization:

- Database indexes optimized
- Static assets cached
- Module lazy loading enabled
- Service Worker caching active

Run manual optimization:
1. Go to System Admin
2. Click **Run Database Optimization**
3. Review results

---

## Audit Trail

### Viewing Administrative Actions

1. Go to **Audit Trail**
2. See all admin actions with timestamps
3. View before/after values for changes
4. Filter by:
   - Admin user
   - Action type (create, update, delete, etc.)
   - Date range
   - Entity type

### Exporting Audit Data

Click **Export** and choose format:

- **CSV** - For spreadsheet analysis
- **Excel** - Formatted workbook
- **PDF** - Professional report

Exports respect current filters.

---

## Troubleshooting

### Dashboard Won't Load

1. Clear browser cache (Ctrl+Shift+Delete)
2. Try incognito/private mode
3. Check browser console for errors (F12)
4. Verify your admin access permissions
5. Check system status in logs

### Slow Performance

1. Check **System Performance** panel
2. Close unused browser tabs
3. Clear browser cache
4. Update to latest browser version
5. Check network connection speed

### Module not responding

**Module Loader Debug:**
```javascript
// In browser console:
AdminModuleLoader.getMetrics()
// Shows loaded modules and their load times
```

**Performance Metrics:**
```javascript
AdminPerformanceMonitor.getReport()
// Shows detailed performance data
```

### Mobile Menu Not Working

1. Refresh the page
2. Try rotating device
3. Check if JavaScript is enabled
4. Try different browser
5. Clear browser data

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open global search |
| `Esc` | Close search/modals |
| `Tab` | Next focusable element |
| `Shift+Tab` | Previous focusable element |
| `Enter` | Activate button/link |
| `Space` | Toggle checkbox/toggle menu |

---

## Tips & Best Practices

### 1. Save Your Layout

Frequently used layout combinations:
- Save "Executive View" with only KPI and health summary
- Save "Trading Focus" with strategies and signals
- Save "Admin Overview" with users and audit trail

### 2. Use Global Search

Faster than navigating menus:
- Search user by username
- Search trade by symbol
- Search signal by strategy
- All results in one place

### 3. Monitor Performance

Check performance during high activity:
- Watch CPU/memory usage trends
- Monitor signal processing speed
- Track API response times

### 4. Regular Backups

Export audit trail regularly:
- Monthly compliance backup
- Before major changes
- For audit purposes

### 5. Mobile Usage

On mobile devices:
- Use hamburger menu for navigation
- Swipe gestures for menu control
- Tap buttons multiple times for reliability
- Landscape mode for wider tables

---

## Getting Help

### Contact Support

1. Check Troubleshooting section above
2. Review system logs
3. Check browser console (F12)
4. Export and share performance metrics
5. Contact system administrator

### Reporting Issues

Include:
- What you were doing
- What went wrong
- Steps to reproduce
- Browser and OS version
- Performance metrics (if applicable)
- Screenshots/screen recordings

---

## System Information

### Supported Browsers

- Chrome/Chromium (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

### Mobile Support

- iPhone: iOS 12+
- Android: Android 6+
- Responsive at 320px+

### Accessibility

- WCAG 2.1 Level AA compliant
- Keyboard navigation supported
- Screen reader compatible
- Reduced motion supported
- High contrast mode supported

---

## Version Information

- **Dashboard Version**: 1.0.0
- **Last Updated**: 2026-09-21
- **Compatibility**: PHP 7.4+, MySQL 5.7+

---

## Document Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-09-21 | Initial release |
