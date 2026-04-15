<?php
/**
 * Trading-Web — Server Configuration
 * ───────────────────────────────────
 * Loads .env, establishes DB connection, and provides JWT + utility helpers.
 * Required by every API endpoint — never accessed directly by the browser.
 */

declare(strict_types=1);

/* ── Prevent direct access ── */
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit(json_encode(['error' => 'Direct access forbidden']));
}

/* ══════════════════════════════════════════════
   1. Load .env file
   ══════════════════════════════════════════════ */

function loadEnv(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value);

        /* Remove surrounding quotes ("value" or 'value') */
        if (preg_match('/^(["\'])(.*)\\1$/', $value, $m)) {
            $value = $m[2];
        }

        $_ENV[$key] = $value;
        putenv("$key=$value");
    }
}

/* Search for .env in common locations */
$envSearchPaths = [
    __DIR__ . '/../.env',          // repo root  (same level as api/)
    dirname(__DIR__, 2) . '/.env', // one level above document root
    __DIR__ . '/.env',             // inside api/ folder
];

foreach ($envSearchPaths as $envPath) {
    if (is_file($envPath)) {
        loadEnv($envPath);
        break;
    }
}

/** Read an environment variable with an optional default. */
function env(string $key, string $default = ''): string
{
    return $_ENV[$key] ?? (getenv($key) ?: $default);
}

/* ── Auto-generate JWT_SECRET if missing or placeholder ──────
   Generates a cryptographically secure 64-char hex secret and
   persists it to .jwt_secret so it survives across requests.
   This lets the app work out-of-the-box without manual setup. */
(function (): void {
    $current = env('JWT_SECRET');
    $placeholder = 'generate_a_random_64_char_string_here';

    if ($current !== '' && $current !== $placeholder) {
        return;                                        // already configured
    }

    $secretFile = dirname(__DIR__) . '/.jwt_secret';

    /* Try to load a previously auto-generated secret */
    if (is_file($secretFile) && is_readable($secretFile)) {
        $saved = trim((string) file_get_contents($secretFile));
        if ($saved !== '' && $saved !== $placeholder) {
            $_ENV['JWT_SECRET'] = $saved;
            putenv("JWT_SECRET=$saved");
            return;
        }
    }

    /* Generate a new secret and persist it */
    $secret = bin2hex(random_bytes(32));               // 64 hex chars
    $written = @file_put_contents($secretFile, $secret, LOCK_EX);
    if ($written !== false) {
        @chmod($secretFile, 0600);
    } else {
        /* Cannot persist — log a warning so the admin knows */
        error_log('JWT_SECRET auto-generation: could not write ' . $secretFile
            . ' — a new secret will be generated on every request until this is fixed.');
    }

    $_ENV['JWT_SECRET'] = $secret;
    putenv("JWT_SECRET=$secret");
})();

/** Check whether debug mode is enabled in .env (APP_DEBUG=true). */
function isDebug(): bool
{
    $val = env('APP_DEBUG', 'false');
    return in_array(strtolower($val), ['true', '1', 'yes', 'on'], true);
}

/* ══════════════════════════════════════════════
   2. Database connection (PDO — MySQL)
   ══════════════════════════════════════════════ */

function getDB(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $host = env('DB_HOST', 'localhost');
    $name = env('DB_NAME');
    $user = env('DB_USER');
    $pass = env('DB_PASSWORD');

    if ($name === '' || $user === '') {
        throw new RuntimeException(
            'Database not configured — DB_NAME or DB_USER is empty. Check your .env file.'
        );
    }

    try {
        $pdo = new PDO(
            "mysql:host=$host;dbname=$name;charset=utf8mb4",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        error_log('DB connection failed: ' . $e->getMessage());
        $detail = '';
        if (isDebug()) {
            if (str_contains($e->getMessage(), 'Unknown database')) {
                $detail = ': database "' . $name . '" does not exist — create it in your hosting panel';
            } elseif (str_contains($e->getMessage(), 'Access denied')) {
                $detail = ': access denied — check DB_USER and DB_PASSWORD in your .env file';
            } elseif (str_contains($e->getMessage(), 'Connection refused') || str_contains($e->getMessage(), 'No such file')) {
                $detail = ': cannot reach DB host "' . $host . '" — check DB_HOST in .env';
            } else {
                $detail = ': ' . $e->getMessage();
            }
        }
        throw new RuntimeException('Database connection failed' . $detail, 0, $e);
    }
}

/* ══════════════════════════════════════════════
   3. JWT helpers (HMAC-SHA256)
   ══════════════════════════════════════════════ */

function base64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/'));
}

/**
 * Create a signed JWT token.
 *
 * @param  array<string,mixed> $payload
 * @return string
 */
function jwtEncode(array $payload): string
{
    $secret = env('JWT_SECRET');
    if ($secret === '') {
        throw new RuntimeException('JWT_SECRET is not set in .env');
    }

    $header  = base64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
    $body    = base64url_encode(json_encode($payload));
    $sig     = base64url_encode(hash_hmac('sha256', "$header.$body", $secret, true));

    return "$header.$body.$sig";
}

/**
 * Decode and verify a JWT token.
 *
 * @return array<string,mixed>|null  Decoded payload on success, null on failure.
 */
function jwtDecode(string $token): ?array
{
    $secret = env('JWT_SECRET');
    if ($secret === '') {
        return null;
    }

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$header, $payload, $sig] = $parts;

    $expected = base64url_encode(hash_hmac('sha256', "$header.$payload", $secret, true));
    if (!hash_equals($expected, $sig)) {
        return null;
    }

    $data = json_decode(base64url_decode($payload), true);
    if (!is_array($data)) {
        return null;
    }

    /* Check expiration */
    if (isset($data['exp']) && $data['exp'] < time()) {
        return null;
    }

    return $data;
}

/* ══════════════════════════════════════════════
   4. IP-based rate limiting (file-system)
   ══════════════════════════════════════════════ */

/**
 * Simple rate limiter.  Returns TRUE if the request is allowed.
 *
 * @param int $maxAttempts  Maximum requests per window
 * @param int $windowSecs   Window duration in seconds
 */
function rateLimit(int $maxAttempts = 5, int $windowSecs = 60): bool
{
    /* Resolve client IP — prefer X-Forwarded-For behind trusted proxies */
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $forwarded = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $candidate = trim($forwarded[0]);
        if (filter_var($candidate, FILTER_VALIDATE_IP)) {
            $ip = $candidate;
        }
    }

    $rateDir = sys_get_temp_dir() . '/trading_rate_limits';

    if (!is_dir($rateDir) && !mkdir($rateDir, 0700, true)) {
        error_log('Rate-limit: could not create directory ' . $rateDir);
        return true; /* fail open — don't block requests if dir creation fails */
    }

    $file     = $rateDir . '/' . md5($ip) . '.json';
    $attempts = [];

    if (is_file($file)) {
        $raw      = @file_get_contents($file);
        $attempts = $raw ? (json_decode($raw, true) ?? []) : [];
    }

    $now      = time();
    $attempts = array_values(array_filter($attempts, fn($t) => $t > ($now - $windowSecs)));

    if (count($attempts) >= $maxAttempts) {
        return false;
    }

    $attempts[] = $now;
    @file_put_contents($file, json_encode($attempts), LOCK_EX);

    return true;
}

/* ══════════════════════════════════════════════
   5. Common response helpers
   ══════════════════════════════════════════════ */

/** Send a JSON response and terminate. */
function jsonResponse(mixed $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

/** Reject non-POST requests. */
function requirePost(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['error' => 'Method not allowed'], 405);
    }
}

/** Read and decode the JSON request body. */
function getJsonBody(): array
{
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        jsonResponse(['error' => 'Invalid JSON body'], 400);
    }
    return $data;
}

/**
 * Categorise a caught exception into an actionable error message.
 *
 * Always returns a user-facing hint (DB not configured, connection failed,
 * missing table, missing JWT_SECRET).  Sensitive details are only appended
 * when APP_DEBUG=true.
 *
 * @param string      $prefix  e.g. "Login failed" or "Registration failed"
 * @param \Throwable  $e       the caught exception
 */
function categoriseAuthError(string $prefix, \Throwable $e): string
{
    $em  = $e->getMessage();
    $msg = $prefix;

    if (str_contains($em, 'DB_NAME') || str_contains($em, 'DB_USER') || str_contains($em, 'Database not configured')) {
        $msg .= ': database is not configured — check your .env file';
    } elseif (str_contains($em, 'Connection refused') || str_contains($em, 'No such file') || str_contains($em, 'Access denied') || str_contains($em, 'Unknown database') || str_contains($em, 'connection failed')) {
        $msg .= ': cannot connect to the database';
        if (isDebug()) $msg .= ' — ' . $em;
    } elseif (str_contains($em, "doesn't exist") || (str_contains($em, 'Table') && str_contains($em, 'exist'))) {
        $msg .= ': users table not found — run database/schema.sql on your database';
    } elseif (str_contains($em, 'Unknown column') || str_contains($em, 'Column not found') || str_contains($em, '42S22')) {
        $msg .= ': database schema mismatch — re-run database/schema.sql to update your table';
        if (isDebug()) $msg .= ' — ' . $em;
    } elseif (str_contains($em, 'server has gone away') || str_contains($em, 'Lost connection')) {
        $msg .= ': database connection was lost — please try again';
    } elseif ($e instanceof \RuntimeException && str_contains($em, 'JWT_SECRET')) {
        $msg .= ': JWT_SECRET is not set in your .env file';
    } else {
        /* Always include the exception class so the user can report/search it,
           but keep sensitive details behind APP_DEBUG. */
        $class = basename(str_replace('\\', '/', get_class($e)));
        $msg  .= isDebug()
            ? ": $em"
            : ". Unexpected error ({$class}). Enable APP_DEBUG=true in .env for details, then retry.";
    }

    return $msg . ' (visit /api/auth/status to diagnose)';
}

/* ── Shared headers for every API response ── */
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/* CORS — same-origin in production, open in dev */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (env('APP_ENV') !== 'production') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
} elseif ($origin !== '') {
    /* In production only allow your own domain */
    $allowed = env('AUTH_API_BASE');
    $parsed  = parse_url($allowed);
    $scheme  = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');
    if (str_starts_with($origin, $scheme)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
}
