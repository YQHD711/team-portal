/**
 * 桌上/桌下分区（task-39 纠正）：俯视图不画桌下、正视图两行、开关默认开启、关闭不静默。
 */
import { describe, expect, it } from "vitest";
import type { ItemElement, MaterialItem } from "@/components/inventory/layoutTypes";
import {
  frontRows, hasUnderTable, topRows, underTableCells, underTableImpact, withUnderTable,
} from "@/components/inventory/tableZones";
import { locationKey } from "@/components/inventory/locationCodes";
import { findElementByLoc } from "@/components/inventory/locationCodes";

const bench = (o: Partial<ItemElement> = {}): ItemElement => ({
  id: "b1", type: "workbench", name: "工作台", x: 0, y: 0, w: 200, h: 120, rotation: 0,
  locCode: "6011-C", rows: 2, cols: 3, ...o,
});
const mat = (id: number, locationCode: string): MaterialItem =>
  ({ id, name: `M${id}`, category: null, quantity: 1, locationCode, status: "available", grade: null, unitPrice: null, updatedAt: null } as unknown as MaterialItem);

describe("开关默认与泛化（俯/正行数）", () => {
  it("**默认开启**（字段缺省 = true）", () => {
    expect(hasUnderTable(bench())).toBe(true);
    expect(hasUnderTable(bench({ underTableEnabled: true }))).toBe(true);
    expect(hasUnderTable(bench({ underTableEnabled: false }))).toBe(false);
    expect(hasUnderTable(bench({ type: "shelf" }))).toBe(false);   // 非工作台无此概念
  });

  it("三条泛化都钉住：rows=1→俯1/正1；rows=2→俯1/正2；rows=3→俯2/正3", () => {
    expect([topRows(bench({ rows: 1 })), frontRows(bench({ rows: 1 }))]).toEqual([1, 1]);
    expect([topRows(bench({ rows: 2 })), frontRows(bench({ rows: 2 }))]).toEqual([1, 2]);
    expect([topRows(bench({ rows: 3 })), frontRows(bench({ rows: 3 }))]).toEqual([2, 3]);
  });

  it("关闭后正视图只剩桌上那一行，俯视图仍 1 行", () => {
    expect([topRows(bench({ rows: 2, underTableEnabled: false })), frontRows(bench({ rows: 2, underTableEnabled: false }))]).toEqual([1, 1]);
  });

  it("非工作台类型不受影响（俯=正=rows）", () => {
    expect([topRows(bench({ type: "shelf", rows: 4 })), frontRows(bench({ type: "shelf", rows: 4 }))]).toEqual([4, 4]);
  });
});

describe("「俯视图看不见」≠「没有编码」", () => {
  it("开启时桌下格位**有编码**（第 2 段起，rowsOf 驱动），只是不在俯视图里画", () => {
    const b = bench({ rows: 3, cols: 2 });
    expect(underTableCells(b)).toHaveLength(4);                    // 第 2、3 行 × 2 列
    expect(findElementByLoc([b], "6011-C-2-02")?.id).toBe("b1");   // 桌下第 2 行仍有码可解析
    expect(findElementByLoc([b], "6011-C-3-01")?.id).toBe("b1");
  });

  it("关闭时不再产出桌下格位（视图层），但**编码仍可解析**（宽松是刻意的）", () => {
    const b = bench({ rows: 2, underTableEnabled: false });
    expect(underTableCells(b)).toEqual([]);
    // 关键：locationKey 仍接受第 2 段 → 物料不会变成孤儿数据
    expect(locationKey(b, "6011-C-2-02")).not.toBeNull();
    expect(findElementByLoc([b], "6011-C-2-02")?.id).toBe("b1");
  });
});

describe("关闭不静默 + 可撤销的开启", () => {
  it("影响统计：桌下 N 个库位、M 件物料（用于关闭前确认）", () => {
    const b = bench({ rows: 2, cols: 3 });
    const impact = underTableImpact(b, [mat(1, "6011-C-2-01"), mat(2, "6011-C-1-01"), mat(3, "6011-C-2-03"), mat(4, "6011-X-2-01")]);
    expect(impact.cells).toBe(3);                                  // 第 2 行 3 个位
    expect(impact.items.map(m => m.id)).toEqual([1, 3]);           // 只算属于本工作台桌下的
  });

  it("关闭只改开关，**不删数据**（rows 与物料编码保留，重新开启无损）", () => {
    const b = bench({ rows: 2, cols: 3 });
    const off = withUnderTable(b, false);
    expect(off.rows).toBe(2);                                      // rows 不动
    expect(off.underTableEnabled).toBe(false);
    const on = withUnderTable(off, true);
    expect(hasUnderTable(on)).toBe(true);
    expect(findElementByLoc([on], "6011-C-2-01")?.id).toBe("b1");  // 恢复后编码照旧
  });

  it("rows=1 打开开关 → **自动提到 2**（否则开关开着却没有桌下行）", () => {
    const on = withUnderTable(bench({ rows: 1 }), true);
    expect(on.rows).toBe(2);
    expect(frontRows(on)).toBe(2);
  });
});