#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Standalone Deriv Public WebSocket Connection Test
 * ──────────────────────────────────────────────────
 * Connects to the public endpoint, subscribes to one symbol, and prints
 * received ticks.  Runs without authentication.
 *
 * Usage:
 *   php tests/test_deriv_public_ws.php [SYMBOL]
 *
 * Example:
 *   php tests/test_deriv_public_ws.php R_100
 */

$symbol = $argv[1] ?? 'R_100';
$wsUrl  = 'wss://ws.derivws.com/websockets/v3?app_id=120128';
$maxTicks = 5;
$timeout  = 15;

echo "=== Deriv Public WebSocket Test ===\n";
echo "Endpoint : $wsUrl\n";
echo "Symbol   : $symbol\n";
echo "Max ticks: $maxTicks\n\n";

/* ── 1. Connect ── */
echo "[" . date('H:i:s') . "] Attempting Deriv public feed connection...\n";

$parsed = parse_url($wsUrl);
$host   = $parsed['host'] ?? '';
$port   = $parsed['port'] ?? 443;
$path   = $parsed['path'] ?? '/';

$ctx = stream_context_create([
    'ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
        'SNI_enabled'      => true,
        'peer_name'        => $host,
    ],
]);

$errNo = 0;
$errStr = '';
$socket = @stream_socket_client(
    "ssl://$host:$port",
    $errNo,
    $errStr,
    10,
    STREAM_CLIENT_CONNECT,
    $ctx
);

if ($socket === false) {
    echo "[ERROR] stream_socket_client failed ($errNo): $errStr\n";
    exit(1);
}

echo "[" . date('H:i:s') . "] TCP/TLS connected\n";

/* ── 2. WebSocket Upgrade Handshake ── */
$key = base64_encode(random_bytes(16));
$headers = "GET $path HTTP/1.1\r\n"
    . "Host: $host\r\n"
    . "Upgrade: websocket\r\n"
    . "Connection: Upgrade\r\n"
    . "Sec-WebSocket-Key: $key\r\n"
    . "Sec-WebSocket-Version: 13\r\n"
    . "Origin: https://$host\r\n"
    . "\r\n";

fwrite($socket, $headers);

$response = '';
$deadline = microtime(true) + 10;
while (microtime(true) < $deadline) {
    $chunk = @fread($socket, 4096);
    if ($chunk !== false) $response .= $chunk;
    if (str_contains($response, "\r\n\r\n")) break;
    usleep(5000);
}

if (!preg_match('/^HTTP\/1\.[01] 101\b/', $response)) {
    echo "[ERROR] Handshake failed. Server response:\n" . substr($response, 0, 300) . "\n";
    fclose($socket);
    exit(1);
}

$expectedAccept = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
if (!str_contains($response, $expectedAccept)) {
    echo "[ERROR] Sec-WebSocket-Accept validation failed\n";
    fclose($socket);
    exit(1);
}

echo "[" . date('H:i:s') . "] WebSocket connected (101 Switching Protocols)\n";

/* ── Helper: send masked frame ── */
function sendWsFrame($socket, string $payload, int $opcode = 0x1): void
{
    $len  = strlen($payload);
    $mask = random_bytes(4);
    $frame = chr(0x80 | $opcode);
    if ($len < 126) {
        $frame .= chr(0x80 | $len);
    } elseif ($len < 65536) {
        $frame .= chr(0x80 | 126) . pack('n', $len);
    } else {
        $frame .= chr(0x80 | 127) . pack('J', $len);
    }
    $frame .= $mask;
    $masked = '';
    for ($i = 0; $i < $len; $i++) {
        $masked .= $payload[$i] ^ $mask[$i % 4];
    }
    fwrite($socket, $frame . $masked);
}

/* ── Helper: read one frame ── */
function readWsFrame($socket, int $timeoutSec = 10): ?string
{
    stream_set_blocking($socket, false);
    $deadline = microtime(true) + $timeoutSec;
    while (microtime(true) < $deadline) {
        $header = @fread($socket, 2);
        if ($header === false || strlen($header) < 2) {
            usleep(10000);
            continue;
        }
        $byte0 = ord($header[0]);
        $byte1 = ord($header[1]);
        $opcode = $byte0 & 0x0F;
        $masked = ($byte1 & 0x80) !== 0;
        $payLen = $byte1 & 0x7F;

        if ($payLen === 126) {
            $ext = @fread($socket, 2);
            if ($ext === false || strlen($ext) < 2) return null;
            $payLen = unpack('n', $ext)[1];
        } elseif ($payLen === 127) {
            $ext = @fread($socket, 8);
            if ($ext === false || strlen($ext) < 8) return null;
            $payLen = unpack('J', $ext)[1];
        }

        $maskKey = '';
        if ($masked) {
            $maskKey = @fread($socket, 4);
            if ($maskKey === false || strlen($maskKey) < 4) return null;
        }

        $payload = '';
        $remaining = $payLen;
        while ($remaining > 0 && microtime(true) < $deadline) {
            $chunk = @fread($socket, min($remaining, 4096));
            if ($chunk === false || $chunk === '') {
                usleep(2000);
                continue;
            }
            $payload .= $chunk;
            $remaining -= strlen($chunk);
        }

        if ($masked && $maskKey !== '') {
            $unmasked = '';
            for ($i = 0, $l = strlen($payload); $i < $l; $i++) {
                $unmasked .= $payload[$i] ^ $maskKey[$i % 4];
            }
            $payload = $unmasked;
        }

        // Respond to ping
        if ($opcode === 0x9) {
            sendWsFrame($socket, $payload, 0xA);
            continue;
        }
        // Close
        if ($opcode === 0x8) {
            $code = strlen($payload) >= 2 ? unpack('n', substr($payload, 0, 2))[1] : 0;
            $reason = strlen($payload) > 2 ? substr($payload, 2) : '';
            echo "[" . date('H:i:s') . "] WebSocket closed: $code / $reason\n";
            return null;
        }
        if ($opcode === 0x1 || $opcode === 0x2) {
            return $payload;
        }
    }
    return null;
}

/* ── 3. Subscribe ── */
$subPayload = json_encode(['ticks' => $symbol, 'subscribe' => 1]);
sendWsFrame($socket, $subPayload);
echo "[" . date('H:i:s') . "] Subscribing to symbol $symbol\n";

/* ── 4. Receive ticks ── */
$received = 0;
$deadline = microtime(true) + $timeout;

while ($received < $maxTicks && microtime(true) < $deadline) {
    $frame = readWsFrame($socket, 5);
    if ($frame === null) continue;

    $data = json_decode($frame, true);
    if (!is_array($data)) continue;

    echo "[" . date('H:i:s') . "] DEBUG raw: " . substr($frame, 0, 200) . "\n";

    if (isset($data['error'])) {
        echo "[ERROR] " . ($data['error']['message'] ?? 'unknown') . "\n";
        break;
    }

    if (isset($data['tick'])) {
        $t = $data['tick'];
        $received++;
        echo "[" . date('H:i:s') . "] Received tick data #$received: "
            . ($t['symbol'] ?? '?') . " = " . ($t['quote'] ?? '?')
            . " @ epoch " . ($t['epoch'] ?? '?') . "\n";
    }
}

/* ── 5. Close ── */
sendWsFrame($socket, '', 0x8);
@fclose($socket);

echo "\n=== Results ===\n";
echo "Ticks received: $received / $maxTicks\n";
echo $received > 0 ? "✅ SUCCESS — Public WebSocket feed is working\n" : "❌ FAIL — No ticks received\n";
exit($received > 0 ? 0 : 1);
