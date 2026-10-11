/**
 * 设计器的几何计算（纯函数，好测）：0.5mm 吸附 + **始终夹在页面内**。
 *
 * 顺序很重要：先吸附再夹取 —— 否则"吸附把元素推出边界"（例如宽度 79.8 的元素向右吸到 80 就出界了）。
 */

export const SNAP_MM = 0.5;
/** 元素最小边长（mm）：太小了就抓不住手柄 */
export const MIN_SIZE_MM = 2;

export interface Rect { x: number; y: number; w: number; h: number }
export interface PageSize { widthMm: number; heightMm: number }
export type Corner = "nw" | "ne" | "sw" | "se";

/** 去掉浮点尾巴（0.30000000000000004 → 0.3），保留 2 位 */
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** 吸附到 0.5mm 网格 */
export const snapMm = (v: number): number => round2(Math.round(v / SNAP_MM) * SNAP_MM);

const clampNum = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo);

/** 把矩形夹进页面：尺寸先合法（≥最小、≤页面），位置再夹 */
export function clampRect(rect: Rect, page: PageSize): Rect {
  const minW = Math.min(MIN_SIZE_MM, page.widthMm);
  const minH = Math.min(MIN_SIZE_MM, page.heightMm);
  const w = round2(clampNum(rect.w, minW, page.widthMm));
  const h = round2(clampNum(rect.h, minH, page.heightMm));
  return {
    w, h,
    x: round2(clampNum(rect.x, 0, Math.max(0, page.widthMm - w))),
    y: round2(clampNum(rect.y, 0, Math.max(0, page.heightMm - h))),
  };
}

/** 位移：吸附 0.5mm → 再夹一次 */
export function moveRect(rect: Rect, page: PageSize, dxMm: number, dyMm: number): Rect {
  return clampRect({ x: snapMm(rect.x + dxMm), y: snapMm(rect.y + dyMm), w: rect.w, h: rect.h }, page);
}

/** 拖角缩放：尺寸吸附到 0.5mm，且不越出页面（对角固定） */
export function resizeRect(rect: Rect, page: PageSize, corner: Corner, dxMm: number, dyMm: number): Rect {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const w = snapMm(Math.max(MIN_SIZE_MM, corner === "nw" || corner === "sw" ? rect.w - dxMm : rect.w + dxMm));
  const h = snapMm(Math.max(MIN_SIZE_MM, corner === "nw" || corner === "ne" ? rect.h - dyMm : rect.h + dyMm));
  const x = corner === "nw" || corner === "sw" ? right - w : rect.x;
  const y = corner === "nw" || corner === "ne" ? bottom - h : rect.y;
  return clampRect({ x, y, w, h }, page);
}

/** 拖拽用的指针增量 → mm（缩放比例 = 画布 px/mm） */
export function deltaMm(clientDx: number, clientDy: number, pxPerMm: number): { dxMm: number; dyMm: number } {
  return { dxMm: clientDx / pxPerMm, dyMm: clientDy / pxPerMm };
}
