#!/bin/bash
# Team Portal data backup script — run via cron daily:
# 0 3 * * * /opt/team-portal/deploy/backup.sh

BACKUP_DIR="/opt/backups/team-portal"
DATA_DIR="/opt/team-portal/data"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/team-portal-$DATE.tar.gz"

# 固件缓存是可重新下载的派生物，不进备份（否则每天几十上百 MB 的重复镜像撑爆保留期）
tar -czf "$BACKUP_FILE" -C "$DATA_DIR" --exclude='./firmware' --exclude='./log-archive' .

# Remove backups older than retention period
find "$BACKUP_DIR" -name "team-portal-*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
