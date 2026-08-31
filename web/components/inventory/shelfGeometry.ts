/** 元素挂载几何与物料统计：货架格子 / 非货架整体命中、拖拽、连线共用同一套坐标（单一来源） */
import type { ItemElement, MaterialItem } from "./layoutTypes";

export const CELL_PAD = 4;

/** 非货架元素的计数 key（整体挂载，无层位细分） */
export const WHOLE_CELL_KEY = "whole";

/** 货架标签区高度：与 PlannerShapes 渲染一致 */
function labelTop(el: ItemElement): number {
  const labelH = el.h > 30 ? 16 : 14;
  return el.locCode ? labelH + 14 : labelH;
}

function rot(p: { x: number; y: number }, deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function cellDims(el: ItemElement) {
  const cols = el.positionCount ?? 8;
  const rows = el.shelfCount ?? 4;
  const top = labelTop(el);
  const areaH = Math.max(10, el.h - top - CELL_PAD);
  return { rows, cols, top, cellW: (el.w - CELL_PAD * 2) / cols, cellH: areaH / rows };
}

export interface ShelfCell {
  row: number;
  col: number;
  /** 货架局部坐标（不含旋转，画布内渲染用） */
  lx: number;
  ly: number;
  w: number;
  h: number;
  /** 世界坐标中心（含旋转），拖拽命中与连线用 */
  cx: number;
  cy: number;
  /** 四段库位编码：货架locCode-层-位，如 1030-A-3-05 */
  code: string;
}

/** 货架全部格子的几何与编码（无 locCode 时 code 为空，仅渲染） */
export function shelfCells(el: ItemElement): ShelfCell[] {
  if (el.type !== "shelf" || !el.shelfCount || !el.positionCount) return [];
  const { rows, cols, top, cellW, cellH } = cellDims(el);
  const out: ShelfCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = CELL_PAD + c * cellW;
      const ly = top + r * cellH;
      const cen = rot({ x: lx + cellW / 2, y: ly + cellH / 2 }, el.rotation);
      out.push({
        row: r, col: c, lx, ly, w: cellW, h: cellH,
        cx: el.x + cen.x, cy: el.y + cen.y,
        code: el.locCode ? `${el.locCode}-${r + 1}-${String(c + 1).padStart(2, "0")}` : "",
      });
    }
  }
  return out;
}

/** 世界坐标命中货架格子（点先逆旋转到局部再算行列） */
export function hitShelfCell(el: ItemElement, px: number, py: number): ShelfCell | null {
  if (el.type !== "shelf" || !el.shelfCount || !el.positionCount) return null;
  const { rows, cols, top, cellW, cellH } = cellDims(el);
  const inv = rot({ x: px - el.x, y: py - el.y }, -el.rotation);
  if (inv.x < CELL_PAD || inv.y < top) return null;
  const c = Math.floor((inv.x - CELL_PAD) / cellW);
  const r = Math.floor((inv.y - top) / cellH);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return shelfCells(el)[r * cols + c] ?? null;
}

/** 命中结果：货架命中格子；工作台/柜子/设备命中元素整体（cell 为 null） */
export interface ItemHit {
  el: ItemElement;
  cell: ShelfCell | null;
}

/** 世界坐标命中物品元素：货架→格子；非货架→整体矩形（逆旋转检测，不含层位细分） */
export function hitItemElement(el: ItemElement, px: number, py: number): ItemHit | null {
  if (el.type === "shelf") {
    const cell = hitShelfCell(el, px, py);
    return cell ? { el, cell } : null;
  }
  const inv = rot({ x: px - el.x, y: py - el.y }, -el.rotation);
  if (inv.x < 0 || inv.y < 0 || inv.x > el.w || inv.y > el.h) return null;
  return { el, cell: null };
}

/** 挂载单元几何：货架→全部格子；非货架→元素整体一个单元（code 为 locCode，无 locCode 返回空） */
export function itemHitCells(el: ItemElement): ShelfCell[] {
  if (el.type === "shelf") return shelfCells(el);
  if (!el.locCode) return [];
  const cen = rot({ x: el.w / 2, y: el.h / 2 }, el.rotation);
  return [{ row: 0, col: 0, lx: 0, ly: 0, w: el.w, h: el.h, cx: el.x + cen.x, cy: el.y + cen.y, code: el.locCode }];
}

/** 元素挂载物料统计：货架按 层-位 细分；非货架整体计数（key=WHOLE_CELL_KEY），匹配完整 locCode 或以 locCode- 开头（兼容） */
export function cellCounts(el: ItemElement, items: MaterialItem[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!el.locCode) return map;
  if (el.type === "shelf") {
    const prefix = el.locCode + "-";
    for (const it of items) {
      const loc = it.locationCode || "";
      if (!loc.startsWith(prefix)) continue;
      const parts = loc.split("-");
      if (parts.length < 4) continue;
      const row = parseInt(parts[2], 10);
      const col = parseInt(parts[3], 10);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      const key = `${row - 1}-${col - 1}`;
      map.set(key, (map.get(key) || 0) + it.quantity);
    }
    return map;
  }
  let total = 0;
  for (const it of items) {
    const loc = it.locationCode || "";
    if (loc === el.locCode || loc.startsWith(el.locCode + "-")) total += it.quantity;
  }
  if (total > 0) map.set(WHOLE_CELL_KEY, total);
  return map;
}
