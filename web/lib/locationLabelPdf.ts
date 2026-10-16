/**
 * 库位标签：数据适配 + **批量 PDF**（task-40 ①）。
 *
 * 复用既有渲染（`lib/labelPdf` 的 `renderLabelPng`/`createQrMatrix`），**不另造 PDF 生成**：
 * 每页 = 一张标签的 PNG 满版贴进页面。
 *
 * ⚠️ **页面尺寸必须等于模板尺寸（不是 A4）**：这份 PDF 要直接送精臣 T80*50 标签机，
 * 页面若为 A4、标签画在左上角 → 打出来错位/浪费整张纸。这里显式 `format: [w,h]`，
 * 且**每页 `addPage([w,h])`**（不靠默认值）。
 */

import type { LabelData, LabelTemplate } from "./labelTemplate";
import { DEFAULT_TEMPLATE } from "./labelTemplate";
import { createQrMatrix, renderLabelPng } from "./labelPdf";

export { DEFAULT_TEMPLATE };

/** 一个「库位」= 元素 + 格位（层/位），或未分格元素整体 */
export interface LocationSlot {
  /** 四段编码，如 6011-C-2-02 */
  code: string;
  /** 元素名（可选展示） */
  elementName?: string;
  /** 房间名（可选展示） */
  roomName?: string;
}

/**
 * 库位 → `LabelData`（复用既有渲染契约）：
 * - `code` = 库位编码（二维码与"编码"文本都取它 → 扫出来就是库位码）
 * - `name` = 元素名，`locationCode` = 编码，`meta` 组合走房间/元素名
 */
export function toLocationLabelData(slot: LocationSlot): LabelData {
  const where = [slot.roomName, slot.elementName].filter(Boolean).join(" · ");
  return {
    code: slot.code,
    url: slot.code,                       // 二维码内容 = 库位编码（扫出来即该编码）
    name: slot.elementName ?? slot.code,
    grade: null,
    locationCode: slot.code,
    category: where || null,              // 房间/元素名：无对应字段，借 category 承载（不参与库位语义）
  };
}

/** 从"元素 + 其格位码"批量收集；**空编码一律跳过**（不生成空标签） */
export function collectLocationSlots(
  elements: { name: string; locCode?: string; codes: string[] }[],
  roomName: string,
): { slots: LocationSlot[]; skipped: number } {
  const slots: LocationSlot[] = [];
  let skipped = 0;
  for (const el of elements) {
    for (const code of el.codes) {
      if (!code || !code.trim()) { skipped += 1; continue; }        // 未指定库位 → 跳过
      slots.push({ code: code.trim(), elementName: el.name, roomName });
    }
  }
  return { slots, skipped };
}

/** 批量导出前的预览统计（供 confirm 文案：将导出 N 张、跳过 M 个空位） */
export function describeBatch(slots: readonly LocationSlot[], skipped: number): string {
  // 单价来自**结构优化后的实测**：矢量文字 + 仅二维码光栅 ≈11.5ms/张（304 张 3.5s）；取 15ms 保守估算
  const estSec = Math.max(1, Math.ceil((slots.length * 15) / 1000));
  const eta = `预计约 ${estSec} 秒（可离开本页，生成完成会自动下载）。`;
  const warn = slots.length > 200 ? `\n\n⚠️ ${slots.length} 张偏多，请确认（会打成几百页）。` : "";
  return `将导出 ${slots.length} 张库位标签，跳过 ${skipped} 个未指定库位。${eta}${warn}`;
}

/**
 * **批量多页 PDF**：每页一张标签，页面尺寸 = 模板尺寸（显式设置，不靠默认值）。
 * 返回 `ArrayBuffer`，由调用方决定下载（测试可直接解析字节）。
 *
 * ⚠️ **分块 + 让出事件循环**：大房间（几百张）时每张都要 canvas 渲染 + PNG 编码，
 * 一次同步跑完会把主线程占住 → 浏览器弹"页面没有响应"。这里每 `chunkSize` 张 `await` 一次，
 * 并通过 `onProgress` 把「正在生成 x/N」报给 UI。
 */
export interface BuildProgressOptions {
  /** 每生成多少张让出一次主线程（默认 8；越小越不卡、越大越快） */
  chunkSize?: number;
  /** 进度回调：`done` 已完成张数、`total` 总张数（UI 显示「正在生成 12/340」） */
  onProgress?: (done: number, total: number) => void;
}

/** 让出事件循环（等一个宏任务），避免长时间占住主线程 */
function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function buildLocationLabelsPdf(
  slots: readonly LocationSlot[],
  template: LabelTemplate = DEFAULT_TEMPLATE,
  opts: BuildProgressOptions = {},
): Promise<ArrayBuffer> {
  // 与 exportLabelPdf 同样动态 import：只有真的要导出时才下载这两个包
  const [pdfMod, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const w = template.widthMm, h = template.heightMm;
  // ⚠️ 显式页面尺寸（模板驱动）：绝不用 jsPDF 默认（默认是 A4，会毁掉标签机打印）
  const doc = new pdfMod.jsPDF({ unit: "mm", format: [w, h], orientation: w >= h ? "landscape" : "portrait", compress: true });

  // ⚠️ 分块 + 让出事件循环（见函数注释）：避免大房间导出时"页面没有响应"
  const chunkSize = Math.max(1, opts.chunkSize ?? 2);
  const total = slots.length;
  for (let i = 0; i < total; i++) {
    const data = toLocationLabelData(slots[i]);
    const png = renderLabelPng(data, createQrMatrix(data.url, qrMod.default), template);
    if (i > 0) doc.addPage([w, h]);                 // **每页**都显式给定尺寸，不靠默认
    doc.addImage(png, "PNG", 0, 0, w, h);           // 满版，无页边距
    const done = i + 1;
    if (done % chunkSize === 0 || done === total) {
      opts.onProgress?.(done, total);
      if (done < total) await yieldToBrowser();     // 把线程还给浏览器（输入/重绘/进度刷新）
    }
  }

  return doc.output("arraybuffer") as unknown as ArrayBuffer;
}

/** 文件名里的非法字符（Windows 禁止 + 常见麻烦字符）统一替换 */
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "房间";
}

/**
 * 批量导出的文件名：`房间名-库位标签-YYYY-MM-DD.pdf`。
 * 可辨识性（用户一次导多个房间时分得清）：**含房间名 + 日期**，且不同房间不同名。
 */
export function labelFileName(roomName: string, when: Date = new Date()): string {
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `${safeName(roomName)}-库位标签-${d}.pdf`;
}

/** 触发浏览器下载（UI 用；测试只断言文件名，不碰 DOM） */
export function downloadPdf(bytes: ArrayBuffer, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 进度回调打包成 UI 文案（供按钮复用，避免两处写同一条格式） */
export function progressText(done: number, total: number): string {
  return `正在生成 ${done}/${total}…`;
}
