#!/usr/bin/env bash
# TeamPortal — 一键启用 HTTPS（审计 C-01 的处置脚本）
#
# 作用：申请/复用 Let's Encrypt 证书 → 把部署拓扑切换到 docker-compose.prod.yml
#       （nginx 终结 TLS，frontend/backend 不再向宿主发布端口）→ 验证并打印回滚方式。
#
# 用法（在项目根目录，需 root 或 docker 权限）：
#   bash deploy/enable-tls.sh
# 前置：
#   * 域名 A 记录已指向本机公网 IP（必须先配好）
#   * .env 里配置 DOMAIN / CERTBOT_EMAIL（也可用环境变量传入）
#   * 80/443 端口空闲（当前站点跑在 3000，不冲突）
#
# 回滚（恢复到明文 3000 拓扑，仅在紧急时使用）：
#   docker compose -f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.prod.yml down
#   docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d --no-build
set -euo pipefail
cd "$(dirname "$0")/.."

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
fail()  { red "✗ $*"; exit 1; }

env_get() { # env_get KEY FILE
  grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' || true
}
env_set() { # env_set KEY VALUE FILE
  local key="$1" val="$2" file="$3"
  if grep -qE "^$key=" "$file"; then
    # 用 awk 替换，避免值里的斜杠破坏 sed
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$file"
  fi
}

command -v docker >/dev/null 2>&1 || fail "未找到 docker"
command -v curl   >/dev/null 2>&1 || fail "未找到 curl"
[ -f .env ] || fail "缺少 .env（先 cp .env.example .env 并填入真实值）"

DOMAIN="${DOMAIN:-$(env_get DOMAIN .env)}"
EMAIL="${EMAIL:-$(env_get CERTBOT_EMAIL .env)}"
[ -n "$DOMAIN" ] || fail "未配置 DOMAIN：请在 .env 设置 DOMAIN=<你的域名> 后重试"
[ -n "$EMAIL" ]  || fail "未配置 CERTBOT_EMAIL：请在 .env 设置证书到期提醒邮箱"

echo "=== 启用 HTTPS：$DOMAIN ==="

# 0) DNS 预检（不阻塞，只提示）
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
[ -n "$RESOLVED" ] && echo "DNS: $DOMAIN → $RESOLVED" || warn "无法解析 $DOMAIN，请确认 A 记录已生效"

# 1) 端口检查
for port in 80 443; do
  if docker ps --format '{{.Ports}}' | grep -q "0.0.0.0:$port->"; then
    fail "宿主 $port 端口已被其它容器占用，请先腾出（nginx/certbot 需要 80/443）"
  fi
done

mkdir -p certbot/www certbot/conf

# 2) 证书：不存在则用 standalone 申请（80 端口；申请后由 compose 里的 certbot 自动续期）
if [ -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
  green "已存在证书：certbot/conf/live/$DOMAIN/fullchain.pem（跳过申请）"
else
  echo "[1/3] 申请 Let's Encrypt 证书（standalone，占用 80 端口）..."
  docker run --rm \
    -p 80:80 \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    certbot/certbot certonly \
      --standalone --non-interactive --agree-tos \
      --email "$EMAIL" -d "$DOMAIN"
  [ -f "certbot/conf/live/$DOMAIN/fullchain.pem" ] || fail "证书申请失败，请检查 DNS 与 80 端口可达性"
  green "证书申请成功"
fi

# 3) 写回 .env（DOMAIN 与 CORS 白名单，确保浏览器同源请求不被 CORS 拦）
echo "[2/3] 更新 .env（备份为 .env.bak-$(date +%Y%m%d%H%M%S)）"
cp .env ".env.bak-$(date +%Y%m%d%H%M%S)"
env_set DOMAIN "$DOMAIN" .env
CUR_CORS=$(env_get CORS__ORIGINS .env)
case "$CUR_CORS" in
  *"https://$DOMAIN"*) : ;;
  "") env_set CORS__ORIGINS "https://$DOMAIN" .env ;;
  *)  env_set CORS__ORIGINS "$CUR_CORS;https://$DOMAIN" .env ;;
esac

# 4) 切换拓扑：deploy.sh 检测到证书后会自动叠加 docker-compose.prod.yml
echo "[3/3] 以 TLS 拓扑部署（frontend/backend 不再发布宿主端口）..."
REQUIRE_TLS=1 bash deploy/deploy.sh

# 5) 验证
echo "--- 验证 ---"
if curl -fsS --max-time 10 "https://$DOMAIN/" >/dev/null 2>&1; then
  green "HTTPS 可访问：https://$DOMAIN/"
else
  fail "HTTPS 验证失败，请查看：docker compose -f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.prod.yml logs --tail=80 nginx"
fi
if curl -sI --max-time 10 "http://$DOMAIN/" | grep -qiE '^(HTTP/.* (301|308)|location: https://)'; then
  green "HTTP 已 301/308 跳转到 HTTPS"
else
  warn "HTTP 未按预期跳转，请检查 deploy/nginx.prod.conf"
fi
if curl -sI --max-time 5 "http://$(hostname -I 2>/dev/null | awk '{print $1}'):3000" >/dev/null 2>&1; then
  warn "注意：3000 端口仍可访问（可能仍有旧容器），执行 'docker ps' 确认 frontend 未发布 3000"
else
  green "3000 端口已不再对外（prod 拓扑取消了端口发布）"
fi

echo ""
green "完成。请用浏览器以 https://$DOMAIN 登录，并在系统设置中立即修改管理员口令。"
echo "回滚（紧急恢复明文 3000，不推荐长期使用）："
echo "  docker compose -f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.prod.yml down"
echo "  docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d --no-build"
