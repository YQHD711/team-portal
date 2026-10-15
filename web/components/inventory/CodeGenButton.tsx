"use client";

/** 显式按钮：为**未指定库位**的元素生成库位编码（预览 → 一次 commit = 一条撤销记录）。
 *  ⚠️ 渲染期不做批量计算：计划只在点击时算。 */
import { useState } from "react";
import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";
import { applyCodePlan, planCodes, planSummary } from "./layoutCodeGen";

interface Props {
  layout: RoomLayout;
  materials: readonly MaterialItem[];
  roomCode: string | null;
  onApply: (next: RoomLayout) => void;
}

export function CodeGenButton({ layout, materials, roomCode, onApply }: Props) {
  const [msg, setMsg] = useState("");

  const onClick = () => {
    const plan = planCodes(layout, materials, roomCode);
    if (plan.assignments.length === 0) {
      setMsg(plan.warnings.join(" ") || "没有需要补码的元素");
      return;
    }
    // 预览：把"将生成哪些编码 + 跳过了哪些已占用号"摆给用户，确认后才写
    const ok = confirm(`将为 ${plan.assignments.length} 个未指定库位的元素生成编码：\n\n${planSummary(plan)}\n\n已有编码不会被改动。继续？`);
    if (!ok) {
      setMsg("已取消，未改动任何编码");
      return;
    }
    onApply(applyCodePlan(layout, plan));     // 一次提交 → 一次 Ctrl+Z 可整批撤销
    setMsg(`已生成 ${plan.assignments.length} 个编码（可一次撤销）`);
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" data-testid="generate-loc-codes" onClick={onClick}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-hover">
        生成库位编码
      </button>
      {msg && <span data-testid="generate-loc-codes-msg" className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}

/** 需要补码的元素清单（供测试/预览复用） */
export function pendingCodeCount(layout: RoomLayout): number {
  return layout.items.filter((el: ItemElement) => !el.locCode?.trim()).length;
}
