/* 备份恢复页面共享类型与工具函数（backup 页面及其子组件共用） */

export interface BackupInfo {
  fileName: string;
  tag: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupStats {
  dbPath: string;
  dbExists: boolean;
  dbSize: number;
  backupCount: number;
  latestBackup: string | null;
  latestBackupAge: string;
  backupDir: string;
  backups: { fileName: string; tag: string; sizeKb: number; createdAt: string }[];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}
