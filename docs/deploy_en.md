# Server Deployment Guide

This guide explains how to deploy Tree Thinking to a Linux server for multi-user online use. Examples assume Ubuntu 22.04 / Debian 12, a repository at `/opt/tree-thinking`, a service user named `tree`, and the domain `tree.example.com` — replace them with your own values.

## 1. Deployment Modes: Local vs. Server

| Mode | Configuration | Use case | Accounts |
| --- | --- | --- | --- |
| Local | `APP_MODE=local` | Personal use on your own machine; one command starts both services | No sign-in, single user |
| Server | `APP_MODE=server` | Hosted on a server for several people online | Register / sign in; data isolated per account |

- Local mode binds to `127.0.0.1` by default and should not be exposed to the internet.
- Server mode must run behind HTTPS (see section 7); otherwise the sign-in cookie cannot be issued securely.
- Both modes share the same database schema. Switching modes does not migrate data; existing local data still belongs to its original anonymous workspace.

## 2. Server Requirements

- OS: Ubuntu 22.04+ or Debian 12+
- Python 3.11+
- Node.js 20+ (needed only to build the frontend; Node can be removed afterwards)
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
sudo -u tree git clone <repository-url> /opt/tree-thinking

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

# Model service
DEEPSEEK_API_KEY=sk-your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
# Volcengine Ark (optional; in-app Settings take precedence; key encrypted at rest)
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2-1-pro-260915
THINKING_ENABLED=true
SUGGESTION_COUNT=3
```

Variable reference:

| Variable | Required | Description |
| --- | --- | --- |
| `APP_MODE` | Yes | `local` (default) or `server`; `server` enables multi-user accounts and sign-in |
| `AUTH_SECRET` | Required in `server` | Signing secret for sessions and encryption of saved model keys; use a strong random string. Startup fails when missing. Changing it invalidates all sessions and makes stored API keys undecryptable, so they must be re-entered in Settings |
| `AUTH_COOKIE_SECURE` | Recommended `true` | Sends the session cookie over HTTPS only; set `false` only for plain-HTTP local debugging |
| `DB_PATH` | No | SQLite file path, default `backend/data/app.db`; relative paths resolve against the repository root |
| `UPLOAD_DIR` | No | Attachment directory, default `backend/data/uploads` |
| `ALLOWED_ORIGINS` | No | Additional allowed origins, comma-separated |
| `DEEPSEEK_API_KEY` | No | DeepSeek key; can also be set in the in-app Settings. Empty means answers fail |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | No | API base URL and model name |
| `ARK_API_KEY` | No | Volcengine Ark key, optional; in-app Settings take precedence and it is stored encrypted |
| `ARK_BASE_URL` / `ARK_MODEL` | No | Ark base URL and model name, defaulting to `https://ark.cn-beijing.volces.com/api/v3` / `doubao-seed-2-1-pro-260915` |
| `THINKING_ENABLED` / `SUGGESTION_COUNT` | No | Default thinking mode and suggestion count |

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
- Usernames are 3–32 characters; passwords are 8–72 characters.
- Self-service password recovery is not supported yet; a server administrator must handle it.
- Each account only sees its own canvases, attachments, and settings; data is isolated per account.
- Model API keys are encrypted at rest in the backend database. The API only returns a masked value (e.g. `sk-••••7890`) and never ships the key to the browser.

### 7.1 Outbound network and data egress

- The server must be allowed to reach `https://api.deepseek.com` and `https://ark.cn-beijing.volces.com` over HTTPS; otherwise answers, document parsing, and web search fail for that provider.
- Document parsing: uploading PDF, DOC/DOCX, or PPT/PPTX sends the file to the DeepSeek Files API. The returned `fileId` is bound to the current API key / DeepSeek account; after changing the key or migrating accounts, old documents may stop working and must be re-uploaded.
- Volcengine Ark files: with Ark, images / video / audio / PDF are uploaded to the Ark Files API (`purpose=user_data`). Files are kept on the Ark side for 7 days by default (configurable 1–30 days). `fileId` values are bound to the API key / account; after changing the key or migrating accounts, old files may stop working and must be re-uploaded.
- Cost note: video, audio, and PDF content counts toward model tokens, so larger page counts or longer media cost more; a PDF beyond 30 pages triggers the in-app warning “pdf页数过多，费用可能失控”.
- Smart search and link reading: the question text, search results, and user-provided link content are processed by DeepSeek. Link reading only recognizes URLs in the last user message.
- If the environment forbids data egress, disable web search in Settings and avoid uploading documents that need parsing; text/image attachments and local canvas data still work.
- A parsing failure only keeps that document out of the model context; the attachment is still saved. Check backend logs for the reason.

## 8. Backup and Restore

Only two things need backing up: the SQLite database file and the `uploads` directory.

### 8.1 Manual Backup

```bash
sudo mkdir -p /var/backups/tree-thinking
# Safe online backup (no downtime; avoids copying a database mid-write)
sudo sqlite3 /var/lib/tree-thinking/app.db ".backup '/var/backups/tree-thinking/app.db'"
# Archive the upload directory
sudo tar czf /var/backups/tree-thinking/uploads-$(date +%F).tar.gz -C /var/lib/tree-thinking uploads
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
- Schema changes are applied automatically on backend startup, including the `note_links` table and related columns added in v0.3.x and the `ark_api_key` / `ark_base_url` / `ark_model` settings columns added in v0.3.8; always back up the database before upgrading.
- If you use document parsing, old `fileId` values remain valid only while the API key / DeepSeek account is unchanged; re-upload documents after changing the key.

## 10. Troubleshooting

**The API returns 401**

- Not signed in, or the session expired: sign in again.
- `AUTH_SECRET` was changed: all previous sessions become invalid; sign in again.
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
