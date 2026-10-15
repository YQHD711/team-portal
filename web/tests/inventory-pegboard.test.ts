/**
 * 「洞洞板」元素（task-37 A）：
 *  - 类型/定义/调色板/预设齐全，配色与货架等**不撞色**
 *  - 与货架同机制：rows × cols（层 × 位），可挂具体物料并定位编码
 *  - 序列化向后兼容：老布局（没有 pegboard）照常解析；新类型往返保真
 *  - **未知类型不静默丢弃**：parseLayout 把原因写进 warnings
 */

import { describe, expect, it } from "vitest";
import {
  ELEMENT_DEFS, ITEM_TYPES, type ItemElement, type RoomLayout,
} from "@/components/inventory/layoutTypes";
import { createElement, layoutToJson, parseLayout } from "@/components/inventory/layoutCodec";
import { FULL_FILL } from "@/components/inventory/cellColors";
import { SIZE_PRESETS } from "@/components/inventory/layoutPresets";

const emptyLayout: RoomLayout = { width: 1000, height: 800, unit: "cm", walls: [], doors: [], windows: [], items: [] };

describe("洞洞板：类型与定义", () => {
  it("ItemType 收录 pegboard，label 是「洞洞板」", () => {
    expect(ITEM_TYPES).toContain("pegboard");
    expect(ELEMENT_DEFS.pegboard.label).toBe("洞洞板");
  });

  it("有层 × 位格位（与货架同机制），标签用「层 / 位」", () => {
    const def = ELEMENT_DEFS.pegboard;
    expect(def.rows).toBeGreaterThanOrEqual(1);
    expect(def.cols).toBeGreaterThanOrEqual(1);
    expect(def.rowLabel).toBe("层");
    expect(def.colLabel).toBe("位");
  });

  it("**配色不与货架/工作台/柜子撞色**（否则画布上分不清）", () => {
    const others = (["shelf", "workbench", "cabinet", "device"] as const).map(k => ELEMENT_DEFS[k].color.toLowerCase());
    expect(others).not.toContain(ELEMENT_DEFS.pegboard.color.toLowerCase());
    // 格位填充色也不能与货架的完全一样
    expect(FULL_FILL.pegboard.toLowerCase()).not.toBe(FULL_FILL.shelf.toLowerCase());
  });

  it("尺寸预设与格位填充色都有（Record<ItemType> 由 tsc 强制，这里再钉一次运行期）", () => {
    expect(SIZE_PRESETS.pegboard.length).toBeGreaterThan(0);
    expect(FULL_FILL.pegboard).toBeTruthy();
  });
});

describe("洞洞板：序列化往返与向后兼容", () => {
  it("createElement 生成 pegboard 并带默认格位 → serialize → parse 保真", () => {
    const created = createElement("pegboard", emptyLayout, 0) as ItemElement;
    expect(created.type).toBe("pegboard");
    expect(created.rows).toBeGreaterThanOrEqual(1);
    expect(created.cols).toBeGreaterThanOrEqual(1);

    const layout: RoomLayout = { ...emptyLayout, items: [{ ...created, locCode: "6011-P-2-03" }] };
    const parsed = parseLayout(layoutToJson(layout));
    expect(parsed).not.toBeNull();
    const item = parsed!.items[0];
    expect(item.type).toBe("pegboard");
    expect(item.rows).toBe(created.rows);
    expect(item.cols).toBe(created.cols);
    expect(item.locCode).toBe("6011-P-2-03");   // 已贴标签的编码必须原样保留
  });

  it("向后兼容：老布局文件（没有 pegboard）照常解析", () => {
    const old = JSON.stringify({
      width: 600, height: 400, unit: "cm", walls: [], doors: [], windows: [],
      items: [{ id: "s1", type: "shelf", x: 10, y: 20, w: 200, h: 60, name: "老货架", locCode: "6011-A-1-01", rows: 4, cols: 8 }],
    });
    const parsed = parseLayout(old);
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].type).toBe("shelf");
  });

  it("**未知类型不静默丢弃**：跳过并写进 warnings", () => {
    const future = JSON.stringify({
      width: 600, height: 400, items: [
        { id: "s1", type: "shelf", x: 0, y: 0, w: 100, h: 50, name: "甲" },
        { id: "h1", type: "hologram", x: 200, y: 0, w: 100, h: 50, name: "未来元素" },
      ],
    });
    const warnings: string[] = [];
    const parsed = parseLayout(future, warnings);

    expect(parsed!.items.map(i => i.type)).toEqual(["shelf"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("hologram");
    expect(warnings[0]).toContain("已跳过");
  });

  it("不传 warnings 时行为与以前一致（向后兼容的签名）", () => {
    const json = JSON.stringify({ width: 600, height: 400, items: [{ id: "n1", type: "nope", x: 0, y: 0, w: 10, h: 10 }] });
    expect(parseLayout(json)!.items).toHaveLength(0);
  });
});
