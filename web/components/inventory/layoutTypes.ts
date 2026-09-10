/** 库位平面图数据类型与元素定义（编辑器与查看器共用）；画布坐标单位统一为厘米（cm） */
import {
  Boxes, Wrench, Archive, Cpu, BrickWall, DoorOpen, AppWindow,
  type LucideIcon,
} from "lucide-react";
import { COLS_MAX, ROWS_MAX, intIn } from "./layoutUnits";

/** 墙/门/窗等基础元素：位置 + 尺寸 + 旋转（cm / 度） */
export interface PosElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export type ItemType = "shelf" | "workbench" | "cabinet" | "device";
export type ElementKind = "wall" | "door" | "window" | ItemType;

/**
 * 画布上的物品元素（立体货架/工作台·桌面/柜子/设备）。
 * 所有类型共用「行 × 列」格位模型：行=层/抽屉层/排，列=位/格/区；1×1 表示整体挂载。
 */
export interface ItemElement extends PosElement {
  type: ItemType;
  name: string;
  locCode?: string;
  /** 格位行数（货架=层，柜子=抽屉层，桌面=排），缺省 1 */
  rows?: number;
  /** 格位列数（货架=位，柜子=格，桌面=区），缺省 1 */
  cols?: number;
}

/** 房间平面图（与后端 LayoutJson 字段对应，坐标单位 cm） */
export interface RoomLayout {
  width: number;
  height: number;
  /** 坐标单位标记，缺省 cm（兼容旧数据） */
  unit?: string;
  walls: PosElement[];
  doors: PosElement[];
  windows: PosElement[];
  items: ItemElement[];
}

/** 物料（来自 /api/inventory 或 /api/storage/layouts/{room}/items） */
export interface MaterialItem {
  id: number;
  name: string;
  category?: string;
  quantity: number;
  unitPrice?: number;
  locationCode?: string;
}

export interface ElementDef {
  label: string;
  icon: LucideIcon;
  color: string;
  /** 默认尺寸（cm） */
  w: number;
  h: number;
  /** 默认格位（1×1 = 整体挂载，不划分） */
  rows?: number;
  cols?: number;
  /** 行/列的业务称呼，用于界面文案 */
  rowLabel?: string;
  colLabel?: string;
  hint: string;
}

export const ELEMENT_DEFS: Record<ElementKind, ElementDef> = {
  wall: { label: "墙", icon: BrickWall, color: "#64748b", w: 200, h: 10, hint: "房间隔墙" },
  door: { label: "门", icon: DoorOpen, color: "#d97706", w: 80, h: 12, hint: "出入口" },
  window: { label: "窗", icon: AppWindow, color: "#38bdf8", w: 120, h: 10, hint: "窗户" },
  shelf: {
    label: "立体货架", icon: Boxes, color: "#0ea5e9", w: 200, h: 60,
    rows: 4, cols: 8, rowLabel: "层", colLabel: "位",
    hint: "俯视为占地，行列即「层 × 位」，可挂载到具体层位",
  },
  workbench: {
    label: "工作台", icon: Wrench, color: "#a855f7", w: 160, h: 80,
    rows: 1, cols: 3, rowLabel: "排", colLabel: "区",
    hint: "桌面/工作台：台面按区划分，1×1 即整张台面",
  },
  cabinet: {
    label: "柜子", icon: Archive, color: "#f59e0b", w: 100, h: 60,
    rows: 4, cols: 2, rowLabel: "层", colLabel: "格",
    hint: "柜子：按抽屉层与柜格划分，1×1 即整个柜体",
  },
  device: {
    label: "设备", icon: Cpu, color: "#10b981", w: 80, h: 80,
    rows: 1, cols: 1, rowLabel: "排", colLabel: "区",
    hint: "设备：默认整体挂载",
  },
};

export const ITEM_TYPES: ItemType[] = ["shelf", "workbench", "cabinet", "device"];

/** 默认画布：900 × 600 cm（9m × 6m） */
export const DEFAULT_CANVAS = { width: 900, height: 600 };

/** 元素的默认行/列（取自身值，缺省 1） */
export function rowsOf(el: ItemElement): number {
  return intIn(el.rows, 1, ROWS_MAX, 1);
}

export function colsOf(el: ItemElement): number {
  return intIn(el.cols, 1, COLS_MAX, 1);
}

/** 是否划分格位（行×列 > 1 才有格位细分，否则整体挂载） */
export function usesCells(el: ItemElement): boolean {
  return rowsOf(el) * colsOf(el) > 1;
}

/** 行/列的界面称呼，例如「层 × 位」 */
export function cellAxes(el: ItemElement): { rowLabel: string; colLabel: string } {
  const def = ELEMENT_DEFS[el.type];
  return { rowLabel: def.rowLabel ?? "行", colLabel: def.colLabel ?? "列" };
}

/** 格位规模文案：4 层 × 8 位 / 整体挂载 */
export function cellSummary(el: ItemElement): string {
  if (!usesCells(el)) return "整体挂载";
  const { rowLabel, colLabel } = cellAxes(el);
  return `${rowsOf(el)} ${rowLabel} × ${colsOf(el)} ${colLabel}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}
