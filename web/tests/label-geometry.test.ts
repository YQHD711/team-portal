import { describe, it, expect } from "vitest";
import { MIN_SIZE_MM, clampRect, deltaMm, moveRect, resizeRect, round2, snapMm } from "@/lib/labelGeometry";

/**
 * 设计器几何：吸附 0.5mm、**永远夹在页面内**（先吸附再夹取，避免吸附把元素推出边界）。
 */

const page = { widthMm: 80, heightMm: 50 };

describe("吸附与夹取", () => {
  it("snapMm 吸到 0.5mm 网格并清掉浮点尾巴", () => {
    expect(snapMm(3.24)).toBe(3);
    expect(snapMm(3.26)).toBe(3.5);
    expect(snapMm(79.999999)).toBe(80);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("clampRect：尺寸不小于最小边长，且整体留在页面内", () => {
    expect(clampRect({ x: -5, y: -5, w: 0.1, h: 0.1 }, page)).toEqual({ x: 0, y: 0, w: MIN_SIZE_MM, h: MIN_SIZE_MM });
    expect(clampRect({ x: 79, y: 49, w: 10, h: 10 }, page)).toEqual({ x: 70, y: 40, w: 10, h: 10 });
    // 尺寸比页面还大 → 收成页面尺寸，位置归零
    expect(clampRect({ x: 5, y: 5, w: 500, h: 500 }, page)).toEqual({ x: 0, y: 0, w: 80, h: 50 });
  });

  it("moveRect：位移被吸附，越界夹回（不是拖出去再报错）", () => {
    const r = { x: 3, y: 10, w: 30, h: 30 };
    expect(moveRect(r, page, 1.24, -0.6)).toEqual({ x: 4, y: 9.5, w: 30, h: 30 });
    // 向右下拖很远 → 夹在页面内
    expect(moveRect(r, page, 999, 999)).toEqual({ x: 50, y: 20, w: 30, h: 30 });
    // 向左上拖很远 → 夹到 0
    expect(moveRect(r, page, -999, -999)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });

  it("moveRect 的吸附不会把元素顶出右/下边界", () => {
    // x=79.9 吸附后是 80（出界）→ 必须夹回 80−w；y=19.9 吸附成 20，仍在页面内
    expect(moveRect({ x: 79.9, y: 19.9, w: 5, h: 5 }, page, 0, 0)).toEqual({ x: 75, y: 20, w: 5, h: 5 });
  });

  it("resizeRect：右下角拉大，左上角固定", () => {
    const r = { x: 10, y: 10, w: 20, h: 10 };
    expect(resizeRect(r, page, "se", 5.26, 3.24)).toMatchObject({ x: 10, y: 10, w: 25.5, h: 13 });
  });

  it("resizeRect：四个角都保持对角固定，且拉不满页面之外", () => {
    const r = { x: 10, y: 10, w: 20, h: 10 };
    expect(resizeRect(r, page, "se", 5, 3)).toMatchObject({ x: 10, y: 10, w: 25, h: 13 });
    expect(resizeRect(r, page, "sw", -4, 3)).toMatchObject({ x: 6, y: 10, w: 24, h: 13 });
    expect(resizeRect(r, page, "ne", 5, -4)).toMatchObject({ x: 10, y: 6, w: 25, h: 14 });
    expect(resizeRect(r, page, "nw", -4, -4)).toMatchObject({ x: 6, y: 6, w: 24, h: 14 });
    // 拖超页面 → 夹回
    const big = resizeRect(r, page, "se", 999, 999);
    expect(big.x + big.w).toBeLessThanOrEqual(80);
    expect(big.y + big.h).toBeLessThanOrEqual(50);
  });

  it("resizeRect：缩到最小边长就不再小，且不会出现负尺寸", () => {
    const r = { x: 10, y: 10, w: 20, h: 10 };
    expect(resizeRect(r, page, "nw", 999, 999)).toMatchObject({ w: MIN_SIZE_MM, h: MIN_SIZE_MM });
  });

  it("deltaMm：像素位移按画布比例换成 mm", () => {
    expect(deltaMm(60, 30, 6)).toEqual({ dxMm: 10, dyMm: 5 });
  });
});
