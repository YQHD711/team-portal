#!/usr/bin/env bash
# Team Portal 一键部署脚本 — 面向非技术用户的引导式部署
# 用法: bash deploy/quickstart.sh
# 作用: 检测 Docker → 生成 .env → 自动生成 JWT 密钥 → docker compose up → 健康检查
set -euo pipefail

cd "$(dirname "$0")/.."   # 回到仓库根目录

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${CYAN}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; }

echo "=============================================="
echo "  Team Portal 一键部署"
echo "=============================================="
echo

# ── 1. 检测 Docker ──
info "检测 Docker..."
if ! command -v docker >/dev/null 2>&1; then
    fail "未检测到 Docker。请先安装 Docker Desktop (https://www.docker.com/products/docker-desktop/)"
    exit 1
fi
if ! docker info >/dev/null 2>&1; then
    fail "Docker 未运行。请先启动 Docker Desktop 后重试"
    exit 1
fi
ok "Docker 正常"

# ── 2. 准备 .env ──
info "准备环境变量文件 .env..."
if [ ! -f .env ]; then
    cp .env.example .env
    # 自动生成 JWT 密钥（至少 32 字符）
    JWT_KEY=$(openssl rand -base64 48 2>/dev/null | tr -d '\n' || head -c 48 /dev/urandom | base64 | tr -d '\n')
    sed -i.bak "s|^JWT__KEY=.*|JWT__KEY=${JWT_KEY}|" .env && rm -f .env.bak
    ok "已生成 .env，JWT 密钥已自动生成"
else
    warn ".env 已存在，跳过生成"
    if grep -q "JWT__KEY=change-me" .env; then
        warn "检测到 JWT__KEY 仍是占位符，正在生成随机密钥..."
        JWT_KEY=$(openssl rand -base64 48 2>/dev/null | tr -d '\n' || head -c 48 /dev/urandom | base64 | tr -d '\n')
        sed -i.bak "s|^JWT__KEY=.*|JWT__KEY=${JWT_KEY}|" .env && rm -f .env.bak
        ok "JWT 密钥已更新"
    fi
fi

# ── 3. 提示关键配置 ──
warn "请确认 .env 中的关键配置（当前可先跳过，稍后再改）:"
warn "  - ADMIN__PASSWORD: 管理员初始密码（默认 change-me，首次登录后请修改）"
warn "  - AISERVICE__DEEPSEEKKEY: DeepSeek AI 密钥（可选，不填则 AI 问答不可用）"
echo

# ── 4. 构建并启动 ──
info "构建并启动服务（首次构建需几分钟）..."
docker compose up -d --build

echo
info "等待服务启动（约 15 秒）..."
sleep 15

# ── 5. 健康检查 ──
info "健康检查..."
FRONTEND=$(curl -sf http://localhost:3000 >/dev/null 2>&1 && echo OK || echo FAIL)
BACKEND=$(curl -sf http://localhost:8080 >/dev/null 2>&1 && echo OK || echo FAIL)

if [ "$FRONTEND" = "OK" ]; then ok "前端 :3000 正常"; else fail "前端 :3000 未就绪"; fi
if [ "$BACKEND" = "OK" ]; then ok "后端 :8080 正常"; else fail "后端 :8080 未就绪（可能需要更多启动时间，运行 make health 复查）"; fi

echo
echo "=============================================="
echo "  部署完成！"
echo "  访问地址: http://localhost:3000"
echo "  管理员账号: admin（密码见 .env 的 ADMIN__PASSWORD）"
echo "=============================================="
echo
warn "后续可用命令:"
warn "  make health      # 检查服务状态"
warn "  make logs        # 查看日志 (docker compose logs -f)"
warn "  docker compose down   # 停止服务"
