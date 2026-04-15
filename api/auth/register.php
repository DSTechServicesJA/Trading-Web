<?php
/**
 * POST /api/auth/register
 * ───────────────────────
 * Request:  { "username": "...", "password": "...", "email": "..." }
 * Success:  201 { "token": "...", "user": { "username", "displayName" } }
 * Failure:  409 { "error": "Username already exists" }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

requirePost();

/* ── Rate limit: 3 registrations per 5 min ── */
if (!rateLimit(3, 300)) {
    jsonResponse(['error' => 'Too many registration attempts. Please try again later.'], 429);
}

$body     = getJsonBody();
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';
$email    = trim($body['email'] ?? '');

/* ── Validation ── */
if ($username === '' || $password === '') {
    jsonResponse(['error' => 'Username and password are required'], 400);
}

if (strlen($username) < 3 || strlen($username) > 50) {
    jsonResponse(['error' => 'Username must be 3–50 characters'], 400);
}

if (!preg_match('/^[a-zA-Z0-9_.\-]+$/', $username)) {
    jsonResponse(['error' => 'Username may only contain letters, numbers, dots, hyphens, and underscores'], 400);
}

if (strlen($password) < 8) {
    jsonResponse(['error' => 'Password must be at least 8 characters'], 400);
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    jsonResponse(['error' => 'Invalid email address'], 400);
}

/* ── Check for existing username ── */
$pdo  = getDB();
$stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
$stmt->execute([$username]);

if ($stmt->fetch()) {
    jsonResponse(['error' => 'Username already exists'], 409);
}

/* ── Check for existing email (if provided) ── */
if ($email !== '') {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        jsonResponse(['error' => 'Email address already registered'], 409);
    }
}

/* ── Create user (bcrypt, cost 12) ── */
$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

$stmt = $pdo->prepare(
    'INSERT INTO users (username, email, password_hash, display_name)
     VALUES (?, ?, ?, ?)'
);
$stmt->execute([$username, $email ?: null, $hash, $username]);
$userId = (int) $pdo->lastInsertId();

/* ── Issue JWT ── */
$token = jwtEncode([
    'sub'      => $userId,
    'username' => $username,
    'iat'      => time(),
    'exp'      => time() + 3600,
]);

jsonResponse([
    'token' => $token,
    'user'  => [
        'username'    => $username,
        'displayName' => $username,
    ],
], 201);
