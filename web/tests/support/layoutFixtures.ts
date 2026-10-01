/** 布局页测试共用的房间/物料夹具（两个测试文件都用，避免各写一份走样） */
import type { ItemElement, MaterialItem } from "@/components/inventory/layoutTypes";
import type { RoomLayoutRow } from "@/components/inventory/layoutRow";

export const shelf: ItemElement = {
  id: "e1", type: "shelf", name: "A货架", locCode: "1012-A",
  x: 100, y: 100, w: 200, h: 60, rotation: 0, rows: 4, cols: 8,
};
export const device: ItemElement = {
  id: "e2", type: "device", name: "充电器", locCode: "1012-C",
  x: 0, y: 0, w: 80, h: 80, rotation: 0, rows: 1, cols: 1,
};

export const theItems: MaterialItem[] = [
  { id: 1, name: "桨叶", quantity: 5, locationCode: "1012-A-1-01", code: "PROP-2026-0001" },
  { id: 2, name: "螺丝", quantity: 2, locationCode: "1012-A-3-05", code: "SCREW-2026-0002" },
  { id: 3, name: "飞控板", quantity: 1, locationCode: "2013-B-1-01", code: "FC-2026-0003" },
];

export const theRooms: RoomLayoutRow[] = [
  {
    id: 1, roomCode: "1012", roomName: "库房", floor: 1,
    cabinetCount: 2, shelfCount: 1, positionCount: 8, updatedAt: "2026-09-01T10:00:00Z",
    layoutJson: JSON.stringify({
      width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [shelf, device],
    }),
  },
];
