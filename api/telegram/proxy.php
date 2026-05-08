<?php
/**
 * POST /api/telegram/proxy
 * ────────────────────────
 * Server-side proxy for Telegram Bot API calls.
 *
 * Browsers block direct fetch() to api.telegram.org due to CORS.
 * This endpoint forwards the request server-side where no CORS
 * restriction applies, then returns the Telegram API response.
 *
 * Supported actions: getMe, getChat, sendMessage, sendPhoto
 *
 * ── JSON requests (getMe, getChat, sendMessage) ──
 *   POST body: { "action": "sendMessage", "token": "...", "payload": { ... } }
 *
 * ── File upload (sendPhoto) ──
 *   POST multipart/form-data with fields:
 *     action  = "sendPhoto"
 *     token   = bot token
 *     chat_id = target chat
 *     caption = (optional)
 *     parse_mode = (optional)
 *     photo   = uploaded file
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/* ── Only allow POST (and preflight OPTIONS) ── */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['ok' => false, 'description' => 'Method not allowed'], 405);
}

/* ── Rate limit: 30 requests per minute per IP ── */
if (!rateLimit(30, 60)) {
    jsonResponse(['ok' => false, 'description' => 'Rate limit exceeded — try again shortly'], 429);
}

/* ── Require authenticated user (JWT) ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
    $jwtPayload = jwtDecode($matches[1]);
} else {
    $jwtPayload = null;
}
if (!$jwtPayload) {
    jsonResponse(['ok' => false, 'description' => 'Authentication required'], 401);
}

/* ── Allowed Telegram Bot API actions ── */
$ALLOWED_ACTIONS = ['getMe', 'getChat', 'sendMessage', 'sendPhoto'];

/**
 * Determine whether this is a multipart upload or a JSON request,
 * then extract the action and token.
 */
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$isMultipart = str_contains($contentType, 'multipart/form-data');

if ($isMultipart) {
    /* ── Multipart: fields come from $_POST, file from $_FILES ── */
    $action = trim($_POST['action'] ?? '');
    $token  = trim($_POST['token'] ?? '');
} else {
    /* ── JSON body ── */
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw ?: '', true);
    if (!is_array($body)) {
        jsonResponse(['ok' => false, 'description' => 'Invalid JSON body'], 400);
    }
    $action  = trim($body['action'] ?? '');
    $token   = trim($body['token'] ?? '');
    $payload = $body['payload'] ?? [];
}

/* ── Validate action ── */
if ($action === '' || !in_array($action, $ALLOWED_ACTIONS, true)) {
    jsonResponse(['ok' => false, 'description' => 'Invalid or missing action. Allowed: ' . implode(', ', $ALLOWED_ACTIONS)], 400);
}

/* ── Validate token format (digits:alphanumeric) ── */
if ($token === '' || !preg_match('/^\d+:[A-Za-z0-9_-]+$/', $token)) {
    jsonResponse(['ok' => false, 'description' => 'Invalid or missing bot token'], 400);
}

/* ── Enforce platform bot token when configured (prevents SSRF-style proxy abuse) ── */
$platformToken = env('TELEGRAM_BOT_TOKEN');
if ($platformToken !== '' && $token !== $platformToken) {
    jsonResponse(['ok' => false, 'description' => 'Unauthorized bot token'], 403);
}

/* ── Build the Telegram API URL ── */
$telegramUrl = "https://api.telegram.org/bot{$token}/{$action}";

/* ── Prepare cURL ── */
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $telegramUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_SSL_VERIFYPEER => true,
]);

if ($isMultipart && $action === 'sendPhoto') {
    /* ── Forward the multipart upload ── */
    $postFields = [];

    /* Copy text fields */
    foreach (['chat_id', 'caption', 'parse_mode'] as $field) {
        if (isset($_POST[$field]) && $_POST[$field] !== '') {
            $postFields[$field] = $_POST[$field];
        }
    }

    /* Attach the photo file */
    if (isset($_FILES['photo']) && $_FILES['photo']['error'] === UPLOAD_ERR_OK) {
        $tmpPath  = $_FILES['photo']['tmp_name'];
        /* Detect MIME type server-side — the client-supplied $_FILES['type'] is
           user-controlled and must not be trusted. */
        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($tmpPath) ?: 'image/png';
        $fileName = $_FILES['photo']['name'] ?: 'chart.png';
        $postFields['photo'] = new CURLFile($tmpPath, $mimeType, $fileName);
    } else {
        jsonResponse(['ok' => false, 'description' => 'Photo file is required for sendPhoto'], 400);
    }

    curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
} else {
    /* ── JSON payload (sendMessage, getMe, getChat) ── */
    $jsonPayload = json_encode(is_array($payload) && count($payload) > 0 ? $payload : new \stdClass());
    curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonPayload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
}

/* ── Execute ── */
$result   = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($result === false || $curlErr !== '') {
    error_log("Telegram proxy cURL error: $curlErr");
    jsonResponse(['ok' => false, 'description' => 'Failed to reach Telegram API: ' . ($curlErr ?: 'unknown error')], 502);
}

/* ── Return the Telegram API response as-is ── */
http_response_code($httpCode ?: 200);
header('Content-Type: application/json; charset=utf-8');
echo $result;
exit;
