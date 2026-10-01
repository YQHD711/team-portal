/**
 * 库位 → 物料布局页的跳转链接（唯一构造处）。
 *
 * 任何显示库位的地方都用这份约定拼链接：布局页据此切房间、选中元素、高亮所查物料。
 * 参数一律可选；一个都没有时返回纯 `/inventory/layout`，与直接点侧边栏的表现一致。
 */

export interface LayoutLinkTarget {
  /** 房间号（库位编码第一段），如 1012 */
  room?: string;
  /** 元素库位编码（室-元素），如 1012-A */
  element?: string;
  /** 物料标识：id 或 code 都行，带 code 时优先用 code（对人不透明但稳定） */
  item?: string | number;
}

function clean(value?: string | number): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** 拼 `/inventory/layout?room=&element=&item=`；无有效参数时返回 `/inventory/layout` */
export function layoutHrefForLocation(target: LayoutLinkTarget): string {
  const params = new URLSearchParams();
  const room = clean(target.room);
  const element = clean(target.element);
  const item = clean(target.item);
  if (room) params.set("room", room);
  if (element) params.set("element", element);
  if (item) params.set("item", item);
  const query = params.toString();
  return query ? `/inventory/layout?${query}` : "/inventory/layout";
}
