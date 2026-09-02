<?php
declare(strict_types=1);

/**
 * DerivMarketDataService
 * ──────────────────────
 * Lightweight PHP WebSocket client for Deriv's public market-data endpoint.
 * No API token is required — this class only subscribes to public price feeds.
 *
 * Usage (server-side / CLI / cron):
 *
 *   $svc = new DerivMarketDataService();
 *   $svc->connect();
 *   $svc->subscribeMarketData('1HZ75V');
 *   $ticks = $svc->listen(10);   // collect up to 10 ticks
 *   $svc->close();
 *
 * The service reads DERIV_PUBLIC_WS_URL from the environment (loaded via
 * api/config.php) and falls back to the compile-time constant below.
 *
 * WebSocket framing is implemented from scratch using PHP streams so no
 * third-party library is required.
 */

/* ── Default public endpoint ── */
if (!defined('DERIV_PUBLIC_WS_DEFAULT')) {
    define('DERIV_PUBLIC_WS_DEFAULT', 'wss://ws.derivws.com/websockets/v3?app_id=120128');
}

class DerivMarketDataService
{
    /* ── Configuration ── */
    private string $wsUrl;
    private int    $connectTimeoutSec;
    private int    $readTimeoutSec;
    private int    $maxReconnectAttempts;
    private int    $reconnectBaseMs;
    private int    $reconnectMaxMs;

    /* ── Runtime state ── */
    /** @var resource|null */
    private $socket        = null;
    private bool   $connected     = false;
    private int    $reconnectCount = 0;

    /** Currently subscribed symbols and their subscription IDs. */
    private array $subscriptions = [];   // symbol => subscriptionId|null

    /* ── Constructor ── */
    public function __construct(array $options = [])
    {
        // Resolve endpoint: env var → option → compile-time default
        $envUrl = function_exists('env') ? env('DERIV_PUBLIC_WS_URL') : (getenv('DERIV_PUBLIC_WS_URL') ?: '');
        $this->wsUrl               = $envUrl ?: ($options['wsUrl'] ?? DERIV_PUBLIC_WS_DEFAULT);
        $this->connectTimeoutSec   = $options['connectTimeout']      ?? 10;
        $this->readTimeoutSec      = $options['readTimeout']         ?? 5;
        $this->maxReconnectAttempts = $options['maxReconnectAttempts'] ?? 5;
        $this->reconnectBaseMs     = $options['reconnectBaseMs']     ?? 1000;
        $this->reconnectMaxMs      = $options['reconnectMaxMs']      ?? 30000;
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */

    /**
     * Open the WebSocket connection (performs the HTTP upgrade handshake).
     *
     * @throws RuntimeException on connection or handshake failure.
     */
    public function connect(): void
    {
        $this->log('Attempting Deriv public feed connection to ' . $this->wsUrl);
        try {
            $this->socket    = $this->openStream($this->wsUrl);
            $this->connected = true;
            $this->log('WebSocket connected — handshake succeeded');
        } catch (\Throwable $e) {
            $this->log('Connection failed: ' . $e->getMessage(), 'error');
            throw $e;
        }
    }

    /**
     * Subscribe to real-time tick updates for the given market symbol.
     *
     * @param string $symbol  e.g. "1HZ75V", "R_75", "frxEURUSD"
     * @throws RuntimeException if not connected.
     */
    public function subscribeMarketData(string $symbol): void
    {
        $this->assertConnected();

        if (isset($this->subscriptions[$symbol])) {
            $this->log("Already subscribed to $symbol — skipping");
            return;
        }

        $payload = [
            'ticks'     => $symbol,
            'subscribe' => 1,
        ];

        $this->sendFrame(json_encode($payload));
        $this->subscriptions[$symbol] = null;   // ID assigned on first tick response
        $this->log("Subscribing to symbol $symbol");
    }

    /**
     * Subscribe to real-time OHLC candle updates for the given market symbol.
     *
     * @param string $symbol       e.g. "1HZ75V", "R_75"
     * @param int    $granularity  Candle interval in seconds (60, 120, 300, …)
     * @throws RuntimeException if not connected.
     */
    public function subscribeCandles(string $symbol, int $granularity = 60): void
    {
        $this->assertConnected();

        $key = "{$symbol}:candle:{$granularity}";
        if (isset($this->subscriptions[$key])) {
            $this->log("Already subscribed to candles for $symbol @ {$granularity}s — skipping");
            return;
        }

        $payload = [
            'ticks_history' => $symbol,
            'style'         => 'candles',
            'granularity'   => $granularity,
            'count'         => 10,
            'subscribe'     => 1,
        ];

        $this->sendFrame(json_encode($payload));
        $this->subscriptions[$key] = null;
        $this->log("Subscribed to candles: $symbol @ {$granularity}s");
    }

    /**
     * Collect incoming messages for up to $maxMessages ticks or $timeoutSec seconds.
     *
     * Returns an array of normalised tick/candle records:
     *   [
     *     'symbol'    => string,
     *     'price'     => float,
     *     'timestamp' => int   (Unix epoch),
     *     'raw'       => array (full decoded JSON),
     *   ]
     *
     * @param int $maxMessages  Stop after receiving this many tick messages (0 = unlimited).
     * @param int $timeoutSec   Maximum wall-clock seconds to wait (0 = no limit).
     * @return array<int, array<string,mixed>>
     */
    public function listen(int $maxMessages = 0, int $timeoutSec = 0): array
    {
        $this->assertConnected();

        $collected = [];
        $deadline  = $timeoutSec > 0 ? (microtime(true) + $timeoutSec) : PHP_INT_MAX;

        while (true) {
            if ($maxMessages > 0 && count($collected) >= $maxMessages) {
                break;
            }
            if (microtime(true) >= $deadline) {
                break;
            }

            $raw = $this->readFrame();
            if ($raw === null) {
                // Timeout on read — no data yet, keep polling
                if (microtime(true) >= $deadline) break;
                continue;
            }

            $msg = json_decode($raw, true);
            if (!is_array($msg)) {
                $this->log('Received non-JSON frame — skipping', 'warning');
                continue;
            }

            if (isset($msg['error'])) {
                $this->log(
                    'API error [' . ($msg['error']['code'] ?? 'unknown') . ']: '
                    . ($msg['error']['message'] ?? 'no message'),
                    'error'
                );
                $this->log('Raw error response: ' . $raw, 'debug');
                continue;
            }

            $msgType = $msg['msg_type'] ?? '';
            $this->log("Received message type: $msgType");

            // Store subscription IDs so we can forget cleanly on close
            if ($msgType === 'tick' && isset($msg['subscription']['id'])) {
                $sym = $msg['tick']['underlying_symbol'] ?? $msg['tick']['symbol'] ?? '';
                if ($sym !== '' && array_key_exists($sym, $this->subscriptions)) {
                    $this->subscriptions[$sym] = $msg['subscription']['id'];
                }
            }

            $normalised = $this->normaliseMessage($msg);
            if ($normalised !== null) {
                $this->log('Received tick data: ' . ($normalised['symbol'] ?? 'unknown') . ' @ ' . ($normalised['price'] ?? '?'));
                $collected[] = $normalised;
            }
        }

        return $collected;
    }

    /**
     * Unsubscribe from a specific symbol's tick stream.
     */
    public function unsubscribeMarketData(string $symbol): void
    {
        if (!$this->connected || !isset($this->subscriptions[$symbol])) {
            return;
        }

        $subId = $this->subscriptions[$symbol];
        if ($subId !== null) {
            $this->sendFrameSafe(json_encode(['forget' => $subId]));
        }
        unset($this->subscriptions[$symbol]);
        $this->log("Unsubscribed from $symbol");
    }

    /**
     * Close the connection gracefully (sends WebSocket CLOSE frame first).
     */
    public function close(): void
    {
        if (!$this->connected || $this->socket === null) {
            return;
        }

        // Forget all active subscriptions
        foreach ($this->subscriptions as $symbol => $subId) {
            if ($subId !== null) {
                $this->sendFrameSafe(json_encode(['forget' => $subId]));
            }
        }
        $this->subscriptions = [];

        // Send WebSocket close frame (opcode 0x8)
        $this->sendFrameSafe('', 0x8);

        @fclose($this->socket);
        $this->socket    = null;
        $this->connected = false;
        $this->log('Connection closed');
    }

    /**
     * Reconnect after a disconnection, optionally re-subscribing previous symbols.
     *
     * @param bool $resubscribe  Whether to re-subscribe to all previously tracked symbols.
     * @throws RuntimeException if max reconnect attempts are exceeded.
     */
    public function reconnect(bool $resubscribe = true): void
    {
        if ($this->reconnectCount >= $this->maxReconnectAttempts) {
            throw new RuntimeException(
                "DerivMarketDataService: max reconnect attempts ({$this->maxReconnectAttempts}) exceeded"
            );
        }

        // Close existing socket if still open
        if ($this->socket !== null) {
            @fclose($this->socket);
            $this->socket    = null;
            $this->connected = false;
        }

        $delay = $this->nextReconnectDelay($this->reconnectCount);
        $this->reconnectCount++;
        $this->log("Reconnect attempt {$this->reconnectCount} in {$delay}ms…");
        usleep($delay * 1000);

        $previousSymbols = $resubscribe ? array_keys($this->subscriptions) : [];
        $this->subscriptions = [];

        $this->connect();
        $this->reconnectCount = 0;   // reset counter on success

        if ($resubscribe) {
            foreach ($previousSymbols as $sym) {
                $this->subscribeMarketData($sym);
            }
        }
    }

    /** Whether the WebSocket is currently open. */
    public function isConnected(): bool
    {
        return $this->connected && $this->socket !== null && !feof($this->socket);
    }

    /* ═══════════════════════════════════════════════════════════
       NORMALISATION
       ═══════════════════════════════════════════════════════════ */

    /**
     * Convert a raw Deriv WebSocket message into a consistent shape.
     * Returns null for messages that carry no price data (e.g. pong).
     *
     * @param  array<string,mixed> $msg
     * @return array<string,mixed>|null
     */
    private function normaliseMessage(array $msg): ?array
    {
        $msgType = $msg['msg_type'] ?? '';

        if ($msgType === 'tick') {
            $tick = $msg['tick'] ?? [];
            return [
                'type'      => 'tick',
                'symbol'    => $tick['underlying_symbol'] ?? $tick['symbol'] ?? '',
                'price'     => (float) ($tick['quote']  ?? 0),
                'bid'       => (float) ($tick['bid']    ?? 0),
                'ask'       => (float) ($tick['ask']    ?? 0),
                'timestamp' => (int)   ($tick['epoch']  ?? time()),
                'raw'       => $msg,
            ];
        }

        if ($msgType === 'ohlc') {
            $ohlc = $msg['ohlc'] ?? [];
            return [
                'type'      => 'ohlc',
                'symbol'    => $ohlc['underlying_symbol'] ?? $ohlc['symbol'] ?? '',
                'open'      => (float) ($ohlc['open']    ?? 0),
                'high'      => (float) ($ohlc['high']    ?? 0),
                'low'       => (float) ($ohlc['low']     ?? 0),
                'close'     => (float) ($ohlc['close']   ?? 0),
                'timestamp' => (int)   ($ohlc['epoch']   ?? time()),
                'granularity' => (int) ($ohlc['granularity'] ?? 0),
                'raw'       => $msg,
            ];
        }

        if ($msgType === 'candles') {
            $candles = $msg['candles'] ?? [];
            $sym     = $msg['echo_req']['ticks_history'] ?? '';
            return [
                'type'    => 'candles',
                'symbol'  => $sym,
                'candles' => array_map(static function (array $c) {
                    return [
                        'open'      => (float) ($c['open']  ?? 0),
                        'high'      => (float) ($c['high']  ?? 0),
                        'low'       => (float) ($c['low']   ?? 0),
                        'close'     => (float) ($c['close'] ?? 0),
                        'timestamp' => (int)   ($c['epoch'] ?? 0),
                    ];
                }, $candles),
                'raw' => $msg,
            ];
        }

        // ping/pong and other control messages carry no price data
        return null;
    }

    /* ═══════════════════════════════════════════════════════════
       WEBSOCKET HANDSHAKE & FRAMING
       ═══════════════════════════════════════════════════════════ */

    /**
     * Open a TLS stream, perform the WebSocket upgrade handshake, and return
     * the connected stream resource.
     *
     * @throws RuntimeException
     * @return resource
     */
    private function openStream(string $wsUrl)
    {
        $parsed = parse_url($wsUrl);
        if ($parsed === false) {
            throw new RuntimeException("DerivMarketDataService: invalid URL: $wsUrl");
        }

        $scheme = $parsed['scheme'] ?? 'wss';
        $host   = $parsed['host']   ?? '';
        $port   = $parsed['port']   ?? ($scheme === 'wss' ? 443 : 80);
        $path   = ($parsed['path']  ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');

        if ($host === '') {
            throw new RuntimeException("DerivMarketDataService: could not parse host from URL: $wsUrl");
        }

        $transport = ($scheme === 'wss') ? 'ssl' : 'tcp';
        $address   = "$transport://$host:$port";

        $ctx = stream_context_create([
            'ssl' => [
                'verify_peer'      => true,
                'verify_peer_name' => true,
                'SNI_enabled'      => true,
                'peer_name'        => $host,
            ],
        ]);

        $errNo  = 0;
        $errStr = '';
        $socket = @stream_socket_client(
            $address,
            $errNo,
            $errStr,
            $this->connectTimeoutSec,
            STREAM_CLIENT_CONNECT,
            $ctx
        );

        if ($socket === false) {
            throw new RuntimeException(
                "DerivMarketDataService: stream_socket_client failed ($errNo): $errStr"
            );
        }

        stream_set_timeout($socket, $this->readTimeoutSec);
        stream_set_blocking($socket, false);

        // ── HTTP/1.1 WebSocket upgrade ──
        $key     = base64_encode(random_bytes(16));
        $headers = implode("\r\n", [
            "GET $path HTTP/1.1",
            "Host: $host",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Key: $key",
            "Sec-WebSocket-Version: 13",
            "Origin: https://$host",
            "", "",     // CRLF CRLF to end headers
        ]);

        if (fwrite($socket, $headers) === false) {
            fclose($socket);
            throw new RuntimeException('DerivMarketDataService: failed to send HTTP upgrade request');
        }

        // ── Read server response ──
        $response = $this->readRaw($socket, 4096, $this->connectTimeoutSec);
        $this->log('WebSocket handshake result: ' . substr($response ?? '(null)', 0, 80));
        if ($response === null || !preg_match('/^HTTP\/1\.[01] 101\b/', $response)) {
            fclose($socket);
            $preview = substr($response ?? '', 0, 200);
            throw new RuntimeException(
                "DerivMarketDataService: server did not return 101 Switching Protocols. Response: $preview"
            );
        }

        // Verify the server's Sec-WebSocket-Accept
        $expectedAccept = base64_encode(
            sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true)
        );
        if (!str_contains($response, $expectedAccept)) {
            fclose($socket);
            throw new RuntimeException(
                'DerivMarketDataService: Sec-WebSocket-Accept validation failed'
            );
        }

        return $socket;
    }

    /**
     * Block-read raw bytes until the delimiter or timeout is reached.
     *
     * @param  resource $socket
     * @param  int      $maxBytes
     * @param  int      $timeoutSec
     * @return string|null
     */
    private function readRaw($socket, int $maxBytes, int $timeoutSec): ?string
    {
        $deadline = microtime(true) + $timeoutSec;
        $buf = '';
        while (microtime(true) < $deadline) {
            $chunk = @fread($socket, $maxBytes);
            if ($chunk === false) {
                return null;
            }
            $buf .= $chunk;
            // HTTP response ends with double CRLF
            if (str_contains($buf, "\r\n\r\n")) {
                return $buf;
            }
            usleep(5000);
        }
        return $buf !== '' ? $buf : null;
    }

    /**
     * Send a WebSocket text frame (or a control frame when opcode != 0x1).
     *
     * @throws RuntimeException on send failure.
     */
    private function sendFrame(string $payload, int $opcode = 0x1): void
    {
        $this->assertConnected();
        $frame = $this->buildFrame($payload, $opcode);
        if (@fwrite($this->socket, $frame) === false) {
            throw new RuntimeException('DerivMarketDataService: fwrite failed — connection may be lost');
        }
    }

    /**
     * Silent version of sendFrame — logs errors instead of throwing.
     */
    private function sendFrameSafe(string $payload, int $opcode = 0x1): void
    {
        if ($this->socket === null) {
            return;
        }
        try {
            $frame = $this->buildFrame($payload, $opcode);
            @fwrite($this->socket, $frame);
        } catch (\Throwable $e) {
            $this->log('sendFrameSafe: ' . $e->getMessage(), 'warning');
        }
    }

    /**
     * Build a masked WebSocket frame (clients MUST mask frames per RFC 6455 §5.3).
     */
    private function buildFrame(string $payload, int $opcode): string
    {
        $len  = strlen($payload);
        $mask = random_bytes(4);

        // Byte 0: FIN=1, opcode
        $frame = chr(0x80 | $opcode);

        // Byte 1+: MASK=1, payload length
        if ($len < 126) {
            $frame .= chr(0x80 | $len);
        } elseif ($len < 65536) {
            $frame .= chr(0x80 | 126) . pack('n', $len);
        } else {
            $frame .= chr(0x80 | 127) . pack('J', $len);
        }

        $frame .= $mask;

        // XOR masking
        $masked = '';
        for ($i = 0; $i < $len; $i++) {
            $masked .= $payload[$i] ^ $mask[$i % 4];
        }

        return $frame . $masked;
    }

    /**
     * Read one WebSocket text frame from the socket.
     * Returns null if no frame is available within the read timeout.
     *
     * Only handles single-frame, unmasked server messages (the common case).
     */
    private function readFrame(): ?string
    {
        if ($this->socket === null || feof($this->socket)) {
            return null;
        }

        // Need at least 2 header bytes
        $header = @fread($this->socket, 2);
        if ($header === false || strlen($header) < 2) {
            return null;
        }

        $byte0  = ord($header[0]);
        $byte1  = ord($header[1]);
        $opcode = $byte0 & 0x0F;
        $masked = ($byte1 & 0x80) !== 0;
        $payLen = $byte1 & 0x7F;

        // Handle extended payload lengths
        if ($payLen === 126) {
            $ext = @fread($this->socket, 2);
            if ($ext === false || strlen($ext) < 2) return null;
            $payLen = unpack('n', $ext)[1];
        } elseif ($payLen === 127) {
            $ext = @fread($this->socket, 8);
            if ($ext === false || strlen($ext) < 8) return null;
            $payLen = unpack('J', $ext)[1];
        }

        // Read masking key (server→client frames should NOT be masked per RFC 6455,
        // but handle it defensively)
        $maskKey = '';
        if ($masked) {
            $maskKey = @fread($this->socket, 4);
            if ($maskKey === false || strlen($maskKey) < 4) return null;
        }

        // Read payload — spin until all bytes arrive or deadline is exceeded.
        $payload   = '';
        $remaining = $payLen;
        $deadline  = microtime(true) + $this->readTimeoutSec;
        while ($remaining > 0) {
            if (microtime(true) > $deadline) {
                // Timed out mid-frame — stream is now desynchronised; signal close.
                $this->connected = false;
                $this->log('readFrame: timeout reading payload — connection desynchronised', 'warning');
                return null;
            }
            $chunk = @fread($this->socket, min($remaining, 4096));
            if ($chunk === false) {
                $this->connected = false;
                $this->log('readFrame: fread returned false — connection lost', 'warning');
                return null;
            }
            if ($chunk === '') {
                if ($payload === '' && $remaining === $payLen) {
                    // No header bytes consumed yet — nothing available this iteration
                    return null;
                }
                // Bytes already consumed — spin until the rest arrive
                usleep(2000);
                continue;
            }
            $payload   .= $chunk;
            $remaining -= strlen($chunk);
        }

        if ($masked && $maskKey !== '') {
            $unmasked = '';
            for ($i = 0, $l = strlen($payload); $i < $l; $i++) {
                $unmasked .= $payload[$i] ^ $maskKey[$i % 4];
            }
            $payload = $unmasked;
        }

        // Handle server-initiated close
        if ($opcode === 0x8) {
            $closeCode = 0;
            $closeReason = '';
            if (strlen($payload) >= 2) {
                $closeCode = unpack('n', substr($payload, 0, 2))[1];
                $closeReason = substr($payload, 2);
            }
            $this->connected = false;
            $this->log("WebSocket closed: $closeCode / $closeReason", 'warning');
            return null;
        }

        // Respond to ping with pong
        if ($opcode === 0x9) {
            $this->sendFrameSafe($payload, 0xA);
            return null;
        }

        // Only return text/binary frames
        if ($opcode !== 0x1 && $opcode !== 0x2) {
            return null;
        }

        return $payload !== '' ? $payload : null;
    }

    /* ═══════════════════════════════════════════════════════════
       HELPERS
       ═══════════════════════════════════════════════════════════ */

    private function assertConnected(): void
    {
        if (!$this->connected || $this->socket === null) {
            throw new RuntimeException(
                'DerivMarketDataService: not connected — call connect() first'
            );
        }
    }

    private function nextReconnectDelay(int $attempt): int
    {
        return (int) min(
            $this->reconnectBaseMs * (2 ** max(0, $attempt)),
            $this->reconnectMaxMs
        );
    }

    /**
     * Write a timestamped log entry to the PHP error log.
     * Prefix makes entries easy to grep: [DerivMarketDataService].
     */
    private function log(string $message, string $level = 'info'): void
    {
        $ts  = date('Y-m-d H:i:s');
        $lvl = strtoupper($level);
        error_log("[DerivMarketDataService][$lvl] $ts — $message");
    }
}
