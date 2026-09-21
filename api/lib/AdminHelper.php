<?php
/**
 * Admin Helper Utilities
 * Provides common functions for admin operations including:
 * - Audit logging
 * - Permission checking  
 * - Data retrieval helpers
 * - Bulk operations
 */

class AdminHelper {
    private $db;
    
    public function __construct($database = null) {
        $this->db = $database ?? Database::getInstance();
    }
    
    /**
     * Log an admin action to the audit trail
     */
    public function logAction($admin_id, $action, $entity_type, $entity_id = null, $old_value = null, $new_value = null, $ip_address = null, $user_agent = null, $status = 'success', $error_message = null) {
        return $this->db->execute("
            INSERT INTO admin_audit_trail 
            (admin_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, status, error_message, created_at)
            VALUES (:admin_id, :action, :entity_type, :entity_id, :old_value, :new_value, :ip, :ua, :status, :error, NOW())
        ", [
            ':admin_id' => $admin_id,
            ':action' => $action,
            ':entity_type' => $entity_type,
            ':entity_id' => $entity_id,
            ':old_value' => is_string($old_value) ? $old_value : json_encode($old_value),
            ':new_value' => is_string($new_value) ? $new_value : json_encode($new_value),
            ':ip' => $ip_address ?? ($_SERVER['REMOTE_ADDR'] ?? null),
            ':ua' => $user_agent ?? ($_SERVER['HTTP_USER_AGENT'] ?? null),
            ':status' => $status,
            ':error' => $error_message
        ]);
    }
    
    /**
     * Add a notification to the admin notifications center
     */
    public function addNotification($category, $title, $message, $type = 'info', $severity = 'medium', $source_entity = null, $source_id = null, $related_data = null) {
        return $this->db->execute("
            INSERT INTO admin_notifications_center 
            (notification_type, category, title, message, severity, source_entity, source_id, related_data, is_read, created_at)
            VALUES (:type, :category, :title, :message, :severity, :source_entity, :source_id, :related_data, 0, NOW())
        ", [
            ':type' => $type,
            ':category' => $category,
            ':title' => $title,
            ':message' => $message,
            ':severity' => $severity,
            ':source_entity' => $source_entity,
            ':source_id' => $source_id,
            ':related_data' => is_string($related_data) ? $related_data : json_encode($related_data)
        ]);
    }
    
    /**
     * Get a user by ID with all related info
     */
    public function getUserFull($user_id) {
        $user = $this->db->fetchOne("
            SELECT id, username, email, display_name, role, status, subscription_status, 
                   subscription_plan, subscription_expires_at, telegram_user_id, telegram_username,
                   telegram_linked_at, last_login_at, created_at, updated_at
            FROM users
            WHERE id = :user_id
        ", [':user_id' => $user_id]);
        
        if (!$user) return null;
        
        // Get strategy access
        $user['strategies'] = $this->db->fetchAll("
            SELECT strategy_key, granted_at, granted_by
            FROM strategy_access
            WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Get profiles
        $user['profiles'] = $this->db->fetchAll("
            SELECT profile_id, assigned_at, assigned_by
            FROM user_profile_assignments
            WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        return $user;
    }
    
    /**
     * Update user subscription
     */
    public function updateUserSubscription($user_id, $plan, $days, $admin_id) {
        $old_user = $this->getUserFull($user_id);
        
        $expires_at = date('Y-m-d H:i:s', strtotime("+{$days} days"));
        
        $this->db->execute("
            UPDATE users
            SET subscription_plan = :plan,
                subscription_status = 'active',
                subscription_expires_at = :expires,
                updated_at = NOW()
            WHERE id = :user_id
        ", [
            ':user_id' => $user_id,
            ':plan' => $plan,
            ':expires' => $expires_at
        ]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'subscription_updated',
            'user',
            $user_id,
            json_encode([
                'plan' => $old_user['subscription_plan'],
                'expires' => $old_user['subscription_expires_at']
            ]),
            json_encode([
                'plan' => $plan,
                'expires' => $expires_at
            ])
        );
        
        // Add notification
        $this->addNotification(
            'subscription',
            'Subscription Updated',
            "User {$old_user['username']} subscription updated to {$plan}",
            'info',
            'low',
            'user',
            $user_id
        );
        
        return true;
    }
    
    /**
     * Grant strategy access to user
     */
    public function grantStrategy($user_id, $strategy_key, $admin_id) {
        // Check if already granted
        $existing = $this->db->fetchOne("
            SELECT id FROM strategy_access
            WHERE user_id = :user_id AND strategy_key = :strategy
        ", [
            ':user_id' => $user_id,
            ':strategy' => $strategy_key
        ]);
        
        if ($existing) {
            return ['success' => false, 'message' => 'User already has access to this strategy'];
        }
        
        $this->db->execute("
            INSERT INTO strategy_access (user_id, strategy_key, granted_at, granted_by)
            VALUES (:user_id, :strategy, NOW(), :admin_id)
        ", [
            ':user_id' => $user_id,
            ':strategy' => $strategy_key,
            ':admin_id' => $admin_id
        ]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'strategy_granted',
            'strategy',
            $strategy_key,
            null,
            json_encode(['user_id' => $user_id, 'strategy' => $strategy_key])
        );
        
        return ['success' => true, 'message' => 'Strategy access granted'];
    }
    
    /**
     * Revoke strategy access from user
     */
    public function revokeStrategy($user_id, $strategy_key, $admin_id) {
        $this->db->execute("
            DELETE FROM strategy_access
            WHERE user_id = :user_id AND strategy_key = :strategy
        ", [
            ':user_id' => $user_id,
            ':strategy' => $strategy_key
        ]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'strategy_revoked',
            'strategy',
            $strategy_key,
            json_encode(['user_id' => $user_id, 'strategy' => $strategy_key]),
            null
        );
        
        return ['success' => true, 'message' => 'Strategy access revoked'];
    }
    
    /**
     * Lock a user account
     */
    public function lockUser($user_id, $admin_id, $reason = 'No reason provided') {
        $old_user = $this->getUserFull($user_id);
        
        $this->db->execute("
            UPDATE users
            SET status = 'locked', updated_at = NOW()
            WHERE id = :user_id
        ", [':user_id' => $user_id]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'user_locked',
            'user',
            $user_id,
            json_encode(['status' => $old_user['status']]),
            json_encode(['status' => 'locked', 'reason' => $reason])
        );
        
        // Add notification
        $this->addNotification(
            'user_management',
            'Account Locked',
            "User {$old_user['username']} account has been locked",
            'warning',
            'medium',
            'user',
            $user_id
        );
        
        return true;
    }
    
    /**
     * Unlock a user account
     */
    public function unlockUser($user_id, $admin_id) {
        $old_user = $this->getUserFull($user_id);
        
        $this->db->execute("
            UPDATE users
            SET status = 'active', updated_at = NOW()
            WHERE id = :user_id
        ", [':user_id' => $user_id]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'user_unlocked',
            'user',
            $user_id,
            json_encode(['status' => $old_user['status']]),
            json_encode(['status' => 'active'])
        );
        
        return true;
    }
    
    /**
     * Delete a user (soft delete - sets status to locked)
     */
    public function deleteUser($user_id, $admin_id, $reason = 'No reason provided') {
        return $this->lockUser($user_id, $admin_id, "Deleted: {$reason}");
    }
    
    /**
     * Reset user adaptive intelligence data
     */
    public function resetAdaptiveIntelligence($user_id, $admin_id) {
        // Clear adaptive learning profiles
        $this->db->execute("
            DELETE FROM adaptive_learning_profiles WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Clear metric snapshots
        $this->db->execute("
            DELETE FROM adaptive_metric_snapshots WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Clear qualification rules
        $this->db->execute("
            DELETE FROM adaptive_qualification_rules WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Clear factor stats
        $this->db->execute("
            DELETE FROM adaptive_factor_stats WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Clear signal decisions
        $this->db->execute("
            DELETE FROM adaptive_signal_decisions WHERE user_id = :user_id
        ", [':user_id' => $user_id]);
        
        // Log action
        $this->logAction(
            $admin_id,
            'adaptive_intelligence_reset',
            'user',
            $user_id,
            null,
            json_encode(['action' => 'Full adaptive intelligence reset'])
        );
        
        // Add notification
        $this->addNotification(
            'adaptive',
            'Adaptive Intelligence Reset',
            "Adaptive intelligence data reset for user #{$user_id}",
            'info',
            'medium',
            'user',
            $user_id
        );
        
        return true;
    }
    
    /**
     * Get admin dashboard statistics summary
     */
    public function getDashboardStats() {
        return [
            'users' => [
                'total' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users")['cnt'],
                'active' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'")['cnt'],
                'locked' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'locked'")['cnt'],
            ],
            'subscriptions' => [
                'active' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users WHERE subscription_status = 'active'")['cnt'],
                'trial' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users WHERE subscription_plan = 'trial'")['cnt'],
                'expiring_soon' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM users WHERE subscription_expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)")['cnt'],
            ],
            'trades' => [
                'total' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM trade_outcomes")['cnt'],
                'today' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM trade_outcomes WHERE DATE(created_at) = CURDATE()")['cnt'],
                'win_rate_30d' => $this->getWinRate30Days(),
            ],
            'signals' => [
                'total' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals")['cnt'],
                'today' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE DATE(created_at) = CURDATE()")['cnt'],
                'pending' => (int) $this->db->fetchOne("SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE status = 'PENDING'")['cnt'],
            ]
        ];
    }
    
    /**
     * Calculate win rate for last 30 days
     */
    private function getWinRate30Days() {
        $result = $this->db->fetchOne("
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins
            FROM trade_outcomes
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        
        $total = (int) $result['total'];
        $wins = (int) $result['wins'];
        
        return $total > 0 ? round(($wins / $total) * 100, 2) : 0;
    }
    
    /**
     * Get users list with pagination
     */
    public function getUsersList($page = 1, $per_page = 50, $filters = []) {
        $per_page = min(max($per_page, 10), 500);
        $page = max($page, 1);
        $offset = ($page - 1) * $per_page;
        
        // Build WHERE clause
        $where = ['1=1'];
        $params = [];
        
        if (!empty($filters['search'])) {
            $where[] = "(username LIKE :search OR email LIKE :search OR display_name LIKE :search)";
            $params[':search'] = '%' . $filters['search'] . '%';
        }
        
        if (!empty($filters['status'])) {
            $where[] = "status = :status";
            $params[':status'] = $filters['status'];
        }
        
        if (!empty($filters['subscription'])) {
            $where[] = "subscription_status = :sub";
            $params[':sub'] = $filters['subscription'];
        }
        
        if (!empty($filters['role'])) {
            $where[] = "role = :role";
            $params[':role'] = $filters['role'];
        }
        
        $where_clause = implode(' AND ', $where);
        
        // Count total
        $total_result = $this->db->fetchOne(
            "SELECT COUNT(*) as total FROM users WHERE $where_clause",
            $params
        );
        $total = (int) $total_result['total'];
        $last_page = max(1, ceil($total / $per_page));
        
        // Get paginated results
        $users = $this->db->fetchAll(
            "SELECT id, username, email, display_name, role, status, subscription_status,
                    subscription_plan, subscription_expires_at, telegram_linked_at, 
                    last_login_at, created_at
             FROM users
             WHERE $where_clause
             ORDER BY created_at DESC
             LIMIT :offset, :per_page",
            array_merge($params, [
                ':offset' => $offset,
                ':per_page' => $per_page
            ])
        );
        
        return [
            'page' => $page,
            'per_page' => $per_page,
            'total' => $total,
            'last_page' => $last_page,
            'users' => $users
        ];
    }
}
?>
