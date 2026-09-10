/** 画布视图变换（缩放/平移）：纯函数，便于测试；坐标单位为画布 cm */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 3;
/** 适应画布时的最大放大倍数（小房间不至于撑满失真） */
export const MAX_FIT_SCALE = 1.5;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** 以 (px, py) 为锚点缩放到 scale：该屏幕点在画布上的对应位置保持不变 */
export function zoomAt(view: View, scale: number, px: number, py: number): View {
  const s = clampScale(scale);
  return {
    scale: s,
    x: px - ((px - view.x) * s) / view.scale,
    y: py - ((py - view.y) * s) / view.scale,
  };
}

/** 内容居中适应容器（带内边距） */
export function fitView(w: number, h: number, contentW: number, contentH: number, pad = 24): View {
  if (w <= 10 || h <= 10 || contentW <= 0 || contentH <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clampScale(Math.min((w - pad * 2) / contentW, (h - pad * 2) / contentH, MAX_FIT_SCALE));
  return { scale, x: (w - contentW * scale) / 2, y: (h - contentH * scale) / 2 };
}

export interface Pt {
  x: number;
  y: number;
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 双指缩放：按住中点缩放，返回新视图（双指同时用于平移时由调用方叠加位移） */
export function pinchView(start: View, startDist: number, dist: number, center: Pt): View {
  if (startDist <= 0 || dist <= 0) return start;
  return zoomAt(start, start.scale * (dist / startDist), center.x, center.y);
}
