# Server Deployment Guide

This guide explains how to deploy Tree Thinking to a Linux server for multi-user online use. Examples assume Ubuntu 22.04 / Debian 12, a repository at `/opt/tree-thinking`, a service user named `tree`, and the domain `tree.example.com` — replace them with your own values.

## 1. Deployment Modes: Local vs. Server

| Mode | Configuration | Use case | Accounts |
| --- | --- | --- | --- |
| Local | `APP_MODE=local` | Personal use on your own machine; one command starts both services | No sign-in, single user |
| Server | `APP_MODE=server` | Hosted on a server for several people online | Register / sign in; data isolated per account |

- Local mode binds to `127.0.0.1` by default and should not be exposed to the internet.
- Server mode must run behind HTTPS (see section 6); otherwise the sign-in cookie cannot be issued securely.
- Both modes share the same database schema. Switching modes does not migrate data; existing local data still belongs to its original anonymous workspace.

## 2. Server Requirements

- OS: Ubuntu 22.04+ or Debian 12+
- Python 3.10+
- Node.js 20.19+ (needed only to build the frontend; Node can be removed afterwards)
- Nginx 1.18+
- 2 vCPU / 2 GB RAM or more recommended; size storage for attachments and the database as needed

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx git sqlite3
# Install Node.js 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Create the service user and the data directory (keep the database and uploads outside the repository):

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin tree
sudo mkdir -p /var/lib/tree-thinking/uploads
sudo chown -R tree:tree /var/lib/tree-thinking
```

## 3. Backend Deployment

### 3.1 Code and Virtualenv

```bash
sudo mkdir -p /opt/tree-thinking
sudo chown tree:tree /opt/tree-thinking
sudo -u tree git clone https://github.com/ziyansh/Tree-thinking.git /opt/tree-thinking

sudo -u tree python3 -m venv /opt/tree-thinking/backend/.venv
sudo -u tree /opt/tree-thinking/backend/.venv/bin/pip install --upgrade pip
sudo -u tree /opt/tree-thinking/backend/.venv/bin/pip install -r /opt/tree-thinking/backend/requirements.txt
```

### 3.2 Environment Variables

The configuration file is `backend/.env`; set mode `600` and owner `tree`. systemd reads it through `EnvironmentFile`, so do not use `export` or quotes inside it.

```bash
# Generate a strong random secret (AUTH_SECRET is required)
openssl rand -hex 32
```

Example `/opt/tree-thinking/backend/.env`:

```bash
APP_MODE=server
# Strong random secret used to sign session credentials; required. Changing it invalidates all sessions.
AUTH_SECRET=paste-the-random-string-here
# Must be true in server mode (the site serves HTTPS)
AUTH_COOKIE_SECURE=true
# SQLite database file (absolute path)
DB_PATH=/var/lib/tree-thinking/app.db
# Attachment upload directory (absolute path)
UPLOAD_DIR=/var/lib/tree-thinking/uploads
# Extra origins allowed to call the API directly; unnecessary when same-origin through Nginx
ALLOWED_ORIGINS=https://tree.example.com

# Do not configure model keys here: in server mode every account enters its own key in Settings.
# DEEPSEEK_API_KEY / OPENAI_API_KEY / ARK_API_KEY, THINKING_ENABLED, and SUGGESTION_COUNT
# only take effect in local mode.
```

Variable reference:

| Variable | Required | Description |
| --- | --- | --- |
| `APP_MODE` | Yes | `local` (default) or `server`; `server` enables multi-user accounts and sign-in |
| `AUTH_SECRET` | Required in `server` | Signing secret for sessions and encryption of saved model keys; use a strong random string. Startup fails when missing. Changing it invalidates all sessions and makes stored API keys undecryptable, so they must be re-entered in Settings |
| `AUTH_COOKIE_SECURE` | Defaults to `true` | Sends the session cookie over HTTPS only; set `false` only for plain-HTTP local debugging |
| `DB_PATH` | No | SQLite file path, default `backend/data/app.db`; relative paths resolve against the repository root |
| `UPLOAD_DIR` | No | Attachment directory, default `backend/data/uploads` |
| `ALLOWED_ORIGINS` | No | Additional allowed origins, comma-separated |
| `DEEPSEEK_*` / `OPENAI_*` / `ARK_*` / `THINKING_ENABLED` / `SUGGESTION_COUNT` | No | **Local mode only**; server mode ignores these values, and each account configures its own keys and model parameters in Settings |

```bash
sudo chown tree:tree /opt/tree-thinking/backend/.env
sudo chmod 600 /opt/tree-thinking/backend/.env
```

### 3.3 systemd Service

Create `/etc/systemd/system/tree-thinking.service`:

```ini
[Unit]
Description=Tree Thinking backend
After=network.target

[Service]
Type=simple
User=tree
Group=tree
WorkingDirectory=/opt/tree-thinking/backend
EnvironmentFile=/opt/tree-thinking/backend/.env
ExecStart=/opt/tree-thinking/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tree-thinking
sudo systemctl status tree-thinking
curl http://127.0.0.1:8000/health   # expects {"status":"ok"}
```

> The backend listens on `127.0.0.1` only; Nginx exposes it. SQLite may briefly wait on a lock when several workers write at the same time — if the log shows `database is locked`, set `--workers` to 1.

## 4. Frontend Build

```bash
cd /opt/tree-thinking/frontend
sudo -u tree npm ci
sudo -u tree npm run build
```

The output is `frontend/dist` (static files served directly by Nginx). Build it once per release or upgrade; no Node process needs to stay running.

## 5. Nginx Reverse Proxy

Create `/etc/nginx/sites-available/tree-thinking`:

```nginx
server {
    listen 80;
    server_name tree.example.com;

    root /opt/tree-thinking/frontend/dist;
    index index.html;

    # Maximum attachment upload size
    client_max_body_size 25m;

    # Single-page app: fall back to index.html when a file is missing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Streaming (SSE) answers must not be buffered
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Health check
    location = /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and reload:

```bash
sudo ln -s /etc/nginx/sites-available/tree-thinking /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

The frontend and backend are reached through the same origin (`/api` is proxied), so the browser never runs into cross-origin issues.

## 6. HTTPS

Server mode requires HTTPS: with `AUTH_COOKIE_SECURE=true` the session cookie is only sent over HTTPS, so plain HTTP makes users appear logged out right after signing in.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tree.example.com
```

certbot rewrites the Nginx configuration and enables the HTTP → HTTPS redirect. Verify automatic renewal:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 7. Multi-user Notes

- In server mode the first visit requires registration, then sign-in; local mode has no accounts.
- Usernames are 3–32 letters, digits, or underscores and must be unique; passwords are 4–12 characters. The registration form validates on blur and shows the reason below each field; the server still performs the final validation on submit.
- Self-service password recovery is not supported yet; a server administrator must handle it.
- Each account only sees its own canvases, attachments, and settings; data is isolated per account.
- Every new account starts with an independently initialized settings row: all defaults and **no API key**. Server mode never inherits model keys from `backend/.env`.
- Model API keys are encrypted at rest in the backend database. The API only returns a masked value (e.g. `sk-••••7890`), never ships the key to the browser, and never writes it to browser storage.
- The session cookie is named `tt_session_server` (HttpOnly, SameSite=Lax). Local mode never reads it, so running a local instance and an online instance on the same machine cannot share a login session.
- The “Restore defaults” button at the bottom-left of the settings dialog resets every setting, keeps saved keys, and only affects the current account.

### 7.1 Outbound network and data egress

- The server must be allowed to reach `https://api.deepseek.com` and `https://ark.cn-beijing.volces.com` over HTTPS; otherwise answers, document parsing, and web search fail for that provider.
- When using an OpenAI-compatible provider, also allow outbound access to the base URL configured in Settings (for example, `https://api.openai.com`).
- Document parsing (DeepSeek): when using DeepSeek, uploading a PDF, DOC/DOCX, or PPT/PPTX sends the file to the DeepSeek Files API. The returned `fileId` is bound to the current API key / DeepSeek account; after changing the key or migrating accounts, old documents may stop working and must be re-uploaded.
- Volcengine Ark files: with Ark, images / video / audio / PDF are uploaded to the Ark Files API (`purpose=user_data`). Files are kept on the Ark side for 7 days by default (configurable 1–30 days). `fileId` values are bound to the API key / account; after changing the key or migrating accounts, old files may stop working and must be re-uploaded.
- Cost note: video, audio, and PDF content counts toward model tokens, so larger page counts or longer media cost more; a PDF beyond 30 pages triggers the in-app warning “pdf页数过多，费用可能失控”.
- Smart search and link reading: question text and search results are processed by the selected provider (DeepSeek / Volcengine Ark); DeepSeek link reading only recognizes URLs in the last user message.
- Never sent: other accounts' canvases, attachments, settings, or API keys; keys and configuration of providers that are not selected (for example, a DeepSeek answer never sends the OpenAI or Ark key); browser storage never contains plaintext keys or settings.
- If the environment forbids data egress, disable web search in Settings and avoid uploading documents that need parsing; text/image attachments and local canvas data still work.
- A parsing failure only keeps that document out of the model context; the attachment is still saved. Check backend logs for the reason.

## 8. Backup and Restore

Back up three things: the SQLite database, the `uploads` directory, and `backend/.env` (at minimum keep `AUTH_SECRET`; if it is lost or changed, saved model API keys can no longer be decrypted).

### 8.1 Manual Backup

```bash
sudo mkdir -p /var/backups/tree-thinking
# Safe online backup (no downtime; avoids copying a database mid-write)
sudo sqlite3 /var/lib/tree-thinking/app.db ".backup '/var/backups/tree-thinking/app.db'"
# Archive the upload directory
sudo tar czf /var/backups/tree-thinking/uploads-$(date +%F).tar.gz -C /var/lib/tree-thinking uploads
# Back up environment variables (contains AUTH_SECRET, required to decrypt saved keys after a rebuild)
sudo cp /opt/tree-thinking/backend/.env /var/backups/tree-thinking/env-$(date +%F).bak
```

### 8.2 Scheduled Backup

Create `/usr/local/bin/tree-thinking-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DEST=/var/backups/tree-thinking
mkdir -p "$DEST"
sqlite3 /var/lib/tree-thinking/app.db ".backup '$DEST/app-$STAMP.db'"
tar czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/tree-thinking uploads
cp /opt/tree-thinking/backend/.env "$DEST/env-$STAMP.bak"
# Keep the last 14 days only
find "$DEST" -type f -mtime +14 -delete
```

```bash
sudo chmod +x /usr/local/bin/tree-thinking-backup.sh
# Run daily at 03:30
echo '30 3 * * * root /usr/local/bin/tree-thinking-backup.sh >> /var/log/tree-thinking-backup.log 2>&1' | sudo tee /etc/cron.d/tree-thinking-backup
```

### 8.3 Restore

```bash
sudo systemctl stop tree-thinking
# After a rebuild, restore .env first (AUTH_SECRET must match the backup or old API keys cannot be decrypted)
sudo cp /var/backups/tree-thinking/env-2026-11-15.bak /opt/tree-thinking/backend/.env
sudo chown tree:tree /opt/tree-thinking/backend/.env
sudo chmod 600 /opt/tree-thinking/backend/.env
sudo cp /var/backups/tree-thinking/app-2026-11-15.db /var/lib/tree-thinking/app.db
sudo tar xzf /var/backups/tree-thinking/uploads-2026-11-15.tar.gz -C /var/lib/tree-thinking
sudo chown -R tree:tree /var/lib/tree-thinking
sudo systemctl start tree-thinking
```

## 9. Upgrade Procedure

Back up first, then:

```bash
sudo systemctl stop tree-thinking

sudo -u tree git -C /opt/tree-thinking pull
sudo -u tree /opt/tree-thinking/backend/.venv/bin/pip install -r /opt/tree-thinking/backend/requirements.txt

cd /opt/tree-thinking/frontend
sudo -u tree npm ci
sudo -u tree npm run build

sudo systemctl start tree-thinking
sudo systemctl status tree-thinking
```

- `backend/.env` is not tracked, so `git pull` never overwrites it; add any new variables manually.
- Nginx reads static files from disk, so a browser refresh picks up the new build without reloading Nginx.
- Upgrading from 0.3.11 or earlier to 0.3.12+: the session cookie is renamed to `tt_session_server`, so existing sessions become invalid and every user must sign in once.
- Schema changes are applied automatically on backend startup, including the `note_links` table and related columns added in v0.3.x and the `ark_api_key` / `ark_base_url` / `ark_model` settings columns added in v0.3.8; always back up the database before upgrading.
- If you use document parsing, old `fileId` values remain valid only while the API key / DeepSeek account is unchanged; re-upload documents after changing the key.

## 10. Troubleshooting

**The API returns 401**

- Not signed in, or the session expired: sign in again.
- `AUTH_SECRET` was changed: all previous sessions become invalid; sign in again.
- Upgrading from 0.3.11 or earlier: the session cookie is renamed to `tt_session_server`, so the old cookie is ignored; sign in again.
- The browser is not sending the cookie: check HTTPS access and that the domain matches `server_name`.

**Sign-in succeeds but a refresh logs the user out (cookie not applied)**

- Server mode requires HTTPS with `AUTH_COOKIE_SECURE=true`; plain HTTP drops the cookie.
- Check that Nginx forwards `X-Forwarded-Proto`.
- Make sure the frontend and API share one origin (same domain, `/api` proxied).

**Browser reports a cross-origin (CORS) error**

- Same-origin deployment (static files plus `/api` proxy) is recommended and needs no extra configuration.
- If the frontend and backend live on different domains, list the full origin in `ALLOWED_ORIGINS` (including `https://`, without a path) and send requests with credentials.

**Port 8000 is already in use**

```bash
sudo ss -lntp | grep :8000
```

Change `--port` in the systemd unit and update `proxy_pass` in Nginx accordingly.

**Startup fails because `AUTH_SECRET` is missing**

Server mode requires a strong random `AUTH_SECRET` in `backend/.env`:

```bash
openssl rand -hex 32
sudo systemctl restart tree-thinking
```

**Attachment upload returns 413**

Increase `client_max_body_size` in Nginx, then `sudo systemctl reload nginx`.

**PDF / Office content is not read by the model**

- Verify that the server can reach `api.deepseek.com` and `ark.cn-beijing.volces.com`, and that the active provider (DeepSeek or Volcengine Ark) has a configured API key.
- When parsing fails the attachment is still saved but stays out of context; check backend logs for the parsing error.
- After changing the API key or account, re-upload attachments that need parsing (Ark files are kept for 7 days by default).

**After changing AUTH_SECRET, model calls report an invalid key or ask for the key again**

- `AUTH_SECRET` also encrypts saved model API keys. After changing it, old ciphertext cannot be decrypted; re-enter the API key in Settings.
