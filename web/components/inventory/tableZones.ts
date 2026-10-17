/**
 * 工作台的「桌上 / 桌下」分区（task-39 纠正版）。
 *
 * 语义（用户纠正后）：**俯视图不画桌下**（俯视是从上往下看，台面下方的区域本来就看不见，
 * 画出来会让人以为画布上有两块地）；**正视图（ElementDetail）显示两行**，桌下是真实存储位。
 *
 * ⚠️ **视图变化 ≠ 数据失效**（这条是**刻意**的，不是疏漏）：
 * 关闭开关后 `locationKey` 仍然接受第 2 段编码 —— 那些物料的 `locationCode` 原样保留、仍可解析，
 * 只是不在视图里出现。若"关闭即判无效"，物料就会变成**按库位查不到、连不上的孤儿数据**，
 * 比多显示一行糟得多。**不要把这里"顺手收紧"。**
 *
 * 泛化：`rows` 是总行数（工作台第 1 行=桌上，其余行=桌下/台下层）。
 *   frontRows = 开启 ? rows : max(1, rows - 1)
 *   topRows   = max(1, frontRows - (开启 ? 1 : 0))
 * 于是：rows=1+开启 → 俯1/正1（无桌下行，正常）；rows=2+开启 → 俯1/正2；rows=3+开启 → 俯2/正3。
 */

import type { ItemElement, MaterialItem, RoomLayout } from "./layoutTypes";
import { colsOf, rowsOf } from "./layoutTypes";

/**
 * 是否有桌下区。
 *
 * **"缺省即开启"只对真的存在第 2 行的老数据成立**（老数据 rows≥2 = 桌上 + 桌下）。
 * 之前无条件按 true 处理，导致 `rows=1` 的 1×1 工作台也显示「关闭桌下存储」（= 声称已开启），
 * 但 `frontRows = rows = 1` → **正视图里根本没有桌下行**：属性面板看不到桌下层，
 * 挂载物料时层位选择也只有「第 1 层」——正是用户报的
 * 「显示开启但 UI 没正确加载」「挂载物料时没办法挂载到桌下」。
 *
 * 现在：**一律要求 rows ≥ 2**（桌下 = 第 2 行起）——
 * 显式 `true` 且 rows≥2 → 开启；显式 `false` → 关闭；缺省 → rows≥2 才算开启（老数据语义）。
 * 这样"按钮状态"与"界面上真的有几行"永远一致，不会出现"显示已开启但没有桌下行"。
 */
export function hasUnderTable(el: ItemElement): boolean {
  if (el.type !== "workbench") return false;
  if (el.underTableEnabled === false) return false;
  // rows=1 时无论标志怎么设都不可能存在桌下层（桌下 = 第 2 行），故一律视为未开启。
  // 用户把「行数」改回 1 时也会自动回到"未开启"，而不是留一个点不动的开关。
  return rowsOf(el) >= 2;
}

/** 正视图（层×位网格）显示的行数 */
export function frontRows(el: ItemElement): number {
  // ⚠️ 只有工作台才有"桌下"概念：非工作台类型**不能**被 -1（测试抓到的边界）
  if (el.type !== "workbench") return rowsOf(el);
  return hasUnderTable(el) ? rowsOf(el) : Math.max(1, rowsOf(el) - 1);
}

/** 俯视图（画布元素）显示的格位行数：工作台只画桌上那一行 */
export function topRows(el: ItemElement): number {
  if (el.type !== "workbench") return rowsOf(el);
  return Math.max(1, frontRows(el) - (hasUnderTable(el) ? 1 : 0));
}

/** 桌下格位（可挂物料、**有编码**）——1-based 行号，第 2 行起 */
export function underTableCells(el: ItemElement): { row: number; col: number }[] {
  if (!hasUnderTable(el)) return [];
  const out: { row: number; col: number }[] = [];
  for (let row = 2; row <= rowsOf(el); row++) {
    for (let col = 1; col <= colsOf(el); col++) out.push({ row, col });
  }
  return out;
}

/** 关闭开关前的影响统计：**不许静默丢弃** —— 视图里将不再可见的库位数与物料 */
export function underTableImpact(
  el: ItemElement,
  materials: readonly MaterialItem[],
): { cells: number; items: MaterialItem[] } {
  const cells = underTableCells(el).length;
  const items = materials.filter(m => {
    const code = m.locationCode?.trim();
    if (!code || !el.locCode) return false;
    if (!code.startsWith(`${el.locCode}-`)) return false;
    const row = parseInt(code.split("-")[2] ?? "", 10);
    return Number.isFinite(row) && row >= 2;
  });
  return { cells, items };
}

/**
 * 打开/关闭桌下：
 *  - 打开且当前 `rows=1` → **自动提到 2**（否则开关开着却没有桌下行 = 用户困惑）
 *  - 关闭只改开关（**不删数据**：编码与物料原样保留，重新开启无损）
 */
export function withUnderTable(el: ItemElement, enabled: boolean): ItemElement {
  if (enabled) {
    const rows = rowsOf(el) < 2 ? 2 : rowsOf(el);
    return { ...el, underTableEnabled: true, rows };
  }
  return { ...el, underTableEnabled: false };
}

/** 布局级：改某个工作台的桌下开关（调用方只 commit 一次 → 一条撤销记录） */
export function setUnderTable(layout: RoomLayout, id: string, enabled: boolean): RoomLayout {
  return { ...layout, items: layout.items.map(i => (i.id === id ? withUnderTable(i, enabled) : i)) };
}
