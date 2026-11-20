"use client";

import { Modal } from "@/components/ui/Modal";
import { useCurrentUser } from "@/lib/hooks";
import { useTourDefs } from "@/components/content/ContentProvider";
import { visibleTours } from "@/lib/tours/registry";
import { useTour } from "./TourProvider";
import { CheckCircle2, Play, RotateCcw, SkipForward } from "lucide-react";

/**
 * 引导中心：列出当前角色可见的全部引导及其状态，可逐个重看、可全部重置。
 * 这里是「跳过之后想再看」和「引导改版后重新走一遍」的统一入口。
 */
export function TourCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useCurrentUser();
  const tours = useTourDefs();
  const { progress, start, reset } = useTour();
  const list = visibleTours(user?.role, tours);

  function begin(key: string) {
    onClose();
    // 等 Modal 关闭再开始，避免遮罩与弹窗抢层级
    setTimeout(() => start(key), 50);
  }

  async function resetAll() {
    if (!window.confirm("确定重置全部引导进度？之后这些引导会重新自动弹出。")) return;
    await reset();
  }

  return (
    <Modal open={open} onClose={onClose} title="使用引导">
      <div className="space-y-2">
        <p className="text-xs text-muted">每条功能引导都可以单独重看；完成后不会自动再弹。</p>
        {list.map((tour) => {
          const saved = progress[tour.key];
          const updated = saved?.status === "done" && saved.version < tour.version;
          return (
            <div key={tour.key} className="flex items-center gap-2 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{tour.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span>{tour.steps.length} 步</span>
                  {saved?.status === "done" && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />已完成{updated ? "（有更新）" : ""}
                    </span>
                  )}
                  {saved?.status === "skipped" && (
                    <span className="inline-flex items-center gap-1"><SkipForward className="h-3 w-3" />已跳过</span>
                  )}
                  {saved?.status === "in_progress" && <span className="text-primary">进行中 · 第 {saved.stepIndex + 1} 步</span>}
                  {!saved && <span>未开始</span>}
                </div>
              </div>
              <button onClick={() => begin(tour.key)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground">
                <Play className="h-3 w-3" />{saved ? "重看" : "开始"}
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="py-6 text-center text-sm text-faint">当前账号还没有可用的引导</p>}
      </div>

      <button onClick={resetAll}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-muted hover:bg-surface-hover hover:text-foreground">
        <RotateCcw className="h-3.5 w-3.5" />重置全部引导
      </button>
    </Modal>
  );
}
