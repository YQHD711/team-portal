/**
 * 模板**适用性守卫**（task-40）：导出与 ③ 设计器校验共用同一判定。
 * 关键风险：默认模板是为物料标签设计的——若它不含二维码/不显示库位编码，导出会**静默产出废纸**，
 * 所以取到默认模板后必须先判定，不适合就回落到内置库位模板并给可见提示。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE } from "@/lib/labelTemplate";

describe("适用性守卫（导出与 ③ 设计器校验共用同一判定）", () => {
  const withElements = (elements: unknown[]) => ({ ...DEFAULT_TEMPLATE, id: 7, name: "默认", elements }) as never;

  it("含 1 个 qr + 1 处引用 code/locationCode 的文本 → 适合", async () => {
    const { locationLabelSuitability } = await import("@/lib/labelSuitability");
    const tpl = withElements([
      { id: "q", type: "qr", x: 2, y: 2, w: 30, h: 30 },
      { id: "t", type: "text", x: 34, y: 4, w: 40, h: 8, field: "code" },
    ]);
    expect(locationLabelSuitability(tpl).ok).toBe(true);
  });

  it("**不含二维码** → 不适合，原因可读", async () => {
    const { locationLabelSuitability } = await import("@/lib/labelSuitability");
    const r = locationLabelSuitability(withElements([{ id: "t", type: "text", x: 1, y: 1, w: 10, h: 5, field: "name" }]));
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain("缺少二维码");
    expect(r.reasons.join()).toContain("至少需要一处显示库位编码");
  });

  it("有二维码但文本不引用编码 → 仍不适合", async () => {
    const { locationLabelSuitability } = await import("@/lib/labelSuitability");
    const r = locationLabelSuitability(withElements([
      { id: "q", type: "qr", x: 1, y: 1, w: 20, h: 20 },
      { id: "t", type: "text", x: 24, y: 2, w: 20, h: 6, field: "grade" },
    ]));
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain("至少需要一处显示库位编码");
  });

  it("**不适合的默认模板 → 回落内置模板 + 可见提示**（不静默产出废纸）", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const unsuitable = withElements([{ id: "t", type: "text", x: 1, y: 1, w: 10, h: 5, field: "name" }]);
    const pick = chooseExportTemplate(unsuitable);
    expect(pick.template.id).toBe(DEFAULT_TEMPLATE.id);            // 回落
    expect(pick.notice).toContain("不适合库位标签");
    expect(pick.notice).toContain("缺少二维码");
    // **产物仍然可用**：回落后的模板本身必须有二维码（jsQR 可解码由上面的用例保证）
    expect(pick.template.elements.some(e => e.type === "qr")).toBe(true);
  });

  it("接口不可用（无默认模板）→ 回落 + 提示", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const pick = chooseExportTemplate(null);
    expect(pick.template.id).toBe(DEFAULT_TEMPLATE.id);
    expect(pick.notice).toContain("模板接口不可用");
  });

  it("适合的默认模板 → 原样使用、无提示（尺寸随模板走）", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const good = { ...DEFAULT_TEMPLATE, id: 42, name: "60×40", widthMm: 60, heightMm: 40 };
    const pick = chooseExportTemplate(good as never);
    expect(pick.template.widthMm).toBe(60);
    expect(pick.notice).toBeNull();
  });
});

/**
 * **共享 fixture（与 C# `tests/api/LabelTemplateKindTests.cs` 同一组 id）**：防跨语言漂移。
 * `case:valid` / `case:missing-qr` / `case:qr-without-code-text` / `case:no-text` / `case:empty`
 * 两侧规则一致；若将来不一致 → **取更严格的一侧并同步另一侧**（两侧注释同步写明）。
 */
describe("共享 fixture：库位标签适用性（与 C# 一一对应）", () => {
  const mk = (id: string) => {
    const qr = { id: "q", type: "qr" as const, x: 1, y: 1, w: 10, h: 10 };
    const text = (field: string) => ({ id: "t", type: "text" as const, x: 1, y: 1, w: 10, h: 10, field: field as never });
    const map: Record<string, unknown[]> = {
      "case:valid": [qr, text("code")],
      "case:missing-qr": [text("code")],
      "case:qr-without-code-text": [qr, text("name")],
      "case:no-text": [qr],
      "case:empty": [],
    };
    return { ...DEFAULT_TEMPLATE, id: 1, name: "fixture", elements: map[id] } as never;
  };
  const cases = [["case:valid", true], ["case:missing-qr", false], ["case:qr-without-code-text", false], ["case:no-text", false], ["case:empty", false]] as const;
  for (const [id, ok] of cases) {
    it(`${id} → ${ok ? "适合" : "不适合"}（与 C# 同名用例对读）`, async () => {
      const { locationLabelSuitability } = await import("@/lib/labelSuitability");
      const r = locationLabelSuitability(mk(id));
      expect(r.ok).toBe(ok);
      if (!ok) expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
  it("候选来源：有 location 默认模板→用它；没有→null（调用方回落原逻辑）", async () => {
    const { pickLocationTemplate } = await import("@/lib/labelSuitability");
    const loc = { ...DEFAULT_TEMPLATE, id: 9, name: "库位", kind: "location", isDefault: true } as never;
    const mat = { ...DEFAULT_TEMPLATE, id: 8, name: "物料", kind: "material", isDefault: true } as never;
    expect(pickLocationTemplate([mat, loc])?.id).toBe(9);
    expect(pickLocationTemplate([mat])).toBeNull();
    expect(pickLocationTemplate([])).toBeNull();
  });
});
