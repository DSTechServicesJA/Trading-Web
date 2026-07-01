<?php
/**
 * api/lib/mailer.php
 * ──────────────────
 * Lightweight, dependency-free transactional email service.
 *
 * The project ships without Composer, so this is a self-contained SMTP
 * client (raw sockets) with the following behaviour:
 *
 *   • Reads configuration from .env (SMTP_HOST, SMTP_PORT, SMTP_USER,
 *     SMTP_PASS, SMTP_SECURE, MAIL_FROM, MAIL_FROM_NAME).
 *   • Sends multipart (text + HTML) messages over SMTP with optional
 *     implicit TLS (smtps / port 465) or STARTTLS (port 587).
 *   • Falls back to PHP's mail() when SMTP is not configured.
 *   • Never throws to the caller — always returns a boolean and records
 *     the attempt in the `email_log` table for auditing / bounce triage.
 *
 * Public API:
 *   sendEmail(array $opts): bool
 *     $opts = [
 *       'to'        => 'user@example.com',   // required
 *       'subject'   => 'Subject line',        // required
 *       'html'      => '<p>…</p>',            // optional (recommended)
 *       'text'      => 'plain text',          // optional fallback body
 *       'user_id'   => 12,                    // optional, for the log
 *       'type'      => 'subscription_change', // optional log category
 *     ];
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';

/** True when SMTP delivery is configured in .env. */
function mailerSmtpConfigured(): bool
{
    return env('SMTP_HOST') !== '' && env('MAIL_FROM') !== '';
}

/**
 * Record an email attempt in the email_log table. Best-effort — a logging
 * failure must never break the caller.
 */
function logEmail(?int $userId, string $to, string $subject, string $type, string $status, ?string $error, string $transport): void
{
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare(
            'INSERT INTO email_log (user_id, recipient, subject, email_type, status, error, transport)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId ?: null,
            substr($to, 0, 255),
            substr($subject, 0, 255),
            substr($type, 0, 60),
            $status,
            $error !== null ? substr($error, 0, 2000) : null,
            substr($transport, 0, 20),
        ]);
    } catch (\Throwable $e) {
        error_log('email_log insert failed: ' . $e->getMessage());
    }
}

/**
 * Send a transactional email.
 *
 * @param array{to:string,subject:string,html?:string,text?:string,user_id?:int,type?:string} $opts
 * @return bool  True when the message was accepted for delivery.
 */
function sendEmail(array $opts): bool
{
    $to      = trim((string) ($opts['to'] ?? ''));
    $subject = (string) ($opts['subject'] ?? '');
    $html    = (string) ($opts['html'] ?? '');
    $text    = (string) ($opts['text'] ?? '');
    $userId  = isset($opts['user_id']) ? (int) $opts['user_id'] : null;
    $type    = (string) ($opts['type'] ?? 'generic');

    if ($text === '' && $html !== '') {
        $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    /* Guard: valid recipient + non-empty subject. */
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL) || $subject === '') {
        logEmail($userId, $to, $subject, $type, 'skipped', 'invalid recipient or empty subject', 'none');
        return false;
    }

    $transport = mailerSmtpConfigured() ? 'smtp' : 'mail';

    try {
        $ok = $transport === 'smtp'
            ? smtpSend($to, $subject, $html, $text)
            : phpMailSend($to, $subject, $html, $text);
    } catch (\Throwable $e) {
        logEmail($userId, $to, $subject, $type, 'failed', $e->getMessage(), $transport);
        error_log("sendEmail [$type] to $to failed: " . $e->getMessage());
        return false;
    }

    logEmail($userId, $to, $subject, $type, $ok ? 'sent' : 'failed', $ok ? null : 'transport reported failure', $transport);
    return $ok;
}

/* ══════════════════════════════════════════════
   PHP mail() fallback
   ══════════════════════════════════════════════ */
function phpMailSend(string $to, string $subject, string $html, string $text): bool
{
    $fromEmail = env('MAIL_FROM', 'no-reply@' . ($_SERVER['SERVER_NAME'] ?? 'localhost'));
    $fromName  = env('MAIL_FROM_NAME', 'IT Guru Trading');
    $boundary  = 'b_' . bin2hex(random_bytes(12));

    $headers   = [
        'MIME-Version: 1.0',
        'From: ' . mailerEncodeHeader($fromName) . " <$fromEmail>",
        "Content-Type: multipart/alternative; boundary=\"$boundary\"",
    ];

    $body = mailerBuildMultipart($boundary, $text, $html);

    return @mail($to, mailerEncodeHeader($subject), $body, implode("\r\n", $headers));
}

/* ══════════════════════════════════════════════
   Raw SMTP client
   ══════════════════════════════════════════════ */
function smtpSend(string $to, string $subject, string $html, string $text): bool
{
    $host   = env('SMTP_HOST');
    $port   = (int) (env('SMTP_PORT', '587'));
    $user   = env('SMTP_USER');
    $pass   = env('SMTP_PASS');
    $secure = strtolower(env('SMTP_SECURE', $port === 465 ? 'ssl' : 'tls')); // ssl | tls | none
    $fromEmail = env('MAIL_FROM');
    $fromName   = env('MAIL_FROM_NAME', 'IT Guru Trading');
    $timeout    = (int) (env('SMTP_TIMEOUT', '15'));

    $transportHost = ($secure === 'ssl') ? "ssl://$host" : $host;

    $ctx = stream_context_create([
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false],
    ]);

    $fp = @stream_socket_client(
        "$transportHost:$port",
        $errno,
        $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT,
        $ctx
    );
    if (!$fp) {
        throw new RuntimeException("SMTP connect failed: $errstr ($errno)");
    }
    stream_set_timeout($fp, $timeout);

    $expect = function (int $code) use ($fp): string {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            /* Multi-line replies: 4th char is '-' for continuation, ' ' for the last line. */
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        $actual = (int) substr($data, 0, 3);
        if ($actual !== $code) {
            throw new RuntimeException("SMTP expected $code, got: " . trim($data));
        }
        return $data;
    };

    $send = function (string $cmd) use ($fp): void {
        fwrite($fp, $cmd . "\r\n");
    };

    try {
        $expect(220);
        $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
        $send("EHLO $ehloHost");
        $expect(250);

        /* STARTTLS upgrade for plaintext ports (e.g. 587). */
        if ($secure === 'tls') {
            $send('STARTTLS');
            $expect(220);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('STARTTLS negotiation failed');
            }
            $send("EHLO $ehloHost");
            $expect(250);
        }

        /* AUTH LOGIN when credentials are supplied. */
        if ($user !== '') {
            $send('AUTH LOGIN');
            $expect(334);
            $send(base64_encode($user));
            $expect(334);
            $send(base64_encode($pass));
            $expect(235);
        }

        $send("MAIL FROM:<$fromEmail>");
        $expect(250);
        $send("RCPT TO:<$to>");
        /* 250 = accepted, 251 = will forward */
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        $rcptCode = (int) substr($data, 0, 3);
        if ($rcptCode !== 250 && $rcptCode !== 251) {
            throw new RuntimeException('SMTP RCPT rejected: ' . trim($data));
        }

        $send('DATA');
        $expect(354);

        $boundary = 'b_' . bin2hex(random_bytes(12));
        $headers  = [
            'Date: ' . date('r'),
            'From: ' . mailerEncodeHeader($fromName) . " <$fromEmail>",
            'To: <' . $to . '>',
            'Subject: ' . mailerEncodeHeader($subject),
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . ($ehloHost) . '>',
            'MIME-Version: 1.0',
            "Content-Type: multipart/alternative; boundary=\"$boundary\"",
        ];
        $message = implode("\r\n", $headers) . "\r\n\r\n"
            . mailerBuildMultipart($boundary, $text, $html);

        /* Dot-stuffing: any line starting with '.' must be doubled. */
        $message = preg_replace('/^\./m', '..', $message);
        $send($message);
        $send('.');
        $expect(250);

        $send('QUIT');
    } finally {
        fclose($fp);
    }

    return true;
}

/* ══════════════════════════════════════════════
   Shared helpers
   ══════════════════════════════════════════════ */

/** RFC 2047 encode a header value that may contain non-ASCII characters. */
function mailerEncodeHeader(string $value): string
{
    if (preg_match('/^[\x20-\x7E]*$/', $value)) {
        return $value; // pure ASCII — no encoding needed
    }
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

/** Build a multipart/alternative body (plain text + HTML). */
function mailerBuildMultipart(string $boundary, string $text, string $html): string
{
    $parts = [];
    $parts[] = "--$boundary";
    $parts[] = 'Content-Type: text/plain; charset=UTF-8';
    $parts[] = 'Content-Transfer-Encoding: base64';
    $parts[] = '';
    $parts[] = chunk_split(base64_encode($text !== '' ? $text : ' '));

    if ($html !== '') {
        $parts[] = "--$boundary";
        $parts[] = 'Content-Type: text/html; charset=UTF-8';
        $parts[] = 'Content-Transfer-Encoding: base64';
        $parts[] = '';
        $parts[] = chunk_split(base64_encode($html));
    }

    $parts[] = "--$boundary--";
    $parts[] = '';

    return implode("\r\n", $parts);
}
