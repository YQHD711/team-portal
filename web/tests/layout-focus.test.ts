import { describe, it, expect } from "vitest";
import { layoutHrefForLocation } from "@/lib/inventoryLayoutLink";
import { EMPTY_FOCUS, findFocusRoom, hasLayoutFocus, parseLayoutFocus, resolveFocusElement, resolveFocusItem, resolveLayoutFocus, type LayoutFocus } from "@/components/inventory/layoutFocus";
import { findFocusCell, pickInitialElement } from "@/components/inventory/viewerFocus";
import type { ItemElement, MaterialItem, RoomLayout } from "@/components/inventory/layoutTypes";
import type { RoomLayoutRow } from "@/components/inventory/layoutRow";

const shelf: ItemElement = {
  id: "e1", type: "shelf", name: "A货架", locCode: "1012-A",
  x: 100, y: 100, w: 200, h: 60, rotation: 0, rows: 4, cols: 8,
};
const device: ItemElement = {
  id: "e2", type: "device", name: "充电器", locCode: "1012-C",
  x: 0, y: 0, w: 80, h: 80, rotation: 0, rows: 1, cols: 1,
};
const layout: RoomLayout = { width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [shelf, device] };

const items: MaterialItem[] = [
  { id: 1, name: "桨叶", quantity: 5, locationCode: "1012-A-1-01", code: "PROP-2026-0001" },
  { id: 2, name: "螺丝", quantity: 2, locationCode: "1012-A-3-05", code: "SCREW-2026-0002" },
  { id: 3, name: "充电线", quantity: 6, locationCode: "1012-C", code: "CABLE-2026-0003" },
];

const row = (over: Partial<RoomLayoutRow> = {}): RoomLayoutRow => ({
  id: 1, roomCode: "1012", roomName: "库房", floor: 1,
  cabinetCount: 2, shelfCount: 1, positionCount: 8, updatedAt: "", layoutJson: JSON.stringify(layout), ...over,
});

const focus = (over: Partial<LayoutFocus> = {}): LayoutFocus => ({ ...EMPTY_FOCUS, ...over });

describe("库位 → 布局页链接", () => {
  it("拼出 room/element/item，item 支持 id 与编码", () => {
    expect(layoutHrefForLocation({ room: "1012", element: "1012-A", item: 7 }))
      .toBe("/inventory/layout?room=1012&element=1012-A&item=7");
    expect(layoutHrefForLocation({ room: "1012", element: "1012-A", item: "PROP-2026-0001" }))
      .toBe("/inventory/layout?room=1012&element=1012-A&item=PROP-2026-0001");
  });

  it("参数缺失/空白时只带有效参数，全空则是纯布局页地址", () => {
    expect(layoutHrefForLocation({ room: "1012" })).toBe("/inventory/layout?room=1012");
    expect(layoutHrefForLocation({ room: "1012", element: "  ", item: "" })).toBe("/inventory/layout?room=1012");
    expect(layoutHrefForLocation({})).toBe("/inventory/layout");
  });
});

describe("布局页定位参数解析", () => {
  it("读出 room/element/item 并去掉空白", () => {
    expect(parseLayoutFocus(new URLSearchParams("?room=1012&element=1012-A&item=1")))
      .toEqual({ room: "1012", element: "1012-A", item: "1" });
    expect(parseLayoutFocus(new URLSearchParams("?room=%201012%20")))
      .toEqual({ room: "1012", element: "", item: "" });
  });

  it("没有参数时视为无定位请求", () => {
    expect(hasLayoutFocus(parseLayoutFocus(new URLSearchParams("")))).toBe(false);
    expect(hasLayoutFocus(parseLayoutFocus(new URLSearchParams("?other=1")))).toBe(false);
    expect(hasLayoutFocus(parseLayoutFocus(new URLSearchParams("?room=1012")))).toBe(true);
  });

  it("房间号大小写不敏感，找不到房间返回 null", () => {
    expect(findFocusRoom([row()], focus({ room: "1012" }))?.roomCode).toBe("1012");
    expect(findFocusRoom([row({ roomCode: "1012" })], focus({ room: "1012" }))).not.toBeNull();
    expect(findFocusRoom([row()], focus({ room: "9999" }))).toBeNull();
    expect(findFocusRoom([row()], focus({ room: "" }))).toBeNull();
  });

  it("元素可以按 id 或库位编码定位", () => {
    expect(resolveFocusElement(layout, focus({ element: "e1" }))?.id).toBe("e1");
    expect(resolveFocusElement(layout, focus({ element: "1012-a" }))?.id).toBe("e1");
    expect(resolveFocusElement(layout, focus({ element: "1012-A-3-05" }))?.id).toBe("e1");
    expect(resolveFocusElement(layout, focus({ element: "不存在" }))).toBeNull();
    expect(resolveFocusElement(layout, focus())).toBeNull();
  });

  it("物料按 id 或编码定位，且必须属于该元素", () => {
    const el = shelf;
    expect(resolveFocusItem(el, focus({ item: "2" }), items)?.name).toBe("螺丝");
    expect(resolveFocusItem(el, focus({ item: "SCREW-2026-0002" }), items)?.name).toBe("螺丝");
    // 充电线挂在 1012-C，不属于 A 货架
    expect(resolveFocusItem(el, focus({ item: "3" }), items)).toBeNull();
    expect(resolveFocusItem(el, focus(), items)).toBeNull();
    expect(resolveFocusItem(null, focus({ item: "1" }), items)).toBeNull();
  });

  it("三段齐全时给出「进哪个房间 + 选中/高亮哪个元素物料」", () => {
    const hit = resolveLayoutFocus(focus({ room: "1012", element: "1012-A", item: "1" }), [row()], items);
    expect(hit?.row.roomCode).toBe("1012");
    expect(hit?.target).toEqual({ initialElementId: "e1", focusElementId: "e1", focusItemId: 1, focusItemName: "桨叶" });
  });

  it("只给 room 时只切房间，不给任何高亮", () => {
    const hit = resolveLayoutFocus(focus({ room: "1012" }), [row()], items);
    expect(hit?.row.roomCode).toBe("1012");
    expect(hit?.target.focusElementId).toBeUndefined();
    expect(hit?.target.focusItemId).toBeNull();
  });

  it("房间/元素/物料对不上时逐级降级，而不是乱定位或抛错", () => {
    // 房间没有平面图 → 仍然进房间，但没有元素可选
    const noPlan = row({ layoutJson: null });
    expect(resolveLayoutFocus(focus({ room: "1012", element: "1012-A", item: "1" }), [noPlan], items)?.target)
      .toEqual({ initialElementId: undefined, focusElementId: undefined, focusItemId: null, focusItemName: undefined });
    // 元素不在这个房间 → 丢弃元素与物料
    expect(resolveLayoutFocus(focus({ room: "1012", element: "9999-Z", item: "1" }), [row()], items)?.target.focusElementId)
      .toBeUndefined();
    // 只有 item 没有 element → 不定位
    expect(resolveLayoutFocus(focus({ room: "1012", item: "1" }), [row()], items)?.target.focusItemId).toBeNull();
    // 房间本身找不到 → 完全不定位
    expect(resolveLayoutFocus(focus({ room: "9999", element: "1012-A", item: "1" }), [row()], items)).toBeNull();
  });
});

describe("查看器的定位种子", () => {
  it("pickInitialElement：id / 库位编码 / 前缀都能命中，空值返回 null", () => {
    expect(pickInitialElement(layout.items, "e1")?.id).toBe("e1");
    expect(pickInitialElement(layout.items, "1012-C")?.id).toBe("e2");
    expect(pickInitialElement(layout.items, "1012-A-3-05")?.id).toBe("e1");
    expect(pickInitialElement(layout.items, "")).toBeNull();
    expect(pickInitialElement(layout.items, undefined)).toBeNull();
    expect(pickInitialElement(layout.items, "不存在")).toBeNull();
  });

  it("findFocusCell：落到具体格位；整体挂载与查不到都是 null", () => {
    expect(findFocusCell(shelf, items[1])).toMatchObject({ row: 2, col: 4 });
    expect(findFocusCell(shelf, items[0])).toMatchObject({ row: 0, col: 0 });
    // 充电线不在 A 货架；充电器是 1×1 整体挂载
    expect(findFocusCell(shelf, items[2])).toBeNull();
    expect(findFocusCell(device, items[2])).toBeNull();
    expect(findFocusCell(shelf, null)).toBeNull();
  });
});
