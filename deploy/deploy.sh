#!/usr/bin/env bash
# TeamPortal 一键部署/回滚脚本 — 拉取 ghcr.io 预构建镜像启动，服务器零构建
# 用法:
#   bash deploy/deploy.sh              # 部署 main 最新镜像
#   bash deploy/deploy.sh sha-<完整40位commit>  # 部署/回滚到指定 commit
#   (完整 sha 用 git rev-parse HEAD 查看;CI 推的镜像 tag 是 sha-<完整sha>)
# 首次使用若拉取被拒(401/403): 包还是私有的，二选一:
#   a) GitHub 网页 → 你的 Packages → teamportal-frontend/backend → Package settings → Change visibility → Public
#   b) 或创建只读 packages PAT 后执行: echo <PAT> | docker login ghcr.io -u YQHD711 --password-stdin
set -euo pipefail

cd "$(dirname "$0")/.."   # 进入项目根目录

TAG="${1:-latest}"

# ⚠ 必须在 pull 之前 export:pull 要按最终 tag 拉取,否则 up 时发现 sha 镜像缺失
#   会在服务器上触发源码构建(1.8G 内存直接被打爆,2026-09-05 血的教训)
if [ "$TAG" != "latest" ]; then
  export TEAMPORTAL_IMAGE_TAG="$TAG"
fi

# ── 传输层安全（审计 C-01）──
# 自动部署此前只叠加 base+ghcr，从不加载 docker-compose.prod.yml，导致线上是 http://IP:3000 明文。
# 这里按"证书是否已就绪"自动选择拓扑：
#   * certbot/conf/live/<DOMAIN>/fullchain.pem 存在 → 叠加 prod（nginx+certbot，frontend/backend 不再发布端口）
#   * 否则 → 保持旧拓扑继续可用，但打印 CRITICAL 告警；设置 REQUIRE_TLS=1 时直接失败（推荐生产）
# 先执行 bash deploy/enable-tls.sh 完成证书与拓扑切换。
DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN=$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
fi
TLS_READY=0
if [ -n "$DOMAIN" ] && [ -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
  TLS_READY=1
fi
if [ "$TLS_READY" -eq 1 ]; then
  COMPOSE=(-f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.prod.yml)
  echo "🔒 TLS 已启用（域名: $DOMAIN）"
else
  COMPOSE=(-f docker-compose.yml -f docker-compose.ghcr.yml)
  echo "⚠️⚠️  警告：未检测到 TLS 证书（DOMAIN=${DOMAIN:-未配置} / certbot/conf/live/...）。"
  echo "    站点将以**明文 HTTP** 提供，登录口令与 JWT 可被链路嗅探（审计 C-01）。"
  echo "    立即处置：bash deploy/enable-tls.sh   （或在 .env 配置 DOMAIN/CERTBOT_EMAIL 后执行）"
  if [ "${REQUIRE_TLS:-0}" = "1" ]; then
    echo "✗ REQUIRE_TLS=1 且无 TLS 证书，拒绝以明文形态部署"
    exit 1
  fi
fi

echo "==> 1/6 拉取最新代码"
# root(cron 自动部署)场景下以 admin 身份拉代码，避免 .git 属主被 root 污染
if [ "$(id -u)" -eq 0 ]; then
  sudo -u admin -H git pull --ff-only origin main || echo "⚠ git pull 失败,继续用镜像部署(仓库代码可能滞后)"
else
  git pull --ff-only origin main
fi

echo "==> 2/6 拉取镜像 (tag: ${TAG})"
docker compose "${COMPOSE[@]}" pull || {
  echo "✗ 镜像拉取失败——大概率是 ghcr 包还是私有的，见脚本头部注释处理"
  exit 1
}

echo "==> 3/6 滚动重启服务"
# --no-build 双保险: 拉取式部署绝不允许在服务器上触发构建
# 注意: 不能加 --remove-orphans，wiki-nginx 由独立的 docker-compose.wiki.yml 管理，会被误删
docker compose "${COMPOSE[@]}" up -d --no-build

echo "==> 4/6 恢复 wiki 站点(独立 compose 文件)"
docker compose -f docker-compose.wiki.yml up -d 2>/dev/null || true

# 健康门禁:容器起来 ≠ 服务可用(docker compose up -d 对 crash-loop 容器同样返回 0)。
# 不通过就 exit 1 → auto-deploy.sh 不更新 .deployed_sha,下一轮自动重试,并可手动回滚。
echo "==> 5/6 健康门禁(最多 90s)"
healthy=0
for _ in $(seq 1 45); do
  if [ "$TLS_READY" -eq 1 ]; then
    # prod 拓扑下 backend/frontend 都不发布宿主端口，按容器运行状态判断
    if docker compose "${COMPOSE[@]}" ps --services --filter status=running 2>/dev/null | grep -qx backend; then healthy=1; break; fi
  else
    if curl -fsS --max-time 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then healthy=1; break; fi
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  echo "✗ 后端 90s 内未就绪 —— 本次部署判定失败(不更新已部署版本)"
  docker compose "${COMPOSE[@]}" logs --tail=60 backend || true
  exit 1
fi
echo "✅ 后端健康"

frontend_ok=0
for _ in $(seq 1 20); do
  if [ "$TLS_READY" -eq 1 ]; then
    if curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" >/dev/null 2>&1 \
       || curl -fsSk --max-time 5 -H "Host: $DOMAIN" https://127.0.0.1/ >/dev/null 2>&1; then frontend_ok=1; break; fi
  else
    if curl -fsS --max-time 3 http://127.0.0.1:3000 >/dev/null 2>&1; then frontend_ok=1; break; fi
  fi
  sleep 2
done
[ "$frontend_ok" -eq 1 ] && echo "✅ 前端健康" || echo "⚠ 前端未就绪(后端已健康,可稍后复查 docker compose logs frontend)"

echo "==> 6/6 清理旧镜像"
# 悬空镜像
docker image prune -f >/dev/null
# 历史版本镜像：CI 每次发版都会推 sha-<commit> 的 backend/frontend 镜像，pull 下来后
# 只清悬空镜像动不了它们（有 tag，不算 dangling）—— 每版约 0.5GB，攒几十版就把磁盘吃满。
# 规则：每个仓库保留最新的 2 个 sha-* 版本（够回滚），更旧的删掉；正在运行的镜像永不删。
# 要回滚到更旧的版本时，用 `bash deploy/deploy.sh sha-<commit>` 重新拉取即可。
running_images=$(docker ps -q | xargs -r docker inspect --format '{{.Image}}' | sort -u)
removed=0
for repo in teamportal-backend teamportal-frontend; do
  stale=$(docker images --format '{{.ID}} {{.CreatedAt}} {{.Repository}}:{{.Tag}}' \
    | grep -E "ghcr\.io/[^/]+/${repo}:sha-" \
    | sort -k2,3 -r \
    | awk '{print $1}' | awk '!seen[$0]++' | tail -n +3 || true)
  for id in $stale; do
    if echo "$running_images" | grep -q "^${id}$"; then continue; fi
    if docker rmi -f "$id" >/dev/null 2>&1; then removed=$((removed + 1)); fi
  done
done
echo "✅ 清理完成（删除 ${removed} 个历史版本镜像）"

echo "✅ 部署完成: $(docker compose "${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}')"