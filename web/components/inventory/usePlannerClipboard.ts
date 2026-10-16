"use client";

/**
 * 平面图编辑器的剪贴板接线（task-37 B）：
 *  - 复制：把**当前选中**（将来是多选）的 id 数组交给纯模块 `copyBuffer`
 *  - 粘贴：`applyPaste` 一次算出新 layout → **只 commit 一次**（撤销栈里一条记录）
 *  - 焦点守卫与快捷键本身在 `usePlannerShortcuts`（Ctrl+C/V/Z 共用一个守卫）
 */

import { useCallback, useRef, useState } from "react";
import type { PosElement, ItemElement, RoomLayout } from "./layoutTypes";
import { applyPaste, copyBuffer, type ClipboardBuffer } from "./layoutClipboard";
import { deepCopySubtree, pasteRejection } from "./layoutNesting";

type Copyable = PosElement | ItemElement;

/** ⚠️ 验证边界（task-37 收尾）：本文件的逻辑有单测覆盖（`tests/inventory-clipboard.test.ts` 16 条）。
 * 但"**粘贴后新元素被选中**"（下面 `setSelected(pasted[0].id)`）**只有单测覆盖，线上真机尚未验证** ——
 * 真机验证时被"保存后页面刷新重置编辑器"打断，未能完成；请勿把它当成已验过的行为。 */
export function usePlannerClipboard(
  layout: RoomLayout,
  selectedIds: readonly string[],
  commit: (next: RoomLayout) => void,
  setSelected: (id: string | null) => void,
  setMsg: (msg: string) => void,
): { copy: () => void; paste: () => void; hasBuffer: boolean } {
  const clipRef = useRef<ClipboardBuffer | null>(null);
  const [hasBuffer, setHasBuffer] = useState(false);
  const all: Copyable[] = [...layout.walls, ...layout.doors, ...layout.windows, ...layout.items];

  const copy = useCallback(() => {
    const buf = copyBuffer(selectedIds, all);
    if (!buf) return;
    clipRef.current = buf;                       // **重新复制 → pasteIndex 归零**
    setHasBuffer(true);
    setMsg(`已复制 ${buf.elements.length} 个元素`);
  }, [selectedIds, layout]);

  const paste = useCallback(() => {
    const buf = clipRef.current;
    if (!buf) return;
    // ⚠️ 顺序依赖（task-38）：容器内的元素**没有独立位置** —— 照旧原地偏移会生成 parentId 指向旧容器、
    // 坐标却在容器外的**孤儿**。v1 明确拒绝并给两条出路（不做自动语义推断）。
    const rejected = pasteRejection(layout, buf.elements);
    if (rejected) { setMsg(rejected); return; }
    // 容器：深拷贝整棵子树（新容器 id + 子元素全新 id + parentId 重映射 + 相对偏移不变）
    const root = buf.elements[0];
    if (root && layout.items.some(i => i.parentId === root.id)) {
      const nth = buf.pasteIndex + 1;
      const copy = deepCopySubtree(layout, root.id, { dx: 24 * nth, dy: 18 * nth });
      if (copy) {
        clipRef.current = { ...buf, pasteIndex: nth };   // 连续粘贴递增偏移
        commit(copy.layout);                            // 一次提交 = 一条撤销记录
        setSelected(copy.rootId);
        setMsg("已复制容器及其子元素（可一次撤销）");
        return;
      }
    }
    const { layout: next, next: advanced, pasted } = applyPaste(layout, buf);
    clipRef.current = advanced;                  // 连续粘贴递增偏移
    commit(next);                                // 一次提交 = 一条撤销记录
    setSelected(pasted[0]?.id ?? null);          // 粘贴后选中新元素
    setMsg(`已粘贴 ${pasted.length} 个元素（同类型、偏移递增）`);
  }, [layout, commit, setSelected, setMsg]);

  return { copy, paste, hasBuffer };
}
