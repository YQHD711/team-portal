/** LayoutJson 编解码：解析/序列化、旧数据兼容、默认布局与新建元素（坐标单位 cm） */
import { COLS_MAX, DEFAULT_COLS, DEFAULT_ROWS, ROWS_MAX, intIn, numIn } from "./layoutUnits";
import type { ElementKind, ItemElement, ItemType, PosElement, RoomLayout } from "./layoutTypes";
import { DEFAULT_CANVAS, ELEMENT_DEFS, ITEM_TYPES, uid } from "./layoutTypes";

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
    rows: def.rows ?? 1,
    cols: def.cols ?? 1,
  };
}

/** 默认平面图：四周墙 + 居中一个货架（与后端回填一致） */
export function defaultLayout(roomCode: string): RoomLayout {
  const { width, height } = DEFAULT_CANVAS;
  const wall = (id: string, x: number, y: number, w: number, h: number): PosElement =>
    ({ id, x, y, w, h, rotation: 0 });
  return {
    width, height, unit: "cm",
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
      locCode: `${roomCode}-A`, rows: DEFAULT_ROWS, cols: DEFAULT_COLS,
    }],
  };
}

function normPos(v: unknown): PosElement | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" && typeof o.id !== "number") return null;
  return {
    id: String(o.id),
    x: numIn(o.x, 0, 100000, 0), y: numIn(o.y, 0, 100000, 0),
    w: numIn(o.w, 1, 100000, 100), h: numIn(o.h, 1, 100000, 50),
    rotation: numIn(o.rotation, -360, 360, 0),
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
    // 兼容旧字段 shelfCount / positionCount → rows / cols
    out.push({
      ...pos,
      type,
      name: typeof o.name === "string" && o.name ? o.name : ELEMENT_DEFS[type].label,
      locCode: typeof o.locCode === "string" ? o.locCode : "",
      rows: intIn(o.rows ?? o.shelfCount, 1, ROWS_MAX, type === "shelf" ? DEFAULT_ROWS : 1),
      cols: intIn(o.cols ?? o.positionCount, 1, COLS_MAX, type === "shelf" ? DEFAULT_COLS : 1),
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
      width: numIn(raw.width, 100, 100000, DEFAULT_CANVAS.width),
      height: numIn(raw.height, 100, 100000, DEFAULT_CANVAS.height),
      unit: typeof raw.unit === "string" ? raw.unit : "cm",
      walls: Array.isArray(raw.walls) ? raw.walls.map(normPos).filter((e): e is PosElement => e !== null) : [],
      doors: Array.isArray(raw.doors) ? raw.doors.map(normPos).filter((e): e is PosElement => e !== null) : [],
      windows: Array.isArray(raw.windows) ? raw.windows.map(normPos).filter((e): e is PosElement => e !== null) : [],
      items: normItems(raw.items),
    };
  } catch {
    return null;
  }
}

/** 序列化：始终写入 unit=cm，坐标即厘米 */
export function layoutToJson(layout: RoomLayout): string {
  return JSON.stringify({ ...layout, unit: "cm" });
}

/** 元素构成摘要（房间卡片展示用）：立体货架×2 柜子×1 */
export function layoutSummary(layout: RoomLayout): string {
  const counts = new Map<ItemType, number>();
  for (const it of layout.items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
  const parts = ITEM_TYPES.filter(t => counts.get(t)).map(t => `${ELEMENT_DEFS[t].label}×${counts.get(t)}`);
  return parts.length > 0 ? parts.join(" ") : "暂无元素";
}

/** 浅拷贝并写回指定 id 的元素（编辑器 patch 用） */
export function withElement(cur: RoomLayout, el: PosElement | ItemElement): RoomLayout {
  const repl = <T extends PosElement>(arr: T[]): T[] => arr.map(e => (e.id === el.id ? (el as T) : e));
  if (cur.walls.some(e => e.id === el.id)) return { ...cur, walls: repl(cur.walls) };
  if (cur.doors.some(e => e.id === el.id)) return { ...cur, doors: repl(cur.doors) };
  if (cur.windows.some(e => e.id === el.id)) return { ...cur, windows: repl(cur.windows) };
  return { ...cur, items: repl(cur.items) };
}
