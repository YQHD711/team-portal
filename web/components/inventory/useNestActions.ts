"use client";

/**
 * 嵌套动作（task-38）：**移入/移出容器** + **位移提交的唯一入口**。
 *
 * ⚠️ 位移只能走 `moveElement`（内部就是 `applyMoved`）：它会带着子元素一起走、把子元素钳制在父内、
 * 并在"有子元素却要缩放"时拒绝提交。**绕过它子元素会漂移。**
 * 删除不走这里（删除的唯一入口是 `RoomPlanner.deleteById`，它用 `deleteElementSafe`）。
 */

import { useCallback } from "react";
import type { ItemElement, RoomLayout } from "./layoutTypes";
import type { Element } from "./layoutNesting";
import { applyMoved, canNest, clampInside, detachBeside, findElement, replaceElement } from "./layoutNesting";

/** 位移提交：**唯一**入口（拖动/变换都调它）。导出以便对"提交结果 = applyMoved"做单元断言。 */
export function moveElement(layout: RoomLayout, moved: Element): RoomLayout {
  return applyMoved(layout, moved);
}

/** 可作父的容器列表（走 canNest：1 层限制、不能放自己、自身有子元素则不可） */
export function nestableParents(layout: RoomLayout, childId: string | null): ItemElement[] {
  if (!childId) return [];
  return layout.items.filter(p => canNest(layout, childId, p.id).ok);
}

export function useNestActions(
  layout: RoomLayout,
  selected: string | null,
  commit: (next: RoomLayout) => void,
  setMsg: (msg: string) => void,
): { move: (el: Element) => void; nest: (parentId: string) => void; detach: () => void } {
  const move = useCallback((el: Element) => commit(moveElement(layout, el)), [layout, commit]);

  const nest = useCallback((parentId: string) => {
    if (!selected) return;
    const check = canNest(layout, selected, parentId);
    if (!check.ok) { setMsg(check.reason ?? "无法移入容器"); return; }        // 拒绝时给可读原因，不静默失败
    const el = findElement(layout, selected);
    const parent = findElement(layout, parentId);
    if (!el || !parent) return;
    // 落点：父内部左上缩进 6cm，并钳制在父边界内
    const placed = clampInside({ ...el, parentId, x: parent.x + 6, y: parent.y + 6 }, parent);
    commit(replaceElement(layout, placed));
    setMsg("已移入容器（可一次撤销）");
  }, [layout, selected, commit, setMsg]);

  const detach = useCallback(() => {
    if (!selected) return;
    const el = findElement(layout, selected);
    if (!el?.parentId) { setMsg("该元素不在容器内"); return; }
    commit(detachBeside(layout, selected));            // 落在父元素右侧，不叠在父上
    setMsg("已移出容器（落在容器旁，可一次撤销）");
  }, [layout, selected, commit, setMsg]);

  return { move, nest, detach };
}
