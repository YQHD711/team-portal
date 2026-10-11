import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATE, LABEL_FIELDS, SAMPLE_LABEL_DATA,
  metaText, normalizeElement, normalizeTemplate, normalizeTemplates, resolveElementText,
  type LabelData,
} from "@/lib/labelTemplate";

/**
 * 模板契约与兜底：meta 组合规则、字段解析、归一化、内置默认模板 = 改造前那一版。
 */

const full: LabelData = {
  code: "BAT-001", url: "http://x/i/BAT-001", name: "锂电池",
  grade: "A", locationCode: "1012-A-1-01", category: "电池电源",
};

describe("meta 组合字段（复刻改造前第三行，逐字一致）", () => {
  it("三个字段齐全", () => {
    expect(metaText(full)).toBe("A 级 · 1012-A-1-01 · 电池电源");
  });

  it("缺等级 → 前导 `-`（与改造前的 `${grade || \"-\"}` 一致）", () => {
    expect(metaText({ ...full, grade: null })).toBe("- 级 · 1012-A-1-01 · 电池电源");
    expect(metaText({ ...full, grade: "" })).toBe("- 级 · 1012-A-1-01 · 电池电源");
  });

  it("缺库位 / 缺分类 → 各自的兜底文案", () => {
    expect(metaText({ ...full, locationCode: null })).toBe("A 级 · 库位未指定 · 电池电源");
    expect(metaText({ ...full, category: undefined })).toBe("A 级 · 1012-A-1-01 · 未分类");
    expect(metaText({ grade: null, locationCode: null, category: null })).toBe("- 级 · 库位未指定 · 未分类");
  });
});

describe("resolveElementText：7 个字段 + 固定文字", () => {
  it("七个字段各自取值", () => {
    expect(resolveElementText({ field: "code" }, full)).toBe("BAT-001");
    expect(resolveElementText({ field: "name" }, full)).toBe("锂电池");
    expect(resolveElementText({ field: "grade" }, full)).toBe("A");
    expect(resolveElementText({ field: "locationCode" }, full)).toBe("1012-A-1-01");
    expect(resolveElementText({ field: "category" }, full)).toBe("电池电源");
    expect(resolveElementText({ field: "url" }, full)).toBe("http://x/i/BAT-001");
    expect(resolveElementText({ field: "meta" }, full)).toBe(metaText(full));
  });

  it("缺值字段返回空串（不画字），空 field 用固定文字", () => {
    expect(resolveElementText({ field: "grade" }, { ...full, grade: null })).toBe("");
    expect(resolveElementText({ field: "", text: "固定文字" }, full)).toBe("固定文字");
    expect(resolveElementText({}, full)).toBe("");
  });

  it("LABEL_FIELDS 恰好 7 个（含 meta）", () => {
    expect(LABEL_FIELDS.map(f => f.value)).toEqual(["code", "name", "grade", "locationCode", "category", "url", "meta"]);
  });
});

describe("内置兜底默认模板 = 改造前那一版版式", () => {
  it("尺寸/DPI/背景", () => {
    expect(DEFAULT_TEMPLATE.widthMm).toBe(80);
    expect(DEFAULT_TEMPLATE.heightMm).toBe(50);
    expect(DEFAULT_TEMPLATE.dpi).toBe(600);
    expect(DEFAULT_TEMPLATE.background).toBe("#FFFFFF");
    expect(DEFAULT_TEMPLATE.isDefault).toBe(true);
  });

  it("二维码 x3 y10 w30 h30 静区 3", () => {
    const qr = DEFAULT_TEMPLATE.elements.find(e => e.type === "qr")!;
    expect([qr.x, qr.y, qr.w, qr.h, qr.quietMm]).toEqual([3, 10, 30, 30, 3]);
  });

  it("右侧四行文字的位置/字号/字重/字族/颜色与改造前一致", () => {
    const byId = (id: string) => DEFAULT_TEMPLATE.elements.find(e => e.id === id)!;
    expect(byId("code")).toMatchObject({ x: 36, w: 41, y: 14, h: 6, fontSizePt: 12, fontWeight: 700, fontFamily: "mono", color: "#111111" });
    expect(byId("name")).toMatchObject({ y: 22, h: 7, fontSizePt: 10, fontWeight: 600, fontFamily: "sans" });
    expect(byId("meta")).toMatchObject({ y: 29.5, h: 5, fontSizePt: 8, color: "#444444" });
    expect(byId("url")).toMatchObject({ y: 35.5, h: 4.5, fontSizePt: 6.5, color: "#666666" });
  });

  it("示例数据可用于设计器预览", () => {
    expect(resolveElementText({ field: "meta" }, SAMPLE_LABEL_DATA)).toBe("B 级 · 1030-A-1-01 · 动力系统");
  });
});

describe("归一化：接口返回任何东西都不能让渲染崩", () => {
  it("完全不合法的模板 → null（调用方改用内置默认模板）", () => {
    expect(normalizeTemplate(null)).toBeNull();
    expect(normalizeTemplate("nope")).toBeNull();
    expect(normalizeTemplate(42)).toBeNull();
  });

  it("缺元素 → 用默认元素补齐；非法元素被丢掉", () => {
    const t = normalizeTemplate({ id: 7, name: "T", widthMm: 60, heightMm: 40, dpi: 300, background: "#EEE", elements: [{ type: "blob" }, null] })!;
    expect(t.elements.length).toBe(DEFAULT_TEMPLATE.elements.length);
    expect(t.widthMm).toBe(60);
    expect(t.dpi).toBe(300);
  });

  it("字面量元素：字段不认识当固定文字，对齐不认识当居中，autoShrink:false 保留", () => {
    const el = normalizeElement({ type: "text", x: 1, y: 2, w: 20, h: 5, field: "wat", text: "hi", align: "wat", autoShrink: false, fontSizePt: 9 }, 0)!;
    expect(el).toMatchObject({ x: 1, y: 2, w: 20, h: 5, field: "", text: "hi", align: "center", autoShrink: false, fontSizePt: 9 });
  });

  it("二维码元素：size 小于 1 或 NaN 时被夹到合法值", () => {
    const el = normalizeElement({ type: "qr", x: 0, y: 0, w: 0, h: Number.NaN, quietMm: -5 }, 1)!;
    expect(el.w).toBe(1);
    expect(el.h).toBeGreaterThanOrEqual(1);
    expect(el.quietMm).toBe(0);
  });

  it("normalizeTemplates：{templates:[...]} 正常，非数组返回空数组", () => {
    expect(normalizeTemplates({ templates: [{ id: 1, name: "A", elements: [] }] })).toHaveLength(1);
    expect(normalizeTemplates({ templates: "x" })).toEqual([]);
    expect(normalizeTemplates(null)).toEqual([]);
  });
});
