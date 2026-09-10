"use client";

/** 编辑器顶部状态条：点选挂载进行中 / 物料列表加载失败 */
import { AlertTriangle, X } from "lucide-react";

interface Props {
  /** 待挂载物料（点选挂载模式） */
  pending: { name: string } | null;
  loadError: boolean;
  onCancel: () => void;
}

export function MountStatusBar({ pending, loadError, onCancel }: Props) {
  if (!pending && !loadError) return null;
  return (
    <div className="space-y-2">
      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">房间物料列表加载失败：可继续编辑平面图，但无法挂载物料。</span>
        </div>
      )}
      {pending && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <span className="min-w-0 flex-1 truncate">点选挂载「{pending.name}」：在画布上点击目标格位完成，或直接拖拽物料。</span>
          <button onClick={onCancel} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-400 px-2 py-0.5 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900">
            <X className="h-3 w-3" />取消
          </button>
        </div>
      )}
    </div>
  );
}
