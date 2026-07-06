"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import {
  RefreshCw, Info, AlertTriangle, XCircle, Download, Trash2,
  Activity, ShieldCheck, Clock
} from "lucide-react";

interface LogEntry { id: number; level: string; category: string; message: string; detail: string | null; userName: string | null; createdAt: string; }
interface LogStats { total: number; errors24h: number; warns24h: number; recentErrors: { category: string; message: string; createdAt: string }[]; }

const levelColors: Record<string, string> = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const levelIcons: Record<string, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warn: <AlertTriangle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
};

const categories = ["all", "auth", "wiki", "knowledge", "inventory", "admin", "system", "baidu", "ai"];

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const fetchLogs = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (category) params.set("category", category);
    if (keyword) params.set("keyword", keyword);
    if (from) params.set("from", from + "T00:00:00Z");
    if (to) params.set("to", to + "T23:59:59Z");
    params.set("page", String(page));
    api.get<LogEntry[]>(`/api/admin/logs?${params}`)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchStats = () => {
    api.get<LogStats>("/api/admin/logs/stats")
      .then(setStats)
      .catch(() => {});
  };

  useEffect(() => {
    fetchLogs();
    fetchStats();
    const t = setInterval(fetchStats, 30000);
    return () => clearInterval(t);
  }, [level, category, page, from, to]);

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (from) params.set("from", from + "T00:00:00Z");
    if (to) params.set("to", to + "T23:59:59Z");
    window.open(`/api/admin/logs/export?${params}`, "_blank");
  };

  const handleCleanup = async () => {
    if (!confirm("删除超过保留期的旧日志？\n\n（90天前的日志）")) return;
    try {
      const res = await api.post<{ deleted: number; message: string }>("/api/admin/logs/cleanup", {});
      setMsg(`✅ ${res.deleted} 条日志已清理`);
      fetchLogs();
      fetchStats();
    } catch { setMsg("❌ 清理失败"); }
  };

  const handleClearAll = async () => {
    if (!confirm("⚠️ 这将删除所有日志记录，不可恢复！\n\n确定继续？")) return;
    try {
      const res = await api.post<{ deleted: number; message: string }>("/api/admin/logs/cleanup?force=true", {});
      setMsg(`✅ 全部 ${res.deleted} 条日志已清除`);
      fetchLogs();
      fetchStats();
    } catch { setMsg("❌ 清除失败"); }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">系统日志</h1>
          <p className="text-sm text-muted">记录系统运行状态和操作历史</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <Download className="h-4 w-4" />导出
          </button>
          <button onClick={handleCleanup} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <Trash2 className="h-4 w-4" />清理旧日志
          </button>
          <button onClick={handleClearAll} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
            <Trash2 className="h-4 w-4" />清除全部
          </button>
          <button onClick={() => { fetchLogs(); fetchStats(); }} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className="h-5 w-5 text-muted" />
          </button>
        </div>
      </div>

      {msg && (
        <div className={`text-sm p-3 rounded-xl ${msg.startsWith("✅") ? "bg-green-50 dark:bg-green-950 text-green-700" : "bg-red-50 dark:bg-red-950 text-red-600"}`}>{msg}</div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800">
              <Activity className="h-5 w-5 text-slate-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
              <div className="text-xs text-muted">日志总数</div>
            </div>
          </div>
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/50">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.errors24h}</div>
              <div className="text-xs text-red-500">24h 错误</div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.warns24h}</div>
              <div className="text-xs text-amber-500">24h 警告</div>
            </div>
          </div>
        </div>
      )}

      {/* Recent errors */}
      {stats && stats.recentErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-4 w-4 text-red-500" />
            <h3 className="font-semibold text-sm text-red-700 dark:text-red-300">最近错误</h3>
          </div>
          <div className="space-y-1">
            {stats.recentErrors.map((e, i) => (
              <div key={i} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/50 font-mono">{e.category}</span>
                <span className="truncate">{e.message}</span>
                <span className="shrink-0 text-red-400 ml-auto">
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {new Date(e.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={level} onChange={e => { setLevel(e.target.value); setPage(1); }}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm">
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm">
          {categories.map(c => <option key={c} value={c === "all" ? "" : c}>{c === "all" ? "全部分类" : c}</option>)}
        </select>
        <input type="text" placeholder="搜索关键词..." value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-40" />
        <div className="flex items-center gap-1 text-sm text-muted">
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm" />
          <span>—</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm" />
        </div>
      </div>

      {/* Log table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-16">级别</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-20">分类</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">消息</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-20 hidden sm:table-cell">用户</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-36 hidden md:table-cell">时间</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading && logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">加载中...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无日志记录
                </td></tr>
              ) : logs.map(l => (
                <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950 cursor-pointer"
                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${levelColors[l.level] || ""}`}>
                      {levelIcons[l.level]}{l.level}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs font-mono">{l.category}</td>
                  <td className="px-4 py-2.5">
                    <div className="truncate max-w-xs lg:max-w-md">{l.message}</div>
                    {expanded === l.id && l.detail && (
                      <div className="mt-1 p-2 rounded bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-500 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{l.detail}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400 text-xs hidden sm:table-cell">{l.userName || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-400 text-xs hidden md:table-cell">{new Date(l.createdAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center gap-2">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="px-3 py-1 rounded border text-sm disabled:opacity-30 hover:bg-slate-50">上一页</button>
        <span className="px-3 py-1 text-sm text-zinc-500">第 {page} 页</span>
        <button onClick={() => setPage(p => p + 1)} disabled={logs.length < 50}
          className="px-3 py-1 rounded border text-sm disabled:opacity-30 hover:bg-slate-50">下一页</button>
      </div>
    </div>
  );
}
