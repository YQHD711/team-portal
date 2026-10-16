/**
 * 布局画布的**坐标换算**（e2e 共享）—— 别再手算，这里踩过坑。
 *
 * ⚠️ 真机事实：**舞台不等于 canvas**。canvas 元素的高度比舞台绘制区大（纵向留白，实测
 * canvas 534×458 而 900×600 cm 按 scale 0.5933 只画 534×356 → 多出 102px），
 * 因此"按 cm 比例直接乘 canvas 高宽"会**纵向打偏 ~29%**：
 * 大目标偶然能中、小目标必然打偏（我因此误判过"嵌套子元素点不中"）。
 *
 * 正确换算：
 *   s      = canvasBox.width / layoutWidthCm
 *   padTop = canvasBox.height - layoutHeightCm * s
 *   px     = box.x + cmX * s,  py = box.y + padTop / 2 + cmY * s   （纵向居中）
 * 若某天舞台改为填满 canvas，`padTop` 会自动变成 0，本函数无需改。
 */

export interface Box { x: number; y: number; width: number; height: number }

export function stageScale(box: Box, layoutWidthCm: number): number {
  return box.width / layoutWidthCm;
}

export function stagePadTop(box: Box, layoutWidthCm: number, layoutHeightCm: number): number {
  return box.height - layoutHeightCm * stageScale(box, layoutWidthCm);
}

/** cm 坐标 → 页面像素（假设舞台在 canvas 内纵向居中；水平无留白） */
export function cmToPage(box: Box, cmX: number, cmY: number, layoutWidthCm: number, layoutHeightCm: number): { x: number; y: number } {
  const s = stageScale(box, layoutWidthCm);
  return { x: box.x + cmX * s, y: box.y + stagePadTop(box, layoutWidthCm, layoutHeightCm) / 2 + cmY * s };
}

/** 元素矩形中心 → 页面像素（给出元素的 cm 位置与尺寸即可） */
export function elementCenterPage(box: Box, el: { x: number; y: number; w: number; h: number }, layoutWidthCm: number, layoutHeightCm: number): { x: number; y: number } {
  return cmToPage(box, el.x + el.w / 2, el.y + el.h / 2, layoutWidthCm, layoutHeightCm);
}
