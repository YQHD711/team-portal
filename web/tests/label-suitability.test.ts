/**
 * 模板**适用性**与**导出候选来源**（task-40）。用户后来明确：**库位标签不用二维码**。
 * 规则（两侧共享，C# 见 `tests/api/LabelTemplateKindTests.cs`）：
 *   `kind=location` → 必须 **≥1 处引用 `code` 或 `locationCode` 的文本**；二维码**可选**。
 * 共享 fixture 用例标识：case:valid / case:missing-qr / case:qr-without-code-text / case:no-text / case:empty
 * 两侧不一致时 → **取更严格的一侧并同步另一侧**（当前一致）。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE, type LabelTemplate } from "@/lib/labelTemplate";

const qr = { id: "q", type: "qr" as const, x: 1, y: 1, w: 10, h: 10 };
const text = (field: string) => ({ id: "t", type: "text" as const, x: 1, y: 1, w: 10, h: 10, field: field as never });
const withElements = (elements: unknown[]) =>
  ({ ...DEFAULT_TEMPLATE, id: 7, name: "默认", elements }) as unknown as LabelTemplate;

describe("库位标签适用性（与 C# 共享 fixture）", () => {
  const cases: [string, unknown[], boolean][] = [
    ["case:valid", [qr, text("code")], true],
    ["case:missing-qr", [text("code")], true],                    // 用户明确：不用二维码 → 不再要求
    ["case:qr-without-code-text", [qr, text("name")], false],     // 没有引用编码的文本 → 仍拒
    ["case:no-text", [qr], false],
    ["case:empty", [], false],
  ];
  for (const [id, els, ok] of cases) {
    it(`${id} → ${ok ? "适合" : "不适合"}（与 C# 同名用例对读）`, async () => {
      const { locationLabelSuitability } = await import("@/lib/labelSuitability");
      const r = locationLabelSuitability(withElements(els));
      expect(r.ok).toBe(ok);
      if (!ok) expect(r.reasons.length).toBeGreaterThan(0);
    });
  }

  it("locationCode 文本同样算有效（不是只认 code）", async () => {
    const { locationLabelSuitability } = await import("@/lib/labelSuitability");
    expect(locationLabelSuitability(withElements([text("locationCode")])).ok).toBe(true);
  });
});

describe("导出候选来源与回落", () => {
  const tpl = (over: Partial<LabelTemplate>) => ({ ...DEFAULT_TEMPLATE, ...over }) as LabelTemplate;

  it("适合的模板 → 原样使用、无提示", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const good = tpl({ elements: [text("code")] as never, widthMm: 60, heightMm: 40 });
    const pick = chooseExportTemplate(good);
    expect(pick.template.widthMm).toBe(60);
    expect(pick.notice).toBeNull();
  });

  it("**不适合**（有文本但不引用编码）→ 回落内置 + 提示", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const bad = tpl({ elements: [text("name")] as never });
    const pick = chooseExportTemplate(bad);
    expect(pick.template.id).toBe(DEFAULT_TEMPLATE.id);
    expect(pick.notice).toContain("不适合库位标签");
    expect(pick.template.elements.some(e => e.type === "qr")).toBe(true);
  });

  it("接口不可用（无默认模板）→ 回落 + 提示", async () => {
    const { chooseExportTemplate } = await import("@/lib/labelSuitability");
    const pick = chooseExportTemplate(null);
    expect(pick.template.id).toBe(DEFAULT_TEMPLATE.id);
    expect(pick.notice).toContain("模板接口不可用");
  });

  it("候选来源：有 kind=location 的默认模板 → 优先用它；没有 → null", async () => {
    const { pickLocationTemplate } = await import("@/lib/labelSuitability");
    const loc = tpl({ id: 9, name: "库位", kind: "location", isDefault: true });
    const mat = tpl({ id: 8, name: "物料", kind: "material", isDefault: true });
    expect(pickLocationTemplate([mat, loc])?.id).toBe(9);
    expect(pickLocationTemplate([mat])).toBeNull();
    expect(pickLocationTemplate([])).toBeNull();
  });
});
