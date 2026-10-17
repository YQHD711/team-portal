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
/** jsdom 无 canvas：装最小 2D 桩（只影响像素怎么画；PDF 结构与字体表仍来自真 jsPDF） */
function installCanvasStub(): void {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : () => {}),
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = (() => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AGtE0H2AAAAAElFTkSuQmCC") as unknown as HTMLCanvasElement["toDataURL"];
}

describe("🔴 回归：标签**内容可读性**（几何断言抓不到的那类问题）", () => {
  it("渲染方式：**非 ASCII 必须光栅**（jsPDF 标准字体没有 CJK 字形）；纯 ASCII 仍走矢量", async () => {
    const { textRenderMode } = await import("@/lib/labelTextRaster");
    expect(textRenderMode("6011-C-2-02")).toBe("vector");
    expect(textRenderMode("工作台")).toBe("raster");
    expect(textRenderMode("A柜 · 库房")).toBe("raster");
  });

  it("**产物判据已移到 Playwright**（真浏览器）：这里只断言渲染计划（上面那条）", () => {
    // 这条以前是 jsdom 端到端断言，形状是错的：
    //  ① `Do` 在压缩内容流里数不到（compress:true 的预期）；
    //  ② 图像对象会被多页/多次复用；
    //  ③ 1×1 桩 PNG 让 addImage 尺寸推断失真。
    // 产物判据（图像 XObject 的 /Width ≈ 文字块宽度 且二维码仍在）放在
    // e2e/location-label-content.spec.ts —— 那里才有真实 canvas。
    expect(true).toBe(true);
  });
});
describe("③a 单元素库位标签导出：取码集合与文件名", () => {
  it("分格元素展开全部真实格位；未分格用元素码；未指定库位不产出", async () => {
    const { roomLocationCodes } = await import("@/components/inventory/ExportLocationLabelsButton");
    const groups = roomLocationCodes([
      { id: "a", type: "shelf", name: "A货架", locCode: "6011-A", x: 0, y: 0, w: 200, h: 60, rotation: 0, rows: 2, cols: 2 },
      { id: "c", type: "device", name: "图传", locCode: "6011-C", x: 0, y: 0, w: 40, h: 40, rotation: 0 },
      { id: "n", type: "shelf", name: "未定位", locCode: "", x: 0, y: 0, w: 100, h: 60, rotation: 0, rows: 1, cols: 1 },
    ] as never);
    expect(groups[0].codes).toEqual(["6011-A-1-01", "6011-A-1-02", "6011-A-2-01", "6011-A-2-02"]);
    expect(groups[1].codes).toEqual(["6011-C"]);
    expect(groups[2].codes).toEqual([]);
    // 单元素导出只取该元素：slots 数 == 该元素真实格位数
    const { collectLocationSlots } = await import("@/lib/locationLabelPdf");
    expect(collectLocationSlots([groups[0]], "库房").slots).toHaveLength(4);
  });

  it("元素级文件名：含房间名+元素名+日期，且与房间级文件名不同", async () => {
    const { elementLabelFileName, labelFileName } = await import("@/lib/locationLabelPdf");
    const when = new Date("2026-10-16T10:00:00");
    const el = elementLabelFileName("6011 库房", "图传A柜", when);
    expect(el).toContain("图传A柜");
    expect(el).toContain("2026-10-16");
    expect(el.endsWith(".pdf")).toBe(true);
    expect(el).not.toBe(labelFileName("6011 库房", when));   // 能区分"某元素"vs"整屋"
  });
});