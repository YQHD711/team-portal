"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { RefreshCw, Info, AlertTriangle, XCircle, Filter } from "lucide-react";

interface LogEntry { id: number; level: string; category: string; message: string; detail: string | null; userName: string | null; createdAt: string; }

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

const categories = ["all", "auth", "wiki", "knowledge", "inventory", "admin", "system"];

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetch = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (category) params.set("category", category);
    params.set("page", String(page));
    api.get<LogEntry[]>(`/api/admin/logs?${params}`).then(setLogs).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); const t = setInterval(fetch, 10000); return () => clearInterval(t); }, [level, category, page]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">系统日志</h1><p className="text-sm text-zinc-500">记录系统运行状态和操作历史</p></div>
        <button onClick={fetch} className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><RefreshCw className="h-5 w-5 text-zinc-500" /></button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={level} onChange={e => { setLevel(e.target.value); setPage(1); }} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm">
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm">
          {categories.map(c => <option key={c} value={c === "all" ? "" : c}>{c === "all" ? "全部分类" : c}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-16">级别</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-24">分类</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">消息</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-20 hidden sm:table-cell">用户</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500 w-40 hidden md:table-cell">时间</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading && logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">加载中...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">暂无日志记录</td></tr>
              ) : logs.map(l => (
                <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950 cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <td className="px-4 py-2.5"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${levelColors[l.level] || ""}`}>{levelIcons[l.level]}{l.level}</span></td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{l.category}</td>
                  <td className="px-4 py-2.5">
                    <div className="truncate max-w-xs">{l.message}</div>
                    {expanded === l.id && l.detail && <div className="mt-1 p-2 rounded bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-500 font-mono whitespace-pre-wrap break-all">{l.detail}</div>}
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
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded border text-sm disabled:opacity-30">上一页</button>
        <span className="px-3 py-1 text-sm text-zinc-500">第 {page} 页</span>
        <button onClick={() => setPage(p => p + 1)} disabled={logs.length < 50} className="px-3 py-1 rounded border text-sm disabled:opacity-30">下一页</button>
      </div>
    </div>
  );
}
