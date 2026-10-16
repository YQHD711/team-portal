/**
 * 库位标签的**矢量渲染路径**（task-40 性能结构优化）。
 *
 * 为什么单开一条路径、不与 `lib/labelPdf` 共用：
 *  - 既有 `labelPdf` 是"整枚标签画到 canvas → 导出 PNG → 满版贴进 PDF"，**每张都要
 *    光栅化整张 80×50mm（~639×400px）+ PNG 编码**，实测 ≈48ms/张（304 张 14.6s、1000 张约 48s）。
 *  - 库位标签的**唯一变量是二维码**：文字完全可以走 PDF 矢量（清晰、体积极小、无需光栅化），
 *    只有二维码需要光栅化——而且只是那一小块（30mm@203dpi ≈ 240×240px，像素量约为整张的 1/4）。
 *  - 因此这里**新开一条路径**：`text` 用 `doc.text()` 矢量绘制，`qr` 只光栅二维码小图。
 *    好处：**完全不动 `labelPdf`**（物料标签零回归风险），代价是两处"字段取值"逻辑需保持一致——
 *    所以字段解析只写在这里的 `fieldValue()`，并与契约 `LabelField` 一一对应。
 *
 * 页面尺寸仍然**显式 = 模板尺寸**（绝不 A4），这是送标签机的前提。
 */

import type { LabelData, LabelElement, LabelTemplate } from "./labelTemplate";
import type { LocationSlot } from "./locationLabelPdf";
import { DEFAULT_TEMPLATE, toLocationLabelData } from "./locationLabelPdf";
import { locationLabelSuitability } from "./labelSuitability";

export interface VectorBuildOptions {
  /** 每多少张让出一次主线程（默认 2；响应性优先） */
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
  /** 光栅化二维码用的 DPI（默认取模板 dpi，保证扫码模块清晰） */
  dpi?: number;
}

/** 字段 → 文本（与 `lib/labelTemplate.ts` 的 LabelField 一一对应；`text` 字面量优先） */
export function fieldValue(el: LabelElement, data: LabelData): string {
  if (!el.field) return el.text ?? "";
  switch (el.field) {
    case "code": return data.code;
    case "locationCode": return data.locationCode ?? "";
    case "name": return data.name;
    case "grade": return data.grade ?? "";
    case "category": return data.category ?? "";
    case "url": return data.url;
    case "meta": return [data.grade, data.locationCode, data.category].filter(Boolean).join(" · ");
    default: return el.text ?? "";
  }
}

/** 把二维码模块画成一张小 PNG（data URL）：只光栅这一小块，不画整张标签 */
export function qrPng(moduleCount: (r: number, c: number) => boolean, count: number, pxTotal: number, quiet: number): string {
  const canvas = document.createElement("canvas");
  const scale = Math.max(1, Math.floor(pxTotal / (count + quiet * 2)));
  const size = (count + quiet * 2) * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法生成二维码图");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (moduleCount(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
  return canvas.toDataURL("image/png");
}

/**
 * **批量多页 PDF（矢量文字 + 仅二维码光栅）**。
 * 页面尺寸显式 = 模板尺寸；每 `chunkSize` 张让出一次主线程。
 */
export async function buildLocationLabelsVectorPdf(
  slots: readonly LocationSlot[],
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: VectorBuildOptions = {},
): Promise<ArrayBuffer> {
  const fit = locationLabelSuitability(template);
  if (!fit.ok) throw new Error(`模板不适合库位标签：${fit.reasons.join("；")}`);
  const [pdfMod, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const w = template.widthMm, h = template.heightMm;
  const doc = new pdfMod.jsPDF({ unit: "mm", format: [w, h], orientation: w >= h ? "landscape" : "portrait", compress: true });
  const dpi = opts.dpi ?? template.dpi;
  const px = (mm: number) => Math.round((mm * dpi) / 25.4);

  for (let i = 0; i < slots.length; i++) {
    const data = toLocationLabelData(slots[i]);
    if (i > 0) doc.addPage([w, h]);                 // **每页**显式尺寸，不靠默认
    for (const el of template.elements) {
      if (el.type === "qr") {
        const m = (qrMod.default as unknown as (t: number, l: string) => {
          addData(d: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean;
        })(0, "M");
        m.addData(data.url);
        m.make();
        const png = qrPng((r, c) => m.isDark(r, c), m.getModuleCount(), px(el.w), 3);
        doc.addImage(png, "PNG", el.x, el.y, el.w, el.h);
      } else {
        const fontPt = el.fontSizePt ?? 7;
        doc.setFontSize(fontPt);
        const text = fieldValue(el, data);
        const y = el.y + Math.min(el.h, (fontPt * 25.4) / 72);         // 基线：贴着元素盒底
        if (el.align === "center") doc.text(text, el.x + el.w / 2, y, { align: "center", maxWidth: el.w });
        else if (el.align === "right") doc.text(text, el.x + el.w, y, { align: "right", maxWidth: el.w });
        else doc.text(text, el.x, y, { maxWidth: el.w });
      }
    }
    const done = i + 1;
    if (done % Math.max(1, opts.chunkSize ?? 2) === 0 || done === slots.length) {
      opts.onProgress?.(done, slots.length);
      if (done < slots.length) await new Promise(r => setTimeout(r, 0));
    }
  }
  return doc.output("arraybuffer") as unknown as ArrayBuffer;
}
