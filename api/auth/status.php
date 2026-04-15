<?php
/**
 * GET/POST /api/auth/status
 * ─────────────────────────
 * Server health-check — verifies .env, DB connection, users table, and JWT.
 * Only returns detailed diagnostics when APP_DEBUG=true in .env.
 *
 * Response:  200 { "ok": true|false, "checks": { ... } }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/* Allow GET and POST for easy browser testing */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$checks = [];
$allOk  = true;

/* ── 1. .env file loaded ── */
$dbName = env('DB_NAME');
$dbUser = env('DB_USER');
$envOk  = ($dbName !== '' && $dbUser !== '');
$checks['env_loaded'] = $envOk ? 'ok' : 'FAIL — DB_NAME or DB_USER is empty; check your .env file';
if (!$envOk) $allOk = false;

/* ── 2. JWT_SECRET configured ── */
$jwtOk = (env('JWT_SECRET') !== '' && env('JWT_SECRET') !== 'generate_a_random_64_char_string_here');
$checks['jwt_secret'] = $jwtOk ? 'ok' : 'FAIL — JWT_SECRET is missing or still set to the placeholder value';
if (!$jwtOk) $allOk = false;

/* ── 3. Database connection ── */
$dbOk = false;
try {
    $pdo  = getDB();
    $dbOk = true;
    $checks['db_connection'] = 'ok';
} catch (\Throwable $e) {
    $checks['db_connection'] = 'FAIL — ' . (isDebug() ? $e->getMessage() : 'could not connect (enable APP_DEBUG=true for details)');
    $allOk = false;
}

/* ── 4. Users table exists ── */
if ($dbOk) {
    try {
        $stmt = $pdo->query('SELECT 1 FROM users LIMIT 1');
        $checks['users_table'] = 'ok';
    } catch (\Throwable $e) {
        $checks['users_table'] = 'FAIL — users table not found; run database/schema.sql';
        $allOk = false;
    }
}

/* ── 5. APP_ENV / Debug mode ── */
$checks['app_env']   = env('APP_ENV', '(not set)');
$checks['debug']     = isDebug() ? 'on' : 'off';
$checks['php_version'] = PHP_VERSION;

jsonResponse([
    'ok'     => $allOk,
    'checks' => $checks,
]);
