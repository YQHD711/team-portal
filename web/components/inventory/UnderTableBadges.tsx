"use client";

/**
 * 「含桌下」角标 —— **DOM 覆盖层**（task-39 ① 的真修复）。
 *
 * 为什么不用 Konva 画：角标若跟着舞台缩放，`44×12 cm` 在 `s≈0.427` 下只有 ~19×5 px、
 * 9px 字号 → **真实缩放下读不出来** = 等于没解决"有台下存储却无从发现"。
 * DOM 覆盖层天然是**屏幕固定尺寸**、文字清晰、且不受缩放影响。
 *
 * 定位用的是**画布同一套变换**：Konva `<Layer x={view.x} y={view.y} scaleX={view.scale}>`
 * → 这里 `left = view.x + cm * view.scale`。`view` 是 React 状态，缩放/平移/拖动都会重渲染，
 * **不会滞后或漂走**。`pointer-events-none` + 外层 `overflow-hidden` → 不参与命中、越界自动裁剪。
 */

import type { ItemElement } from "./layoutTypes";
import { hasUnderTable } from "./tableZones";

interface Props {
  items: readonly ItemElement[];
  view: { x: number; y: number; scale: number };
  size: { w: number; h: number };
}

/** 角标屏幕尺寸（固定像素）与内边距 */
const PAD = 6;

export function UnderTableBadges({ items, view, size }: Props) {
  const badges = items
    .filter(el => hasUnderTable(el))
    .map(el => {
      const right = view.x + (el.x + el.w) * view.scale;
      const bottom = view.y + (el.y + el.h) * view.scale;
      const left = right - 56;                       // 固定 56px 宽（不随缩放）
      const top = bottom - 18;                       // 固定 18px 高
      // 越出可视区就不画（避免"元素在左、角标在右"这类错位；外层也有 overflow-hidden 兜底）
      if (right < 0 || bottom < 0 || left > size.w || top > size.h) return null;
      return { id: el.id, left, top };
    })
    .filter((b): b is { id: string; left: number; top: number } => b !== null);

  if (badges.length === 0) return null;
  return (
    <div data-testid="under-table-badges" className="pointer-events-none absolute inset-0 z-10" style={{ padding: PAD }}>
      {badges.map(b => (
        <span key={b.id} data-testid="under-table-badge"
          className="pointer-events-none absolute rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
          style={{ left: b.left, top: b.top }}>
          含桌下
        </span>
      ))}
    </div>
  );
}
