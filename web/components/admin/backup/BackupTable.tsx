import { FileArchive, History, RefreshCw, Trash2, Upload } from "lucide-react";
import { formatSize, formatTime, timeAgo, type BackupInfo } from "./backupTypes";

interface Props {
  backups: BackupInfo[];
  loading: boolean;
  restoring: string | null;
  onRestore: (fileName: string) => void;
  onDelete: (fileName: string) => void;
}

/** 备份列表（表格 + 恢复/删除操作） */
export default function BackupTable({ backups, loading, restoring, onRestore, onDelete }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <History className="h-4 w-4 text-muted" />
        <h2 className="font-semibold text-sm">备份列表</h2>
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center text-faint">
          <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-40" />
          加载中...
        </div>
      ) : backups.length === 0 ? (
        <div className="px-4 py-12 text-center text-faint">
          <FileArchive className="h-8 w-8 mx-auto mb-2 opacity-30" />
          暂无备份，点击上方"立即备份"创建
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="px-4 py-3 text-left font-medium text-muted">文件名</th>
                <th className="px-4 py-3 text-left font-medium text-muted w-16">类型</th>
                <th className="px-4 py-3 text-left font-medium text-muted w-24">大小</th>
                <th className="px-4 py-3 text-left font-medium text-muted w-40 hidden sm:table-cell">创建时间</th>
                <th className="px-4 py-3 text-right font-medium text-muted w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {backups.map((b) => (
                <tr key={b.fileName} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileArchive className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="font-mono text-xs truncate max-w-[200px] sm:max-w-[300px]">{b.fileName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      b.tag === "manual"
                        ? "bg-primary/15 text-primary"
                        : b.tag === "daily"
                        ? "bg-info/15 text-info"
                        : "bg-surface-hover text-muted"
                    }`}>
                      {b.tag === "manual" ? "手动" : b.tag === "daily" ? "每日" : "自动"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted font-mono text-xs">{formatSize(b.sizeBytes)}</td>
                  <td className="px-4 py-2.5 text-faint text-xs hidden sm:table-cell">
                    <div>{formatTime(b.createdAt)}</div>
                    <div className="text-zinc-300">{timeAgo(b.createdAt)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onRestore(b.fileName)}
                        disabled={restoring === b.fileName}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 px-2 py-1 text-xs text-primary hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50"
                        title="恢复到此备份"
                      >
                        {restoring === b.fileName ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        恢复
                      </button>
                      <button
                        onClick={() => onDelete(b.fileName)}
                        className="inline-flex items-center rounded-lg border border-red-200 dark:border-red-800 px-2 py-1 text-xs text-danger hover:bg-red-50 dark:hover:bg-red-950"
                        title="删除备份"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
