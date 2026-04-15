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
$jwtVal   = env('JWT_SECRET');
$jwtOk    = ($jwtVal !== '' && $jwtVal !== 'generate_a_random_64_char_string_here');
$jwtAuto  = $jwtOk && is_file(dirname(__DIR__, 2) . '/.jwt_secret');
if ($jwtOk) {
    $checks['jwt_secret'] = $jwtAuto
        ? 'ok (auto-generated — set JWT_SECRET in .env for full control)'
        : 'ok';
} else {
    $checks['jwt_secret'] = 'FAIL — JWT_SECRET is missing or still set to the placeholder value';
    $allOk = false;
}

/* ── 3. Database connection ── */
$dbOk = false;
try {
    $pdo  = getDB();
    $dbOk = true;
    $checks['db_connection'] = 'ok';
} catch (\Throwable $e) {
    $detail = $e->getMessage();
    /* Redact credentials from the message but always show the category */
    $hint = 'could not connect';
    if (str_contains($detail, 'Unknown database')) {
        $hint = 'database does not exist — create it in your hosting panel';
    } elseif (str_contains($detail, 'Access denied')) {
        $hint = 'access denied — check DB_USER and DB_PASSWORD in .env';
    } elseif (str_contains($detail, 'Connection refused') || str_contains($detail, 'No such file')) {
        $hint = 'cannot reach DB host — check DB_HOST in .env';
    } elseif (str_contains($detail, 'DB_NAME') || str_contains($detail, 'DB_USER') || str_contains($detail, 'not configured')) {
        $hint = 'DB_NAME or DB_USER is empty — check .env file';
    } elseif (isDebug()) {
        $hint = $detail;
    }
    $checks['db_connection'] = 'FAIL — ' . $hint;
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

/* ── 4b. Verify expected columns exist ── */
if ($dbOk && ($checks['users_table'] ?? '') === 'ok') {
    try {
        $pdo->query(
            'SELECT id, username, display_name, password_hash, email FROM users LIMIT 0'
        );
        $checks['users_columns'] = 'ok';
    } catch (\Throwable $e) {
        $hint = 'missing columns — re-run database/schema.sql';
        if (isDebug()) $hint .= ' — ' . $e->getMessage();
        $checks['users_columns'] = 'FAIL — ' . $hint;
        $allOk = false;
    }
}

/* ── 4c. JWT encode / decode round-trip ── */
try {
    $testToken = jwtEncode(['test' => true, 'iat' => time(), 'exp' => time() + 60]);
    $decoded   = jwtDecode($testToken);
    if ($decoded && ($decoded['test'] ?? false) === true) {
        $checks['jwt_roundtrip'] = 'ok';
    } else {
        $checks['jwt_roundtrip'] = 'FAIL — token decoded but payload mismatch';
        $allOk = false;
    }
} catch (\Throwable $e) {
    $checks['jwt_roundtrip'] = 'FAIL — ' . $e->getMessage();
    $allOk = false;
}

/* ── 4d. password_hash / password_verify sanity check ── */
try {
    $testHash = password_hash('test', PASSWORD_BCRYPT, ['cost' => 4]);
    if ($testHash === false) {
        $checks['password_hashing'] = 'FAIL — password_hash returned false';
        $allOk = false;
    } elseif (!password_verify('test', $testHash)) {
        $checks['password_hashing'] = 'FAIL — password_verify could not verify a freshly generated hash';
        $allOk = false;
    } else {
        $checks['password_hashing'] = 'ok';
    }
} catch (\Throwable $e) {
    $checks['password_hashing'] = 'FAIL — ' . $e->getMessage();
    $allOk = false;
}

/* ── 5. APP_ENV / Debug mode ── */
$checks['app_env']   = env('APP_ENV', '(not set)');
$checks['debug']     = isDebug() ? 'on' : 'off';
$checks['php_version'] = PHP_VERSION;

jsonResponse([
    'ok'     => $allOk,
    'checks' => $checks,
]);
