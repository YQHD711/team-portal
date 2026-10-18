"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { datedFilename, downloadErrorMessage, saveBlob } from "@/lib/download";
import { RefreshCw, Download, History, ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  actionColors, actionLabel, baseActionLabels, summarize, targetTypeOptions,
  type OperationEntry, type OperationPage,
} from "@/lib/operationLog";

export default function OperationLogsTab() {
  const [items, setItems] = useState<OperationEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState("");
  const pageSize = 50;

  const fetchOps = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (user) params.set("user", user);
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (targetId) params.set("targetId", targetId);
    if (keyword) params.set("q", keyword);
    if (from) params.set("from", from + "T00:00:00Z");
    if (to) params.set("to", to + "T23:59:59Z");
    params.set("page", String(page));
    api.get<OperationPage>(`/api/admin/logs/operations?${params}`)
      .then(res => { setItems(res.items); setTotal(res.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, action, targetType, targetId, keyword, from, to, page]);

  useEffect(() => { fetchOps(); }, [fetchOps]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /**
   * 导出 CSV：必须走 api.download（带 Authorization 头）。
   * `window.open` 开的新标签页发不出 token（JWT 在 localStorage）→ 接口是 AdminOnly，必 401。
   * api.download 只回 Blob，拿不到 Content-Disposition，所以文件名用与后端一致的客户端默认名。
   */
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setMsg("导出中…");
    try {
      const params = new URLSearchParams();
      if (user) params.set("user", user);
      if (action) params.set("action", action);
      if (from) params.set("from", from + "T00:00:00Z");
      if (to) params.set("to", to + "T23:59:59Z");
      const blob = await api.download(`/api/admin/logs/operations/export?${params}`);
      saveBlob(blob, datedFilename("operations"));
      setMsg("");
    } catch (err) {
      // 401 由 api.download 接管（清 token + 跳登录）→ 不再提示"导出失败"
      const message = downloadErrorMessage(err);
      setMsg(message ? `导出失败：${message}` : "");
    } finally {
      setExporting(false);
    }
  };

  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <History className="h-4 w-4" />共 {total.toLocaleString()} 条操作记录
        </div>
        <div className="flex gap-2">
          <button onClick={() => void handleExport()} disabled={exporting} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50">
            <Download className="h-4 w-4" />{exporting ? "导出中…" : "导出"}
          </button>
          <button onClick={fetchOps} className="p-2 rounded hover:bg-surface-hover">
            <RefreshCw className="h-5 w-5 text-muted" />
          </button>
        </div>
      </div>

      {/* 导出反馈（401 已由 api.download 接管，不显示误导性的"导出失败"） */}
      {msg && (
        <p data-testid="operation-export-msg"
          className={`rounded-lg border-l-4 px-3 py-2 text-xs ${msg.startsWith("导出失败") ? "border-danger bg-red-50 text-red-700" : "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"}`}>
          {msg}
        </p>
      )}

      {/* 筛选 */}
      <div className="flex flex-wrap gap-2 items-center">
        <input type="text" placeholder="操作人..." value={user} onChange={e => reset(setUser)(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm w-32" />
        <select value={action} onChange={e => reset(setAction)(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
          <option value="">全部动作</option>
          {Object.entries(baseActionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={targetType} onChange={e => reset(setTargetType)(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
          <option value="">全部目标类型</option>
          {targetTypeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="text" placeholder="目标ID" value={targetId} onChange={e => reset(setTargetId)(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm w-20" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
          <input type="text" placeholder="关键词(内容)..." value={keyword} onChange={e => reset(setKeyword)(e.target.value)}
            className="rounded-lg border border-border bg-surface pl-8 pr-3 py-1.5 text-sm w-44" />
        </div>
        <input type="date" value={from} onChange={e => reset(setFrom)(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        <span className="text-sm text-muted">—</span>
        <input type="date" value={to} onChange={e => reset(setTo)(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
      </div>

      {/* 表格 */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-background">
              <th className="px-4 py-3 text-left font-medium text-muted w-36 hidden md:table-cell">时间</th>
              <th className="px-4 py-3 text-left font-medium text-muted w-24">操作人</th>
              <th className="px-4 py-3 text-left font-medium text-muted w-24">操作类型</th>
              <th className="px-4 py-3 text-left font-medium text-muted">目标</th>
                <th className="px-4 py-3 text-left font-medium text-muted w-8"></th>
            </tr></thead>
            <tbody className="divide-y divide-border-subtle">
              {loading && items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-faint">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-faint">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-30" />暂无操作记录
                </td></tr>
              ) : items.map(o => (
                <tr key={o.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950 cursor-pointer align-top"
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                  <td className="px-4 py-2.5 text-faint text-xs hidden md:table-cell whitespace-nowrap">{new Date(o.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{o.userName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${actionColors[o.action] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                      {actionLabel(o.action, o.targetType)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted text-xs">
                    <span className="font-mono">{o.targetType ?? "—"}</span>
                    {o.targetId && <span className="ml-1 font-mono">#{o.targetId}</span>}
                    <div className="mt-1 max-w-md">
                      {expanded === o.id ? (
                        <div className="p-2 rounded bg-background text-[11px] text-muted font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{o.data}</div>
                      ) : (o.data ? <span className="text-faint line-clamp-2 break-all">{summarize(o.data)}</span> : null)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-faint">
                    {o.data ? (expanded === o.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center gap-2">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="px-3 py-1 rounded border text-sm disabled:opacity-30 hover:bg-slate-50">上一页</button>
        <span className="px-3 py-1 text-sm text-muted">第 {page} / {totalPages} 页</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="px-3 py-1 rounded border text-sm disabled:opacity-30 hover:bg-slate-50">下一页</button>
      </div>
    </div>
  );
}
