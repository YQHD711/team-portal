/** 库位编码 ↔ 元素/格位 的映射与物料统计：四段编码 = 室-元素-层-位 */
import type { ItemElement, MaterialItem } from "./layoutTypes";
import { colsOf, rowsOf, usesCells } from "./layoutTypes";
import { WHOLE_CELL_KEY, cellKey, pad2 } from "./elementGeometry";

/** 按库位编码找到所属元素：四段=室-元素-层-位；短编码按完整编码或前缀匹配（兼容旧数据） */
export function findElementByLoc(elements: ItemElement[], loc: string): ItemElement | null {
  const code = (loc || "").trim();
  if (!code) return null;
  const parts = code.split("-");
  if (parts.length >= 4) {
    const target = `${parts[0]}-${parts[1]}`.toUpperCase();
    return elements.find(e => (e.locCode || "").toUpperCase() === target) ?? null;
  }
  return elements.find(e => !!e.locCode && (code === e.locCode || code.startsWith(e.locCode + "-"))) ?? null;
}

/** 物料库位编码 → 所属元素的格位 key（1×1 元素返回 locCode；不属于该元素或越界返回 null） */
export function locationKey(el: ItemElement, loc: string): string | null {
  if (!el.locCode) return null;
  const parts = (loc || "").split("-");
  if (parts.length >= 4) {
    // 四段编码必须同属「室-元素」，否则是别的元素的物料
    if (`${parts[0]}-${parts[1]}`.toUpperCase() !== el.locCode.toUpperCase()) return null;
    if (!usesCells(el)) return el.locCode;
    const row = parseInt(parts[2], 10);
    const col = parseInt(parts[3], 10);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    if (row < 1 || row > rowsOf(el) || col < 1 || col > colsOf(el)) return null;
    return `${el.locCode}-${row}-${pad2(col)}`;
  }
  // 无格位细分时才接受短编码（整体挂载，兼容旧数据的前缀写法）
  if (!usesCells(el) && (loc === el.locCode || loc.startsWith(el.locCode + "-"))) return el.locCode;
  return null;
}

/** 该元素下的物料列表 */
export function elementMaterials(el: ItemElement, items: MaterialItem[]): MaterialItem[] {
  return items.filter(it => locationKey(el, it.locationCode || "") !== null);
}

/** 按格位分组的物料：key = cellKey(row, col)（1×1 元素为 0-0） */
export function materialsByCell(el: ItemElement, items: MaterialItem[]): Map<string, MaterialItem[]> {
  const map = new Map<string, MaterialItem[]>();
  for (const it of elementMaterials(el, items)) {
    const key = locationKey(el, it.locationCode || "");
    if (!key) continue;
    const parts = key.split("-");
    const k = usesCells(el)
      ? cellKey(parseInt(parts[2], 10) - 1, parseInt(parts[3], 10) - 1)
      : cellKey(0, 0);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

/** 元素挂载物料统计：格位元素按 层-位 细分；1×1 元素整体计数（key = WHOLE_CELL_KEY） */
export function cellCounts(el: ItemElement, items: MaterialItem[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!usesCells(el)) {
    const total = elementMaterials(el, items).reduce((s, i) => s + i.quantity, 0);
    if (total > 0) map.set(WHOLE_CELL_KEY, total);
    return map;
  }
  for (const [k, list] of materialsByCell(el, items)) map.set(k, list.reduce((s, i) => s + i.quantity, 0));
  return map;
}

/** 元素挂载统计：总数 / 种类 / 占用格位 */
export interface ElementStats {
  total: number;
  kinds: number;
  usedCells: number;
  totalCells: number;
}

export function elementStats(el: ItemElement, items: MaterialItem[]): ElementStats {
  const list = elementMaterials(el, items);
  const totalCells = usesCells(el) ? rowsOf(el) * colsOf(el) : 1;
  const used = new Set<string>();
  for (const it of list) {
    const key = locationKey(el, it.locationCode || "");
    if (key) used.add(key);
  }
  return {
    total: list.reduce((s, i) => s + i.quantity, 0),
    kinds: list.length,
    usedCells: used.size,
    totalCells,
  };
}
