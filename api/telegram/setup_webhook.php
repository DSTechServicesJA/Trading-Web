<?php
/**
 * api/telegram/setup_webhook.php
 * ──────────────────────────────
 * One-time script to register the Telegram webhook with the Bot API.
 *
 * USAGE
 * ──────
 *   Visit this URL in your browser (must be logged in as admin first,
 *   or just run it from the command line):
 *
 *     https://trading.dsitservicesja.com/api/telegram/setup_webhook.php?secret=YOUR_ADMIN_SECRET
 *
 *   Where YOUR_ADMIN_SECRET is any string you pass to protect this endpoint.
 *   Alternatively, delete this file after running it once.
 *
 * REQUIREMENTS
 * ─────────────
 *   TELEGRAM_BOT_TOKEN       — set in .env
 *   TELEGRAM_WEBHOOK_SECRET  — set in .env (will be sent to Telegram as the secret_token)
 *
 * The webhook URL will be set to:
 *   https://<HOST>/api/telegram/webhook.php
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/* ── Simple one-time protection: require ?secret= matching TELEGRAM_WEBHOOK_SECRET ── */
$provided = trim($_GET['secret'] ?? '');
$expected = env('TELEGRAM_WEBHOOK_SECRET');

if ($expected === '' || !hash_equals($expected, $provided)) {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "403 Forbidden — pass ?secret=<TELEGRAM_WEBHOOK_SECRET> to authorise this setup call.\n";
    exit;
}

$botToken = env('TELEGRAM_BOT_TOKEN');
if ($botToken === '') {
    http_response_code(503);
    header('Content-Type: text/plain');
    echo "TELEGRAM_BOT_TOKEN is not set in .env\n";
    exit;
}

/* ── Build the webhook URL ── */
$scheme  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host    = $_SERVER['HTTP_HOST'] ?? 'localhost';
$webhook = "{$scheme}://{$host}/api/telegram/webhook.php";

/* ── Call setWebhook ── */
$payload = json_encode([
    'url'          => $webhook,
    'secret_token' => $expected,
    'allowed_updates' => ['message'],
]);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => "https://api.telegram.org/bot{$botToken}/setWebhook",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$result  = curl_exec($ch);
$curlErr = curl_error($ch);
curl_close($ch);

header('Content-Type: application/json; charset=utf-8');

if ($result === false || $curlErr !== '') {
    http_response_code(502);
    echo json_encode(['ok' => false, 'description' => "cURL error: {$curlErr}", 'webhook_url' => $webhook]);
} else {
    echo $result; // forward Telegram's JSON response as-is
}
exit;
