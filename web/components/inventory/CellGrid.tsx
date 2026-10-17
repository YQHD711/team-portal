"use client";

/**
 * **正视格位图（两层摞在一起）**——task-40 ①②：直接嵌在属性面板里，不再是第二个弹窗。
 *
 * 用户反馈的原问题："一直写一个含桌下，谁都看不到" → 这里把**桌下层做成真正的一行**，
 * 行首明确写「桌上层」/「桌下层」，视觉上一眼能看出"这张桌子有上下两层"。
 *
 * 规则：
 * - 层数用既有 `frontRows(element)`：工作台开启桌下 = rows（桌上 + 桌下），否则 = rows（无桌下行）
 * - 每层一行，**上下紧挨**（不拆左右）
 * - 格子三态：有物料 → `N 件`；空 → **「未挂载」**；该层未开启 → **整行不渲染**
 * - 桌下层：虚线边框 + 浅色底 + 行首标签「桌下层」（靠视觉区分，不用角标）
 * - 编码复用既有 `cellLabelAt`（层-位：桌下层是层号 2 → `6011-D-2-01`），**不改数据模型**
 */

import type { ItemElement, MaterialItem } from "./layoutTypes";
import { ELEMENT_DEFS, colsOf, rowsOf, usesCells } from "./layoutTypes";
import { frontRows, hasUnderTable } from "./tableZones";
import { cellLabelAt } from "./elementGeometry";
import { materialsByCell } from "./locationCodes";

interface Props {
  /** 编辑中的元素（**草稿**也行：未保存的改动应立即反映出来） */
  element: ItemElement;
  items: MaterialItem[];
}

const cellCls = "flex min-w-[3.5rem] flex-1 flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors";

export function CellGrid({ element, items }: Props) {
  const split = usesCells(element);
  const cols = split ? colsOf(element) : 1;
  const totalRows = split ? frontRows(element) : 1;
  const grouped = materialsByCell(element, items);
  const def = ELEMENT_DEFS[element.type];
  const rowNames = def.rowNames ?? ["第1层"];

  return (
    <div className="space-y-1.5" data-testid="cell-grid">
      {Array.from({ length: totalRows }, (_, row) => {
        // 桌下行的判定：工作台开启桌下时，**最后一行**就是桌下层（与 frontRows 一致）
        const isUnderRow = hasUnderTable(element) && row === totalRows - 1 && totalRows > 1;
        const label = isUnderRow ? "桌下层" : (rowNames[row] ?? `第${row + 1}层`);
        return (
          <div key={row} className="flex items-stretch gap-1.5" data-testid={`cell-row-${row}`}>
            <span className={`flex w-14 shrink-0 items-center text-[11px] font-medium ${isUnderRow ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}>
              {label}
            </span>
            {Array.from({ length: cols }, (_, col) => {
              const key = `${row}-${col}`;
              const list = grouped.get(key) ?? [];
              const code = split ? cellLabelAt(element, row, col) : (element.locCode || "整体");
              const under = isUnderRow;
              return (
                <div key={key} data-testid={`cell-${row}-${col}`} title={code}
                  className={`${cellCls} ${under
                    ? "border-dashed border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-border bg-surface-subtle"}`}>
                  <span className="font-mono text-[10px] text-faint">{code.split("-").slice(-2).join("-")}</span>
                  {list.length > 0 ? (
                    <span className={`rounded px-1 text-[10px] font-medium ${under ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"}`}>
                      {list.length} 件
                    </span>
                  ) : (
                    <span className="text-[10px] text-faint">未挂载</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {hasUnderTable(element) ? (
        <p className="text-[10px] text-faint">虚线一行是<b>桌下层</b>：桌子下面也能存东西，格子有自己的库位编码（先保存后生效）。</p>
      ) : (
        <p className="text-[10px] text-faint">当前只有一层。桌子下面也能存东西？点下面的「＋ 开启桌下存储」。</p>
      )}
    </div>
  );
}

/** 供属性面板判断"是否显示开启桌下按钮"（只有工作台/多行才谈得上桌下） */
export function canUnderTable(element: ItemElement): boolean {
  return element.type === "workbench" && rowsOf(element) >= 1;
}
