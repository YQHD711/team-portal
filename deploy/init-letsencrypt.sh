#!/bin/bash
# Team Portal — Let's Encrypt 证书初始化脚本
# 首次部署时运行一次即可，后续 certbot 服务会自动续期
#
# 用法: DOMAIN=team.yourdomain.com EMAIL=admin@yourdomain.com bash deploy/init-letsencrypt.sh

set -e

# ── 参数检查 ──
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

if [ -z "$DOMAIN" ]; then
    echo "错误: 请设置 DOMAIN 环境变量"
    echo "用法: DOMAIN=team.yourdomain.com EMAIL=admin@yourdomain.com bash deploy/init-letsencrypt.sh"
    exit 1
fi
if [ -z "$EMAIL" ]; then
    echo "错误: 请设置 EMAIL 环境变量（Let's Encrypt 证书到期提醒用）"
    exit 1
fi

echo "=== Team Portal HTTPS 初始化 ==="
echo "域名: $DOMAIN"
echo "邮箱: $EMAIL"
echo ""

# ── 目录准备 ──
mkdir -p certbot/www certbot/conf

# ── 步骤 1: 检查 DNS ──
echo "[1/5] 检查 DNS 解析..."
SERVER_IP=$(curl -sf https://ifconfig.me 2>/dev/null || curl -sf https://api.ipify.org 2>/dev/null || echo "")
if [ -n "$SERVER_IP" ]; then
    RESOLVED_IP=$(dig +short "$DOMAIN" A 2>/dev/null || echo "")
    if [ -z "$RESOLVED_IP" ]; then
        echo "⚠ 无法解析 $DOMAIN 的 DNS 记录，请确保域名 A 记录指向本服务器 IP ($SERVER_IP)"
        echo "继续前请确认 DNS 已正确配置"
        read -rp "按 Enter 继续，Ctrl+C 取消..."
    elif [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
        echo "⚠ DNS 解析到 $RESOLVED_IP，但本服务器 IP 是 $SERVER_IP"
        echo "请确认 DNS 配置正确"
        read -rp "按 Enter 继续，Ctrl+C 取消..."
    else
        echo "✓ DNS 解析正确: $DOMAIN → $SERVER_IP"
    fi
else
    echo "⚠ 无法获取服务器公网 IP，跳过 DNS 检查"
fi

# ── 步骤 2: 启动临时 HTTP-only Nginx 进行 ACME 验证 ──
echo "[2/5] 启动临时 Nginx（HTTP-only）以完成证书验证..."

# 创建临时 HTTP-only 配置
cat > deploy/nginx.temp.conf << 'NGINX_TEMP'
server {
    listen 80;
    server_name __TEMP_DOMAIN__;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 "certbot bootstrap";
        add_header Content-Type text/plain;
    }
}
NGINX_TEMP
sed -i "s/__TEMP_DOMAIN__/$DOMAIN/g" deploy/nginx.temp.conf

# 启动临时 nginx（仅 80 端口）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx 2>/dev/null || true
docker stop team-portal-nginx-temp 2>/dev/null || true
docker rm team-portal-nginx-temp 2>/dev/null || true
docker run -d --name team-portal-nginx-temp \
    -p 80:80 \
    -v "$(pwd)/deploy/nginx.temp.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    --network team-portal_default \
    nginx:alpine

sleep 2
echo "✓ 临时 Nginx 已启动"

# ── 步骤 3: 申请 Let's Encrypt 证书 ──
echo "[3/5] 申请 Let's Encrypt 证书..."

# 先用 staging 环境测试
docker run --rm \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    certbot/certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --domain "$DOMAIN" \
    --agree-tos \
    --non-interactive \
    --dry-run

if [ $? -eq 0 ]; then
    echo "✓ Staging 测试通过，申请正式证书..."
else
    echo "⚠ Staging 测试失败，请检查 DNS 和端口 80 是否可达"
    echo "继续尝试申请正式证书..."
fi

# 申请正式证书
docker run --rm \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    certbot/certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --domain "$DOMAIN" \
    --agree-tos \
    --non-interactive \
    --force-renewal

echo "✓ 证书申请成功"

# ── 步骤 4: 清理并启动生产环境 ──
echo "[4/5] 清理临时环境，启动生产服务..."

# 停止临时 nginx
docker stop team-portal-nginx-temp 2>/dev/null || true
docker rm team-portal-nginx-temp 2>/dev/null || true
rm -f deploy/nginx.temp.conf

echo ""
echo "=== HTTPS 初始化完成! ==="
echo ""
echo "接下来:"
echo "  1. 创建 .env 文件并设置 DOMAIN=$DOMAIN"
echo "  2. 启动生产环境: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo "  3. 验证: curl https://$DOMAIN"
echo ""
echo "证书将自动续期（certbot 服务每 12 小时检查一次）"
