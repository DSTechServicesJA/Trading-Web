# MT5 Bridge API Template (Minimal)

This document provides minimal request/response templates matching these endpoints exactly:

- `/api/mt5/signal.php`
- `/api/mt5/pull.php`
- `/api/mt5/status.php`
- `/api/mt5/order_status.php`

---

## 1) Queue order from web flow

### `POST /api/mt5/signal.php`

**Headers**
- `Authorization: Bearer <JWT>`
- Optional: `X-Idempotency-Key: <KEY>`

**Request (minimal valid JSON)**
```json
{
  "symbol": "EURUSD",
  "dir": "BUY",
  "entry": 1.085,
  "sl": 1.083,
  "tp": 1.089
}
```

**Response**
```json
{
  "ok": true,
  "duplicate": false,
  "order": {
    "orderId": "mt5_20260516235154_ab12cd34",
    "status": "QUEUED",
    "symbol": "EURUSD",
    "side": "BUY",
    "orderType": "BUY_MARKET",
    "entry": 1.085,
    "sl": 1.083,
    "tp": 1.089,
    "lot": 0.01,
    "source": "breakout",
    "strategyName": "",
    "brokerTicket": null,
    "message": null,
    "attempts": 0,
    "createdAt": 1710000000,
    "updatedAt": 1710000000
  }
}
```

---

## 2) EA poll for queued orders

### `GET|POST /api/mt5/pull.php`

**Auth options**
- Header: `X-MT5-BRIDGE-KEY: <MT5_BRIDGE_KEY>`
- Or request field/query: `bridge_key`

**GET example**
```http
GET /api/mt5/pull.php?bridge_key=<MT5_BRIDGE_KEY>&limit=20&terminal=MT5-TERM-01
```

**POST request JSON (minimal)**
```json
{
  "bridge_key": "<MT5_BRIDGE_KEY>",
  "limit": 20,
  "terminal": "MT5-TERM-01"
}
```

**Response**
```json
{
  "ok": true,
  "serverTime": 1710000000,
  "count": 1,
  "orders": [
    {
      "orderId": "mt5_20260516235154_ab12cd34",
      "symbol": "EURUSD",
      "side": "BUY",
      "orderType": "BUY_MARKET",
      "entry": 1.085,
      "sl": 1.083,
      "tp": 1.089,
      "lot": 0.01,
      "digits": 5,
      "point": 0.00001,
      "source": "breakout",
      "strategyName": "MyStrategy",
      "idempotencyKey": "abc123",
      "attempts": 1,
      "createdAt": 1710000000
    }
  ]
}
```

---

## 3) EA callback status updates

### `POST /api/mt5/status.php`

**Auth options**
- Header: `X-MT5-BRIDGE-KEY: <MT5_BRIDGE_KEY>`
- Or request field: `bridge_key`

### Single update request
```json
{
  "bridge_key": "<MT5_BRIDGE_KEY>",
  "orderId": "mt5_20260516235154_ab12cd34",
  "status": "FILLED",
  "brokerTicket": "12345678",
  "message": "Filled by broker",
  "filledPrice": 1.08502
}
```

### Batch update request
```json
{
  "bridge_key": "<MT5_BRIDGE_KEY>",
  "updates": [
    {
      "orderId": "mt5_20260516235154_ab12cd34",
      "status": "RECEIVED",
      "brokerTicket": "12345678",
      "message": "Accepted",
      "filledPrice": 0
    }
  ]
}
```

**Allowed status values**
- `QUEUED`, `DISPATCHED`, `RECEIVED`, `FILLED`, `MODIFIED`, `REJECTED`, `CANCELLED`, `EXPIRED`

**Response**
```json
{
  "ok": true,
  "applied": 1,
  "missingOrderIds": []
}
```

---

## 4) Web UI poll order status

### `GET /api/mt5/order_status.php`

**Headers**
- `Authorization: Bearer <JWT>`

**Query params**
- `since` (unix timestamp, optional)
- `limit` (1..200, optional)

**Example**
```http
GET /api/mt5/order_status.php?since=0&limit=50
```

**Response**
```json
{
  "ok": true,
  "serverTime": 1710000000,
  "count": 1,
  "orders": [
    {
      "orderId": "mt5_20260516235154_ab12cd34",
      "status": "FILLED",
      "symbol": "EURUSD",
      "side": "BUY",
      "orderType": "BUY_MARKET",
      "entry": 1.085,
      "sl": 1.083,
      "tp": 1.089,
      "lot": 0.01,
      "source": "breakout",
      "strategyName": "",
      "brokerTicket": "12345678",
      "message": "Filled by broker",
      "attempts": 1,
      "createdAt": 1710000000,
      "updatedAt": 1710000030
    }
  ]
}
```
