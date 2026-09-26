<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/AuthMiddleware.php';

final class AuthGuard
{
    public static function requireAdmin(): array
    {
        return AuthMiddleware::requireAdmin();
    }
}
