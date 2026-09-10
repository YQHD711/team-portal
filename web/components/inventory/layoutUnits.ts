/** 物料布局单位与数值格式化：画布坐标单位统一为厘米（cm）——1 小格 20cm，1 主格 100cm = 1m */

export const LAYOUT_UNIT = "cm";
/** 细网格间距（cm） */
export const GRID_STEP_CM = 20;
/** 主网格间距（cm），标注数值 */
export const MAJOR_STEP_CM = 100;
/** 元素最小边长（cm） */
export const MIN_ELEMENT_CM = 8;
/** 画布尺寸范围（cm） */
export const ROOM_MIN_CM = 200;
export const ROOM_MAX_CM = 5000;
/** 格位行/列上限（与后端 StorageEndpoints 校验一致：层 ≤9、位 ≤99） */
export const ROWS_MAX = 9;
export const COLS_MAX = 99;
/** 货架默认层数/位数（新建与旧数据回填用） */
export const DEFAULT_ROWS = 4;
export const DEFAULT_COLS = 8;

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 任意输入转整数并夹取范围；非法值回落 fallback */
export function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : fallback;
}

/** 任意输入转数值并夹取范围；非法值回落 fallback */
export function numIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

/** 去掉多余小数：8 → "8"，23.75 → "23.8" */
export function cm(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/** 单个长度："240 cm" */
export function formatLen(v: number): string {
  return `${cm(v)} ${LAYOUT_UNIT}`;
}

/** 平面尺寸："240 × 120 cm" */
export function formatDims(w: number, h: number): string {
  return `${cm(w)} × ${cm(h)} ${LAYOUT_UNIT}`;
}

/** 面积：28800 cm² → "2.88 m²" */
export function formatArea(w: number, h: number): string {
  const m2 = (w * h) / 10000;
  return `${m2 >= 100 ? Math.round(m2) : Math.round(m2 * 100) / 100} m²`;
}

/** 单格尺寸："约 24 × 15 cm/格"（格位不足时返回空串） */
export function formatCellDims(w?: number, h?: number, unit = "格"): string {
  if (!w || !h || w <= 0 || h <= 0) return "";
  return `约 ${cm(w)} × ${cm(h)} ${LAYOUT_UNIT}/${unit}`;
}

/** 把 cm 值转成 m 的显示（房间尺寸副标注）：900 → "9.0 m" */
export function formatMeters(v: number): string {
  return `${(v / 100).toFixed(v % 100 === 0 ? 0 : 1)} m`;
}
