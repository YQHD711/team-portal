/**
 * 查看器的定位种子：`?element=&item=` 传进来后，决定「初始选中哪个元素、哪个格位」。
 *
 * 抽成纯函数是为了可单测：参数解析、元素 id/库位编码两种写法、物料落点越界
 * 都要能在没有 Canvas 的环境里验证（PlannerViewer 依赖 react-konva）。
 */
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { cellKey, elementCells, type ElementCell } from "./elementGeometry";
import { findElementByLoc, materialsByCell } from "./locationCodes";

/** 元素 id / 库位编码 → 布局里的元素（URL 里两种写法都接受） */
export function pickInitialElement(items: ItemElement[], key?: string): ItemElement | null {
  if (!key) return null;
  const upper = key.toUpperCase();
  return items.find(e => e.id.toUpperCase() === upper)
    ?? items.find(e => (e.locCode || "").toUpperCase() === upper)
    ?? findElementByLoc(items, key);
}

/** 由 materialsByCell 的 "row-col" key 还原格位对象（越界/整体挂载返回 null） */
export function findCellByKey(el: ItemElement, key: string): ElementCell | null {
  return elementCells(el).find(c => cellKey(c.row, c.col) === key) ?? null;
}

/** 所查物料在该元素下的格位；1×1 元素或查不到返回 null（= 元素整体） */
export function findFocusCell(el: ItemElement, item: MaterialItem | null): ElementCell | null {
  if (!item) return null;
  const key = [...materialsByCell(el, [item])].find(([, list]) => list.length > 0)?.[0];
  return key ? findCellByKey(el, key) : null;
}
