/** 平面图编辑历史：commit 入栈过去，undo/redo 在 past/future 间迁移 */
import type { RoomLayout } from "./layoutTypes";

export const HISTORY_MAX = 50;

export interface HistState {
  layout: RoomLayout;
  past: RoomLayout[];
  future: RoomLayout[];
}

export function historyReducer(s: HistState, a: { type: "commit"; next: RoomLayout } | { type: "undo" } | { type: "redo" }): HistState {
  switch (a.type) {
    case "commit":
      return { layout: a.next, past: [...s.past, s.layout].slice(-HISTORY_MAX), future: [] };
    case "undo":
      return s.past.length === 0 ? s
        : { layout: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.layout, ...s.future] };
    case "redo":
      return s.future.length === 0 ? s
        : { layout: s.future[0], past: [...s.past, s.layout], future: s.future.slice(1) };
  }
}

/** 从布局中删除指定元素 */
export function removeElem(cur: RoomLayout, id: string): RoomLayout {
  return {
    ...cur,
    walls: cur.walls.filter(e => e.id !== id),
    doors: cur.doors.filter(e => e.id !== id),
    windows: cur.windows.filter(e => e.id !== id),
    items: cur.items.filter(e => e.id !== id),
  };
}
