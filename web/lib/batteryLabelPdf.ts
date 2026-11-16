/**
 * 电池标签 PDF：每块电池一张，二维码内容 = `{origin}/b/{code}`（扫码直接进借还页）。
 *
 * 复用既有渲染链路（lib/labelPdf 的 renderLabelPng/createQrMatrix）与
 * 批量 PDF 的分块/让出主线程策略（lib/locationLabelPdf 的 buildLocationLabelsPdf 同款），
 * **不另造一套 PDF 生成**；只是把 LabelData 的 url 换成 /b/ 短链。
 */

import type { LabelData, LabelTemplate } from "./labelTemplate";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { buildLabelsPdf, type BuildProgressOptions } from "./printService";

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

/** 批量生成多页 PDF：构建循环统一在 printService（收口），这里只做领域转换。 */
export async function buildBatteryLabelsPdf(
  batteries: readonly BatteryLabelSource[],
  origin: string,
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: BuildProgressOptions = {},
): Promise<ArrayBuffer> {
  return buildLabelsPdf(batteries.map(b => toBatteryLabelData(b, origin)), template, opts);
}

/** 电池标签文件名：`电池标签-YYYY-MM-DD.pdf` */
export function batteryLabelFileName(when: Date = new Date()): string {
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `电池标签-${d}.pdf`;
}

export { pickMaterialTemplate } from "./printService";
