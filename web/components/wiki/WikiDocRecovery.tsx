"use client";

import { useState, useEffect } from "react";
import { BookOpen, Loader2, RefreshCw, History } from "lucide-react";
import {
  diagnoseTask, restoreFromHistory, retryMissingDocuments,
  type WikiDiagnostics,
} from "@/lib/wikiRetry";

/**
 * 文档读取失败时的恢复面板。
 *
 * 同时给出「文档在哪」和「两种恢复方式」：
 *   1) 从 .history 历史版本恢复 —— 零 AI 成本（文档曾被覆盖/清空时可用）
 *   2) 只补齐缺失文档 —— 会调用 AI，但只针对缺失的那几篇，与仓库大小无关
 */
export function WikiDocRecovery({
  taskId, projectName, docPath, onRecovered,
}: {
  taskId: string;
  projectName: string;
  docPath: string;
  onRecovered: () => void;
}) {
  const [diag, setDiag] = useState<WikiDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    diagnoseTask(taskId)
      .then(d => { if (alive) setDiag(d); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : "诊断失败"); });
    return () => { alive = false; };
  }, [taskId]);

  const current = diag?.documents.find(d => d.path === docPath);
  const recoverable = diag?.recoverableFromHistory.length ?? 0;

  const run = async (action: "history" | "ai") => {
    setBusy(true);
    setMessage(null);
    try {
      const text = action === "history"
        ? await restoreFromHistory(taskId, recoverable)
        : await retryMissingDocuments(taskId, projectName);
      setMessage(text || "已取消");
      if (text) onRecovered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-center py-16 max-w-xl mx-auto space-y-3">
      <BookOpen className="h-10 w-10 mx-auto text-zinc-300" />
      <div className="text-sm text-danger">文档读取失败：{docPath}</div>

      {current && (
        <div className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-left space-y-1">
          <div className="text-muted">该文档在服务器上的位置：</div>
          <div className="font-mono break-all">{diag?.kbRoot}/{current.relativeFile}</div>
          <div className="text-faint">
            项目目录：<span className="font-mono">{diag?.projectDir}</span>
            {diag?.workspaceExists ? " · 源码工作区仍在（补写不必重新下载）" : " · 源码工作区已清理"}
          </div>
          <div className="text-faint">
            历史版本：{current.historyVersions} 个
            {diag ? ` · 本项目缺失 ${diag.missing.length} 篇，其中 ${recoverable} 篇可零成本恢复` : ""}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => run("history")}
          disabled={busy || !diag}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
          title="从知识库 .history 备份恢复：不调用 AI、无费用"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
          从历史版本恢复（免费）
        </button>
        <button
          onClick={() => run("ai")}
          disabled={busy || !diag}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          title="只对缺失的文档调用 AI 重新生成，已有文档不重跑"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          补齐缺失文档（AI）
        </button>
      </div>

      {message && <div className="text-xs text-success">{message}</div>}
      {error && <div className="text-xs text-danger">{error}</div>}
      {!diag && !error && <div className="text-xs text-faint">正在检查文档位置…</div>}
    </div>
  );
}
