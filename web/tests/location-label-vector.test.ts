/**
 * 自适应二维码光栅（task-40 实验 5）：短编码省成本、长编码不失效。
 * 规则是**自证**的（每模块 ≥K 像素的最小 dpi，以模板 dpi 封顶），不是拍一个魔法 dpi。
 */

import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import { QR_MIN_PX_PER_MODULE, qrModuleScale, qrRasterPx } from "@/lib/locationLabelVector";

/** 用真实 qrcode-generator 算模块数（与线上路径同一实现） */
function moduleCount(text: string): number {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.getModuleCount();
}
const BOX_MM = 30;
const MAX_DPI = 600;                                   // 线上默认模板实测 dpi=600
const PX_AT_MAX_DPI = Math.ceil((BOX_MM * MAX_DPI) / 25.4);   // ≈709px

describe("自适应二维码 dpi（规则自证，不是魔法数）", () => {
  it("短编码 6011-C-2-02：用远低于 600 的 dpi，且仍 ≥6px/模块", () => {
    const n = moduleCount("6011-C-2-02");
    const px = qrRasterPx(BOX_MM, n, MAX_DPI);
    expect(qrModuleScale(px, n)).toBeGreaterThanOrEqual(QR_MIN_PX_PER_MODULE);
    expect(px).toBeLessThan(PX_AT_MAX_DPI);
    expect(px).toBeLessThanOrEqual(400);
  });

  it("**最坏情况**：超长编码 → 仍满足 ≥6px/模块（不会静默失效）", () => {
    for (const text of ["6011-C-2-02-" + "A".repeat(120), "https://example.com/loc/" + "X".repeat(200)]) {
      const n = moduleCount(text);
      const px = qrRasterPx(BOX_MM, n, MAX_DPI);
      expect(qrModuleScale(px, n)).toBeGreaterThanOrEqual(QR_MIN_PX_PER_MODULE);
    }
  });

  it("以模板 dpi **封顶**：极端长编码下也不突破封顶（封顶优先于 ≥K）", () => {
    const n = moduleCount("X".repeat(2000));
    const px = qrRasterPx(BOX_MM, n, MAX_DPI);
    expect(px).toBeLessThanOrEqual(PX_AT_MAX_DPI + 1);
    // 这种情况物理上给不了 6px/模块：应在上层校验提示"编码过长/模板 dpi 过低"，而不是偷偷突破封顶
    expect(qrModuleScale(px, n)).toBeLessThan(QR_MIN_PX_PER_MODULE);
  });

  it("dpi 越低越省：短编码的像素数显著小于 600dpi（这是成本下降的来源）", () => {
    const n = moduleCount("6011-C-2-02");
    const px = qrRasterPx(BOX_MM, n, MAX_DPI);
    expect(px * px).toBeLessThan(PX_AT_MAX_DPI * PX_AT_MAX_DPI / 4);   // 面积降至 1/4 以下
  });
});
describe("导出边界的物理无解提示（不静默产出扫不出的标签）", () => {
  const tplWith = (dpi: number) => ({ id: 1, name: "t", isDefault: true, widthMm: 80, heightMm: 50, dpi, background: "#FFF", elements: [{ id: "q", type: "qr" as const, x: 2, y: 2, w: 30, h: 30 }] });
  const slot = (code: string) => ({ code, elementName: "E", roomName: "R" });

  it("低 dpi + 超长编码 → 命中；并给出用户可见告警文案", async () => {
    const { findUnscannableCodes, unscannableWarning } = await import("@/lib/locationLabelVector");
    const bad = await findUnscannableCodes([slot("X".repeat(2000))], tplWith(203) as never);
    expect(bad).toHaveLength(1);
    const msg = unscannableWarning(bad, tplWith(203) as never);
    expect(msg).toContain("可能扫不出");
    expect(msg).toContain("提高模板 dpi 或缩短编码");
    expect(msg).toContain("仍要继续导出吗");
  });

  it("600dpi + 普通编码（6011-C-2-02）→ 全部可扫（不该打扰用户）", async () => {
    const { findUnscannableCodes } = await import("@/lib/locationLabelVector");
    const bad = await findUnscannableCodes([slot("6011-C-2-02"), slot("R001-2-02")], tplWith(600) as never);
    expect(bad).toEqual([]);
  });

  it("没有二维码元素 → 全部列入（另一条适用性校验也会拦）", async () => {
    const { findUnscannableCodes } = await import("@/lib/locationLabelVector");
    const tpl = { ...tplWith(600), elements: [{ id: "t", type: "text" as const, x: 1, y: 1, w: 10, h: 5, field: "code" as const }] };
    expect(await findUnscannableCodes([slot("6011-A")], tpl as never)).toEqual(["6011-A"]);
  });
});