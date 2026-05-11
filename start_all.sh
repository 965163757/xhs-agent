#!/usr/bin/env bash
# 一键启动小红书创作助手：后端 (FastAPI) + 前端 (Vite)
# 用法：
#   ./start_all.sh              启动后端 + 前端
#   ./start_all.sh --with-mcp   额外起一个 MCP stdio 守护（仅用于本地调试，见下）
#   BACKEND_PORT=9000 FRONTEND_PORT=5180 ./start_all.sh
#
# MCP stdio server 说明：
#   项目自带的 MCP server 是 stdio 协议，应由外部客户端（Claude Desktop / Cursor 等）
#   通过 `command: ./start_mcp.sh` 按需拉起并用 stdin/stdout 通信。
#   它不是一个常驻后台服务，单独后台运行会立刻因为读到 EOF 而退出。
#
# 停止：Ctrl+C（按端口精确回收前后端）

set -eo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

BACKEND_PORT="${BACKEND_PORT:-8787}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

WITH_MCP=0
for arg in "$@"; do
  case "$arg" in
    --with-mcp) WITH_MCP=1 ;;
    --no-mcp)   WITH_MCP=0 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "❌ 缺少依赖：$1" >&2; exit 1; }
}
need python3
need node
need npm
need lsof
need curl

port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1; }
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -TERM $pids 2>/dev/null || true
    sleep 0.5
    pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
  fi
}

if port_busy "$BACKEND_PORT"; then
  echo "❌ 后端端口 $BACKEND_PORT 已被占用，请释放或设置 BACKEND_PORT=..." >&2
  exit 1
fi
if port_busy "$FRONTEND_PORT"; then
  echo "❌ 前端端口 $FRONTEND_PORT 已被占用，请释放或设置 FRONTEND_PORT=..." >&2
  exit 1
fi

# ---------- 清理 ----------
MCP_PID=""
cleanup() {
  echo ""
  echo "🛑 正在停止所有子进程..."
  [ -n "$MCP_PID" ] && kill -TERM "$MCP_PID" 2>/dev/null || true
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  echo "✅ 已退出。日志保留在 $LOG_DIR"
}
trap cleanup EXIT INT TERM

# ---------- 启动后端 ----------
echo "▶️  启动后端（端口 $BACKEND_PORT）..."
PORT="$BACKEND_PORT" "$ROOT_DIR/start_backend.sh" \
  >"$LOG_DIR/backend.log" 2>&1 &

# ---------- 启动前端 ----------
echo "▶️  启动前端（端口 $FRONTEND_PORT）..."
(
  cd "$ROOT_DIR/frontend"
  if [ ! -d node_modules ]; then
    npm install
  fi
  exec npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) >"$LOG_DIR/frontend.log" 2>&1 &

# ---------- 启动 MCP ----------
if [ "$WITH_MCP" -eq 1 ]; then
  echo "▶️  启动 MCP stdio server..."
  "$ROOT_DIR/start_mcp.sh" >"$LOG_DIR/mcp.log" 2>&1 &
  MCP_PID=$!
fi

# ---------- 打印地址 ----------
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"

banner() {
  local state="$1"
  cat <<EOF

====================================================
  小红书创作助手  ——  $state
----------------------------------------------------
  前端   $FRONTEND_URL
  后端   $BACKEND_URL
  健康   $BACKEND_URL/healthz      Meta $BACKEND_URL/api/meta
EOF
  if [ "$WITH_MCP" -eq 1 ]; then
    echo "  MCP    stdio 已启动 (PID ${MCP_PID:-?}, 日志 $LOG_DIR/mcp.log)"
  else
    echo "  MCP    未启动（加 --with-mcp 或去掉 --no-mcp 可开启）"
  fi
  cat <<EOF
----------------------------------------------------
  日志   $LOG_DIR/{backend,frontend,mcp}.log
  停止   Ctrl+C
====================================================

EOF
}

banner "启动中"

# ---------- 按端口等待 ----------
wait_port() {
  local port="$1" url="$2" name="$3" timeout="${4:-120}"
  local i=0
  while [ $i -lt "$timeout" ]; do
    if port_busy "$port" && curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      echo "   ✅ $name 就绪：$url"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "   ⚠️  $name 启动超时（$timeout s），查看日志：$LOG_DIR"
  return 1
}

echo "⏳ 等待服务就绪（首次启动会装依赖，最多 2 分钟）..."
wait_port "$BACKEND_PORT"  "$BACKEND_URL/api/meta" "backend"  120 || exit 1
wait_port "$FRONTEND_PORT" "$FRONTEND_URL"         "frontend" 120 || exit 1

banner "全部就绪 ✅"

# ---------- 监听 ----------
while true; do
  if ! port_busy "$BACKEND_PORT"; then
    echo "⚠️  backend 端口 $BACKEND_PORT 已失联，准备退出..."
    exit 1
  fi
  if ! port_busy "$FRONTEND_PORT"; then
    echo "⚠️  frontend 端口 $FRONTEND_PORT 已失联，准备退出..."
    exit 1
  fi
  if [ "$WITH_MCP" -eq 1 ] && [ -n "$MCP_PID" ] && ! kill -0 "$MCP_PID" 2>/dev/null; then
    echo "⚠️  MCP ($MCP_PID) 已退出，准备退出..."
    exit 1
  fi
  sleep 2
done
