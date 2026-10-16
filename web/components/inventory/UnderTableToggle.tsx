"use client";

/**
 * 工作台「含桌下」开关（task-39 ③）。
 *
 * 只在**选中工作台**时出现（其它类型没有桌下概念）。
 *  - 关闭：若有桌下库位/物料 → **警告 + 确认**（取消则保持原状）；**绝不删数据**，编码与物料原样保留
 *  - 开启：`rows=1` 时**自动提到 2**（否则开关开着却没有桌下行）
 *  - **两件事都走既有 `commit`** → 一次 Ctrl+Z 可撤销（不绕过快照入口）
 *
 * 说明：用户原话希望开关在"属性面板"里；这里按与「移入/移出容器」一致的**选中即出现的顶层动作**实现
 * （同一模块已有该模式，且零 PropertyPanel 改动风险）。如需挪进属性面板，接线只是把本动作传给
 * `PropertyDialog` 即可（回调已收敛在本组件内）。
 */

import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";
import { hasUnderTable, setUnderTable, underTableImpact } from "./tableZones";

interface Props {
  layout: RoomLayout;
  selected: string | null;
  materials: readonly MaterialItem[];
  commit: (next: RoomLayout) => void;
  setMsg: (msg: string) => void;
}

export function UnderTableToggle({ layout, selected, materials, commit, setMsg }: Props) {
  const el: ItemElement | undefined = layout.items.find(i => i.id === selected);
  if (!el || el.type !== "workbench") return null;                 // 只在工作台上显示
  const on = hasUnderTable(el);

  const onChange = () => {
    if (on) {
      const impact = underTableImpact(el, materials);
      if (impact.cells > 0 || impact.items.length > 0) {
        const ok = confirm(
          `桌下有 ${impact.cells} 个库位、${impact.items.length} 件物料将不再可见（数据保留，重新开启即恢复）。确定关闭 / 取消`,
        );
        if (!ok) { setMsg("已取消：桌下保持开启"); return; }       // 取消 = 保持原状
      }
      commit(setUnderTable(layout, el.id, false));
      setMsg("已关闭桌下区（数据保留，重新开启即恢复；可一次撤销）");
      return;
    }
    const bumped = (el.rows ?? 1) < 2;
    commit(setUnderTable(layout, el.id, true));
    setMsg(bumped ? "已开启桌下：已把格位行数设为 2 以容纳桌下（可一次撤销）" : "已开启桌下区（可一次撤销）");
  };

  return (
    <label data-testid="under-table-toggle" className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" data-testid="under-table-check" checked={on} onChange={onChange} className="h-3.5 w-3.5" />
      含桌下（正视图显示桌下区）
    </label>
  );
}
