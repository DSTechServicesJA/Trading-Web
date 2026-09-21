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

## Strategy Statistics APIs

### GET /api/admin/strategy_stats?action=stats&strategy=grid_scalper_ma
Get statistics for a specific strategy.

**Query Parameters:**
- `strategy`: Strategy type (grid_scalper_ma, mtf, breakout_retest)
- `action`: 'stats', 'signals', or 'performance'

**Response:**
```json
{
  "success": true,
  "strategy": "grid_scalper_ma",
  "signals": {
    "total": 450,
    "active": 12,
    "completed": 438
  },
  "trades_30d": {
    "total": 120,
    "wins": 78,
    "losses": 35,
    "breakeven": 7,
    "win_rate": 65.0,
    "avg_return": 2.35,
    "best_trade": 15.5,
    "worst_trade": -8.25,
    "profitable_trades": 78
  },
  "today": {
    "trades": 8,
    "wins": 6,
    "total_return": 18.75
  },
  "top_symbols": [
    {
      "symbol": "EURUSD",
      "trades": 12,
      "wins": 9,
      "avg_return": 2.5
    }
  ]
}
```

### GET /api/admin/strategy_stats?action=performance
Get performance comparison across all strategies.

---

## Adaptive Intelligence Management APIs

### GET /api/admin/adaptive_intelligence?user_id=123
Get adaptive profiles for a user.

**Query Parameters:**
- `user_id`: User ID (required)
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 50)

**Response:**
```json
{
  "success": true,
  "user_id": 123,
  "total": 4,
  "profiles": [
    {
      "id": 1,
      "user_id": 123,
      "strategy_type": "grid_scalper_ma",
      "learning_stage": "QUALIFIED",
      "qualification_level": 0.87,
      "trades_analyzed": 45,
      "wins_captured": 32,
      "overall_confidence": 0.92,
      "created_at": "2026-09-01 10:00:00",
      "updated_at": "2026-09-21 15:30:00"
    }
  ]
}
```

### GET /api/admin/adaptive_intelligence?action=stats
Get adaptive system statistics.

**Response:**
```json
{
  "success": true,
  "total_profiles": 450,
  "total_rules": 1200,
  "active_profiles": 380,
  "users_with_adaptive": 145,
  "by_strategy": [
    {
      "strategy": "grid_scalper_ma",
      "count": 200,
      "avg_confidence": 0.85
    }
  ]
}
```

### POST /api/admin/adaptive_intelligence
Reset adaptive intelligence for a user.

**Request Body:**
```json
{
  "user_id": 123
}
```

---

## System Logs APIs

### GET /api/admin/logs?level=error&limit=50
Get system logs with filtering and search.

**Query Parameters:**
- `level`: Log level (debug, info, warning, error, fatal)
- `source`: Log source (strategy, telegram, api, database)
- `search`: Search in message and context
- `date_from`: Start date (YYYY-MM-DD)
- `date_to`: End date (YYYY-MM-DD)
- `limit`: Number of logs (default: 50, max: 1000)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "total": 456,
  "has_more": true,
  "logs": [
    {
      "id": 1,
      "level": "ERROR",
      "source": "telegram",
      "message": "Failed to send message to user 123",
      "context": {"user_id": 123, "reason": "rate_limit"},
      "created_at": "2026-09-21 15:30:00"
    }
  ],
  "available_sources": ["api", "database", "strategy", "telegram"],
  "available_levels": ["DEBUG", "INFO", "WARNING", "ERROR", "FATAL"],
  "stats": {
    "total_logs": 5000,
    "error_count": 120,
    "warning_count": 450,
    "earliest_log": "2026-09-01 00:00:00",
    "latest_log": "2026-09-21 23:59:59"
  }
}
```

---

## Telegram Queue Monitor APIs

### GET /api/admin/telegram_queue
Get Telegram queue status and statistics.

**Response:**
```json
{
  "success": true,
  "queue_status": {
    "queued": 12,
    "sent_today": 456,
    "failed": 3,
    "retry_queue": 2,
    "oldest_queued": "2026-09-21 15:20:00"
  },
  "today_stats": {
    "total_messages": 471,
    "sent": 456,
    "failed": 3,
    "success_rate": 96.81,
    "avg_delivery_time_sec": 2.35
  },
  "health_indicators": {
    "rate_limit_events_24h": 0,
    "queue_healthy": true,
    "last_check": "2026-09-21 15:35:00"
  }
}
```

### GET /api/admin/telegram_queue?action=messages&status=FAILED
Get queued or failed messages.

**Query Parameters:**
- `action`: 'messages', 'retry', or 'health'
- `status`: QUEUED, FAILED, RETRY, SENT
- `page`: Page number
- `per_page`: Results per page

### POST /api/admin/telegram_queue?action=retry
Retry a failed message.

**Request Body:**
```json
{
  "message_id": 123
}
```

### GET /api/admin/telegram_queue?action=health
Get Telegram API health status.

---

## System Performance Monitoring APIs

### GET /api/admin/performance
Get all system performance metrics.

**Response:**
```json
{
  "success": true,
  "server": {
    "php_version": "8.2.0",
    "os": "Linux kernel 5.15",
    "timestamp": "2026-09-21 15:35:00"
  },
  "memory": {
    "current_usage_mb": 128.5,
    "peak_usage_mb": 256.0,
    "limit": "512M",
    "percentage_used": 50.2
  },
  "database": {
    "total_tables": 45,
    "total_size_mb": 1024.5,
    "active_connections": 12,
    "signal_queue": 450
  },
  "processing": {
    "active_requests": 8,
    "telegram_queue": 12,
    "scheduled_jobs_total": 15,
    "scheduled_jobs_running": 3
  },
  "api": {
    "avg_response_time_ms": 145.5,
    "max_response_time_ms": 2500.0,
    "min_response_time_ms": 15.0,
    "total_requests_1h": 4500
  },
  "cache": {
    "enabled": true,
    "type": "redis"
  }
}
```

### GET /api/admin/performance?action=database
Get detailed database performance metrics.

### GET /api/admin/performance?action=api-response-times&interval=hour
Get API response time analytics.

**Query Parameters:**
- `interval`: 'hour', 'day', or '6hour'

---

## Version History

- **v1.0** (2026-09-21) - Initial implementation with core APIs for dashboard redesign
- **v1.1** (2026-09-21) - Added strategy statistics, adaptive intelligence, logs, Telegram queue, and performance monitoring APIs
