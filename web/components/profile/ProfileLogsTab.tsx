"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { History, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import {
  actionColors, actionLabel, summarize,
  type OperationEntry, type OperationPage,
} from "@/lib/operationLog";

interface Props {
  userId: number;
  /** 展示用；查询一律按 userId（用户名可改，id 不会变） */
  username: string;
}

/**
 * 队员档案里的「操作日志」tab（仅管理员可见）。
 *
 * 为什么按 userId 而不是 userName 查：用户名可以被管理员改掉，
 * 用名字查会把这个人的历史一刀两断（改名前的记录查不到了）。
 */
export default function ProfileLogsTab({ userId, username }: Props) {
  const [items, setItems] = useState<OperationEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    api.get<OperationPage>(`/api/admin/logs/operations?userId=${userId}&size=50`)
      .then(res => { setItems(res.items); setTotal(res.total); })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <History className="h-4 w-4" />
          <span><strong className="text-zinc-700 dark:text-zinc-300">{username}</strong> 共 {total.toLocaleString()} 条操作记录</span>
        </div>
        <button onClick={fetchLogs} className="p-2 rounded hover:bg-surface-hover" title="刷新">
          <RefreshCw className="h-4 w-4 text-muted" />
        </button>
      </div>

      {total > items.length && (
        <p className="text-xs text-faint">仅显示最近 {items.length} 条；完整检索与导出见「系统日志 → 操作日志」。</p>
      )}

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="px-4 py-12 text-center text-faint text-sm">加载中...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-faint">
            <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm">这位队员还没有操作记录</div>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {items.map(o => (
              <li key={o.id} className={o.data ? "cursor-pointer" : ""}
                onClick={() => o.data && setExpanded(expanded === o.id ? null : o.id)}>
                <div className="px-4 py-2.5 flex items-start gap-3">
                  <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${actionColors[o.action] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {actionLabel(o.action, o.targetType)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-faint">{new Date(o.createdAt).toLocaleString("zh-CN")}</span>
                      <span className="text-xs text-faint font-mono truncate">
                        {o.targetType ?? "—"}{o.targetId ? ` #${o.targetId}` : ""}
                        {o.ipAddress ? ` · ${o.ipAddress}` : ""}
                      </span>
                    </div>
                    {o.data && (
                      expanded === o.id
                        ? <pre className="mt-1.5 p-2 rounded bg-background text-[11px] text-muted font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{o.data}</pre>
                        : <div className="mt-0.5 text-xs text-muted truncate">{summarize(o.data)}</div>
                    )}
                  </div>
                  {o.data && (expanded === o.id
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-faint mt-0.5" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-faint mt-0.5" />)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
