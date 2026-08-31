<?php
declare(strict_types=1);

/**
 * DerivPublicFeedService
 * ──────────────────────
 * Focused public-market-data service for the Deriv public WebSocket endpoint.
 * No API token is required — this service is strictly for price feeds, OHLC
 * candle data, and indicator input.  Trade execution remains in the
 * authenticated channel handled by the frontend (indicator.js) and should
 * never be mixed with this service.
 *
 * Uses DerivMarketDataService internally for all WebSocket transport.
 *
 * Required interface:
 *   connect()            – open the public WebSocket connection
 *   disconnect()         – close gracefully and forget subscriptions
 *   subscribe($symbol)   – subscribe to tick stream for a symbol
 *   receiveTicks($n,$t)  – collect up to $n normalised tick objects
 *   processMarketData($raw) – normalise a raw WS message to standard shape
 *   reconnect()          – disconnect then connect (resubscribes after open)
 *   getLatestPrices()    – return the most recent price for each subscribed symbol
 *
 * Normalised market-data format:
 *   {
 *     "symbol":    "R_100",
 *     "timestamp": 1234567890,
 *     "price":     123.456,
 *     "open":      123.100,
 *     "high":      123.900,
 *     "low":       122.800,
 *     "close":     123.456,
 *     "volume":    100
 *   }
 */

require_once __DIR__ . '/DerivMarketDataService.php';

class DerivPublicFeedService
{
    private DerivMarketDataService $transport;

    /** symbol => latest normalised tick */
    private array $latestPrices = [];

    /** symbols that should be resubscribed after reconnect */
    private array $pendingSymbols = [];

    /**
     * Candle subscriptions that should be resubscribed after reconnect.
     * Format: [['symbol' => '...', 'granularity' => 60], ...]
     */
    private array $pendingCandles = [];

    public function __construct(array $options = [])
    {
        $this->transport = new DerivMarketDataService($options);
    }

    /* ═══════════════════════════════════════════════════════════
       LIFECYCLE
       ═══════════════════════════════════════════════════════════ */

    /**
     * Open the public WebSocket connection.
     *
     * @throws RuntimeException on connection or handshake failure.
     */
    public function connect(): void
    {
        $this->transport->connect();
    }

    /**
     * Close the connection gracefully and clear subscription state.
     */
    public function disconnect(): void
    {
        try {
            $this->transport->close();
        } catch (\Throwable $e) {
            // Swallow — we are disconnecting deliberately
        }
        $this->latestPrices = [];
    }

    /**
     * Disconnect, then reconnect and resubscribe to all previously
     * registered symbols.  Implements the auto-reconnect requirement.
     *
     * @throws RuntimeException if the reconnect itself fails.
     */
    public function reconnect(): void
    {
        $this->disconnect();
        $this->connect();

        // Restore tick subscriptions
        foreach ($this->pendingSymbols as $sym) {
            $this->transport->subscribeMarketData($sym);
        }

        // Restore candle subscriptions with their original granularity
        foreach ($this->pendingCandles as $entry) {
            $this->transport->subscribeCandles($entry['symbol'], $entry['granularity']);
        }
    }

    /* ═══════════════════════════════════════════════════════════
       SUBSCRIPTION
       ═══════════════════════════════════════════════════════════ */

    /**
     * Subscribe to the real-time tick stream for $symbol.
     * Duplicate subscriptions are silently ignored.
     *
     * @param string $symbol  e.g. "1HZ75V", "R_100", "frxEURUSD"
     * @throws RuntimeException if not connected.
     */
    public function subscribe(string $symbol): void
    {
        $symbol = strtoupper(trim($symbol));

        // Remember for post-reconnect resubscription
        if (!in_array($symbol, $this->pendingSymbols, true)) {
            $this->pendingSymbols[] = $symbol;
        }

        $this->transport->subscribeMarketData($symbol);
    }

    /**
     * Subscribe to OHLC candles for $symbol.
     *
     * @param string $symbol       e.g. "R_100"
     * @param int    $granularity  seconds per candle (default: 60)
     * @throws RuntimeException if not connected.
     */
    public function subscribeCandles(string $symbol, int $granularity = 60): void
    {
        $symbol = strtoupper(trim($symbol));

        // Track candle subscriptions separately so reconnect can restore them
        // with the correct granularity; update granularity if already registered.
        $found = false;
        foreach ($this->pendingCandles as &$entry) {
            if ($entry['symbol'] === $symbol) {
                $entry['granularity'] = $granularity;
                $found = true;
                break;
            }
        }
        unset($entry);
        if (!$found) {
            $this->pendingCandles[] = ['symbol' => $symbol, 'granularity' => $granularity];
        }

        $this->transport->subscribeCandles($symbol, $granularity);
    }

    /* ═══════════════════════════════════════════════════════════
       DATA COLLECTION
       ═══════════════════════════════════════════════════════════ */

    /**
     * Block and collect up to $maxTicks normalised tick objects.
     *
     * Each returned element conforms to the normalised market-data format.
     * The latest price for each symbol is cached internally.
     *
     * @param  int   $maxTicks  Maximum number of ticks to collect (1–200).
     * @param  int   $timeout   Max seconds to wait (1–60).
     * @return array<int, array<string,mixed>>
     */
    public function receiveTicks(int $maxTicks = 10, int $timeout = 8): array
    {
        $raw = $this->transport->listen($maxTicks, $timeout);

        $normalised = [];
        foreach ($raw as $tick) {
            // $tick is the DerivMarketDataService normalised shape which includes
            // a 'raw' key holding the original WebSocket frame. Run it through
            // processMarketData() to produce the documented public-feed shape.
            $rawFrame = $tick['raw'] ?? null;
            if (!is_array($rawFrame)) {
                continue;
            }
            $norm = $this->processMarketData($rawFrame);
            if ($norm === null) {
                continue;
            }
            $normalised[] = $norm;
            $sym = $norm['symbol'] ?? null;
            if ($sym !== null && $sym !== '') {
                $this->latestPrices[$sym] = $norm;
            }
        }

        return $normalised;
    }

    /**
     * Normalise a raw WebSocket JSON payload (already decoded as an array)
     * into the standard market-data shape.
     *
     * Returns null for messages that carry no price data (e.g. ping, error).
     *
     * @param  array<string,mixed> $raw  Decoded JSON from the WebSocket.
     * @return array<string,mixed>|null  Normalised data or null.
     */
    public function processMarketData(array $raw): ?array
    {
        /* Tick message */
        if (isset($raw['tick'])) {
            $t = $raw['tick'];
            return [
                'symbol'    => $t['symbol']     ?? '',
                'timestamp' => (int) ($t['epoch'] ?? time()),
                'price'     => (float) ($t['quote'] ?? 0),
                'open'      => (float) ($t['quote'] ?? 0),
                'high'      => (float) ($t['quote'] ?? 0),
                'low'       => (float) ($t['quote'] ?? 0),
                'close'     => (float) ($t['quote'] ?? 0),
                'volume'    => 1,
            ];
        }

        /* OHLC / candle message */
        if (isset($raw['ohlc'])) {
            $c = $raw['ohlc'];
            return [
                'symbol'    => $c['symbol']     ?? '',
                'timestamp' => (int) ($c['epoch'] ?? time()),
                'price'     => (float) ($c['close'] ?? 0),
                'open'      => (float) ($c['open']  ?? 0),
                'high'      => (float) ($c['high']  ?? 0),
                'low'       => (float) ($c['low']   ?? 0),
                'close'     => (float) ($c['close'] ?? 0),
                'volume'    => 1,
            ];
        }

        /* candles history (batch) */
        if (isset($raw['candles']) && is_array($raw['candles'])) {
            $sym = $raw['echo_req']['ticks_history'] ?? '';
            $last = end($raw['candles']);
            if ($last === false) return null;
            return [
                'symbol'    => $sym,
                'timestamp' => (int) ($last['epoch'] ?? time()),
                'price'     => (float) ($last['close'] ?? 0),
                'open'      => (float) ($last['open']  ?? 0),
                'high'      => (float) ($last['high']  ?? 0),
                'low'       => (float) ($last['low']   ?? 0),
                'close'     => (float) ($last['close'] ?? 0),
                'volume'    => 1,
            ];
        }

        return null;
    }

    /* ═══════════════════════════════════════════════════════════
       PRICE CACHE
       ═══════════════════════════════════════════════════════════ */

    /**
     * Return the most recent normalised tick for every subscribed symbol.
     *
     * @return array<string, array<string,mixed>>  Keyed by symbol.
     */
    public function getLatestPrices(): array
    {
        return $this->latestPrices;
    }
}
