"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Brain, RefreshCw, AlertTriangle } from "lucide-react";

export interface RagStats {
  days: number;
  searchCount: number;
  emptyCount: number;
  emptyRatePct: number;
  returnedTotal: number;
  recentEmpty: { query: string; at: string }[];
  contextCount: number;
  avgContextChars: number;
  avgUsedDocs: number;
}

function rateColor(pct: number): string {
  if (pct >= 50) return "text-danger";
  if (pct >= 20) return "text-warning";
  return "text-success";
}

/**
 * 「AI 检索统计」卡片：把 RAG 的空转率摆到管理员面前。
 *
 * 背景：此前检索效果**没有任何观测数据**，没人知道中文提问是否命中过任何资料。
 * 数据来自 SystemLogs（category=ai）里 KnowledgeSearchService / AiProxyService 记的
 * `RAG search:` 与 `RAG context:` 行，由 `/api/admin/rag-stats` 聚合。
 */
export function RagStatsCard({ days = 7 }: { days?: number }) {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setStats(await api.get<RagStats>("/api/admin/rag-stats"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5" data-testid="rag-stats-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Brain className="h-4 w-4" />AI 检索统计（近 {stats?.days ?? days} 天）
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
          title="重新拉取统计"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />刷新
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>无法获取检索统计：{error}</span>
        </div>
      )}

      {!error && !stats && <div className="text-sm text-muted py-4">加载中…</div>}

      {stats && stats.searchCount === 0 && (
        <div className="text-sm text-muted py-2">
          暂无检索记录 —— 近 {stats.days} 天没有聊天检索落到知识库（可能还没人提问，或检索日志尚未落盘）。
        </div>
      )}

      {stats && stats.searchCount > 0 && (
        <div className="space-y-4">
          <div className="flex items-end gap-6">
            <div>
              <div className="text-xs text-muted mb-1">空转率（空结果占比）</div>
              <div className={`text-3xl font-extrabold tabular-nums ${rateColor(stats.emptyRatePct)}`} data-testid="rag-empty-rate">
                {stats.emptyRatePct.toFixed(1)}<span className="text-base text-muted ml-1">%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-muted">检索次数</span><span className="tabular-nums text-right">{stats.searchCount}</span>
              <span className="text-muted">空结果次数</span><span className="tabular-nums text-right">{stats.emptyCount}</span>
              <span className="text-muted">平均注入文档</span><span className="tabular-nums text-right">{stats.avgUsedDocs}</span>
              <span className="text-muted">平均上下文字符</span><span className="tabular-nums text-right">{stats.avgContextChars}</span>
            </div>
          </div>

          <div>
            <div className="text-xs text-muted mb-1">最近空结果提问（知识库缺口线索）</div>
            {stats.recentEmpty.length === 0 ? (
              <div className="text-sm text-success">最近没有空结果 —— 中文提问都命中到了资料。</div>
            ) : (
              <ul className="space-y-0.5" data-testid="rag-recent-empty">
                {stats.recentEmpty.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-sm flex items-center justify-between gap-3">
                    <span className="truncate" title={e.query}>{e.query}</span>
                    <span className="text-xs text-faint shrink-0">{new Date(e.at).toLocaleString("zh-CN")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
