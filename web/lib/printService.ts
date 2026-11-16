/**
 * 打印统一服务：所有标签（物料/库位/电池/身份码）的 PDF 导出与直连打印数据统一从这里进出。
 *
 * 收口前：batteryLabelPdf / identityLabelPdf / locationLabelPdf 各自复制了一份 jsPDF 构建循环，
 * 文件名/下载/模板选择各写一份。收口后领域模块只做 toXxxLabelData 转换，构建与导出走本模块。
 * 渲染复用 lib/labelPdf 的 renderLabelPng/createQrMatrix（模板驱动、中文 canvas 渲染）。
 */

import type { LabelData, LabelTemplate } from "./labelTemplate";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { createQrMatrix, renderLabelPng } from "./labelPdf";
import { downloadPdf, type BuildProgressOptions } from "./locationLabelPdf";

export type { BuildProgressOptions };

/** 标签用途：决定文件名。 */
export type LabelKind = "material" | "location" | "battery" | "identity";

const KIND_FILE_PREFIX: Record<LabelKind, string> = {
  material: "物料标签",
  location: "库位标签",
  battery: "电池标签",
  identity: "身份码",
};

/** 统一文件名：用途-YYYY-MM-DD.pdf */
export function labelFileName(kind: LabelKind, when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const d = String(when.getDate()).padStart(2, "0");
  return KIND_FILE_PREFIX[kind] + "-" + y + "-" + m + "-" + d + ".pdf";
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
/**
 * 唯一的 PDF 构建循环：每页一张标签，页面尺寸 = 模板尺寸（不是 A4，可直接送标签机）。
 * 分块让出主线程，避免几百张时页面没有响应。
 */
export async function buildLabelsPdf(
  dataList: readonly LabelData[],
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
  const total = dataList.length;
  for (let i = 0; i < total; i++) {
    const data = dataList[i];
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

export interface ExportResult {
  filename: string;
  count: number;
}

/** 一站式导出：构建 PDF 并触发浏览器下载。调用方只需给 LabelData[]。 */
export async function exportLabelsPdf(
  kind: LabelKind,
  dataList: readonly LabelData[],
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: BuildProgressOptions & { filename?: string } = {},
): Promise<ExportResult> {
  const bytes = await buildLabelsPdf(dataList, template, opts);
  const filename = opts.filename ?? labelFileName(kind);
  downloadPdf(bytes, filename);
  return { filename, count: dataList.length };
}

/**
 * 直连打印（精臣 K3W）入口数据：与 PDF 导出共用同一份 LabelData + 模板。
 * NiimbotPrintPanel 消费这份数据（连接/预览/打印在 lib/niimbot）。
 */
export function directPrintJob(template: LabelTemplate, dataList: readonly LabelData[]) {
  return { template, dataList: dataList.map(d => ({ ...d })) };
}

/**
 * 从模板列表挑物料模板（物料/电池/身份码标签都带二维码，语义属物料标签）。
 * 各领域模块的 pickMaterialTemplate 统一从这里 re-export。
 */
export function pickMaterialTemplate(list: readonly LabelTemplate[]): LabelTemplate | null {
  const isMaterial = (t: LabelTemplate) => (t.kind ?? "material") === "material";
  return list.find(t => isMaterial(t) && t.isDefault) ?? list.find(isMaterial) ?? null;
}
