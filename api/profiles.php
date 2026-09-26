<?php
/**
 * /api/profiles.php
 * ─────────────────
 * Authenticated user endpoint for indicator settings profiles.
 *
 * GET    — list caller's own profiles + profiles assigned to them by admin
 * POST   — create or update a profile (caller owns it)
 * DELETE — delete one of the caller's own profiles (?id=<profile_id>)
 *
 * All requests require  Authorization: Bearer <token>
 */

declare(strict_types=1);
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$userId = authenticateUserFromToken();

try {
    $pdo = getDB();
    
    // Get user details for subscription check
    $stmt = $pdo->prepare('SELECT role, subscription_expires_at FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    
    if (($user['role'] ?? 'user') !== 'admin'
        && $user['subscription_expires_at'] !== null
        && strtotime($user['subscription_expires_at']) < time()
    ) {
        jsonResponse([
            'error'  => 'Your subscription has expired. Please renew to regain access.',
            'reason' => 'subscription_expired',
        ], 403);
    }
} catch (\Throwable $e) {
    error_log('profiles.php subscription check error: ' . $e->getMessage());
    jsonResponse(['error' => 'Failed to verify subscription'], 500);
}

/* ═══════════════════════════════════════════════
   GET — list profiles
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
        /* Own profiles */
        $own = $pdo->prepare(
            'SELECT id, name, settings_json, is_admin_profile, created_at, updated_at
               FROM indicator_profiles
              WHERE created_by = ?
              ORDER BY updated_at DESC'
        );
        $own->execute([$userId]);
        $ownProfiles = $own->fetchAll();

        /* Profiles assigned by admin (exclude own to avoid duplicates) */
        $assigned = $pdo->prepare(
            'SELECT ip.id, ip.name, ip.settings_json, ip.is_admin_profile,
                    ip.created_at, ip.updated_at,
                    upa.assigned_at,
                    u.username AS assigned_by_username
               FROM user_profile_assignments upa
               JOIN indicator_profiles ip ON ip.id = upa.profile_id
               LEFT JOIN users u ON u.id = upa.assigned_by
              WHERE upa.user_id = ?
                AND ip.created_by != ?
              ORDER BY upa.assigned_at DESC'
        );
        $assigned->execute([$userId, $userId]);
        $assignedProfiles = $assigned->fetchAll();

        /* Decode settings_json so the client gets a JS object directly */
        $decode = static function (array $row): array {
            $row['settings'] = $row['settings_json'] ? json_decode($row['settings_json'], true) : [];
            unset($row['settings_json']);
            $row['is_admin_profile'] = (bool) $row['is_admin_profile'];
            return $row;
        };

        jsonResponse([
            'own'      => array_map($decode, $ownProfiles),
            'assigned' => array_map($decode, $assignedProfiles),
        ]);
    } catch (\Throwable $e) {
        error_log('GET /api/profiles error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to load profiles', $e)], 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — save (create or update) a profile
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $body = getJsonBody();

    $name = trim((string) ($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 60) {
        jsonResponse(['error' => 'Profile name must be 1–60 characters'], 400);
    }

    $settings = $body['settings'] ?? null;
    if (!is_array($settings) && !is_object($settings)) {
        jsonResponse(['error' => 'settings must be a JSON object'], 400);
    }

    $settingsJson = json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen($settingsJson) > 512000) {
        jsonResponse(['error' => 'Settings snapshot is too large (max 500 KB)'], 400);
    }

    /* Optional explicit id — update if provided and owned by caller */
    $profileId = isset($body['id']) ? (int) $body['id'] : 0;

    try {
        if ($profileId > 0) {
            /* Update existing — must be owner */
            $check = $pdo->prepare('SELECT id FROM indicator_profiles WHERE id = ? AND created_by = ?');
            $check->execute([$profileId, $userId]);
            if (!$check->fetch()) {
                jsonResponse(['error' => 'Profile not found or not owned by you'], 404);
            }
            $upd = $pdo->prepare(
                'UPDATE indicator_profiles SET name = ?, settings_json = ? WHERE id = ?'
            );
            $upd->execute([$name, $settingsJson, $profileId]);
            jsonResponse(['message' => 'Profile updated', 'id' => $profileId]);
        } else {
            /* Upsert by name for the caller (keep existing id if name already exists) */
            $existing = $pdo->prepare(
                'SELECT id FROM indicator_profiles WHERE created_by = ? AND name = ?'
            );
            $existing->execute([$userId, $name]);
            $row = $existing->fetch();

            if ($row) {
                $upd = $pdo->prepare(
                    'UPDATE indicator_profiles SET settings_json = ? WHERE id = ?'
                );
                $upd->execute([$settingsJson, $row['id']]);
                jsonResponse(['message' => 'Profile updated', 'id' => (int) $row['id']]);
            } else {
                $ins = $pdo->prepare(
                    'INSERT INTO indicator_profiles (name, settings_json, created_by, is_admin_profile)
                     VALUES (?, ?, ?, 0)'
                );
                $ins->execute([$name, $settingsJson, $userId]);
                jsonResponse(['message' => 'Profile saved', 'id' => (int) $pdo->lastInsertId()], 201);
            }
        }
    } catch (\Throwable $e) {
        error_log('POST /api/profiles error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to save profile', $e)], 500);
    }
}

/* ═══════════════════════════════════════════════
   DELETE — remove one of the caller's own profiles
   ═══════════════════════════════════════════════ */
if ($method === 'DELETE') {
    $profileId = (int) ($_GET['id'] ?? 0);
    if ($profileId <= 0) {
        jsonResponse(['error' => 'Missing or invalid ?id parameter'], 400);
    }

    try {
        $del = $pdo->prepare(
            'DELETE FROM indicator_profiles WHERE id = ? AND created_by = ?'
        );
        $del->execute([$profileId, $userId]);
        if ($del->rowCount() === 0) {
            jsonResponse(['error' => 'Profile not found or not owned by you'], 404);
        }
        jsonResponse(['message' => 'Profile deleted']);
    } catch (\Throwable $e) {
        error_log('DELETE /api/profiles error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to delete profile', $e)], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
