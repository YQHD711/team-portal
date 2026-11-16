import { describe, it, expect } from "vitest";
import { labelFileName, pickMaterialTemplate } from "@/lib/printService";
import { identityUrl, toIdentityLabelData, identityLabelFileName } from "@/lib/identityLabelPdf";
import type { LabelTemplate } from "@/lib/labelTemplate";

const tpl = (id: number, kind: string, isDefault = false): LabelTemplate => ({
  id, name: "t" + id, kind, isDefault,
  widthMm: 80, heightMm: 50, dpi: 203, background: "#ffffff", elements: [],
});

describe("printService 统一命名", () => {
  it("四种用途各自命名", () => {
    const when = new Date(2026, 10, 16);
    expect(labelFileName("material", when)).toBe("物料标签-2026-11-16.pdf");
    expect(labelFileName("location", when)).toBe("库位标签-2026-11-16.pdf");
    expect(labelFileName("battery", when)).toBe("电池标签-2026-11-16.pdf");
    expect(labelFileName("identity", when)).toBe("身份码-2026-11-16.pdf");
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

describe("身份码数据", () => {
  it("有 slug 用短链 /u/{slug}", () => {
    expect(identityUrl({ username: "20240001", slug: "u_abc" }, "https://team.example.com/"))
      .toBe("https://team.example.com/u/u_abc");
  });
  it("无 slug 直接用学号（login-by-id 兜底形态）", () => {
    expect(identityUrl({ username: "20240001", slug: null }, "https://team.example.com"))
      .toBe("20240001");
  });
  it("LabelData：编码=学号、名称=显示姓名、无姓名回落学号", () => {
    const d = toIdentityLabelData({ username: "20240001", displayName: "张三", slug: "u_abc" }, "https://x");
    expect(d.code).toBe("20240001");
    expect(d.name).toBe("张三");
    expect(d.url).toContain("/u/u_abc");

    const d2 = toIdentityLabelData({ username: "20240002", displayName: "  ", slug: null }, "https://x");
    expect(d2.name).toBe("20240002");
  });
  it("身份码文件名带日期", () => {
    expect(identityLabelFileName(new Date(2026, 10, 16))).toBe("身份码-2026-11-16.pdf");
  });
});
