#!/usr/bin/env bash
# 切换「宿主 3000 → nginx → frontend」这条可选拓扑（审计要拿到真实客户端 IP 才需要）。
#
#   bash deploy/nginx-proxy.sh enable     # 启用：nginx 接管宿主 3000
#   bash deploy/nginx-proxy.sh disable    # 回滚：nginx 下线，frontend 恢复直接发布 3000
#   bash deploy/nginx-proxy.sh status     # 看当前形态
#
# 设计要点（Lead 的硬约束）：
#  * 本拓扑放在**独立 override 文件**里，systemd 自动部署（只带 docker-compose.yml + ghcr.yml）
#    **不会**启用它 —— 拓扑不会自己变。
#  * 回滚路径不依赖 nginx 能起来：disable 先让 frontend 恢复发布端口，再移除 nginx 容器；
#    任一步失败都会打印现场信息并以非 0 退出，便于立刻人工介入。
#  * 不执行任何 git 命令。

set -euo pipefail
cd "$(dirname "$0")/.."

BASE=(-f docker-compose.yml -f docker-compose.ghcr.yml)
NGINX=(-f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.nginx.yml)

ok()   { printf '\033[32m✅ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m❌ %s\033[0m\n' "$*"; }

frontend_percent() {
  # 只发布给宿主时才是"直接形态"；被 nginx 接管时 frontend 不该再发布 3000
  docker compose "${BASE[@]}" config 2>/dev/null | grep -c '"published": "3000"' || true
}

wait_http() {
  local url="$1" tries="${2:-30}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "$url"; then return 0; fi
    sleep 2
  done
  return 1
}

case "${1:-}" in
  enable)
    ok "启用 nginx 拓扑（宿主 3000 → nginx → frontend）"
    docker compose "${NGINX[@]}" up -d --no-build
    if wait_http http://127.0.0.1:3000/; then
      ok "站点可用（http://<host>:3000/）"
    else
      fail "启用后站点不可用；请立刻执行：bash deploy/nginx-proxy.sh disable"
      docker compose "${NGINX[@]}" logs --tail=40 nginx || true
      exit 1
    fi
    warn "现在请实测：浏览器登录一次 → 管理端「操作日志」里应看到**你的真实客户端 IP**，不再是内部地址"
    warn "伪造对照：curl -H 'X-Forwarded-For: 1.2.3.4' http://<host>:3000/api/auth/login -d ... 应**不会**把 1.2.3.4 记进日志"
    ;;
  disable)
    warn "回滚：恢复 frontend 直接发布 3000（先恢复可用性，再撤 nginx）"
    docker compose "${BASE[@]}" up -d --no-build --force-recreate frontend
    if wait_http http://127.0.0.1:3000/; then
      ok "站点已恢复（frontend 直接发布 3000）"
    else
      fail "站点仍不可用；请查看：docker compose ${BASE[*]} logs --tail=40 frontend"
      exit 1
    fi
    docker compose "${NGINX[@]}" rm -sf nginx || warn "移除 nginx 容器失败（不影响站点可用性）"
    ok "回滚完成：nginx 已下线，拓扑回到自动部署的形态"
    ;;
  status)
    echo "--- 当前容器 ---"
    docker compose "${NGINX[@]}" ps
    echo "--- frontend 是否直接发布 3000（>0 表示是自动部署的默认形态）---"
    frontend_percent
    ;;
  *)
    echo "用法: bash deploy/nginx-proxy.sh {enable|disable|status}" >&2
    exit 2
    ;;
esac
