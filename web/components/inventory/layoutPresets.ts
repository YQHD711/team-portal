/** 常用元素尺寸预设（cm）：宽 × 深（墙/门/窗只关心长度） */
import type { ItemType } from "./layoutTypes";

export const SIZE_PRESETS: Record<ItemType, [number, number][]> = {
  shelf: [[200, 60], [240, 90], [300, 60], [120, 60]],
  cabinet: [[100, 60], [90, 45], [180, 60], [60, 45]],
  workbench: [[160, 80], [200, 100], [120, 60], [240, 120]],
  device: [[80, 80], [60, 60], [100, 60], [40, 40]],
};

/** 墙/门/窗常用长度（cm） */
export const POS_PRESETS: Record<"wall" | "door" | "window", number[]> = {
  wall: [100, 200, 300, 400],
  door: [80, 90, 100, 120],
  window: [100, 120, 180],
};
