<?php
/**
 * /api/admin/users.php
 * ─────────────────────
 * GET  — paginated list of all users with strategies
 * POST — create a new user
 *
 * All requests require Authorization: Bearer <admin-token>
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ═══════════════════════════════════════════════
   GET — list users
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
        $pdo = getDB();

        /* Pagination */
        $page    = max(1, (int) ($_GET['page']    ?? 1));
        $perPage = min(100, max(1, (int) ($_GET['per_page'] ?? 25)));
        $offset  = ($page - 1) * $perPage;

        /* Filters */
        $search       = trim($_GET['search']       ?? '');
        $filterStatus = trim($_GET['status']       ?? '');
        $filterSub    = trim($_GET['subscription'] ?? '');
        $filterRole   = trim($_GET['role']         ?? '');

        $where   = [];
        $params  = [];

        if ($search !== '') {
            $where[]  = '(u.username LIKE ? OR u.email LIKE ?)';
            $like     = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
        }
        if ($filterStatus !== '' && in_array($filterStatus, ['active', 'locked'], true)) {
            $where[]  = 'u.status = ?';
            $params[] = $filterStatus;
        }
        if ($filterSub !== '' && in_array($filterSub, ['active', 'inactive', 'trial'], true)) {
            $where[]  = 'u.subscription_status = ?';
            $params[] = $filterSub;
        }
        if ($filterRole !== '' && in_array($filterRole, ['admin', 'user'], true)) {
            $where[]  = 'u.role = ?';
            $params[] = $filterRole;
        }

        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        /* Total count */
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users u $whereSql");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        /* Users */
        $paginatedParams = array_merge($params, [$perPage, $offset]);
        $stmt = $pdo->prepare(
            "SELECT u.id, u.username, u.email, u.display_name, u.role, u.status,
                    u.subscription_status, u.subscription_plan, u.subscription_expires_at, u.last_login_at,
                    u.telegram_user_id, u.telegram_username, u.telegram_linked_at,
                    u.created_at
             FROM users u
             $whereSql
             ORDER BY u.id DESC
             LIMIT ? OFFSET ?"
        );
        $stmt->execute($paginatedParams);
        $users = $stmt->fetchAll();

        /* Attach strategies */
        if ($users) {
            $ids   = array_column($users, 'id');
            $in    = implode(',', array_fill(0, count($ids), '?'));
            $saStmt = $pdo->prepare(
                "SELECT user_id, strategy_key FROM strategy_access WHERE user_id IN ($in) ORDER BY strategy_key"
            );
            $saStmt->execute($ids);
            $stratMap = [];
            foreach ($saStmt->fetchAll() as $row) {
                $stratMap[$row['user_id']][] = $row['strategy_key'];
            }
            foreach ($users as &$u) {
                $u['strategies']      = $stratMap[$u['id']] ?? [];
                $u['telegram_linked'] = !empty($u['telegram_user_id']);
            }
            unset($u);
        }

        /* Aggregate stats across all matching users (not just current page) */
        $statsStmt = $pdo->prepare(
            "SELECT
                SUM(subscription_status = 'active')  AS active_subs,
                SUM(subscription_status = 'trial')   AS trial_subs,
                SUM(status = 'locked')               AS locked_count,
                SUM(subscription_expires_at IS NOT NULL
                    AND subscription_expires_at > NOW()
                    AND subscription_expires_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)) AS expiring_soon
             FROM users u $whereSql"
        );
        $statsStmt->execute($params);
        $stats = $statsStmt->fetch();

        /* Global count of users with any bot strategy access */
        $botStmt = $pdo->prepare(
            "SELECT COUNT(DISTINCT user_id) FROM strategy_access
             WHERE strategy_key IN (?, ?)"
        );
        $botStmt->execute(['bot_hc_1hz75v', 'bot_normal']);
        $botAccessCount = (int) $botStmt->fetchColumn();

        jsonResponse([
            'users'        => $users,
            'total'        => $total,
            'page'         => $page,
            'per_page'     => $perPage,
            'last_page'    => (int) ceil($total / $perPage),
            'stats'        => [
                'active_subs'      => (int) ($stats['active_subs']   ?? 0),
                'trial_subs'       => (int) ($stats['trial_subs']    ?? 0),
                'locked_count'     => (int) ($stats['locked_count']  ?? 0),
                'expiring_soon'    => (int) ($stats['expiring_soon'] ?? 0),
                'bot_access_count' => $botAccessCount,
            ],
        ]);
    } catch (\Throwable $e) {
        error_log('Admin GET /users error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to list users', $e)], 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — create user
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $body        = getJsonBody();
    $username    = trim($body['username'] ?? '');
    $password    = $body['password'] ?? '';
    $email       = trim($body['email'] ?? '');
    $role        = $body['role'] ?? 'user';
    $status      = $body['status'] ?? 'active';
    $sub         = $body['subscription_status'] ?? 'inactive';
    $subPlan     = array_key_exists('subscription_plan', $body) ? ($body['subscription_plan'] ?? null) : null;
    $subExp      = $body['subscription_expires_at'] ?? null;
    $tgUsername  = isset($body['telegram_username']) ? ltrim(trim((string) $body['telegram_username']), '@') : null;

    /* Validation */
    if ($username === '' || $password === '') {
        jsonResponse(['error' => 'Username and password are required'], 400);
    }
    if (strlen($username) < 3 || strlen($username) > 50) {
        jsonResponse(['error' => 'Username must be 3–50 characters'], 400);
    }
    if (!preg_match('/^[a-zA-Z0-9_.\-]+$/', $username)) {
        jsonResponse(['error' => 'Invalid username characters'], 400);
    }
    if (strlen($password) < 8) {
        jsonResponse(['error' => 'Password must be at least 8 characters'], 400);
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['error' => 'Invalid email address'], 400);
    }
    if (!in_array($role, ['user', 'admin'], true)) {
        jsonResponse(['error' => 'Invalid role'], 400);
    }
    if (!in_array($status, ['active', 'locked'], true)) {
        jsonResponse(['error' => 'Invalid status'], 400);
    }
    if (!in_array($sub, ['active', 'inactive', 'trial'], true)) {
        jsonResponse(['error' => 'Invalid subscription_status'], 400);
    }
    if ($subPlan !== null && $subPlan !== '' && !in_array($subPlan, ['trial', 'weekly', 'monthly'], true)) {
        jsonResponse(['error' => 'Invalid subscription_plan value (use trial, weekly, monthly, or null)'], 400);
    }
    $subPlan = ($subPlan === '') ? null : $subPlan;

    /* Auto-calculate expiry when activating with a plan and no explicit expiry provided */
    if ($sub === 'active' && ($subExp === null || $subExp === '')) {
        $daysMap = ['weekly' => 7, 'monthly' => 30];
        if (isset($daysMap[$subPlan])) {
            $subExp = (new \DateTime())->modify('+' . $daysMap[$subPlan] . ' days')->format('Y-m-d H:i:s');
        }
    }

    if ($subExp !== null && $subExp !== '') {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $subExp)
            || !\DateTime::createFromFormat('Y-m-d', substr($subExp, 0, 10))) {
            jsonResponse(['error' => 'Invalid subscription_expires_at format (use YYYY-MM-DD)'], 400);
        }
    }

    /* Validate optional Telegram username */
    $tgUsername = ($tgUsername === '') ? null : $tgUsername;
    if ($tgUsername !== null) {
        if (strlen($tgUsername) > 32 || !preg_match('/^[a-zA-Z0-9_]{5,32}$/', $tgUsername)) {
            jsonResponse(['error' => 'Invalid Telegram username (5–32 chars, letters/numbers/underscores, no @)'], 400);
        }
    }

    try {
        $pdo = getDB();

        /* Duplicate username */
        $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Username already exists'], 409);
        }

        /* Duplicate email */
        if ($email !== '') {
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            if ($stmt->fetch()) {
                jsonResponse(['error' => 'Email already registered'], 409);
            }
        }

        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $stmt = $pdo->prepare(
            'INSERT INTO users (username, email, password_hash, display_name, role, status, subscription_status, subscription_plan, subscription_expires_at, telegram_username)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $username,
            $email ?: null,
            $hash,
            $username,
            $role,
            $status,
            $sub,
            $subPlan,
            ($subExp !== '' && $subExp !== null) ? $subExp : null,
            $tgUsername,
        ]);
        $newId = (int) $pdo->lastInsertId();

        /* Grant initial strategies if provided */
        $strategies = $body['strategies'] ?? [];
        if (is_array($strategies) && $strategies) {
            $adminId = $GLOBALS['adminUserId'];
            $ins = $pdo->prepare(
                'INSERT IGNORE INTO strategy_access (user_id, strategy_key, granted_by) VALUES (?, ?, ?)'
            );
            foreach ($strategies as $key) {
                $key = trim((string) $key);
                if ($key !== '') {
                    $ins->execute([$newId, $key, $adminId]);
                }
            }
        }

        jsonResponse(['id' => $newId, 'message' => 'User created'], 201);
    } catch (\Throwable $e) {
        error_log('Admin POST /users error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to create user', $e)], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
