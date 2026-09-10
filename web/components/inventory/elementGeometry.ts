/**
 * 元素格位几何（单一来源）：格位划分 / 拖拽命中 / 连线锚点共用同一套坐标。
 * 所有类型共用「行 × 列」模型：行=层/抽屉层/排，列=位/格/区；1×1 表示整体挂载（无格位细分）。
 */
import type { ItemElement } from "./layoutTypes";
import { cellAxes, colsOf, rowsOf, usesCells } from "./layoutTypes";

export const CELL_PAD = 4;
/** 整体挂载（1×1）元素的计数 key */
export const WHOLE_CELL_KEY = "whole";

/** 标签区高度：与 PlannerShapes 渲染保持一致 */
export function headerHeight(el: ItemElement): number {
  const labelH = el.h > 40 ? 15 : 12;
  const codeH = el.locCode ? 11 : 0;
  return Math.min(labelH + codeH, Math.max(6, el.h - 14));
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

export interface ElementCell {
  row: number;
  col: number;
  /** 元素局部坐标（不含旋转，画布内渲染用） */
  lx: number;
  ly: number;
  w: number;
  h: number;
  /** 世界坐标中心（含旋转），拖拽命中与连线用 */
  cx: number;
  cy: number;
  /** 库位编码：locCode-层-位（如 1030-A-3-05）；无 locCode 时为空串 */
  code: string;
}

function rot(p: { x: number; y: number }, deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function cellDims(el: ItemElement) {
  const rows = rowsOf(el);
  const cols = colsOf(el);
  const top = headerHeight(el);
  const areaH = Math.max(10, el.h - top - CELL_PAD);
  return { rows, cols, top, cellW: (el.w - CELL_PAD * 2) / cols, cellH: areaH / rows };
}

/** 元素格位几何与编码（1×1 元素不划分，返回空数组） */
export function elementCells(el: ItemElement): ElementCell[] {
  if (!usesCells(el)) return [];
  const { rows, cols, top, cellW, cellH } = cellDims(el);
  const out: ElementCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = CELL_PAD + c * cellW;
      const ly = top + r * cellH;
      const cen = rot({ x: lx + cellW / 2, y: ly + cellH / 2 }, el.rotation);
      out.push({
        row: r, col: c, lx, ly, w: cellW, h: cellH,
        cx: el.x + cen.x, cy: el.y + cen.y,
        code: el.locCode ? `${el.locCode}-${r + 1}-${pad2(c + 1)}` : "",
      });
    }
  }
  return out;
}

/** 单格尺寸（cm），详情视图展示用；1×1 元素返回 null */
export function cellSizeCm(el: ItemElement): { w: number; h: number } | null {
  if (!usesCells(el)) return null;
  const { cellW, cellH } = cellDims(el);
  return { w: cellW, h: cellH };
}

/** 世界坐标命中格位（点先逆旋转到局部再算行列）；1×1 元素返回 null */
export function hitElementCell(el: ItemElement, px: number, py: number): ElementCell | null {
  if (!usesCells(el)) return null;
  const { rows, cols, top, cellW, cellH } = cellDims(el);
  const inv = rot({ x: px - el.x, y: py - el.y }, -el.rotation);
  if (inv.x < CELL_PAD || inv.y < top) return null;
  const c = Math.floor((inv.x - CELL_PAD) / cellW);
  const r = Math.floor((inv.y - top) / cellH);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return elementCells(el)[r * cols + c] ?? null;
}

/** 命中结果：有格位 → 命中格子；1×1 → 元素整体（cell 为 null） */
export interface ItemHit {
  el: ItemElement;
  cell: ElementCell | null;
}

/** 世界坐标命中物品元素（逆旋转检测；格位元素先命中格子） */
export function hitItemElement(el: ItemElement, px: number, py: number): ItemHit | null {
  if (usesCells(el)) {
    const cell = hitElementCell(el, px, py);
    return cell ? { el, cell } : null;
  }
  const inv = rot({ x: px - el.x, y: py - el.y }, -el.rotation);
  if (inv.x < 0 || inv.y < 0 || inv.x > el.w || inv.y > el.h) return null;
  return { el, cell: null };
}

/** 挂载单元：有格位 → 全部格子；1×1 → 元素整体一个单元（code 为 locCode） */
export function itemHitCells(el: ItemElement): ElementCell[] {
  if (usesCells(el)) return elementCells(el);
  if (!el.locCode) return [];
  const cen = rot({ x: el.w / 2, y: el.h / 2 }, el.rotation);
  return [{ row: 0, col: 0, lx: 0, ly: 0, w: el.w, h: el.h, cx: el.x + cen.x, cy: el.y + cen.y, code: el.locCode }];
}

/** 格位的业务名称：3层05位 / 2层01格 / 1排02区；1×1 用元素编码 */
export function cellLabelAt(el: ItemElement, row: number, col: number): string {
  if (!usesCells(el)) return el.locCode || "整体";
  const { rowLabel, colLabel } = cellAxes(el);
  return `${row + 1}${rowLabel}${pad2(col + 1)}${colLabel}`;
}

/** 由四段库位编码解析格位名称 */
export function cellLabelFromLoc(el: ItemElement, loc: string): string {
  const parts = (loc || "").split("-");
  const row = parseInt(parts[2] ?? "", 10);
  const col = parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return loc;
  return cellLabelAt(el, row - 1, col - 1);
}
