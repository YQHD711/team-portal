/**
 * 元素嵌套（**1 层**）—— 父子关系 + 移动传播 + 删除/复制语义。纯逻辑，便于把约束测透。
 *
 * 数据模型（task-38 统一方案 B1）：子元素 `parentId` 指向容器；**坐标仍是绝对 cm**，
 * 因此父元素移动时**必须**经 `applyMoved` 传播，否则子元素会漂移。
 * ⚠️ 画布拖动/变换**只能走 `applyMoved`**（唯一传播路径）；绕过它就会漂移。
 *
 * 边界（与产品约定一致）：
 *  - **只允许 1 层**：父必须是"没有 parentId 的元素"，子不得再当父；
 *  - 子元素**钳制在父边界内**（要移出必须走显式的移出动作）；
 *  - **有子元素时禁止缩放/旋转父元素**（平面图按 cm 标注，缩放会静默改变子元素真实尺寸）；
 *  - 删除父元素**绝不静默**：先阻止并列清单，用户显式二选一；**绝不产生孤儿**。
 */

import type { ItemElement, PosElement, RoomLayout } from "./layoutTypes";
import { uid } from "./layoutTypes";

export type Element = PosElement | ItemElement;

const isItem = (el: Element): el is ItemElement => "type" in el;

/** 布局里所有元素（walls/doors/windows/items） */
export function allElements(layout: RoomLayout): Element[] {
  return [...layout.walls, ...layout.doors, ...layout.windows, ...layout.items];
}

export function findElement(layout: RoomLayout, id: string): Element | null {
  return allElements(layout).find(e => e.id === id) ?? null;
}

/** 直接子元素（**只查 items**：只有可挂载元素能当容器） */
export function childrenOf(layout: RoomLayout, parentId: string): ItemElement[] {
  return layout.items.filter(el => el.parentId === parentId);
}

export function hasChildren(layout: RoomLayout, id: string): boolean {
  return childrenOf(layout, id).length > 0;
}

/** 能否把 childId 放进 parentId：1 层限制 + 不能放自己 + 父不能是子 */
export function canNest(layout: RoomLayout, childId: string, parentId: string): { ok: boolean; reason?: string } {
  if (childId === parentId) return { ok: false, reason: "不能把元素放进自己" };
  const parent = findElement(layout, parentId);
  const child = findElement(layout, childId);
  if (!parent || !child) return { ok: false, reason: "元素不存在" };
  if (!isItem(parent)) return { ok: false, reason: "墙/门/窗不能作为容器" };
  if (child.parentId) return { ok: false, reason: "只支持 1 层嵌套：该元素已在容器内" };
  if (hasChildren(layout, childId)) return { ok: false, reason: "该元素自身有子元素，不能再放进别人里面" };
  return { ok: true };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 把子元素钳制在父边界内（父可能比子小：此时贴左上） */
export function clampInside(child: Element, parent: Element): Element {
  const maxX = parent.x + Math.max(0, parent.w - child.w);
  const maxY = parent.y + Math.max(0, parent.h - child.h);
  return { ...child, x: clamp(child.x, parent.x, maxX), y: clamp(child.y, parent.y, maxY) };
}

/** 替换布局里的某个元素（按 id，保持原集合归属） */
export function replaceElement(layout: RoomLayout, el: Element): RoomLayout {
  const map = <T extends Element>(arr: T[]): T[] => arr.map(e => (e.id === el.id ? (el as T) : e));
  return { ...layout, walls: map(layout.walls), doors: map(layout.doors), windows: map(layout.windows), items: map(layout.items) };
}

/**
 * **唯一传播路径**：把移动/变换后的父元素写回，并让所有子元素跟着吃同一个位移（相对位置不变）。
 * 若父元素**尺寸变了且有子元素** → 直接拒绝（返回原布局），由 UI 提示"先移出子元素"。
 */
export function applyMoved(layout: RoomLayout, moved: Element): RoomLayout {
  const before = findElement(layout, moved.id);
  if (!before) return layout;
  const children = childrenOf(layout, moved.id);
  const resized = moved.w !== before.w || moved.h !== before.h;
  if (children.length > 0 && resized) return layout;      // 有子元素禁止缩放

  let out = replaceElement(layout, moved);
  if (children.length === 0) return out;
  const dx = moved.x - before.x;
  const dy = moved.y - before.y;
  for (const child of children) {
    const shifted = { ...child, x: child.x + dx, y: child.y + dy };
    out = replaceElement(out, clampInside(shifted, moved));   // 子元素不得越出父边界
  }
  return out;
}

/** 「移出容器」：清掉 parentId（显式动作，不是拖出去的副作用） */
export function detachElement(layout: RoomLayout, id: string): RoomLayout {
  const el = findElement(layout, id);
  if (!el) return layout;
  const next = { ...el };
  delete next.parentId;
  return replaceElement(layout, next);
}

export type DeleteResult =
  | { kind: "deleted"; layout: RoomLayout }
  | { kind: "blocked"; children: ItemElement[] };

/** 删除**不静默**：有子元素 → 阻止并返回清单（UI 让用户选"移出"或"显式级联"） */
export function deleteElementSafe(layout: RoomLayout, id: string): DeleteResult {
  const children = childrenOf(layout, id);
  if (children.length > 0) return { kind: "blocked", children };
  return { kind: "deleted", layout: removeById(layout, id) };
}

/** 显式级联删除（调用方必须先让用户确认那份清单） */
export function deleteWithChildren(layout: RoomLayout, id: string): RoomLayout {
  let out = layout;
  for (const child of childrenOf(layout, id)) out = removeById(out, child.id);
  return removeById(out, id);
}

function removeById(layout: RoomLayout, id: string): RoomLayout {
  return {
    ...layout,
    walls: layout.walls.filter(e => e.id !== id),
    doors: layout.doors.filter(e => e.id !== id),
    windows: layout.windows.filter(e => e.id !== id),
    items: layout.items.filter(e => e.id !== id),
  };
}

/**
 * **深拷贝子树**（复制容器 = 连子元素一起复制）：
 * 新容器 id + 每个子元素全新 id + `parentId` 重映射到**新**容器 + **相对偏移保持不变**；
 * 对外整体偏移只作用在容器上（子元素跟着走）。返回新布局与"根元素新 id"。
 */
export function deepCopySubtree(
  layout: RoomLayout,
  rootId: string,
  offset: { dx: number; dy: number },
): { layout: RoomLayout; rootId: string } | null {
  const root = findElement(layout, rootId);
  if (!root || !isItem(root)) return null;
  const newRootId = `${root.id.split(":")[0]}-${uid()}`;
  const newRoot: ItemElement = { ...root, id: newRootId, x: root.x + offset.dx, y: root.y + offset.dy };

  let out: RoomLayout = { ...layout, items: [...layout.items, newRoot] };   // 复制：原布局保留，仅追加新子树
  for (const child of childrenOf(layout, rootId)) {
    const copied: ItemElement = {
      ...child,
      id: `${child.id.split(":")[0]}-${uid()}`,
      parentId: newRootId,                           // ← 必须指向**新**容器
      x: child.x + offset.dx,                        // 相对偏移不变（父与子同位移）
      y: child.y + offset.dy,
    };
    out = { ...out, items: [...out.items, copied] };
  }
  return { layout: out, rootId: newRootId };
}

/** 不变量：不存在 parentId 指向不存在元素的"孤儿"（测试用） */
export function findOrphans(layout: RoomLayout): ItemElement[] {
  const ids = new Set(allElements(layout).map(e => e.id));
  return layout.items.filter(el => el.parentId && !ids.has(el.parentId));
}

/**
 * **粘贴子元素的守卫**（task-38 边缘情况）：容器内的元素没有独立位置，
 * 若照旧"+24/+18 原地偏移"会生成 `parentId` 指向旧容器、坐标却在容器外的**孤儿**。
 * v1 明确**拒绝**并给两条出路（不做自动语义推断）。
 */
export function pasteRejection(
  layout: RoomLayout,
  buffered: readonly { id: string }[],
): string | null {
  for (const el of buffered) {
    const full = findElement(layout, el.id);
    if (full && full.parentId) {
      const parent = findElement(layout, full.parentId);
      return `该元素在容器「${parent ? (parent as ItemElement).name : full.parentId}」内，没有独立位置；请**复制整个容器**，或先用「移出容器」把它移出来。`;
    }
  }
  return null;
}

/** 「移出容器」后的落点：父元素右侧留 20cm，避免叠在父元素上（看起来像没移出） */
export function detachBeside(layout: RoomLayout, id: string): RoomLayout {
  const el = findElement(layout, id);
  if (!el || !el.parentId) return layout;
  const parent = findElement(layout, el.parentId);
  const next = { ...el, x: parent ? parent.x + parent.w + 20 : el.x, y: parent ? parent.y : el.y };
  delete next.parentId;
  return replaceElement(layout, next);
}

/** 删除确认文案（列清单 + 两个显式选项）—— 放在纯模块里，供所有删除入口复用 */
export function deleteConfirmText(children: readonly ItemElement[]): string {
  const list = children.map(c => `${c.name}${c.locCode ? `（${c.locCode}）` : ""}`).join("、");
  return `该容器内有 ${children.length} 个子元素：${list}\n\n确定 = 连同子元素一起删除（可一次撤销）；取消 = 先移出子元素。`;
}
