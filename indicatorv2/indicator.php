<?php
declare(strict_types=1);

/*
 * Indicator V2 launcher:
 * - Uses separate PHP session cookie scope to avoid collision with other pages.
 * - Redirects to the existing indicator UI with an auth namespace so browser
 *   storage keys are isolated from /indicator/.
 */

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

session_name('itguru_indicatorv2');
if (PHP_VERSION_ID >= 70300) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/indicatorv2/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
} else {
    session_set_cookie_params(0, '/indicatorv2/', '', $secure, true);
}

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Location: /indicator/?auth_ns=indicatorv2', true, 302);
exit;

