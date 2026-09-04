#!/usr/bin/env bash
# Team Portal 服务器部署脚本 — 基础模式 (HTTP + IP 直连,无 HTTPS)
# 用法: bash deploy/basic-deploy.sh
# 前置: 项目已传到 ~/team-portal,当前用户有 docker 权限
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; }

cd "$(dirname "$0")/.."

echo "=============================================="
echo "  Team Portal — 基础模式部署"
echo "  模式: HTTP + 直连 IP (无 HTTPS, 无 nginx)"
echo "=============================================="

# ── 1. 环境变量文件 ──
if [ ! -f deploy/.env.basic-server ]; then
    fail "deploy/.env.basic-server 不存在"
    exit 1
fi
cp -f deploy/.env.basic-server .env
ok "已写入 .env"

# ── 2. 自动生成 JWT 密钥 ──
JWT_KEY=$(openssl rand -base64 48 2>/dev/null | tr -d '\n' || head -c 48 /dev/urandom | base64 | tr -d '\n')
sed -i.bak "s|^JWT__KEY=.*|JWT__KEY=${JWT_KEY}|" .env && rm -f .env.bak
ok "已生成 JWT 密钥"

# ── 3. 数据目录 ──
mkdir -p data/knowledge
[ -f data/teamportal.db ] || touch data/teamportal.db
ok "数据目录就绪"

# ── 4. 构建并启动 ──
info "构建镜像 (首次约 3-5 分钟,取决于网络)..."
docker compose build --progress=plain
echo
info "启动服务..."
docker compose up -d

# ── 5. 健康检查 ──
info "等待服务就绪 (约 30 秒)..."
sleep 30

# 健康检查
curl -sf http://localhost:8080/health >/dev/null && ok "Backend :8080 健康"  || warn "Backend :8080 未就绪 (查看 docker compose logs backend)"
curl -sf http://localhost:3000       >/dev/null && ok "Frontend :3000 健康" || warn "Frontend :3000 未就绪"
curl -sf http://localhost:9001/health >/dev/null && ok "AI service :9001 健康" || warn "AI service :9001 未就绪"

echo
echo "=============================================="
echo "  部署完成！"
echo "  访问: http://8.137.161.160:3000"
echo "  管理员账号: admin / admin123 (首次登录后请修改)"
echo "=============================================="
warn "常用命令:"
warn "  docker compose logs -f         # 查看实时日志"
warn "  docker compose ps              # 查看容器状态"
warn "  docker compose restart backend # 重启某个服务"
