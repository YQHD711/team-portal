"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, GitBranch } from "lucide-react";
import { diagnoseTask, recloneWorkspace } from "@/lib/wikiRetry";

/**
 * 源码工作区丢失提示条。
 *
 * 工作区建在容器 /tmp（未挂卷），每次部署重建容器就整片清空：
 * 任务记录和文档都还在，但源码浏览 /blob 全部 404，用户只看到「文件不存在」。
 * 这里在项目页把原因说清楚，并提供「重新克隆」把源码按需拉回来
 * （只下载源码，不调用 AI、不产生费用）。
 */
export function WikiWorkspaceBanner({ taskId, projectName }: { taskId: string; projectName: string }) {
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 诊断是纯文件检查（不产生 AI 调用），但只在 workspaceExists=false 时才需要展示
  useEffect(() => {
    let alive = true;
    diagnoseTask(taskId)
      .then(d => { if (alive) setLost(!d.workspaceExists); })
      .catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  if (!lost) return null;

  const run = async () => {
    setBusy(true); setMessage(null); setError(null);
    try {
      const text = await recloneWorkspace(taskId, projectName);
      if (!text) return; // 用户取消
      const diag = await diagnoseTask(taskId);
      setLost(!diag.workspaceExists);
      setMessage(diag.workspaceExists ? text : "克隆已结束，但工作区仍不可用，请查看任务错误信息");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新克隆失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>源码工作区已丢失（重建容器会清空临时工作区），源码浏览会 404。</span>
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2 py-1 font-medium transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900"
        title="只重新下载源码：不调用 AI、不产生费用，已生成的文档不受影响"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
        {busy ? "正在重新克隆..." : "重新克隆源码"}
      </button>
      {message && <span className="text-success">{message}</span>}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
