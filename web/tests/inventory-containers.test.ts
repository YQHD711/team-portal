/**
 * 嵌套 / 抽屉 / 桌上桌下（task-38）—— 负向与不变量为主：
 *  ① 编码加法兼容：旧码照常解析、工作台码结构不变、抽屉沿用四段
 *  ② 删容器**不静默**：阻止 + 子清单；显式级联后**无孤儿**
 *  ③ 移动父元素**子相对位置不变**；子元素钳制在父内；有子元素时禁止缩放
 *  ④ 深拷贝：新 id、parentId 指向**新**容器、相对偏移保持、原布局不动
 */

import { describe, expect, it } from "vitest";
import type { ItemElement, RoomLayout } from "@/components/inventory/layoutTypes";
import { ELEMENT_DEFS, ITEM_TYPES } from "@/components/inventory/layoutTypes";
import { FULL_FILL } from "@/components/inventory/cellColors";
import { findElementByLoc } from "@/components/inventory/locationCodes";
import { cellLabelAt } from "@/components/inventory/elementGeometry";
import {
  applyMoved, canNest, childrenOf, clampInside, deepCopySubtree, deleteElementSafe, pasteRejection,
  deleteWithChildren, detachElement, findOrphans,
} from "@/components/inventory/layoutNesting";

const el = (o: Partial<ItemElement> & { id: string; type: ItemElement["type"] }): ItemElement => ({
  name: o.id, x: 0, y: 0, w: 100, h: 100, rotation: 0, rows: 1, cols: 1, ...o,
});
const layout = (items: ItemElement[]): RoomLayout =>
  ({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items });

describe("C 逐行名称（rowNames）：只影响显示、码结构不变、缺失/不匹配回落", () => {
  const wb = el({ id: "c1", type: "workbench", locCode: "6011-C", rows: 2, cols: 3 });

  it("桌上/桌下是可读标签（不再是「1桌上/桌下02区」）", () => {
    expect(cellLabelAt(wb, 0, 1)).toBe("桌上02区");
    expect(cellLabelAt(wb, 1, 1)).toBe("桌下02区");
  });

  it("**码结构不变**：标签变了但四段码与解析结果不变", () => {
    expect(findElementByLoc([wb], "6011-C-1-02")?.id).toBe("c1");
    expect(findElementByLoc([wb], "6011-C-2-02")?.id).toBe("c1");
  });

  it("**旧布局无 rowNames → 回落 rowLabel**（不空标签、不报错）", () => {
    const old = el({ id: "s1", type: "shelf", locCode: "6011-A", rows: 4, cols: 8 });
    expect(cellLabelAt(old, 2, 4)).toBe("3层05位");
  });

  it("**rowNames 长度与 rows 不符 → 回落 rowLabel**（不崩、不静默取错项）", () => {
    const bad = el({ id: "c2", type: "workbench", rows: 3, cols: 1 });
    expect(cellLabelAt(bad, 0, 0)).toBe("1桌上/桌下01区");   // ← 明确回落，不取 "桌上"
  });
});

describe("粘贴守卫：容器内的元素没有独立位置（拒绝 → 不产生新元素、不产生孤儿）", () => {
  const parent = el({ id: "p1", type: "cabinet", name: "B柜", x: 0, y: 0, w: 200, h: 200 });
  const child = el({ id: "k1", type: "drawer", x: 20, y: 20, w: 60, h: 40, parentId: "p1" });
  const l = layout([parent, child]);

  it("复制子元素 → 返回可读拒绝原因（含父容器名 + 两条出路）", () => {
    const msg = pasteRejection(l, [{ id: "k1" }]);
    expect(msg).not.toBeNull();
    expect(msg!).toContain("B柜");                     // 说清在哪个容器里
    expect(msg!).toContain("复制整个容器");             // 出路 1
    expect(msg!).toContain("移出容器");                 // 出路 2
  });

  it("自由元素不受影响（不该拦）", () => {
    expect(pasteRejection(layout([el({ id: "a1", type: "shelf" })]), [{ id: "a1" }])).toBeNull();
  });

  it("**被拒绝时不产生任何新元素、也不产生孤儿**", () => {
    const msg = pasteRejection(l, [{ id: "k1" }]);
    if (!msg) throw new Error("本应被拒绝");
    // 拒绝路径不触碰布局（等价于 UI 直接 return）
    expect(l.items).toHaveLength(2);
    expect(findOrphans(l)).toEqual([]);
  });
});

describe("F 嵌套布局下 C 补码：不触碰任何已有编码", () => {
  const parent = el({ id: "p1", type: "cabinet", name: "A柜", locCode: "6011-A", rows: 4, cols: 2, w: 200, h: 200 });
  const child = el({ id: "k1", type: "drawer", locCode: "", rows: 4, cols: 1, parentId: "p1" });
  const free = el({ id: "f1", type: "shelf", locCode: "", rows: 4, cols: 8 });
  const l = layout([parent, child, free]);

  it("只给空的补码；父柜的 6011-A 一字不改；子元素也能补到独立码", async () => {
    const { planCodes, applyCodePlan } = await import("@/components/inventory/layoutCodeGen");
    const plan = planCodes(l, [], "6011");
    const out = applyCodePlan(l, plan);

    expect(out.items.find(i => i.id === "p1")!.locCode).toBe("6011-A");        // 已贴标签：不变
    expect(out.items.find(i => i.id === "k1")!.locCode).toBe("6011-B");        // 子元素补独立码
    expect(out.items.find(i => i.id === "f1")!.locCode).toBe("6011-C");
    expect(out.items.find(i => i.id === "k1")!.parentId).toBe("p1");           // 嵌套关系不受影响
    expect(findOrphans(out)).toEqual([]);
  });
});

describe("③ 位移提交处理器（**处理器层**，非组件层）：提交结果 = applyMoved", () => {
  const parent = el({ id: "p1", type: "cabinet", x: 100, y: 100, w: 300, h: 300 });
  const child = el({ id: "k1", type: "drawer", x: 140, y: 160, w: 60, h: 40, parentId: "p1" });
  const l = layout([parent, child]);

  it("**拖动提交路径的结果与 applyMoved 深相等**（绕过它就漂移 → 会立刻红）", async () => {
    const { moveElement } = await import("@/components/inventory/useNestActions");
    const moved = { ...parent, x: 400, y: 380 };
    expect(moveElement(l, moved)).toEqual(applyMoved(l, moved));
    // 且子元素确实跟着走（相对位置守恒）
    const after = moveElement(l, moved);
    expect(childrenOf(after, "p1")[0].x - 400).toBe(140 - 100);
  });

  it("nestableParents：只给出可作父的容器（1 层限制、不放自己）", async () => {
    const { nestableParents } = await import("@/components/inventory/useNestActions");
    const l2 = layout([parent, child, el({ id: "free1", type: "shelf" }), el({ id: "p2", type: "cabinet" })]);
    const targets = nestableParents(l2, "free1").map(p => p.id);
    expect(targets).toEqual(["p1", "p2"]);            // 不能把自己当容器
    expect(nestableParents(l2, "k1")).toEqual([]);    // 已在容器内 → 无可选目标（仅支持 1 层）
  });
});
