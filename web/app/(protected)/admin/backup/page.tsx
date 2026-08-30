"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { AlertTriangle, CheckCircle, HardDrive, RefreshCw } from "lucide-react";
import BackupStatsCards from "@/components/admin/backup/BackupStatsCards";
import BackupTable from "@/components/admin/backup/BackupTable";
import type { BackupInfo, BackupStats } from "@/components/admin/backup/backupTypes";

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
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:opacity-50 transition-colors"
          >
            {backingUp ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <HardDrive className="h-4 w-4" />
            )}
            {backingUp ? "备份中..." : "立即备份"}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg hover:bg-surface-hover">
            <RefreshCw className="h-5 w-5 text-muted" />
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`text-sm p-3 rounded-xl flex items-center gap-2 ${
          msg.type === "success"
            ? "bg-success/10 text-success"
            : "bg-danger/10 text-danger"
        }`}>
          {msg.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      {/* Stats cards */}
      {stats && <BackupStatsCards stats={stats} />}

      {/* Info bar */}
      {stats && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted bg-surface-subtle rounded-xl p-3">
          <span>路径: <code className="text-xs bg-surface-hover px-1 rounded">{stats.dbPath}</code></span>
          <span>备份目录: <code className="text-xs bg-surface-hover px-1 rounded">{stats.backupDir}</code></span>
          {stats.latestBackup && <span>最新备份: <code className="text-xs bg-surface-hover px-1 rounded">{stats.latestBackup}</code></span>}
        </div>
      )}

      {/* Backup list */}
      <BackupTable backups={backups} loading={loading} restoring={restoring} onRestore={handleRestore} onDelete={handleDelete} />

      {/* Help text */}
      <div className="text-xs text-muted space-y-1 bg-warning/10 rounded-xl p-4 border border-warning/30">
        <p className="font-medium text-warning">⏱️ 自动备份策略</p>
        <p>• 每 6 小时自动备份一次（保留最近 24 个）</p>
        <p>• 每日凌晨 3 点备份并同步至百度网盘</p>
        <p>• 启动时自动检测数据库完整性，异常则从最新备份恢复</p>
        <p>• 手动备份不会被自动清理</p>
      </div>
    </div>
  );
}
