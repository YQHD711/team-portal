import { describe, it, expect } from "vitest";
import {
  COLS_MAX, ROWS_MAX, clamp, cm, formatArea, formatCellDims, formatDims, formatLen, formatMeters, intIn, numIn,
} from "@/components/inventory/layoutUnits";
import { ELEMENT_DEFS, cellAxes, cellSummary, colsOf, rowsOf, usesCells, type ItemElement, type MaterialItem } from "@/components/inventory/layoutTypes";
import { createElement, defaultLayout, layoutSummary, layoutToJson, parseLayout, withElement } from "@/components/inventory/layoutCodec";
import { cellLabelAt, cellLabelFromLoc, elementCells, hitItemElement, itemHitCells, cellKey } from "@/components/inventory/elementGeometry";
import { cellCounts, elementMaterials, elementStats, findElementByLoc, locationKey, materialsByCell } from "@/components/inventory/locationCodes";
import { clampScale, fitView, zoomAt, pinchView, distance, midpoint } from "@/components/inventory/layoutGestures";
import { buildLocCode, locationRoom, parseLocParts } from "@/components/inventory/locCode";
import { LOW_STOCK_THRESHOLD, cellClasses, cellFill, EMPTY_FILL, LOW_FILL, FULL_FILL } from "@/components/inventory/cellColors";
import { SIZE_PRESETS } from "@/components/inventory/layoutPresets";

// ── 测试数据 ──
const el = (over: Partial<ItemElement> = {}): ItemElement => ({
  id: "e1", type: "shelf", name: "A货架", locCode: "201-A",
  x: 0, y: 0, w: 200, h: 60, rotation: 0, rows: 4, cols: 8, ...over,
});
const mat = (id: number, locationCode: string, quantity = 1, name = `物料${id}`): MaterialItem =>
  ({ id, name, quantity, locationCode });

describe("单位：统一 cm", () => {
  it("格式化长度/尺寸/面积/单格", () => {
    expect(formatLen(240)).toBe("240 cm");
    expect(formatDims(240, 60.25)).toBe("240 × 60.3 cm");
    expect(formatArea(900, 600)).toBe("54 m²");
    expect(formatArea(160, 80)).toBe("1.28 m²");
    expect(formatCellDims(23.75, 8.5)).toBe("约 23.8 × 8.5 cm/格");
    expect(formatCellDims(0, 0)).toBe("");
    expect(formatMeters(900)).toBe("9 m");
    expect(formatMeters(650)).toBe("6.5 m");
    expect(cm(8)).toBe("8");
    expect(cm(8.04)).toBe("8");
    expect(cm(8.06)).toBe("8.1");
  });

  it("数值夹取与非法输入回落", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(intIn("7", 1, ROWS_MAX, 1)).toBe(7);
    expect(intIn("99", 1, ROWS_MAX, 1)).toBe(ROWS_MAX);
    expect(intIn("abc", 1, ROWS_MAX, 4)).toBe(4);
    expect(intIn("3.6", 1, COLS_MAX, 8)).toBe(4);
    expect(numIn(undefined, 0, 100, 12)).toBe(12);
    expect(numIn(-5, 0, 100, 1)).toBe(0);
  });
});

describe("元素模型：行 × 列 与类型适配", () => {
  it("各类型默认格位与称呼", () => {
    expect(rowsOf(el({ rows: undefined, cols: undefined }))).toBe(1);
    expect(usesCells(el({ rows: 1, cols: 1 }))).toBe(false);
    expect(usesCells(el())).toBe(true);
    expect(cellSummary(el())).toBe("4 层 × 8 位");
    expect(cellSummary(el({ rows: 1, cols: 1 }))).toBe("整体挂载");
    expect(cellAxes(el()).rowLabel).toBe("层");
    expect(cellAxes(el({ type: "cabinet", rows: 4, cols: 2 }))).toMatchObject({ rowLabel: "层", colLabel: "格" });
    expect(cellAxes(el({ type: "workbench", rows: 1, cols: 3 }))).toMatchObject({ rowLabel: "排", colLabel: "区" });
  });

  it("新建元素带上类型默认格位（cm 默认尺寸）", () => {
    const room = defaultLayout("201");
    const shelf = createElement("shelf", room, 0) as ItemElement;
    const cabinet = createElement("cabinet", room, 1) as ItemElement;
    const bench = createElement("workbench", room, 2) as ItemElement;
    const device = createElement("device", room, 3) as ItemElement;
    expect([shelf.w, shelf.h, shelf.rows, shelf.cols]).toEqual([200, 60, 4, 8]);
    expect([cabinet.w, cabinet.h, cabinet.rows, cabinet.cols]).toEqual([100, 60, 4, 2]);
    expect([bench.rows, bench.cols]).toEqual([1, 3]);
    expect(usesCells(device)).toBe(false);
    // 墙/门/窗没有格位字段
    expect("type" in createElement("wall", room, 0)).toBe(false);
  });

  it("解析旧数据：shelfCount/positionCount 映射为 rows/cols，单位缺省 cm", () => {
    const json = JSON.stringify({
      width: 900, height: 600,
      walls: [{ id: "w1", x: 0, y: 0, w: 900, h: 10, rotation: 0 }],
      doors: [], windows: [],
      items: [
        { id: "it1", type: "shelf", name: "A", x: 0, y: 0, w: 200, h: 60, rotation: 0, locCode: "201-A", shelfCount: 3, positionCount: 5 },
        { id: "it2", type: "cabinet", name: "柜1", x: 0, y: 0, w: 100, h: 60, rotation: 0, locCode: "201-B" },
      ],
    });
    const layout = parseLayout(json)!;
    expect(layout.unit).toBe("cm");
    expect([layout.items[0].rows, layout.items[0].cols]).toEqual([3, 5]);
    // 旧柜子没有格位字段 → 1×1 整体挂载
    expect([layout.items[1].rows, layout.items[1].cols]).toEqual([1, 1]);
    // 新写入的 JSON 一定带 cm 标记
    expect(JSON.parse(layoutToJson(layout)).unit).toBe("cm");
  });

  it("损坏 JSON 返回 null；元素摘要与写回按 id 生效", () => {
    expect(parseLayout("{ 不是 json")).toBeNull();
    expect(parseLayout(null)).toBeNull();
    const layout = defaultLayout("201");
    expect(layoutSummary(layout)).toBe("立体货架×1");
    expect(layoutSummary({ ...layout, items: [] })).toBe("暂无元素");
    const moved = withElement(layout, { ...layout.items[0], x: 111 });
    expect(moved.items[0].x).toBe(111);
    const wall = layout.walls[0];
    expect(withElement(layout, { ...wall, w: 500 }).walls[0].w).toBe(500);
  });
});

describe("格位几何与编码", () => {
  it("货架 4×8 生成 32 个格位，编码为 locCode-层-位", () => {
    const cells = elementCells(el());
    expect(cells).toHaveLength(32);
    expect(cells[0].code).toBe("201-A-1-01");
    expect(cells[cells.length - 1].code).toBe("201-A-4-08");
    // 第一行第一列在标签区之下、左侧留白之后
    expect(cells[0].lx).toBeGreaterThan(0);
    expect(cells[0].ly).toBeGreaterThan(0);
    // 无 locCode 时只渲染不编码
    expect(elementCells(el({ locCode: "" }))[0].code).toBe("");
  });

  it("1×1 元素不划分格位，但作为整体挂载单元参与连线", () => {
    const device = el({ type: "device", rows: 1, cols: 1, locCode: "201-C", w: 80, h: 80 });
    expect(elementCells(device)).toHaveLength(0);
    const units = itemHitCells(device);
    expect(units).toHaveLength(1);
    expect(units[0].code).toBe("201-C");
    expect(units[0].cx).toBe(40);
    expect(units[0].cy).toBe(40);
  });

  it("命中格位支持旋转（逆旋转回局部坐标）", () => {
    const plain = el({ x: 100, y: 100 });
    const first = elementCells(plain)[0];
    const hit = hitItemElement(plain, first.cx, first.cy);
    expect(hit?.cell?.code).toBe("201-A-1-01");
    // 标签区（标题）不命中格位
    expect(hitItemElement(plain, 110, 102)).toBeNull();
  });

  it("格位名称按类型显示 层位/层格/排区", () => {
    expect(cellLabelAt(el(), 2, 4)).toBe("3层05位");
    expect(cellLabelAt(el({ type: "cabinet" }), 1, 0)).toBe("2层01格");
    expect(cellLabelAt(el({ type: "workbench", rows: 1, cols: 3 }), 0, 1)).toBe("1排02区");
    expect(cellLabelAt(el({ rows: 1, cols: 1 }), 0, 0)).toBe("201-A");
    expect(cellLabelFromLoc(el(), "201-A-3-05")).toBe("3层05位");
    expect(cellLabelFromLoc(el(), "201-A")).toBe("201-A");
  });
});

describe("库位编码 → 元素/格位映射", () => {
  const elements = [
    el(),
    el({ id: "e2", type: "cabinet", locCode: "201-B", rows: 4, cols: 2 }),
    el({ id: "e3", type: "device", locCode: "201-C", rows: 1, cols: 1 }),
  ];

  it("按四段/短编码找到元素", () => {
    expect(findElementByLoc(elements, "201-A-3-05")?.id).toBe("e1");
    expect(findElementByLoc(elements, "201-B-2-01")?.id).toBe("e2");
    expect(findElementByLoc(elements, "201-C")?.id).toBe("e3");
    expect(findElementByLoc(elements, "")).toBeNull();
    expect(findElementByLoc(elements, "999-Z-1-01")).toBeNull();
  });

  it("位置 key 校验格位范围", () => {
    expect(locationKey(elements[0], "201-A-3-05")).toBe("201-A-3-05");
    expect(locationKey(elements[0], "201-A-3")).toBeNull();
    expect(locationKey(elements[0], "201-A-9-01")).toBeNull(); // 超出 4 层
    expect(locationKey(elements[0], "201-A-1-99")).toBeNull(); // 超出 8 位
    expect(locationKey(elements[2], "201-C")).toBe("201-C");
    expect(locationKey(elements[2], "201-D")).toBeNull();
    expect(locationKey(el({ locCode: "" }), "201-A-1-01")).toBeNull();
  });

  it("物料统计：格位细分 / 整体挂载 / 越界物料不计入", () => {
    const items = [
      mat(1, "201-A-1-01", 2),
      mat(2, "201-A-1-01", 3),
      mat(3, "201-A-4-08", 5),
      mat(4, "201-A-9-01", 7), // 超出层数 → 不计入货架
      mat(5, "201-B-2-01", 4),
      mat(6, "201-C", 6),
      mat(7, ""),
    ];
    const shelf = elements[0];
    expect(elementMaterials(shelf, items).map(i => i.id)).toEqual([1, 2, 3]);
    const counts = cellCounts(shelf, items);
    expect(counts.get(cellKey(0, 0))).toBe(5);
    expect(counts.get(cellKey(3, 7))).toBe(5);
    expect(counts.get(cellKey(8, 0))).toBeUndefined();
    expect([...counts.values()].reduce((s, n) => s + n, 0)).toBe(10);
    // 整体挂载：只有总数
    expect(cellCounts(elements[2], items).get("whole")).toBe(6);
    expect(elementMaterials(elements[2], items).map(i => i.id)).toEqual([6]);
    // 统计
    const stats = elementStats(shelf, items);
    expect(stats).toMatchObject({ total: 10, kinds: 3, usedCells: 2, totalCells: 32 });
    const grouped = materialsByCell(shelf, items);
    expect(grouped.get(cellKey(0, 0))?.map(i => i.id)).toEqual([1, 2]);
    expect(grouped.get(cellKey(3, 7))?.map(i => i.id)).toEqual([3]);
  });
});

describe("视图变换（缩放/平移）", () => {
  it("锚点缩放后该点对应的画布坐标不变", () => {
    const view = { scale: 0.8, x: 40, y: 20 };
    const px = 300, py = 150;
    const world = { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    const next = zoomAt(view, 1.6, px, py);
    expect(next.scale).toBe(1.6);
    expect((px - next.x) / next.scale).toBeCloseTo(world.x, 6);
    expect((py - next.y) / next.scale).toBeCloseTo(world.y, 6);
  });

  it("缩放范围受限，适应视图居中且不超出上限", () => {
    expect(clampScale(99)).toBe(3);
    expect(clampScale(0)).toBe(0.15);
    const fit = fitView(800, 500, 900, 600);
    expect(fit.scale).toBeLessThanOrEqual(1.5);
    expect(fit.x).toBeCloseTo((800 - 900 * fit.scale) / 2, 6);
    expect(fitView(0, 0, 900, 600)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("双指捏合按距离比例缩放，中点与距离工具函数正确", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 0 }, { x: 4, y: 6 })).toEqual({ x: 2, y: 3 });
    const zoomed = pinchView({ scale: 1, x: 0, y: 0 }, 100, 200, { x: 0, y: 0 });
    expect(zoomed.scale).toBe(2);
    expect(pinchView({ scale: 1, x: 0, y: 0 }, 0, 100, { x: 0, y: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("库位编码构造与格位配色", () => {
  it("构造/解析四段编码（架位补零）", () => {
    expect(buildLocCode("201", "1", "A", "3")).toBe("201-01-A-03");
    expect(parseLocParts("201-01-A-03")).toEqual({ room: "201", cabinet: "01", shelf: "A", pos: "03" });
    expect(parseLocParts("")).toEqual({ room: "", cabinet: "", shelf: "", pos: "" });
    expect(locationRoom("201-01-A-03")).toBe("201");
    expect(locationRoom(undefined)).toBe("");
  });

  it("有货按类型着色，低于阈值用琥珀色，空位半透明", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(3);
    expect(cellFill("shelf", 0)).toBe(EMPTY_FILL);
    expect(cellFill("shelf", 2)).toBe(LOW_FILL);
    expect(cellFill("shelf", 3)).toBe(FULL_FILL.shelf);
    expect(cellFill("cabinet", 10)).toBe(FULL_FILL.cabinet);
    expect(cellClasses(0)).toContain("border-dashed");
    expect(cellClasses(1)).toContain("amber");
    expect(cellClasses(9)).toContain("sky");
  });

  it("尺寸预设覆盖全部物品类型且单位为 cm", () => {
    expect(SIZE_PRESETS.shelf[0]).toEqual([200, 60]);
    expect(SIZE_PRESETS.cabinet.length).toBeGreaterThan(2);
    expect(SIZE_PRESETS.workbench.every(([w, h]) => w > 0 && h > 0)).toBe(true);
    expect(ELEMENT_DEFS.shelf.label).toBe("立体货架");
  });
});
