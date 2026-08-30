import { Clock, Database, FileArchive, ShieldCheck } from "lucide-react";
import { formatSize, type BackupStats } from "./backupTypes";

interface Props {
  stats: BackupStats;
}

/** 备份统计卡片（数据库大小 / 备份数量 / 最近备份 / 数据库状态） */
export default function BackupStatsCards({ stats }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40">
          <Database className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <div className="text-xl font-bold">{formatSize(stats.dbSize)}</div>
          <div className="text-xs text-muted">数据库大小</div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/40">
          <FileArchive className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <div className="text-xl font-bold">{stats.backupCount}</div>
          <div className="text-xs text-muted">备份数量</div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40">
          <Clock className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <div className="text-xl font-bold">{stats.latestBackupAge}</div>
          <div className="text-xs text-muted">最近备份</div>
        </div>
      </div>
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${
        stats.dbExists
          ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
          : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
      }`}>
        <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
          stats.dbExists ? "bg-green-100 dark:bg-green-900/50" : "bg-red-100 dark:bg-red-900/50"
        }`}>
          <ShieldCheck className={`h-5 w-5 ${stats.dbExists ? "text-green-500" : "text-red-500"}`} />
        </div>
        <div>
          <div className={`text-xl font-bold ${stats.dbExists ? "text-green-600" : "text-red-500"}`}>
            {stats.dbExists ? "正常" : "异常"}
          </div>
          <div className="text-xs text-muted">数据库状态</div>
        </div>
      </div>
    </div>
  );
}
