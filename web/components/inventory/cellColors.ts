/** 格位配色（画布与列表共用的单一来源，不依赖 Konva，便于测试与复用） */
import type { ItemType } from "./layoutTypes";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "./LowStockProvider";

export const EMPTY_FILL = "rgba(255,255,255,0.30)";
export const LOW_FILL = "#f59e0b";
/** 各类型「有货」格位底色（与元素主色形成层次） */
export const FULL_FILL: Record<ItemType, string> = {
  shelf: "#1d4ed8",
  cabinet: "#b45309",
  workbench: "#7c4dff",
  device: "#047857",
};

/**
 * 画布格位填充色：空位半透明 / 低库存琥珀 / 有货按类型。
 * 阈值由调用方传入（后端设置下发，见 LowStockProvider），不再硬编码。
 */
export function cellFill(type: ItemType, qty: number, threshold: number = DEFAULT_LOW_STOCK_THRESHOLD): string {
  if (qty <= 0) return EMPTY_FILL;
  return qty < threshold ? LOW_FILL : FULL_FILL[type];
}

/** DOM 侧格位样式（正视细节视图）：空位虚线 / 低库存琥珀 / 有货蓝色 */
export function cellClasses(qty: number, threshold: number = DEFAULT_LOW_STOCK_THRESHOLD): string {
  if (qty <= 0) return "border-dashed border-border bg-surface-subtle text-faint";
  if (qty < threshold) return "border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-100";
  return "border-sky-300 dark:border-sky-800 bg-sky-100 dark:bg-sky-950 text-sky-900 dark:text-sky-100";
}
