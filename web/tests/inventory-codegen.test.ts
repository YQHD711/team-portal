/**
 * 自动生成库位编码（task-37 C）—— 重点是**负向**与现场安全：
 *  - 已有编码**一字不改**（现场标签已打印）
 *  - 物料的 `locationCode` 也算已占用（只收元素会撞上物料位）
 *  - 冲突跳过并顺延、室号缺失不瞎编、生成结果能被 findElementByLoc 往返解析
 */

import { describe, expect, it } from "vitest";
import type { ItemElement, MaterialItem, RoomLayout } from "@/components/inventory/layoutTypes";
import { findElementByLoc } from "@/components/inventory/locationCodes";
import {
  applyCodePlan, baseCode, baseOfLoc, missingCodeElements, planCodes, planSummary, usedCodes,
} from "@/components/inventory/layoutCodeGen";

const el = (id: string, locCode?: string): ItemElement => ({
  id, type: "shelf", name: `货架${id}`, x: 10, y: 10, w: 200, h: 60, rotation: 0,
  locCode: locCode ?? "", rows: 4, cols: 8,
});

const mat = (id: number, name: string, locationCode: string): MaterialItem =>
  ({ id, name, category: null, quantity: 1, locationCode, status: "available", grade: null, unitPrice: null, updatedAt: null } as unknown as MaterialItem);

const layout = (items: ItemElement[]): RoomLayout =>
  ({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items });

describe("baseCode / baseOfLoc", () => {
  it("字母顺延：0→A、25→Z、26→AA", () => {
    expect(baseCode("6011", 0)).toBe("6011-A");
    expect(baseCode("6011", 25)).toBe("6011-Z");
    expect(baseCode("6011", 26)).toBe("6011-AA");
  });

  it("从四段码拆元素基码：6011-A-3-05 → 6011-A；拆不出 → null", () => {
    expect(baseOfLoc("6011-A-3-05")).toBe("6011-A");
    expect(baseOfLoc("6011-B")).toBe("6011-B");
    expect(baseOfLoc("乱七八糟")).toBeNull();
  });
});

describe("usedCodes：只收元素是不够的（必须含物料 locationCode）", () => {
  it("物料码与它拆出的元素基码都算已占用", () => {
    const used = usedCodes(layout([el("e1", "6011-A")]), [mat(1, "螺丝", "6011-B-3-05")]);
    expect(used.has("6011-A")).toBe(true);
    expect(used.has("6011-B-3-05")).toBe(true);
    expect(used.has("6011-B")).toBe(true);          // ← 容易漏的那条
  });
});

describe("planCodes：只填空、冲突顺延、室号缺失不瞎编", () => {
  it("**已有编码的元素不进候选**", () => {
    const l = layout([el("e1", "6011-A"), el("e2")]);
    expect(missingCodeElements(l).map(e => e.id)).toEqual(["e2"]);
    const plan = planCodes(l, [], "6011");
    expect(plan.assignments.map(a => a.elementId)).toEqual(["e2"]);
  });

  it("**冲突跳过并顺延**：物料占了 6011-A 位 → 新元素拿 6011-B，A 记入 skipped", () => {
    const plan = planCodes(layout([el("e1")]), [mat(1, "桨叶", "6011-A-1-01")], "6011");
    expect(plan.assignments[0].code).toBe("6011-B");
    expect(plan.skipped).toContain("6011-A");
  });

  it("多个空位元素依次 A/B/C（同批内不重复）", () => {
    const plan = planCodes(layout([el("e1"), el("e2"), el("e3")]), [], "6011");
    expect(plan.assignments.map(a => a.code)).toEqual(["6011-A", "6011-B", "6011-C"]);
  });

  it("**室号缺失 → 不生成任何编码**，只给「要求显式输入」的提示（不瞎编）", () => {
    for (const room of [null, undefined, "", "   "]) {
      const plan = planCodes(layout([el("e1")]), [], room);
      expect(plan.roomCode).toBeNull();
      expect(plan.assignments).toEqual([]);
      expect(plan.warnings.join()).toContain("缺少室号");
    }
  });

  it("没有未指定库位的元素 → 空计划 + 提示", () => {
    const plan = planCodes(layout([el("e1", "6011-A")]), [], "6011");
    expect(plan.assignments).toEqual([]);
    expect(plan.warnings.join()).toContain("没有未指定库位");
  });
});

describe("applyCodePlan：**已有编码一字不改** + 往返解析", () => {
  const l = layout([
    el("e1", "6011-A"),         // 已贴标签 → 必须原样
    el("e2", "6011-C"),         // 已贴标签 → 必须原样
    el("e3"),                   // 待补
  ]);

  it("负向：已有编码元素的对象与编码完全不变，只有空的那个被填", () => {
    const plan = planCodes(l, [mat(1, "桨叶", "6011-B-1-01")], "6011");
    const out = applyCodePlan(l, plan);

    const before1 = l.items[0], before2 = l.items[1];
    expect(out.items[0]).toEqual(before1);                    // 同一个对象语义，一字未改
    expect(out.items[1]).toEqual(before2);
    expect(out.items[0].locCode).toBe("6011-A");
    expect(out.items[1].locCode).toBe("6011-C");
    expect(out.items[2].locCode).toBe("6011-D");             // A/B/C 都被占 → 顺延到 D
    expect(plan.skipped).toEqual(expect.arrayContaining(["6011-A", "6011-B", "6011-C"]));
  });

  it("往返：生成后 findElementByLoc 能按元素码与格位码解析回该元素", () => {
    const out = applyCodePlan(l, planCodes(l, [], "6011"));
    const code = out.items[2].locCode!;
    expect(findElementByLoc(out.items, code)?.id).toBe("e3");
    expect(findElementByLoc(out.items, `${code}-3-05`)?.id).toBe("e3");   // 四段格位码
    expect(findElementByLoc(out.items, "6011-A")?.id).toBe("e1");         // 老码照样解析
  });

  it("计划为空时不产生新布局（不触发无意义提交）", () => {
    const none = planCodes(layout([el("e1", "6011-A")]), [], "6011");
    expect(applyCodePlan(l, none)).toBe(l);
  });

  it("planSummary 含「元素名 → 编码」与跳过说明（预览内容）", () => {
    const plan = planCodes(layout([el("e1")]), [mat(1, "桨叶", "6011-A-1-01")], "6011");
    const s = planSummary(plan);
    expect(s).toContain("货架e1 → 6011-B");
    expect(s).toContain("跳过");
  });
});
