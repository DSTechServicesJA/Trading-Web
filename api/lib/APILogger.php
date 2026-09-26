<?php
/**
 * /api/lib/APILogger.php
 * ──────────────────────────────────────────────────────
 * Enhanced error logging for API endpoints
 * Provides structured logging with SQL queries, line numbers, and full context
 */

declare(strict_types=1);

class APILogger
{
    /**
     * Log API error with full context
     *
     * @param string $endpoint       e.g., "/api/admin/users"
     * @param string $method         e.g., "GET", "POST"
     * @param \Throwable $exception  The exception that was caught
     * @param string $sqlQuery       Optional SQL query that failed
     * @param array $params          Optional SQL parameters
     * @param array $requestData     Optional request data
     * @param int $httpStatus        HTTP status code to return
     * @return array                 Error response array
     */
    public static function logEndpointError(
        string $endpoint,
        string $method,
        \Throwable $exception,
        ?string $sqlQuery = null,
        ?array $params = null,
        ?array $requestData = null,
        int $httpStatus = 500
    ): array {
        $trace = $exception->getTrace()[0] ?? [];
        $file = $trace['file'] ?? $exception->getFile();
        $line = $trace['line'] ?? $exception->getLine();
        
        $logEntry = [
            'timestamp' => date('Y-m-d H:i:s'),
            'endpoint' => $endpoint,
            'method' => $method,
            'http_status' => $httpStatus,
            'exception_type' => get_class($exception),
            'exception_message' => $exception->getMessage(),
            'file' => $file,
            'line' => (int) $line,
            'sql_query' => $sqlQuery,
            'sql_params' => self::sanitizeSQLParams($params),
            'request_data' => self::sanitizeRequestData($requestData),
        ];
        
        // Log to error log
        error_log(json_encode($logEntry, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        
        // Determine detailed error message for client
        $errorMessage = self::categorizeError($exception->getMessage(), $sqlQuery);
        if (!self::isDebug()) {
            $errorMessage = self::sanitizeErrorMessage($errorMessage);
        }
        
        // Build response
        $response = [
            'success' => false,
            'error' => $errorMessage,
        ];
        
        // Include technical details if debugging is enabled
        if (getenv('APP_DEBUG') === 'true' || getenv('DEBUG') === '1') {
            $response['_debug'] = [
                'exception_type' => get_class($exception),
                'exception_message' => $exception->getMessage(),
                'file' => $file,
                'line' => (int) $line,
                'sql_query' => $sqlQuery,
            ];
        }
        
        return $response;
    }
    
    /**
     * Categorize and extract meaningful error message
     */
    private static function categorizeError(string $message, ?string $sqlQuery): string
    {
        // Database schema issues
        if (str_contains($message, 'Unknown column')) {
            preg_match("/Unknown column '([^']+)'/", $message, $matches);
            if (!empty($matches[1])) {
                return "Database error: Unknown column '{$matches[1]}' — database schema may be out of date";
            }
            return "Database error: Unknown column in query — run database/schema.sql";
        }
        
        if (str_contains($message, "doesn't exist") || str_contains($message, 'Table not found')) {
            preg_match("/table '([^']+)'/i", $message, $matches);
            if (!empty($matches[1])) {
                return "Database error: Table '{$matches[1]}' not found — run database/schema.sql";
            }
            return "Database error: Required table not found";
        }
        
        if (str_contains($message, 'No such table')) {
            preg_match("/table ([^\s]+)/i", $message, $matches);
            if (!empty($matches[1])) {
                return "Database error: Table {$matches[1]} not found — run database/schema.sql";
            }
            return "Database error: Required table not found";
        }
        
        // Connection issues
        if (str_contains($message, 'Connection refused') || str_contains($message, 'Connection timed out') || str_contains($message, 'Lost connection') || str_contains($message, 'Connection reset')) {
            return "Database error: Cannot connect to database — check configuration";
        }
        
        if (str_contains($message, 'Access denied')) {
            return "Database error: Database credentials incorrect";
        }
        
        // SQL syntax errors
        if (str_contains($message, 'Syntax error') || str_contains($message, 'SQL syntax')) {
            return "Database error: SQL syntax error — check endpoint implementation";
        }
        
        // Constraint violations
        if (str_contains($message, 'foreign key constraint')) {
            return "Database error: Foreign key constraint violation — referenced record may not exist";
        }
        
        if (str_contains($message, 'Duplicate entry')) {
            preg_match("/Duplicate entry '([^']+)'/", $message, $matches);
            if (!empty($matches[1])) {
                return "Database error: Duplicate entry '{$matches[1]}' — this record already exists";
            }
            return "Database error: Duplicate entry — this record already exists";
        }
        
        // Generic database error
        if (str_contains(strtolower($message), 'pdo') || str_contains(strtolower($message), 'database')) {
            return "Database error: " . substr($message, 0, 100);
        }
        
        // Generic error
        return "API Error: Operation failed";
    }
    
    /**
     * Check if debug mode is enabled
     */
    private static function isDebug(): bool
    {
        return getenv('APP_DEBUG') === 'true' || getenv('DEBUG') === '1';
    }
    
    /**
     * Sanitize error message to hide database details when not in debug mode
     */
    private static function sanitizeErrorMessage(string $message): string
    {
        // Replace detailed error information with generic message
        if (str_contains($message, 'Database error:')) {
            return "Database error: Operation failed";
        }
        return "API Error: Operation failed";
    }
    
    /**
     * Sanitize SQL parameters for logging (remove sensitive values)
     */
    private static function sanitizeSQLParams(?array $params): ?array
    {
        if (!$params) {
            return null;
        }
        
        $sanitized = [];
        foreach ($params as $key => $value) {
            // Redact all parameter values to avoid leaking sensitive data
            $sanitized[$key] = '***REDACTED***';
        }
        
        return $sanitized;
    }
    
    /**
     * Sanitize request data for logging (remove sensitive fields)
     */
    private static function sanitizeRequestData(?array $data): ?array
    {
        if (!$data) {
            return null;
        }
        
        $sanitized = $data;
        $sensitiveFields = ['password', 'password_hash', 'token', 'api_key', 'secret', 'authorization'];
        
        foreach ($sensitiveFields as $field) {
            foreach (array_keys($sanitized) as $key) {
                if (stripos($key, $field) !== false) {
                    $sanitized[$key] = '***REDACTED***';
                }
            }
        }
        
        return $sanitized;
    }
    
    /**
     * Log SQL query execution
     */
    public static function logQuery(string $query, ?array $params = null, float $executionTime = 0.0): void
    {
        if (getenv('APP_DEBUG') !== 'true' && getenv('DEBUG') !== '1') {
            return;
        }
        
        $logEntry = [
            'timestamp' => date('Y-m-d H:i:s'),
            'type' => 'SQL_QUERY',
            'query' => $query,
            'params' => $params,
            'execution_time_ms' => round($executionTime * 1000, 2),
        ];
        
        error_log('[SQL] ' . json_encode($logEntry));
    }
}
?>
