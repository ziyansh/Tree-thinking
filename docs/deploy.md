# 服务器部署指南

本文说明如何把「树状对话画布」部署到一台 Linux 服务器，供多人在线使用。文中以 Ubuntu 22.04 / Debian 12 为例，示例路径假定仓库位于 `/opt/tree-thinking`、服务运行用户为 `tree`、域名为 `tree.example.com`，请按实际情况替换。

## 1. 部署形态：本地与服务器

| 模式 | 配置 | 适用场景 | 账号 |
| --- | --- | --- | --- |
| 本地模式 | `APP_MODE=local` | 个人在本机使用，一条命令启动前后端 | 无需登录，不区分用户 |
| 服务器模式 | `APP_MODE=server` | 部署在服务器上，多人同时在线使用 | 需要注册 / 登录，数据按账号隔离 |

- 本地模式默认只监听 `127.0.0.1`，不应对公网开放。
- 服务器模式必须配合 HTTPS（见第 7 节），否则登录 Cookie 无法安全下发。
- 两种模式共用同一套数据库结构；切换模式不迁移数据，本地数据仍属于原来的匿名空间。

## 2. 服务器要求

- 操作系统：Ubuntu 22.04+ 或 Debian 12+
- Python 3.11+
- Node.js 20+（仅构建前端时需要，构建完成后服务器可不保留 Node）
- Nginx 1.18+
- 建议 2 vCPU / 2 GB 内存以上；附件与数据库占用的磁盘按实际使用量预留

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx git sqlite3
# 安装 Node.js 20（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

创建运行用户与数据目录（数据库与上传文件不放在代码仓库里）：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin tree
sudo mkdir -p /var/lib/tree-thinking/uploads
sudo chown -R tree:tree /var/lib/tree-thinking
```

## 3. 后端部署

### 3.1 拉取代码与虚拟环境

```bash
sudo mkdir -p /opt/tree-thinking
sudo chown tree:tree /opt/tree-thinking
sudo -u tree git clone <仓库地址> /opt/tree-thinking

sudo -u tree python3 -m venv /opt/tree-thinking/backend/.venv
sudo -u tree /opt/tree-thinking/backend/.venv/bin/pip install --upgrade pip
sudo -u tree /opt/tree-thinking/backend/.venv/bin/pip install -r /opt/tree-thinking/backend/requirements.txt
```

### 3.2 环境变量

配置文件为 `backend/.env`，权限建议 `600` 且属主为 `tree`。启动时由 systemd 通过 `EnvironmentFile` 读取，不要在这里写 `export` 或引号。

```bash
# 生成强随机密钥（AUTH_SECRET 必填）
openssl rand -hex 32
```

`/opt/tree-thinking/backend/.env` 示例：

```bash
APP_MODE=server
# 用于签发登录凭证的强随机密钥，必填；变更后所有已登录会话失效
AUTH_SECRET=把上面命令输出的随机串粘贴到这里
# 服务器模式必须为 true（站点已启用 HTTPS）
AUTH_COOKIE_SECURE=true
# SQLite 数据库文件（绝对路径）
DB_PATH=/var/lib/tree-thinking/app.db
# 附件上传目录（绝对路径）
UPLOAD_DIR=/var/lib/tree-thinking/uploads
# 允许直接跨域访问后端的来源；同域经 Nginx 反代时可不配置
ALLOWED_ORIGINS=https://tree.example.com

# 模型服务
DEEPSEEK_API_KEY=sk-你的Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
THINKING_ENABLED=true
SUGGESTION_COUNT=3
```

变量说明：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APP_MODE` | 是 | `local`（默认）或 `server`；`server` 开启多用户与登录 |
| `AUTH_SECRET` | `server` 必填 | 登录凭证签名与模型 Key 加密密钥，使用强随机串；缺失时服务启动失败。变更后所有会话失效，且已保存的模型 API Key 无法解密，需要在页面「设置」中重新填写 |
| `AUTH_COOKIE_SECURE` | 建议 `true` | 仅通过 HTTPS 下发登录 Cookie；本地 HTTP 调试时可设为 `false` |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `backend/data/app.db`；相对路径按仓库根目录解析 |
| `UPLOAD_DIR` | 否 | 附件目录，默认 `backend/data/uploads` |
| `ALLOWED_ORIGINS` | 否 | 额外允许的跨域来源，多个用逗号分隔 |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek Key，也可在页面「设置」中填写；留空则回答报错 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 否 | 接口地址与模型名 |
| `THINKING_ENABLED` / `SUGGESTION_COUNT` | 否 | 思考模式与候选方向数量默认值 |

```bash
sudo chown tree:tree /opt/tree-thinking/backend/.env
sudo chmod 600 /opt/tree-thinking/backend/.env
```

### 3.3 systemd 服务

新建 `/etc/systemd/system/tree-thinking.service`：

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
curl http://127.0.0.1:8000/health   # 期望返回 {"status":"ok"}
```

> 后端只监听 `127.0.0.1`，由 Nginx 对外提供访问。SQLite 在多个 worker 同时写入时可能出现短暂的锁等待，如果日志中出现 `database is locked`，把 `--workers` 改为 1。

## 4. 前端构建

```bash
cd /opt/tree-thinking/frontend
sudo -u tree npm ci
sudo -u tree npm run build
```

产物为 `frontend/dist`（静态文件，由 Nginx 直接托管）。构建只需在发布或升级时执行一次，服务器不必常驻 Node 进程。

## 5. Nginx 反向代理

新建 `/etc/nginx/sites-available/tree-thinking`：

```nginx
server {
    listen 80;
    server_name tree.example.com;

    root /opt/tree-thinking/frontend/dist;
    index index.html;

    # 附件上传大小上限
    client_max_body_size 25m;

    # 前端单页应用：找不到文件时回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE 流式回答不应被缓冲
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # 健康检查
    location = /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用站点并重载：

```bash
sudo ln -s /etc/nginx/sites-available/tree-thinking /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

前端与后端对外是同一个域名同源访问（`/api` 走反代），因此浏览器不会产生跨域问题。

## 6. HTTPS

服务器模式必须使用 HTTPS：`AUTH_COOKIE_SECURE=true` 时登录 Cookie 只在 HTTPS 下发送，纯 HTTP 会导致登录后立刻变回未登录。

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tree.example.com
```

certbot 会自动改写 Nginx 配置并启用 HTTP → HTTPS 跳转。确认自动续期：

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 7. 多用户说明

- 服务器模式下首次访问需要注册账号，之后登录使用；本地模式没有账号概念。
- 用户名长度 3–32 个字符，密码长度 8–72 个字符。
- 忘记密码暂不支持自助找回，需要通过服务管理员处理。
- 每个账号只能看到自己的画布、附件与设置，数据按账号隔离。
- 模型 API Key 加密存储在后端数据库中，接口只返回脱敏值（如 `sk-••••7890`），不会下发到浏览器。

### 7.1 出站网络与数据外发

- 服务器需要允许访问 `https://api.deepseek.com`（HTTPS 出站），否则回答、文件解析与联网搜索都会失败。
- 文件解析：上传 PDF、DOC/DOCX、PPT/PPTX 时，后端会把文件上传到 DeepSeek Files API 进行解析。`fileId` 与当前 API Key / DeepSeek 账号绑定，更换 Key 或迁移账号后旧文档可能失效，需要重新上传。
- 智能搜索与读取链接：问题文本、搜索结果、用户提供的链接内容由 DeepSeek 服务端处理。读取链接只识别最后一条用户消息中的 URL。
- 如果部署环境不允许数据外发，请在页面设置中关闭联网搜索，并避免上传需要解析的文档；普通文本/图片附件与本地画布数据仍可正常使用。
- 文件解析失败只会让该文档不进入模型上下文，附件本身仍会保存，可在后端日志中查看原因。

## 8. 数据备份与恢复

需要备份的内容只有两处：SQLite 数据库文件与 `uploads` 上传目录。

### 8.1 手动备份

```bash
sudo mkdir -p /var/backups/tree-thinking
# 在线安全备份（不需要停服，避免直接 cp 正在写入的数据库）
sudo sqlite3 /var/lib/tree-thinking/app.db ".backup '/var/backups/tree-thinking/app.db'"
# 打包上传目录
sudo tar czf /var/backups/tree-thinking/uploads-$(date +%F).tar.gz -C /var/lib/tree-thinking uploads
```

### 8.2 定时备份

新建 `/usr/local/bin/tree-thinking-backup.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DEST=/var/backups/tree-thinking
mkdir -p "$DEST"
sqlite3 /var/lib/tree-thinking/app.db ".backup '$DEST/app-$STAMP.db'"
tar czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/tree-thinking uploads
# 只保留最近 14 天
find "$DEST" -type f -mtime +14 -delete
```

```bash
sudo chmod +x /usr/local/bin/tree-thinking-backup.sh
# 每天 03:30 执行
echo '30 3 * * * root /usr/local/bin/tree-thinking-backup.sh >> /var/log/tree-thinking-backup.log 2>&1' | sudo tee /etc/cron.d/tree-thinking-backup
```

### 8.3 恢复

```bash
sudo systemctl stop tree-thinking
sudo cp /var/backups/tree-thinking/app-2026-11-15.db /var/lib/tree-thinking/app.db
sudo tar xzf /var/backups/tree-thinking/uploads-2026-11-15.tar.gz -C /var/lib/tree-thinking
sudo chown -R tree:tree /var/lib/tree-thinking
sudo systemctl start tree-thinking
```

## 9. 升级流程

升级前先做一次备份，然后：

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

- `backend/.env` 不在版本库中，`git pull` 不会覆盖，新增变量请手动补充。
- 静态文件由 Nginx 直接读取，重新构建后浏览器刷新即可生效，无需重载 Nginx。
- 数据结构变更由后端启动时自动处理（含 v0.3.x 新增的 `note_links` 表与相关列），升级前务必备份数据库。
- 如使用文件解析，旧文档的 `fileId` 仍有效的前提是 API Key / DeepSeek 账号未变；更换 Key 后请重新上传需要解析的文档。

## 10. 常见问题

**接口返回 401**

- 未登录或登录已过期：重新登录。
- 修改过 `AUTH_SECRET`：旧登录凭证一律失效，需要重新登录。
- 浏览器未携带 Cookie：检查是否通过 HTTPS 访问、域名是否与 `server_name` 一致。

**登录成功但刷新后又变成未登录（Cookie 不生效）**

- 服务器模式必须 HTTPS，且 `AUTH_COOKIE_SECURE=true`；用 HTTP 访问会丢失 Cookie。
- 检查 Nginx 是否传递了 `X-Forwarded-Proto`。
- 确认前端与 API 同域（都走同一个域名，`/api` 由反代转发）。

**浏览器报跨域（CORS）错误**

- 推荐同域部署（静态文件 + `/api` 反代），通常无需额外配置。
- 如果前后端分属不同域名，在 `ALLOWED_ORIGINS` 中填写完整来源（含 `https://`，不要写路径），并让前端请求携带凭证。

**端口被占用（8000）**

```bash
sudo ss -lntp | grep :8000
```

修改 systemd 中的 `--port` 后同步修改 Nginx 的 `proxy_pass`。

**启动失败并提示缺少 `AUTH_SECRET`**

服务器模式必须在 `backend/.env` 中提供强随机 `AUTH_SECRET`：

```bash
openssl rand -hex 32
sudo systemctl restart tree-thinking
```

**上传附件返回 413**

调大 Nginx 的 `client_max_body_size` 后 `sudo systemctl reload nginx`。

**PDF / Office 文档内容没有被模型读取**

- 确认服务器可访问 `api.deepseek.com`，服务商为 DeepSeek，且已配置 Key。
- 文件解析失败时附件仍会保存，但不会进入上下文；请查看后端日志中的解析错误。
- 更换 API Key / 账号后，旧附件需要重新上传解析。

**更换 AUTH_SECRET 后模型调用提示 Key 无效或需要重新填写**

- `AUTH_SECRET` 同时用于加密保存的模型 API Key；更换后旧密文无法解密，请在页面「设置」中重新填写 API Key。
