"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import {
  HardDrive, Database, Clock, ShieldCheck, RefreshCw,
  Download, Upload, Trash2, AlertTriangle, CheckCircle,
  FileArchive, History
} from "lucide-react";

interface BackupInfo {
  fileName: string;
  tag: string;
  sizeBytes: number;
  createdAt: string;
}

interface BackupStats {
  dbPath: string;
  dbExists: boolean;
  dbSize: number;
  backupCount: number;
  latestBackup: string | null;
  latestBackupAge: string;
  backupDir: string;
  backups: { fileName: string; tag: string; sizeKb: number; createdAt: string }[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export default function BackupPage() {
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<BackupStats>("/api/admin/backup/stats"),
      api.get<BackupInfo[]>("/api/admin/backup"),
    ])
      .then(([s, b]) => {
        setStats(s);
        setBackups(b);
      })
      .catch(() => setMsg({ type: "error", text: "加载失败" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleBackup = async () => {
    setBackingUp(true);
    setMsg(null);
    try {
      const res = await api.post<{ success: boolean; message: string }>("/api/admin/backup", {});
      setMsg({ type: "success", text: res.message });
      fetchData();
    } catch {
      setMsg({ type: "error", text: "备份失败" });
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async (fileName: string) => {
    if (!confirm(`⚠️ 确定要从 "${fileName}" 恢复数据库？\n\n当前数据库将被替换，服务会自动重启。`)) return;
    if (!confirm("再次确认：此操作不可撤销！\n\n服务恢复后需要 3-5 秒重启。")) return;

    setRestoring(fileName);
    setMsg(null);
    try {
      const res = await api.post<{ success: boolean; message: string }>("/api/admin/backup/restore", {
        fileName,
        confirm: true,
      });
      setMsg({ type: "success", text: res.message + " 页面将在5秒后刷新..." });
      // Wait for restart then refresh
      setTimeout(() => {
        let attempts = 0;
        const check = setInterval(() => {
          fetch("/api/auth/login", { method: "HEAD" })
            .then(() => { clearInterval(check); window.location.reload(); })
            .catch(() => { if (++attempts > 30) clearInterval(check); });
        }, 2000);
      }, 5000);
    } catch {
      setMsg({ type: "error", text: "恢复失败" });
      setRestoring(null);
    }
  };

  const handleDelete = async (fileName: string) => {
    if (!confirm(`确定删除备份 "${fileName}"？`)) return;
    try {
      await api.delete(`/api/admin/backup/${encodeURIComponent(fileName)}`);
      setMsg({ type: "success", text: `已删除 ${fileName}` });
      fetchData();
    } catch {
      setMsg({ type: "error", text: "删除失败（可能是最新备份，不允许删除）" });
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">备份恢复</h1>
          <p className="text-sm text-muted">数据库自动备份与灾难恢复管理</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {backingUp ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <HardDrive className="h-4 w-4" />
            )}
            {backingUp ? "备份中..." : "立即备份"}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className="h-5 w-5 text-muted" />
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`text-sm p-3 rounded-xl flex items-center gap-2 ${
          msg.type === "success"
            ? "bg-green-50 dark:bg-green-950 text-green-700"
            : "bg-red-50 dark:bg-red-950 text-red-600"
        }`}>
          {msg.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
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
      )}

      {/* Info bar */}
      {stats && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted bg-slate-50 dark:bg-slate-900 rounded-xl p-3">
          <span>路径: <code className="text-xs bg-slate-200 dark:bg-slate-800 px-1 rounded">{stats.dbPath}</code></span>
          <span>备份目录: <code className="text-xs bg-slate-200 dark:bg-slate-800 px-1 rounded">{stats.backupDir}</code></span>
          {stats.latestBackup && <span>最新备份: <code className="text-xs bg-slate-200 dark:bg-slate-800 px-1 rounded">{stats.latestBackup}</code></span>}
        </div>
      )}

      {/* Backup list */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <History className="h-4 w-4 text-muted" />
          <h2 className="font-semibold text-sm">备份列表</h2>
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center text-zinc-400">
            <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-40" />
            加载中...
          </div>
        ) : backups.length === 0 ? (
          <div className="px-4 py-12 text-center text-zinc-400">
            <FileArchive className="h-8 w-8 mx-auto mb-2 opacity-30" />
            暂无备份，点击上方"立即备份"创建
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">文件名</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 w-16">类型</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 w-24">大小</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 w-40 hidden sm:table-cell">创建时间</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500 w-32">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {backups.map((b) => (
                  <tr key={b.fileName} className="hover:bg-zinc-50 dark:hover:bg-zinc-950">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <FileArchive className="h-4 w-4 text-blue-400 shrink-0" />
                        <span className="font-mono text-xs truncate max-w-[200px] sm:max-w-[300px]">{b.fileName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        b.tag === "manual"
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                          : b.tag === "daily"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}>
                        {b.tag === "manual" ? "手动" : b.tag === "daily" ? "每日" : "自动"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">{formatSize(b.sizeBytes)}</td>
                    <td className="px-4 py-2.5 text-zinc-400 text-xs hidden sm:table-cell">
                      <div>{formatTime(b.createdAt)}</div>
                      <div className="text-zinc-300">{timeAgo(b.createdAt)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleRestore(b.fileName)}
                          disabled={restoring === b.fileName}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50"
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
                          onClick={() => handleDelete(b.fileName)}
                          className="inline-flex items-center rounded-lg border border-red-200 dark:border-red-800 px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
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

      {/* Help text */}
      <div className="text-xs text-muted space-y-1 bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
        <p className="font-medium text-amber-700 dark:text-amber-400">⏱️ 自动备份策略</p>
        <p>• 每 6 小时自动备份一次（保留最近 24 个）</p>
        <p>• 每日凌晨 3 点备份并同步至百度网盘</p>
        <p>• 启动时自动检测数据库完整性，异常则从最新备份恢复</p>
        <p>• 手动备份不会被自动清理</p>
      </div>
    </div>
  );
}
