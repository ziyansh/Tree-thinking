#!/bin/sh
# 树状对话画布 - macOS / Linux 一键启动
# 用法：bash start.sh（或先 chmod +x start.sh 再 ./start.sh）

set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"
LOG_DIR="$ROOT_DIR/.runtime"
BACKEND_PID=""
FRONTEND_PID=""

echo "========================================"
echo "  树状对话 - 一键启动（后端 + 前端）"
echo "========================================"
echo

# 结束进程树：先递归结束子进程（npm -> vite、uvicorn reloader -> worker），再结束父进程
kill_tree() {
  pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  if [ -n "$BACKEND_PID" ] || [ -n "$FRONTEND_PID" ]; then
    echo
    echo "正在停止服务 ..."
    [ -n "$FRONTEND_PID" ] && kill_tree "$FRONTEND_PID"
    [ -n "$BACKEND_PID" ] && kill_tree "$BACKEND_PID"
    wait 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' HUP INT TERM

# ---------- 0. 基础命令检查 ----------
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未找到 node / npm，请先安装 Node.js 18+：https://nodejs.org/"
  exit 1
fi

# ---------- 1. 后端虚拟环境 ----------
if [ ! -x "$PYTHON_BIN" ]; then
  if command -v python3 >/dev/null 2>&1; then
    BASE_PYTHON=python3
  elif command -v python >/dev/null 2>&1; then
    BASE_PYTHON=python
  else
    echo "[错误] 未找到 python3 / python，请先安装 Python 3.10+：https://www.python.org/downloads/"
    exit 1
  fi

  echo "[1/5] 未找到后端虚拟环境，正在创建 backend/.venv ..."
  "$BASE_PYTHON" -m venv "$VENV_DIR" || {
    echo "[错误] 创建虚拟环境失败。"
    exit 1
  }
  echo "      正在安装后端依赖，请稍候 ..."
  "$PYTHON_BIN" -m pip install -q -r "$BACKEND_DIR/requirements.txt" || {
    echo "[错误] 后端依赖安装失败，请检查网络后重试："
    echo "      $PYTHON_BIN -m pip install -r backend/requirements.txt"
    exit 1
  }
else
  echo "[1/5] 后端虚拟环境已就绪"
fi

# ---------- 2. 前端依赖 ----------
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "[2/5] 未找到前端依赖，正在执行 npm install ..."
  npm --prefix "$FRONTEND_DIR" install || {
    echo "[错误] 前端依赖安装失败，请检查 Node.js 与网络后重试。"
    exit 1
  }
else
  echo "[2/5] 前端依赖已就绪"
fi

# ---------- 3. 默认配置 ----------
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "[3/5] 未找到 backend/.env，已从 .env.example 复制默认配置"
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
else
  echo "[3/5] 配置文件 backend/.env 已就绪"
fi

# ---------- 4. 端口检查 ----------
check_port() {
  port=$1
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[错误] 端口 $port 已被占用，请先停止占用进程后重试。"
      exit 1
    fi
  fi
}

check_port 8000
check_port 5173
echo "[4/5] 端口 8000 / 5173 可用"

# ---------- 5. 启动服务 ----------
mkdir -p "$LOG_DIR"
echo "[5/5] 正在启动服务 ..."

# --reload-dir 只监听后端目录，避免 uvicorn 扫描 frontend/node_modules
"$PYTHON_BIN" -m uvicorn app.main:app \
  --app-dir "$BACKEND_DIR" \
  --reload --reload-dir "$BACKEND_DIR" \
  --port 8000 >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

npm --prefix "$FRONTEND_DIR" run dev >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# 等待服务就绪；进程提前退出或超时都直接失败并打印日志
wait_url() {
  url=$1
  name=$2
  port=$3
  i=0
  while [ "$i" -lt 60 ]; do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "$url" >/dev/null 2>&1 && return 0
    elif command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null || ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
      return 1
    fi
    i=$((i + 1))
    sleep 0.5
  done
  echo "[错误] 等待 $name 就绪超时，请查看日志：$LOG_DIR"
  return 1
}

if ! wait_url "http://127.0.0.1:8000/health" "后端" 8000; then
  tail -n 20 "$LOG_DIR/backend.log" 2>/dev/null
  exit 1
fi
if ! wait_url "http://localhost:5173" "前端" 5173; then
  tail -n 20 "$LOG_DIR/frontend.log" 2>/dev/null
  exit 1
fi

echo
echo "后端： http://127.0.0.1:8000  （健康检查 /health）"
echo "前端： http://localhost:5173"
echo "日志： $LOG_DIR/backend.log  |  $LOG_DIR/frontend.log"
echo "首次使用：在页面左下角「设置」中填写 API Key，保存后立即生效。"
echo "按 Ctrl+C 停止两个服务。"
echo

if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173" >/dev/null 2>&1 &
fi

wait
