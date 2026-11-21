"use client";

import type { TourStep } from "@/lib/tours/types";
import { ArrowDown, ArrowUp, Info, Plus, Trash2 } from "lucide-react";

/** 把锚点翻译成人话：管理员不需要知道 data-guide 是什么 */
function targetLabel(target: string): string {
  if (!target) return "屏幕中央（纯说明，不高亮任何元素）";
  if (target === "sidebar-base") return "左侧导航区";
  if (target.startsWith("nav-")) return "左侧菜单里的对应入口";
  if (target.startsWith("topbar-")) return "顶部栏的对应按钮";
  if (target.startsWith("page-")) return "页面标题";
  if (target === "ai-fab") return "右下角的 AI 助手按钮";
  if (target.startsWith("battery-")) return "电池借还页上的按钮/区块";
  if (target.startsWith("inventory-")) return "库存页上的按钮/区块";
  if (target.startsWith("study-")) return "学习库页上的区块";
  if (target.startsWith("flightlog-")) return "飞行日志页上的区块";
  if (target.startsWith("incidents-")) return "事故安全页上的区块";
  if (target.startsWith("files-")) return "资源共享页上的区块";
  if (target.startsWith("profile-")) return "我的档案页上的区块";
  if (target.startsWith("checkout-")) return "领用管理页上的区块";
  if (target.startsWith("stocktake-")) return "盘点页上的区块";
  if (target.startsWith("finance-")) return "采购申请页上的区块";
  if (target.startsWith("layout-")) return "物料布局页上的区块";
  return "页面里的某个元素";
}

/**
 * 引导步骤编辑器（面向管理员，不是开发者）：
 * 主要编辑标题与说明；高亮位置用中文描述，只有展开「高级」才露出技术标识。
 * 新步骤默认是"纯说明"（屏幕中央），不要求任何锚点。
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
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i} className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{i + 1}</span>
            <label className="flex items-center gap-1 text-[11px] text-muted" title="手机上没有左侧栏，这类步骤只在电脑端显示">
              <input type="checkbox" checked={!!step.desktopOnly}
                onChange={(e) => update(i, { desktopOnly: e.target.checked })} />
              只在电脑端显示
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30" aria-label="上移">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="rounded p-1 text-muted hover:bg-surface-hover disabled:opacity-30" aria-label="下移">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
                className="rounded p-1 text-danger hover:bg-surface-hover" aria-label="删除这一步">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <label className="mt-2 block text-[11px] text-muted">这一步的标题（队员一眼要看懂）</label>
          <input value={step.title} onChange={(e) => update(i, { title: e.target.value })}
            placeholder="例如：这里可以借电池" className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm" />

          <label className="mt-2 block text-[11px] text-muted">说明（具体怎么做）</label>
          <textarea value={step.body} onChange={(e) => update(i, { body: e.target.value })}
            placeholder="例如：扫电池上的二维码，然后点「借出」" rows={2}
            className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm" />

          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-faint">
            <Info className="h-3 w-3 shrink-0" />
            高亮位置：{targetLabel(step.target)}
          </div>

          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] text-faint">高级（技术人员用，一般不用改）</summary>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <input value={step.id} onChange={(e) => update(i, { id: e.target.value })}
                placeholder="步骤标识" className="rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]" />
              <input value={step.target} onChange={(e) => update(i, { target: e.target.value })}
                placeholder="页面锚点（留空 = 屏幕中央说明）" className="rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]" />
            </div>
          </details>
        </div>
      ))}

      <button onClick={add}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-2 text-sm text-muted hover:border-primary/40 hover:text-foreground">
        <Plus className="h-4 w-4" />添加一步说明
      </button>
      <p className="text-[11px] text-faint">
        提示：新增的步骤默认显示在屏幕中央、不高亮任何按钮；如果要它指向某个按钮，请让技术人员在「高级」里填锚点。
      </p>
    </div>
  );
}
