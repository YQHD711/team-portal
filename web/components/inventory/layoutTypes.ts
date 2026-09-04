/** 库位平面图数据类型与工具函数（编辑器与查看器共用） */
import {
  Boxes, Wrench, Archive, Cpu, BrickWall, DoorOpen, AppWindow,
  type LucideIcon,
} from "lucide-react";

/** 墙/门/窗等基础元素：位置 + 尺寸 + 旋转 */
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

/** 画布上的物品元素（货架/工作台/柜子/设备） */
export interface ItemElement extends PosElement {
  type: ItemType;
  name: string;
  locCode?: string;
  /** 货架专属：层数 / 每层位数 */
  shelfCount?: number;
  positionCount?: number;
}

/** 房间平面图（与后端 LayoutJson 字段对应） */
export interface RoomLayout {
  width: number;
  height: number;
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
  w: number;
  h: number;
}

export const ELEMENT_DEFS: Record<ElementKind, ElementDef> = {
  wall: { label: "墙", icon: BrickWall, color: "#64748b", w: 200, h: 10 },
  door: { label: "门", icon: DoorOpen, color: "#d97706", w: 80, h: 12 },
  window: { label: "窗", icon: AppWindow, color: "#38bdf8", w: 120, h: 10 },
  shelf: { label: "货架", icon: Boxes, color: "#0ea5e9", w: 200, h: 60 },
  workbench: { label: "工作台", icon: Wrench, color: "#a855f7", w: 160, h: 80 },
  cabinet: { label: "柜子", icon: Archive, color: "#f59e0b", w: 100, h: 50 },
  device: { label: "设备", icon: Cpu, color: "#10b981", w: 80, h: 80 },
};

export const ITEM_TYPES: ItemType[] = ["shelf", "workbench", "cabinet", "device"];

export const DEFAULT_CANVAS = { width: 900, height: 600 };

export function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** 新建元素：居中偏左上放置，重叠时错开一点 */
export function createElement(kind: ElementKind, layout: RoomLayout, index: number): PosElement | ItemElement {
  const def = ELEMENT_DEFS[kind];
  const base: PosElement = {
    id: `${kind}-${uid()}`,
    x: (layout.width - def.w) / 2 + (index % 5) * 24,
    y: (layout.height - def.h) / 2 + (index % 4) * 18,
    w: def.w, h: def.h, rotation: 0,
  };
  if (kind === "wall" || kind === "door" || kind === "window") return base;
  return {
    ...base,
    type: kind,
    name: def.label,
    locCode: "",
    shelfCount: kind === "shelf" ? 4 : undefined,
    positionCount: kind === "shelf" ? 8 : undefined,
  };
}

/** 默认平面图：四周墙 + 居中一个货架（与后端回填一致） */
export function defaultLayout(roomCode: string): RoomLayout {
  const { width, height } = DEFAULT_CANVAS;
  const wall = (id: string, x: number, y: number, w: number, h: number): PosElement =>
    ({ id, x, y, w, h, rotation: 0 });
  return {
    width, height,
    walls: [
      wall("w1", 20, 20, width - 40, 10),
      wall("w2", 20, height - 30, width - 40, 10),
      wall("w3", 20, 20, 10, height - 40),
      wall("w4", width - 30, 20, 10, height - 40),
    ],
    doors: [],
    windows: [],
    items: [{
      id: "it1", type: "shelf", name: "A货架",
      x: 330, y: 240, w: 240, h: 120, rotation: 0,
      locCode: `${roomCode}-A`, shelfCount: 4, positionCount: 8,
    }],
  };
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normPos(v: unknown): PosElement | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" && typeof o.id !== "number") return null;
  return {
    id: String(o.id),
    x: asNum(o.x, 0), y: asNum(o.y, 0),
    w: asNum(o.w, 100), h: asNum(o.h, 50),
    rotation: asNum(o.rotation, 0),
  };
}

function normItems(v: unknown): ItemElement[] {
  if (!Array.isArray(v)) return [];
  const out: ItemElement[] = [];
  for (const raw of v) {
    const pos = normPos(raw);
    if (!pos) continue;
    const o = raw as Record<string, unknown>;
    const type = ITEM_TYPES.find(t => t === o.type);
    if (!type) continue;
    out.push({
      ...pos,
      type,
      name: typeof o.name === "string" && o.name ? o.name : ELEMENT_DEFS[type].label,
      locCode: typeof o.locCode === "string" ? o.locCode : "",
      shelfCount: type === "shelf" ? Math.round(asNum(o.shelfCount, 4)) : undefined,
      positionCount: type === "shelf" ? Math.round(asNum(o.positionCount, 8)) : undefined,
    });
  }
  return out;
}

/** 解析后端 LayoutJson，损坏/缺失返回 null（调用方回退默认布局） */
export function parseLayout(json?: string | null): RoomLayout | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      width: asNum(raw.width, DEFAULT_CANVAS.width),
      height: asNum(raw.height, DEFAULT_CANVAS.height),
      walls: Array.isArray(raw.walls) ? raw.walls.map(normPos).filter((e): e is PosElement => e !== null) : [],
      doors: Array.isArray(raw.doors) ? raw.doors.map(normPos).filter((e): e is PosElement => e !== null) : [],
      windows: Array.isArray(raw.windows) ? raw.windows.map(normPos).filter((e): e is PosElement => e !== null) : [],
      items: normItems(raw.items),
    };
  } catch {
    return null;
  }
}

export function layoutToJson(layout: RoomLayout): string {
  return JSON.stringify(layout);
}
