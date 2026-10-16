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
  applyMoved, canNest, childrenOf, clampInside, deepCopySubtree, deleteElementSafe,
  deleteWithChildren, detachElement, findOrphans,
} from "@/components/inventory/layoutNesting";

const el = (o: Partial<ItemElement> & { id: string; type: ItemElement["type"] }): ItemElement => ({
  name: o.id, x: 0, y: 0, w: 100, h: 100, rotation: 0, rows: 1, cols: 1, ...o,
});
const layout = (items: ItemElement[]): RoomLayout =>
  ({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items });

describe("A 抽屉：类型/配色/四段编码", () => {
  it("ITEM_TYPES 与定义齐全，标签是「可堆叠抽屉」，1 位 × N 屉", () => {
    expect(ITEM_TYPES).toContain("drawer");
    const def = ELEMENT_DEFS.drawer;
    expect(def.label).toBe("可堆叠抽屉");
    expect(def.rows).toBe(4);
    expect(def.cols).toBe(1);
    expect(def.rowLabel).toBe("屉");
    expect(def.colLabel).toBe("位");
  });

  it("**配色不与其它类型撞**（主色 + 格位填充色都不同）", () => {
    const others = (["shelf", "workbench", "cabinet", "device", "pegboard"] as const).map(k => ELEMENT_DEFS[k].color.toLowerCase());
    expect(others).not.toContain(ELEMENT_DEFS.drawer.color.toLowerCase());
    const fills = (["shelf", "workbench", "cabinet", "device", "pegboard"] as const).map(k => FULL_FILL[k].toLowerCase());
    expect(fills).not.toContain(FULL_FILL.drawer.toLowerCase());
  });

  it("编码落在既有四段里：6011-L-3-01 能解析回该抽屉", () => {
    const d = el({ id: "d1", type: "drawer", locCode: "6011-L", rows: 4, cols: 1 });
    expect(findElementByLoc([d], "6011-L")?.id).toBe("d1");
    expect(findElementByLoc([d], "6011-L-3-01")?.id).toBe("d1");   // 第 3 屉第 1 位
  });
});

describe("C 桌上/桌下：四段内表达且两码不同（旧码不变）", () => {
  it("工作台 rows=2，桌上/桌下是不同编码；旧 1排×3区 的码照常解析", () => {
    const wb = el({ id: "c1", type: "workbench", locCode: "6011-C", rows: 2, cols: 3 });
    const deskTop = findElementByLoc([wb], "6011-C-1-02");        // 桌上 2 区
    const deskUnder = findElementByLoc([wb], "6011-C-2-02");      // 桌下 2 区
    expect(deskTop?.id).toBe("c1");
    expect(deskUnder?.id).toBe("c1");
    expect("6011-C-1-02").not.toBe("6011-C-2-02");
    expect(ELEMENT_DEFS.workbench.rowLabel).toBe("桌上/桌下");
    expect(ELEMENT_DEFS.workbench.rows).toBe(2);
  });
});

describe("B 嵌套：1 层限制 + 钳制 + 唯一传播路径", () => {
  const parent = el({ id: "p1", type: "cabinet", x: 100, y: 100, w: 200, h: 200 });
  const child = el({ id: "k1", type: "drawer", x: 120, y: 140, w: 60, h: 40, parentId: "p1" });
  const l = layout([parent, child]);

  it("canNest：不能放自己、父必须是可挂载元素、只允许 1 层", () => {
    expect(canNest(l, "k1", "k1").ok).toBe(false);
    expect(canNest(layout([parent, el({ id: "d2", type: "drawer" })]), "d2", "p1").ok).toBe(true);
    expect(canNest(l, "p1", "k1").ok).toBe(false);          // k1 已在容器内 → 不能再当容器
  });

  it("**③ 移动父元素后，子元素相对父的偏移不变**（唯一传播路径）", () => {
    const before = childrenOf(l, "p1")[0];
    const relBefore = { dx: before.x - parent.x, dy: before.y - parent.y };

    const after = applyMoved(l, { ...parent, x: 300, y: 250 });   // 父整体移动
    const movedChild = childrenOf(after, "p1")[0];
    expect(movedChild.x - 300).toBe(relBefore.dx);                // 相对位置守恒
    expect(movedChild.y - 250).toBe(relBefore.dy);
  });

  it("子元素被钳制在父边界内（拖不出去）", () => {
    const c = clampInside({ ...child, x: 9999, y: 9999 }, parent);
    expect(c.x).toBe(parent.x + parent.w - child.w);
    expect(c.y).toBe(parent.y + parent.h - child.h);
  });

  it("**有子元素时禁止缩放父元素**（返回原布局，不静默改子元素真实尺寸）", () => {
    const after = applyMoved(l, { ...parent, w: 400, h: 400 });
    expect(after).toBe(l);                                        // 原样返回
  });

  it("「移出容器」只能显式调用：detachElement 清掉 parentId", () => {
    expect(findOrphans(l)).toEqual([]);
    const out = detachElement(l, "k1");
    expect(out.items.find(e => e.id === "k1")!.parentId).toBeUndefined();
  });
});

describe("D 删除：绝不静默、绝不孤儿", () => {
  const parent = el({ id: "p1", type: "cabinet", locCode: "6011-P" });
  const child = el({ id: "k1", type: "drawer", locCode: "6011-P-2-01", parentId: "p1" });
  const l = layout([parent, child]);

  it("**删父被阻止**并给出子元素清单（含名称与库位编码）", () => {
    const r = deleteElementSafe(l, "p1");
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") {
      expect(r.children.map(c => c.id)).toEqual(["k1"]);
      expect(r.children[0].locCode).toBe("6011-P-2-01");          // 清单里带编码
    }
    expect(l.items).toHaveLength(2);                               // 未改动
  });

  it("无子元素时正常删除", () => {
    const r = deleteElementSafe(layout([parent]), "p1");
    expect(r.kind).toBe("deleted");
    if (r.kind === "deleted") expect(r.layout.items).toHaveLength(0);
  });

  it("**显式级联删除后无孤儿**（不变量）", () => {
    const out = deleteWithChildren(l, "p1");
    expect(out.items).toHaveLength(0);
    expect(findOrphans(out)).toEqual([]);
  });
});

describe("E 深拷贝子树：新 id + parentId 重映射 + 相对偏移保持", () => {
  const parent = el({ id: "p1", type: "cabinet", x: 100, y: 100, w: 200, h: 200, locCode: "6011-P" });
  const child = el({ id: "k1", type: "drawer", x: 120, y: 140, w: 60, h: 40, parentId: "p1", locCode: "6011-K" });
  const l = layout([parent, child]);

  it("复制容器连子元素一起复制，且**父链指向新容器**、相对偏移不变、原容器仍在", () => {
    const r = deepCopySubtree(l, "p1", { dx: 24, dy: 18 })!;
    expect(r.rootId).not.toBe("p1");
    expect(r.layout.items).toHaveLength(4);                       // 原件 2 + 副本 2
    expect(r.layout.items.some(e => e.id === "p1")).toBe(true);   // 原容器保留

    const copyParent = r.layout.items.find(e => e.id === r.rootId)!;
    const copyChild = r.layout.items.find(e => e.parentId === r.rootId)!;
    expect(copyChild.id).not.toBe("k1");                          // 子元素新 id
    expect(copyChild.parentId).toBe(r.rootId);                    // **指向新容器**
    expect(copyParent.x).toBe(parent.x + 24);                     // 整体偏移
    expect(copyChild.x - copyParent.x).toBe(child.x - parent.x);   // 相对偏移保持
    expect(copyChild.type).toBe("drawer");                        // 同类型（不跨类型）
    expect(findOrphans(r.layout)).toEqual([]);                    // 无孤儿
  });

  it("locCode 会被一并复制（编码由 C 决定是否补，不在这里改）", () => {
    const r = deepCopySubtree(l, "p1", { dx: 0, dy: 0 })!;
    expect(r.layout.items.find(e => e.parentId === r.rootId)!.locCode).toBe("6011-K");
  });
});

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