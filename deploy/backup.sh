#!/bin/bash
# Team Portal data backup script — run via cron daily:
# 0 3 * * * /opt/team-portal/deploy/backup.sh

BACKUP_DIR="/opt/backups/team-portal"
DATA_DIR="/opt/team-portal/data"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/team-portal-$DATE.tar.gz"

tar -czf "$BACKUP_FILE" -C "$DATA_DIR" .

# Remove backups older than retention period
find "$BACKUP_DIR" -name "team-portal-*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
