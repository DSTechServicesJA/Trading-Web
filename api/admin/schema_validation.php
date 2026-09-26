<?php
/**
 * /api/admin/schema_validation.php
 * ──────────────────────────────────
 * Admin endpoint to validate and report database schema status
 * Useful for troubleshooting 500 errors
 *
 * GET /api/admin/schema_validation
 *   Returns detailed validation report
 *
 * All requests require Authorization: ******
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';
require_once __DIR__ . '/../lib/SchemaValidator.php';
require_once __DIR__ . '/../lib/APILogger.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($method !== 'GET') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

try {
    $pdo = getDB();
    $report = SchemaValidator::getReport($pdo);
    jsonResponse($report);
} catch (\Throwable $e) {
    $response = APILogger::logEndpointError('/api/admin/schema_validation', 'GET', $e);
    jsonResponse($response, 500);
}
?>
