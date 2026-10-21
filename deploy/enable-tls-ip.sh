#!/usr/bin/env bash
# TeamPortal — 无域名场景启用免费 TLS（Let's Encrypt IP 证书）+ HTTP/3
#
# 适用：站点只有公网 IP、没有域名；80 端口已被 wiki-nginx 占用。
# 思路：把现有 wiki-nginx 升级成 80/443 边缘：
#   * 80  : ACME HTTP-01 challenge（webroot）+ 301 到 https
#   * 443 : 反代主站 frontend:3000 + 继续提供 /ardupilot_wiki/；同时开 QUIC（HTTP/3）
#   * 证书：Let's Encrypt IP 证书（certbot 5.4+，shortlived profile，约 6 天），webroot 续期
#
# 2026-10-21 已在生产按本脚本步骤实施并通过验证（https 200、http 301、HTTP/3 200、3000 外网阻断）。
# 用法（root）：  IP=1.2.3.4 bash deploy/enable-tls-ip.sh
#   STAGING=1 ... 先用 Let's Encrypt staging 演练（不产出受信任证书）
#   SKIP_SSH_PORT=1 ... 不改 sshd 端口（若 443 没被 sshd 占用）
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${IP:-}"
STAGING="${STAGING:-0}"
SKIP_SSH_PORT="${SKIP_SSH_PORT:-0}"
REPO="$(pwd)"
CERT_DIR="$REPO/certbot"
fail() { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }
say()  { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || fail "请用 root 执行（需要改 nginx/iptables/cron）"
[ -n "$IP" ] || fail "缺少 IP 环境变量：IP=<公网IP> bash deploy/enable-tls-ip.sh"
command -v docker >/dev/null || fail "缺少 docker"
command -v openssl >/dev/null || fail "缺少 openssl"
[ -f docker-compose.wiki.yml ] || fail "请在项目根目录执行（找不到 docker-compose.wiki.yml）"

say "0) 备份"
TS=$(date +%Y%m%d-%H%M%S)
for f in wiki.conf docker-compose.wiki.yml .env /etc/ssh/sshd_config; do
  [ -f "$f" ] && cp -a "$f" "$f.bak-tls-$TS"
done
ok "备份后缀 .bak-tls-$TS"

say "1) 准备 certbot 目录与 ACME webroot"
mkdir -p "$CERT_DIR/www/.well-known/acme-challenge" "$CERT_DIR/conf"
echo "probe" > "$CERT_DIR/www/.well-known/acme-challenge/probe.txt"

say "2) wiki.conf 注入 ACME location；compose 挂载 webroot"
python3 - "$REPO" <<'PY'
import sys
repo=sys.argv[1]
p=f"{repo}/wiki.conf"; s=open(p).read()
if "acme-challenge" not in s:
    ins='''
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }
'''
    s=s.replace("server_name _;","server_name _;"+ins,1); open(p,"w").write(s)
p2=f"{repo}/docker-compose.wiki.yml"; c=open(p2).read()
if "certbot/www" not in c:
    c=c.replace("      - ./wiki.conf:/etc/nginx/conf.d/default.conf:ro",
                "      - ./wiki.conf:/etc/nginx/conf.d/default.conf:ro\n      - ./certbot/www:/var/www/certbot:ro",1)
    open(p2,"w").write(c)
PY
docker compose -f docker-compose.wiki.yml up -d
ok "80 端口 ACME 已生效"

say "3) 释放 443（sshd 若占用则移回 22）"
if [ "$SKIP_SSH_PORT" != "1" ] && ss -ltn | grep -qE '0\.0\.0\.0:443\b'; then
  sed -i 's|^Port 443$|# Port 443  # moved to nginx for HTTPS/HTTP3|' /etc/ssh/sshd_config
  sshd -t && systemctl reload sshd
  ok "sshd 已只监听 22（备份 /etc/ssh/sshd_config.bak-tls-$TS）"
fi

say "4) 申请 Let's Encrypt IP 证书（certbot 5.4+，shortlived）"
if [ -f "$CERT_DIR/conf/live/$IP/fullchain.pem" ]; then
  ok "已存在证书，跳过申请"
else
  EXTRA=""; [ "$STAGING" = "1" ] && EXTRA="--staging"
  docker run --rm -v "$CERT_DIR/www:/var/www/certbot" -v "$CERT_DIR/conf:/etc/letsencrypt" \
    certbot/certbot certonly --webroot -w /var/www/certbot $EXTRA \
    --ip-address "$IP" --preferred-profile shortlived \
    --register-unsafely-without-email --agree-tos --non-interactive
  [ -f "$CERT_DIR/conf/live/$IP/fullchain.pem" ] || fail "证书申请失败（检查 80 端口与安全组）"
fi

say "5) 安装 443 边缘配置（主站 + wiki + QUIC）"
INSTALLED="$REPO/wiki.conf.tls"
sed "s|__IP__|$IP|g" deploy/nginx.edge-ip.conf > "$INSTALLED"
docker run --rm --network teamportal_default \
  -v "$INSTALLED:/etc/nginx/conf.d/default.conf:ro" \
  -v "$CERT_DIR/conf:/etc/letsencrypt:ro" \
  -v "/home/admin/ardupilot_wiki_cn:/data:ro" nginx:alpine nginx -t
cp "$INSTALLED" wiki.conf
python3 - "$REPO" <<'PY'
import sys
repo=sys.argv[1]; p=f"{repo}/docker-compose.wiki.yml"; c=open(p).read()
if "443:443/udp" not in c:
    c=c.replace('      - "80:80"','      - "80:80"\n      - "443:443"\n      - "443:443/udp"',1)
if "certbot/conf" not in c:
    c=c.replace("      - ./certbot/www:/var/www/certbot:ro",
                "      - ./certbot/www:/var/www/certbot:ro\n      - ./certbot/conf:/etc/letsencrypt:ro",1)
open(p,"w").write(c)
PY
docker compose -f docker-compose.wiki.yml up -d
curl -fsSk -m 10 https://127.0.0.1/ -H "Host: $IP" >/dev/null && ok "HTTPS 本机可用"

say "6) 续期（每 6 小时，webroot + reload）"
cat > /etc/cron.d/teamportal-tls <<CRON
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 1,7,13,19 * * * root docker run --rm -v $CERT_DIR/www:/var/www/certbot -v $CERT_DIR/conf:/etc/letsencrypt certbot/certbot renew --webroot -w /var/www/certbot --quiet >> /var/log/teamportal-cert-renew.log 2>&1; docker exec wiki-nginx nginx -s reload >> /var/log/teamportal-cert-renew.log 2>&1
CRON
chmod 644 /etc/cron.d/teamportal-tls
touch /var/log/teamportal-cert-renew.log
ok "续期 cron 已安装"

say "7) 对外阻断 :3000（只拦公网口 eth0，避免切断容器互访）"
cat > /etc/systemd/system/teamportal-block-3000.service <<'UNIT'
[Unit]
Description=Block external access to TeamPortal :3000 (public access must use HTTPS :443)
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/bin/sh -c "/sbin/iptables -C DOCKER-USER -i eth0 -p tcp --dport 3000 -j DROP 2>/dev/null || /sbin/iptables -I DOCKER-USER -i eth0 -p tcp --dport 3000 -j DROP"
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now teamportal-block-3000
ok "3000 外网阻断已启用"

say "8) 完成后手工确认（需重启后端使 CORS/PublicBaseUrl 生效）"
cat <<EOF
  1) .env: CORS__ORIGINS=https://$IP
  2) 数据库 SystemSettings: App:PublicBaseUrl=https://$IP
  3) docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d backend
  4) 外部验证: curl -I https://$IP/ ; curl -I http://$IP/ ; curl -I http://$IP:3000/（应失败）
  5) HTTP/3: docker run --rm --network host ymuski/curl-http3 curl --http3-only -k -I https://127.0.0.1/ -H 'Host: $IP'
EOF
