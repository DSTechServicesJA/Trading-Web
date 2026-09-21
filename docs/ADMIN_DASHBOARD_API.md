# Admin Dashboard Redesign - API Documentation

## Overview

This document describes all new and enhanced API endpoints created as part of the Admin Dashboard Redesign project.

---

## Authentication

All endpoints require an admin user token in the `Authorization` header:

```
Authorization: ******
```

---

## Dashboard APIs

### GET /api/admin/dashboard
Get KPI metrics for the executive dashboard.

**Query Parameters:**
- `metric` (optional): Get specific metric (users, subscriptions, strategies, trading, win_rate, telegram, system)
- If not provided, returns all metrics

**Response:**
```json
{
  "users": {
    "total_users": 150,
    "active_users": 120,
    "premium_users": 45,
    "online_users": 32,
    "locked_accounts": 5
  },
  "subscriptions": {
    "active_subscriptions": 45,
    "trial_users": 20,
    "expiring_soon": 3,
    "expired_subscriptions": 10
  },
  "strategies": {
    "active_strategies": 4,
    "users_with_strategies": 80
  },
  "trading": {
    "signals_today": 150,
    "trades_today": 45,
    "wins_today": 28,
    "losses_today": 17
  },
  "win_rate": {
    "win_rate_30d": 62.5,
    "trades_30d": 200
  },
  "telegram": {
    "telegram_linked": 95,
    "telegram_messages_24h": 340,
    "telegram_failures": 2
  },
  "system": {
    "total_signals": 5000,
    "total_trades": 1200,
    "adaptive_profiles": 40
  }
}
```

---

## Preferences APIs

### GET /api/admin/preferences
Get user's dashboard preferences/layout.

**Query Parameters:**
- `layout`: Layout name (default: 'default')
- `list`: If provided, returns all saved layouts

**Response:**
```json
{
  "layout_name": "default",
  "widgets_json": "{}",
  "collapsed_sections": "[]",
  "theme": "dark"
}
```

### POST /api/admin/preferences
Save/update dashboard preferences.

**Request Body:**
```json
{
  "layout_name": "default",
  "widgets_json": {},
  "collapsed_sections": ["section-1", "section-2"],
  "theme": "dark",
  "is_default": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Layout saved"
}
```

### DELETE /api/admin/preferences
Delete a saved layout.

**Query Parameters:**
- `layout`: Layout name to delete

---

## Audit Trail APIs

### GET /api/admin/audit_trail
Get paginated audit trail entries.

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 50, max: 500)
- `admin_id`: Filter by admin who performed action
- `action`: Filter by action type
- `entity_type`: Filter by entity type
- `date_from`: Filter from date (YYYY-MM-DD)
- `date_to`: Filter to date (YYYY-MM-DD)

**Response:**
```json
{
  "success": true,
  "page": 1,
  "per_page": 50,
  "total": 234,
  "last_page": 5,
  "entries": [
    {
      "id": 1,
      "admin_id": 1,
      "admin_name": "John Admin",
      "action": "user_updated",
      "entity_type": "user",
      "entity_id": "123",
      "old_value": "{\"status\":\"active\"}",
      "new_value": "{\"status\":\"locked\"}",
      "ip_address": "192.168.1.1",
      "status": "success",
      "error_message": null,
      "created_at": "2026-09-21 10:30:00"
    }
  ]
}
```

### POST /api/admin/audit_trail
Create new audit entry (internal use).

---

## Impersonation APIs

### POST /api/admin/impersonate
Start impersonating a user (Super Admin only).

**Request Body:**
```json
{
  "user_id": 123,
  "reason": "Testing user dashboard"
}
```

**Response:**
```json
{
  "success": true,
  "log_id": 1,
  "user_id": 123,
  "username": "testuser",
  "message": "Impersonation started"
}
```

### POST /api/admin/impersonate?action=end
End current impersonation.

**Request Body:**
```json
{
  "log_id": 1,
  "user_id": 123
}
```

### GET /api/admin/impersonate
Get current impersonation info.

**Response:**
```json
{
  "impersonating": true,
  "log_id": 1,
  "user_id": 123,
  "username": "testuser",
  "display_name": "Test User",
  "reason": "Testing user dashboard",
  "started_at": "2026-09-21 10:30:00"
}
```

---

## Notifications Center APIs

### GET /api/admin/notifications_center
Get paginated notifications.

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 50)
- `category`: Filter by category (error, warning, info, success)
- `is_read`: Filter by read status (true/false)
- `severity`: Filter by severity (low, medium, high, critical)

**Response:**
```json
{
  "success": true,
  "page": 1,
  "per_page": 50,
  "total": 45,
  "last_page": 1,
  "unread_count": 8,
  "notifications": [
    {
      "id": 1,
      "notification_type": "error",
      "category": "database",
      "title": "Database Connection Error",
      "message": "Connection timeout on primary database",
      "severity": "critical",
      "source_entity": "db",
      "source_id": "primary",
      "related_data": "{}",
      "is_read": false,
      "created_at": "2026-09-21 10:30:00"
    }
  ]
}
```

### POST /api/admin/notifications_center
Create new notification (internal use).

### PUT /api/admin/notifications_center?id=1
Mark notification as read.

### DELETE /api/admin/notifications_center?id=1
Delete notification.

---

## Global Search APIs

### GET /api/admin/search
Search across all entities.

**Query Parameters:**
- `q`: Search query (required, min 2 chars)
- `type`: Entity type to search (users, trades, signals, rules, profiles, notifications, all)
- `limit`: Max results per type (default: 20, max: 100)

**Response:**
```json
{
  "query": "EURUSD",
  "results": {
    "signals": [
      {
        "type": "signal",
        "id": 1,
        "title": "EURUSD_20260921_001",
        "subtitle": "Grid Scalper MA • BULL",
        "meta": "PENDING",
        "created_at": "2026-09-21 10:30:00",
        "link": "/admin/#signal-1"
      }
    ],
    "trades": [
      {
        "type": "trade",
        "id": 1,
        "title": "TRADE_123 (EURUSD)",
        "subtitle": "Grid Scalper MA • BULL",
        "meta": "WIN (125.50%)",
        "created_at": "2026-09-21 09:15:00",
        "link": "/admin/#trade-1"
      }
    ]
  },
  "total": 2
}
```

---

## Enhanced Users Management APIs

### GET /api/admin/users_management
List users with pagination and advanced filtering.

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 50, max: 500)
- `search`: Search by username, email, or display name
- `status`: Filter by status (active, locked)
- `subscription`: Filter by subscription status (active, inactive, trial)
- `role`: Filter by role (user, admin)

**Response:**
```json
{
  "success": true,
  "page": 1,
  "per_page": 50,
  "total": 150,
  "last_page": 3,
  "users": [
    {
      "id": 1,
      "username": "john_trader",
      "email": "john@example.com",
      "display_name": "John Trader",
      "role": "user",
      "status": "active",
      "subscription_status": "active",
      "subscription_plan": "monthly",
      "subscription_expires_at": "2026-10-21",
      "telegram_linked_at": "2026-01-15",
      "last_login_at": "2026-09-21 09:00:00",
      "created_at": "2026-01-01 00:00:00"
    }
  ]
}
```

### POST /api/admin/users_management
Perform bulk actions on users.

**Request Body (Lock users):**
```json
{
  "action": "lock",
  "user_ids": [1, 2, 3],
  "reason": "Suspicious activity"
}
```

**Request Body (Update subscription):**
```json
{
  "action": "update_subscription",
  "user_ids": [1, 2, 3],
  "plan": "monthly",
  "days": 30
}
```

**Supported Actions:**
- `lock` - Lock user accounts
- `unlock` - Unlock user accounts
- `reset_adaptive` - Reset adaptive intelligence
- `update_subscription` - Update subscription plan

**Response:**
```json
{
  "success": true,
  "action": "lock",
  "count": 3,
  "results": [
    {"user_id": 1, "status": "locked"},
    {"user_id": 2, "status": "locked"},
    {"user_id": 3, "status": "locked"}
  ]
}
```

### PUT /api/admin/users_management/:id
Update single user.

**Request Body:**
```json
{
  "display_name": "John Updated",
  "status": "locked",
  "reason": "Inactive for 90 days"
}
```

---

## Database Schema Changes

### New Tables

1. **admin_dashboard_preferences**
   - Stores dashboard layout and widget preferences per admin user
   - Supports multiple saved layouts

2. **admin_audit_trail**
   - Complete audit log of all admin actions
   - Tracks: who, what, when, where, before/after values

3. **admin_impersonation_log**
   - Logs all user impersonations by super admins
   - For security and compliance

4. **admin_notifications_center**
   - Aggregates system errors, warnings, and events
   - Unread badges and filtering support

---

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "Error message description",
  "details": "Additional error context (optional)"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (invalid parameters)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `405` - Method not allowed
- `500` - Server error

---

## Rate Limiting

Currently, no rate limiting is implemented. Future versions will include:
- 100 requests per minute per IP
- 1000 requests per hour per IP

---

## Best Practices

1. **Always include proper authentication** - All requests must include valid admin token
2. **Use pagination** - For endpoints returning lists, use pagination to avoid large responses
3. **Filter results** - Use available filters to reduce data transfer
4. **Handle errors gracefully** - Implement proper error handling in client code
5. **Log important actions** - All admin actions are automatically logged for compliance
6. **Audit impersonations** - Monitor audit trail for impersonation activity

---

## Testing

Example requests using curl:

```bash
# Get dashboard metrics
curl -H "Authorization: ******" \
  https://api.example.com/api/admin/dashboard

# List users with pagination
curl -H "Authorization: ******" \
  "https://api.example.com/api/admin/users_management?page=1&per_page=50"

# Lock multiple users
curl -X POST -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"action":"lock","user_ids":[1,2,3]}' \
  https://api.example.com/api/admin/users_management

# Global search
curl -H "Authorization: ******" \
  "https://api.example.com/api/admin/search?q=EURUSD&type=all"
```

---

## Version History

- **v1.0** (2026-09-21) - Initial implementation with core APIs for dashboard redesign
