/**
 * 布局页定位参数解析：把 `/inventory/layout?room=&element=&item=` 解析成
 * 「进哪个房间 / 选中并高亮哪个元素 / 高亮哪件物料」。
 *
 * 刻意做成纯函数：参数缺失、参数对不上（房间没有平面图、元素不在该房间、
 * 物料编码为空）都必须退化成「和没有参数一样」，这些分支必须能被单测钉住。
 */
import type { ItemElement, MaterialItem, RoomLayout } from "@/components/inventory/layoutTypes";
import { parseLayout } from "@/components/inventory/layoutCodec";
import { findElementByLoc } from "@/components/inventory/locationCodes";
import type { RoomLayoutRow } from "@/components/inventory/layoutRow";

/** 定位目标：三者都可为空，全空即「无定位请求」 */
export interface LayoutFocus {
  room: string;
  element: string;
  item: string;
}

/** 传给查看器的受控入参：初始选中元素 + 要高亮的元素/物料 */
export interface LayoutFocusTarget {
  initialElementId?: string;
  focusElementId?: string;
  focusItemId?: number | null;
  focusItemName?: string;
}

export const EMPTY_FOCUS: LayoutFocus = { room: "", element: "", item: "" };

/** 读取查询参数（大小写不敏感，允许 id 或 code 作为 item） */
export function parseLayoutFocus(params: URLSearchParams): LayoutFocus {
  return {
    room: (params.get("room") || "").trim(),
    element: (params.get("element") || "").trim(),
    item: (params.get("item") || "").trim(),
  };
}

/** 是否指定了任何定位参数 */
export function hasLayoutFocus(focus: LayoutFocus): boolean {
  return Boolean(focus.room || focus.element || focus.item);
}

/** 找不到能显示这一物料的房间 */
export function findFocusRoom(layouts: RoomLayoutRow[], focus: LayoutFocus): RoomLayoutRow | null {
  if (!focus.room) return null;
  const code = focus.room.toUpperCase();
  return layouts.find(l => l.roomCode.toUpperCase() === code) ?? null;
}

/** 元素定位：先按元素 id（可点击元素自身传 id），再按库位编码前缀匹配 */
export function resolveFocusElement(layout: RoomLayout | null, focus: LayoutFocus): ItemElement | null {
  if (!layout) return null;
  const key = focus.element.toUpperCase();
  if (!key) return null;
  return layout.items.find(e => e.id.toUpperCase() === key)
    ?? layout.items.find(e => (e.locCode || "").toUpperCase() === key)
    ?? findElementByLoc(layout.items, focus.element);
}

/** 物料定位：item 可以是数字 id，也可以是物料编码；只在给定元素下匹配 */
export function resolveFocusItem(element: ItemElement | null, focus: LayoutFocus, items: MaterialItem[]): MaterialItem | null {
  if (!element || !focus.item) return null;
  const key = focus.item.toUpperCase();
  const owned = items.filter(it => findElementByLoc([element], it.locationCode || "") !== null);
  const numeric = Number(focus.item);
  if (Number.isInteger(numeric) && String(numeric) === focus.item) {
    const byId = owned.find(it => it.id === numeric);
    if (byId) return byId;
  }
  return owned.find(it => (it.code || "").toUpperCase() === key) ?? null;
}

/**
 * 把查询参数解析成传给布局查看器的定位目标；任何一段对不上就丢弃那一段，
 * 最终可能只剩「进某个房间」（或不剩任何定位）。
 */
export function resolveLayoutFocus(
  focus: LayoutFocus, layouts: RoomLayoutRow[], items: MaterialItem[]
): { row: RoomLayoutRow; target: LayoutFocusTarget } | null {
  const row = findFocusRoom(layouts, focus);
  if (!row) return null;
  const layout = row.layoutJson ? parseLayout(row.layoutJson) : null;
  const element = resolveFocusElement(layout, focus);
  const item = resolveFocusItem(element, focus, items);
  return { row, target: { initialElementId: element?.id, focusElementId: element?.id, focusItemId: item?.id ?? null, focusItemName: item?.name } };
}
