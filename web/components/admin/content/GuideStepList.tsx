"use client";

import type { TourStep } from "@/lib/tours/types";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

/**
 * 引导步骤编辑器：标题 / 正文 / 锚点 / 是否仅桌面端，支持增删与上下移动。
 * 输出仍是 TourStep[]，保存时序列化成 StepsJson。
 */
export function GuideStepList({ steps, onChange }: { steps: TourStep[]; onChange: (next: TourStep[]) => void }) {
  const update = (index: number, patch: Partial<TourStep>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = () =>
    onChange([...steps, { id: `step-${steps.length + 1}`, target: "", title: "", body: "" }]);

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded-xl border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">第 {i + 1} 步</span>
            <input value={step.id} onChange={(e) => update(i, { id: e.target.value })}
              placeholder="步骤 id" className="w-32 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]" />
            <input value={step.target} onChange={(e) => update(i, { target: e.target.value })}
              placeholder="data-guide 锚点，如 battery-scan"
              className="min-w-40 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]" />
            <label className="flex items-center gap-1 text-[11px] text-muted">
              <input type="checkbox" checked={!!step.desktopOnly}
                onChange={(e) => update(i, { desktopOnly: e.target.checked })} />仅桌面
            </label>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30" aria-label="上移">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30" aria-label="下移">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
              className="rounded p-1 text-danger hover:bg-surface-hover" aria-label="删除步骤">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <input value={step.title} onChange={(e) => update(i, { title: e.target.value })}
            placeholder="标题" className="mt-2 w-full rounded border border-border bg-surface px-2 py-1 text-sm" />
          <textarea value={step.body} onChange={(e) => update(i, { body: e.target.value })}
            placeholder="正文说明" rows={2}
            className="mt-1.5 w-full rounded border border-border bg-surface px-2 py-1 text-sm" />
        </div>
      ))}
      <button onClick={add}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-2 text-sm text-muted hover:border-primary/40 hover:text-foreground">
        <Plus className="h-4 w-4" />添加步骤
      </button>
    </div>
  );
}
