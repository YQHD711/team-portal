"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { RefreshCw, Download, History, ChevronDown, ChevronRight } from "lucide-react";

/* ── 操作日志(OperationLog)── */
interface OperationEntry { id: number; userId: number | null; userName: string; action: string; targetType: string | null; targetId: string | null; data: string | null; ipAddress: string | null; createdAt: string; }
interface OperationPage { total: number; items: OperationEntry[]; }

/* 操作类型中文映射 */
const actionLabels: Record<string, string> = {
  login: "登录", register: "注册", logout: "登出", "change-password": "修改密码",
  checkout: "领用申请", checkin: "归还", "damage-report": "报损", stocktake: "盘点",
  reject: "驳回", approve: "审批", backup: "备份", restore: "恢复",
  import: "导入", create: "创建", update: "修改", delete: "删除",
  settings: "系统设置", invite: "邀请", upload: "上传",
};

const actionColors: Record<string, string> = {
  login: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  register: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  "change-password": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  create: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  import: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  upload: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  update: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
  settings: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
  delete: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  reject: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  backup: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  restore: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  checkout: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  checkin: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  "damage-report": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  stocktake: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
  invite: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
};

const actionLabel = (a: string) => actionLabels[a] ?? a;

/* ── 操作日志面板（表格 + 筛选 + 导出 + 分页）── */
export default function OperationLogsTab() {
  const [items, setItems] = useState<OperationEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pageSize = 50;

  const fetchOps = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (user) params.set("user", user);
    if (action) params.set("action", action);
    if (from) params.set("from", from + "T00:00:00Z");
    if (to) params.set("to", to + "T23:59:59Z");
    params.set("page", String(page));
    api.get<OperationPage>(`/api/admin/logs/operations?${params}`)
      .then(res => { setItems(res.items); setTotal(res.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, action, from, to, page]);

  useEffect(() => { fetchOps(); }, [fetchOps]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleExport = () => {
    const params = new URLSearchParams();
    if (user) params.set("user", user);
    if (action) params.set("action", action);
    if (from) params.set("from", from + "T00:00:00Z");
    if (to) params.set("to", to + "T23:59:59Z");
    window.open(`/api/admin/logs/operations/export?${params}`, "_blank");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <History className="h-4 w-4" />
          共 {total.toLocaleString()} 条操作记录
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-surface-hover">
            <Download className="h-4 w-4" />导出
          </button>
          <button onClick={fetchOps} className="p-2 rounded hover:bg-surface-hover">
            <RefreshCw className="h-5 w-5 text-muted" />
          </button>
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap gap-2 items-center">
        <input type="text" placeholder="操作人..." value={user} onChange={e => { setUser(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm w-32" />
        <select value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
          <option value="">全部操作类型</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1 text-sm text-muted">
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
          <span>—</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
        </div>
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
              <th className="px-4 py-3 text-left font-medium text-muted w-32 hidden sm:table-cell">来源IP</th>
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
                      {actionLabel(o.action)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted text-xs">
                    <span className="font-mono">{o.targetType ?? "—"}</span>
                    {o.targetId && <span className="ml-1 font-mono">#{o.targetId}</span>}
                    {o.data && (
                      <div className="mt-1">
                        {expanded === o.id ? (
                          <pre className="p-2 rounded bg-background text-[11px] text-muted font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{o.data}</pre>
                        ) : (
                          <span className="text-faint truncate block max-w-xs">{o.data}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-faint text-xs font-mono hidden sm:table-cell">{o.ipAddress || "—"}</td>
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
