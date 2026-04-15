# Security Policy — Trading-Web

## 🔒 Credential Management

### Golden Rule
> **NEVER commit real database credentials, API secrets, or passwords to this repository.**

All secrets must live in **server-side environment variables** (`.env` file on your Hostinger server).
The `.env.example` file in this repo shows which variables your server needs — copy it to `.env`
on the server, fill in the real values, and ensure `.env` is listed in `.gitignore` (it already is).

### How the system works
| Layer | What it does | Where secrets live |
|-------|-------------|-------------------|
| **Client (this repo)** | HTML/CSS/JS served to browsers | No secrets — only the public Deriv `APP_ID` (120128) |
| **Server API** (`/api/auth/*`) | Authenticates users, talks to DB | `.env` on the server (DB creds, JWT secret) |
| **Database** | Stores user accounts | Accessed only by the server, never by the browser |

### Server `.env` checklist
- [ ] `DB_NAME`, `DB_USER`, `DB_PASSWORD` set to your real values
- [ ] `JWT_SECRET` set to a strong random string (≥ 64 characters)
- [ ] File permissions: `chmod 600 .env` (owner-read/write only)
- [ ] `.env` is **not** accessible via the web (Hostinger blocks `dotfiles` by default)

---

## 🛡️ Server Hardening (Hostinger)

### Database
- Use a **unique, strong password** (mix uppercase, lowercase, digits, symbols, 16+ chars).
- Restrict the DB user's privileges to only the tables/operations the app needs (`SELECT`, `INSERT`, `UPDATE` on the auth table — avoid `DROP`, `ALTER`, `GRANT`).
- Enable **Hostinger's remote MySQL access controls** — allow connections only from `localhost` (default) unless you specifically need remote access.

### PHP / Server-side API
- Use **prepared statements** (PDO or MySQLi with `?` placeholders) for every SQL query to prevent SQL injection.
- Validate and sanitize all user input on the server before using it.
- Set `display_errors = Off` and `log_errors = On` in production `php.ini`.
- Keep PHP and all server packages up-to-date.

### HTTPS & Headers
- Ensure the site is served over **HTTPS only** (Hostinger provides free SSL).
- Add these security headers in your server config or PHP entry point:
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; connect-src 'self' wss://ws.derivws.com https://trading.dsitservicesja.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;
  ```

### Authentication
- Hash passwords with **`password_hash()`** (bcrypt) on the server — never store plain-text passwords.
- Use **`password_verify()`** to check logins.
- Implement **rate limiting** on `/api/auth/login` to prevent brute-force attacks (e.g., max 5 attempts per minute per IP).
- Set short JWT expiry times (e.g., 1 hour) and use refresh tokens if needed.

---

## 🔑 Deriv API Token

The Deriv `APP_ID` (120128) is a **public** application identifier — it is safe to include in client-side code. However, individual users' **API tokens** (entered in the UI) should:
- Never be logged or stored on the server.
- Only be held in `sessionStorage` (cleared when the tab closes).
- Never be transmitted to any endpoint other than `wss://ws.derivws.com`.

---

## 📋 If You Suspect a Breach

1. **Immediately** change your database password via Hostinger hPanel.
2. Rotate the `JWT_SECRET` in your server `.env` (this invalidates all active sessions).
3. Review Hostinger access logs for suspicious activity.
4. If Deriv API tokens may have been exposed, revoke them in the Deriv dashboard.
5. Notify affected users to change their passwords.

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please open a **private** issue or contact the repository owner directly. Do not post credentials or vulnerability details in public issues.
