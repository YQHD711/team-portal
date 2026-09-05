#!/usr/bin/env bash
# TeamPortal 一键部署/回滚脚本 — 拉取 ghcr.io 预构建镜像启动，服务器零构建
# 用法:
#   bash deploy/deploy.sh              # 部署 main 最新镜像
#   bash deploy/deploy.sh sha-<完整40位commit>  # 部署/回滚到指定 commit
#   (完整 sha 用 git rev-parse HEAD 查看;CI 推的镜像 tag 是 sha-<完整sha>)
# 首次使用若拉取被拒(401/403): 包还是私有的，二选一:
#   a) GitHub 网页 → 你的 Packages → teamportal-frontend/backend/ai-service → Package settings → Change visibility → Public
#   b) 或创建只读 packages PAT 后执行: echo <PAT> | docker login ghcr.io -u YQHD711 --password-stdin
set -euo pipefail

cd "$(dirname "$0")/.."   # 进入项目根目录

TAG="${1:-latest}"

# ⚠ 必须在 pull 之前 export:pull 要按最终 tag 拉取,否则 up 时发现 sha 镜像缺失
#   会在服务器上触发源码构建(1.8G 内存直接被打爆,2026-09-05 血的教训)
if [ "$TAG" != "latest" ]; then
  export TEAMPORTAL_IMAGE_TAG="$TAG"
fi

echo "==> 1/4 拉取最新代码"
# root(cron 自动部署)场景下以 admin 身份拉代码，避免 .git 属主被 root 污染
if [ "$(id -u)" -eq 0 ]; then
  sudo -u admin -H git pull --ff-only origin main || echo "⚠ git pull 失败,继续用镜像部署(仓库代码可能滞后)"
else
  git pull --ff-only origin main
fi

echo "==> 2/4 拉取镜像 (tag: ${TAG})"
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull || {
  echo "✗ 镜像拉取失败——大概率是 ghcr 包还是私有的，见脚本头部注释处理"
  exit 1
}

echo "==> 3/4 滚动重启服务"
# --no-build 双保险: 拉取式部署绝不允许在服务器上触发构建
# 注意: 不能加 --remove-orphans，wiki-nginx 由独立的 docker-compose.wiki.yml 管理，会被误删
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d --no-build

echo "==> 4/4 恢复 wiki 站点(独立 compose 文件)"
docker compose -f docker-compose.wiki.yml up -d 2>/dev/null || true

echo "==> 5/5 清理悬空镜像"
docker image prune -f >/dev/null

echo "✅ 部署完成: $(docker compose ps --format 'table {{.Name}}\t{{.Status}}')"
