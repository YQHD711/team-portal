#!/usr/bin/env bash
# TeamPortal 自动部署 watcher — 由 root cron 每 5 分钟调用
#
# 逻辑: 查 GitHub 上 main 分支最新一次「全绿 CI/CD run」的 commit →
#       与 deploy/.deployed_sha 对比 → 不同则执行 deploy.sh sha-<sha>
#       (只有 build-push 成功 run 才算 success,即镜像必定已推到 ghcr)
#
# 暂停/恢复:
#   touch deploy/AUTO_DEPLOY_OFF   # 暂停自动部署(回滚调试前先执行)
#   rm    deploy/AUTO_DEPLOY_OFF   # 恢复
# 手动回滚流程:
#   touch deploy/AUTO_DEPLOY_OFF && bash deploy/deploy.sh sha-xxxx
#   (调试完想恢复自动跟踪时: rm deploy/AUTO_DEPLOY_OFF)
#
# 日志: deploy/auto-deploy.log (cron 与脚本都往这里追加,空闲周期零输出)
set -uo pipefail

REPO=/home/admin/teamportal
STATE=$REPO/deploy/.deployed_sha

log() { echo "[$(date '+%F %T')] $*"; }

# 1. 暂停开关
[ -f "$REPO/deploy/AUTO_DEPLOY_OFF" ] && exit 0

# 2. 查询 main 最新成功 run 的完整 sha(CI 镜像 tag 是 sha-<40位完整sha>;失败静默跳过本轮)
SHA=$(curl -sf --max-time 20 \
  "https://api.github.com/repos/YQHD711/team-portal/actions/runs?branch=main&status=success&per_page=5" \
  | python3 -c 'import json,sys
runs = json.load(sys.stdin)["workflow_runs"]
print(runs[0]["head_sha"] if runs else "")' 2>/dev/null) || exit 0
[ -z "$SHA" ] && exit 0

# 3. 与已部署版本对比,相同则无事可做
LAST=$(cat "$STATE" 2>/dev/null || true)
[ "$SHA" = "$LAST" ] && exit 0

# 4. 自动部署
log "检测到新版本: ${LAST:-无记录} → ${SHA:0:7} , 开始自动部署"
if bash "$REPO/deploy/deploy.sh" "sha-$SHA" >> "$REPO/deploy/auto-deploy.log" 2>&1; then
  echo "$SHA" > "$STATE"
  log "✅ 已自动部署 ${SHA:0:7}"
else
  log "✗ ${SHA:0:7} 部署失败,下轮自动重试(不影响当前运行中的服务)"
fi
