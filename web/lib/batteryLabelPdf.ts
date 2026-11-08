/**
 * 电池标签 PDF：每块电池一张，二维码内容 = `{origin}/b/{code}`（扫码直接进借还页）。
 *
 * 复用既有渲染链路（lib/labelPdf 的 renderLabelPng/createQrMatrix）与
 * 批量 PDF 的分块/让出主线程策略（lib/locationLabelPdf 的 buildLocationLabelsPdf 同款），
 * **不另造一套 PDF 生成**；只是把 LabelData 的 url 换成 /b/ 短链。
 */

import type { LabelData, LabelTemplate } from "./labelTemplate";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { createQrMatrix, renderLabelPng } from "./labelPdf";
import type { BuildProgressOptions } from "./locationLabelPdf";

export interface BatteryLabelSource {
  code: string;
  model?: string | null;
}

/** 电池 → LabelData：编码/名称/二维码短链，其余字段留空。 */
export function toBatteryLabelData(b: BatteryLabelSource, origin: string): LabelData {
  const base = origin.replace(/\/+$/, "");
  return {
    code: b.code,
    url: `${base}/b/${encodeURIComponent(b.code)}`,
    name: b.model || "电池",
    grade: null,
    locationCode: null,
    category: null,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** 批量生成多页 PDF：页面尺寸 = 模板尺寸（与库位标签同一约束，不能退回 A4）。 */
export async function buildBatteryLabelsPdf(
  batteries: readonly BatteryLabelSource[],
  origin: string,
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: BuildProgressOptions = {},
): Promise<ArrayBuffer> {
  const [pdfMod, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const w = template.widthMm, h = template.heightMm;
  const doc = new pdfMod.jsPDF({
    unit: "mm", format: [w, h],
    orientation: w >= h ? "landscape" : "portrait", compress: true,
  });

  const chunkSize = Math.max(1, opts.chunkSize ?? 2);
  const total = batteries.length;
  for (let i = 0; i < total; i++) {
    const data = toBatteryLabelData(batteries[i], origin);
    const png = renderLabelPng(data, createQrMatrix(data.url, qrMod.default), template);
    if (i > 0) doc.addPage([w, h]);
    doc.addImage(png, "PNG", 0, 0, w, h);
    const done = i + 1;
    if (done % chunkSize === 0 || done === total) {
      opts.onProgress?.(done, total);
      if (done < total) await yieldToBrowser();
    }
  }
  return doc.output("arraybuffer") as unknown as ArrayBuffer;
}

/** 电池标签文件名：`电池标签-YYYY-MM-DD.pdf` */
export function batteryLabelFileName(when: Date = new Date()): string {
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `电池标签-${d}.pdf`;
}

/** 从模板列表里挑物料模板（电池标签带二维码，语义上属于物料标签）。 */
export function pickMaterialTemplate(list: readonly LabelTemplate[]): LabelTemplate | null {
  const isMaterial = (t: LabelTemplate) => (t.kind ?? "material") === "material";
  return list.find(t => isMaterial(t) && t.isDefault) ?? list.find(isMaterial) ?? null;
}
