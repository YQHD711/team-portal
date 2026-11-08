import { describe, it, expect } from "vitest";
import { toBatteryLabelData, batteryLabelFileName, pickMaterialTemplate } from "@/lib/batteryLabelPdf";
import type { LabelTemplate } from "@/lib/labelTemplate";

const tpl = (id: number, kind: string, isDefault = false): LabelTemplate => ({
  id,
  name: "t" + id,
  kind,
  isDefault,
  widthMm: 80,
  heightMm: 50,
  dpi: 203,
  background: "#ffffff",
  elements: [],
});

describe("电池标签数据", () => {
  it("二维码内容指向 /b/<code> 短链", () => {
    const data = toBatteryLabelData({ code: "BAT-0001", model: "6S 3300mAh" }, "https://team.example.com");
    expect(data.url).toBe("https://team.example.com/b/BAT-0001");
    expect(data.code).toBe("BAT-0001");
    expect(data.name).toBe("6S 3300mAh");
  });

  it("origin 末尾斜杠不会产生双斜杠", () => {
    const data = toBatteryLabelData({ code: "BAT-0002" }, "https://team.example.com/");
    expect(data.url).toBe("https://team.example.com/b/BAT-0002");
  });

  it("没有型号时名称回落到「电池」", () => {
    expect(toBatteryLabelData({ code: "BAT-0003" }, "https://x").name).toBe("电池");
  });

  it("文件名带日期", () => {
    expect(batteryLabelFileName(new Date(2026, 10, 8))).toBe("电池标签-2026-11-08.pdf");
  });
});

describe("电池标签模板选择", () => {
  it("优先选标记为默认的物料模板", () => {
    const picked = pickMaterialTemplate([tpl(1, "location", true), tpl(2, "material"), tpl(3, "material", true)]);
    expect(picked?.id).toBe(3);
  });

  it("没有默认物料模板时退回任意物料模板", () => {
    const picked = pickMaterialTemplate([tpl(1, "location", true), tpl(2, "material")]);
    expect(picked?.id).toBe(2);
  });

  it("只有库位模板时返回 null（调用方回落内置默认）", () => {
    expect(pickMaterialTemplate([tpl(1, "location", true)])).toBeNull();
  });
});
