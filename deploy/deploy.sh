#!/usr/bin/env bash
# TeamPortal 一键部署/回滚脚本 — 拉取 ghcr.io 预构建镜像启动，服务器零构建
# 用法:
#   bash deploy/deploy.sh              # 部署 main 最新镜像
#   bash deploy/deploy.sh sha-abc1234  # 回滚到指定 commit 的镜像
# 首次使用若拉取被拒(401/403): 包还是私有的，二选一:
#   a) GitHub 网页 → 你的 Packages → teamportal-frontend/backend/ai-service → Package settings → Change visibility → Public
#   b) 或创建只读 packages PAT 后执行: echo <PAT> | docker login ghcr.io -u YQHD711 --password-stdin
set -euo pipefail

cd "$(dirname "$0")/.."   # 进入项目根目录

TAG="${1:-latest}"

echo "==> 1/4 拉取最新代码"
git pull --ff-only origin main

echo "==> 2/4 拉取镜像 (tag: ${TAG})"
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull || {
  echo "✗ 镜像拉取失败——大概率是 ghcr 包还是私有的，见脚本头部注释处理"
  exit 1
}

# 临时替换 tag 用于本次启动(回滚场景)
if [ "$TAG" != "latest" ]; then
  export TEAMPORTAL_IMAGE_TAG="$TAG"
fi

echo "==> 3/4 滚动重启服务"
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d --remove-orphans

echo "==> 4/4 清理悬空镜像"
docker image prune -f >/dev/null

echo "✅ 部署完成: $(docker compose ps --format 'table {{.Name}}\t{{.Status}}')"
