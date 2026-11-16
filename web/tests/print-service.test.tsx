import { describe, it, expect } from "vitest";
import { labelFileName, pickMaterialTemplate } from "@/lib/printService";
import type { LabelTemplate } from "@/lib/labelTemplate";

const tpl = (id: number, kind: string, isDefault = false): LabelTemplate => ({
  id, name: "t" + id, kind, isDefault,
  widthMm: 80, heightMm: 50, dpi: 203, background: "#ffffff", elements: [],
});

describe("printService 统一命名", () => {
  it("三种用途各自命名", () => {
    const when = new Date(2026, 10, 16);
    expect(labelFileName("material", when)).toBe("物料标签-2026-11-16.pdf");
    expect(labelFileName("location", when)).toBe("库位标签-2026-11-16.pdf");
    expect(labelFileName("battery", when)).toBe("电池标签-2026-11-16.pdf");
  });
});

describe("printService 模板选择（各域统一出口）", () => {
  it("优先默认物料模板", () => {
    expect(pickMaterialTemplate([tpl(1, "location", true), tpl(2, "material"), tpl(3, "material", true)])?.id).toBe(3);
  });
  it("无默认时退回任意物料模板", () => {
    expect(pickMaterialTemplate([tpl(1, "location", true), tpl(2, "material")])?.id).toBe(2);
  });
  it("只有库位模板时为 null", () => {
    expect(pickMaterialTemplate([tpl(1, "location", true)])).toBeNull();
  });
});
