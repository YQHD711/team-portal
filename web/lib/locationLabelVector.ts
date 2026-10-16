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

/**
 * ⚠️ **每模块最少像素**：扫码枪/手机的可靠阈值远低于此（二维码在每模块 3–4px 仍很稳），
 * 取 6 留足余量。它是"该用多少 dpi"的**唯一依据**，而不是拍一个 dpi 数字。
 */
export const QR_MIN_PX_PER_MODULE = 6;
/** 静区宽度（模块数）：标准要求 4，这里与既有渲染保持一致 */
export const QR_QUIET_MODULES = 3;

/**
 * **自适应光栅尺寸**：取"能让每个模块 ≥ QR_MIN_PX_PER_MODULE 像素的最小像素数"，
 * 并以模板 dpi 对应的像素数封顶。
 *  - 短编码（模块少）→ 自动用很低 dpi（省掉大量光栅与 PNG 编码）
 *  - 长编码（模块多）→ 自动提高 dpi，保证每模块仍 ≥K，不会静默扫不出
 * 返回该二维码应光栅成的**正方形总像素**（含静区）。
 */
export function qrRasterPx(boxMm: number, moduleCount: number, maxDpi: number): number {
  const needPx = (moduleCount + QR_QUIET_MODULES * 2) * QR_MIN_PX_PER_MODULE;
  const dpiForNeed = (needPx / boxMm) * 25.4;
  const dpi = Math.min(maxDpi, Math.max(1, Math.ceil(dpiForNeed)));
  const capPx = Math.round((boxMm * maxDpi) / 25.4);
  // 规则优先级：**先满足 ≥K/模块，但模板 dpi 是硬上限**。
  // 若编码长到"即使模板 dpi 也给不了 K/模块"，只能取封顶值（物理上无解）——
  // 这种情况应在上层校验里提示"编码过长/模板 dpi 过低"，而不是在这里偷偷突破封顶。
  return needPx <= capPx ? Math.max(needPx, Math.round((boxMm * dpi) / 25.4)) : capPx;
}

/** 实际每模块像素（与 qrPng 的 scale 计算一致；供测试断言 ≥K） */
export function qrModuleScale(pxTotal: number, moduleCount: number): number {
  return Math.max(1, Math.floor(pxTotal / (moduleCount + QR_QUIET_MODULES * 2)));
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
        // 自适应：短编码自动降 dpi（省成本），长编码自动升 dpi（保证 ≥K 像素/模块）
        const png = qrPng((r, c) => m.isDark(r, c), m.getModuleCount(), qrRasterPx(el.w, m.getModuleCount(), dpi), QR_QUIET_MODULES);
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
      if (done < slots.length) await nextFrame();   // 双 rAF：setTimeout(0) 在重渲染压力下可能来不及出帧
    }
  }
  return doc.output("arraybuffer") as unknown as ArrayBuffer;
}

/** 让出到"能绘制"：优先双 rAF（给合成器出帧机会），无 rAF 环境退回宏任务 */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return new Promise(r => setTimeout(r, 0));
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
/**
 * **导出边界的物理无解检查**：模板 dpi 封顶后，若某个编码的二维码**每模块 < QR_MIN_PX_PER_MODULE 像素**，
 * 那这个标签**可能就是扫不出的**（编码太长 + 模板 dpi 太低）。
 * 与 `locationLabelSuitability` 同一条原则：**绝不允许静默产出不可用的标签**——UI 必须显式告知并由用户决定。
 * 返回在"当前模板 dpi"下无法达到每模块 K 像素的编码清单（空 = 全部可扫）。
 */
export async function findUnscannableCodes(
  slots: readonly LocationSlot[],
  template: LabelTemplate = DEFAULT_TEMPLATE,
): Promise<string[]> {
  const qrMod = await import("qrcode-generator");
  const boxes = template.elements.filter(e => e.type === "qr");
  if (boxes.length === 0) return slots.map(s => s.code);      // 没有二维码元素：全部不可用（另一条校验也会拦）
  const boxMm = Math.min(...boxes.map(e => e.w));
  const capPx = Math.round((boxMm * template.dpi) / 25.4);
  const bad: string[] = [];
  for (const slot of slots) {
    const q = (qrMod.default as unknown as (t: number, l: string) => { addData(d: string): void; make(): void; getModuleCount(): number })(0, "M");
    q.addData(slot.code); q.make();
    if (qrModuleScale(capPx, q.getModuleCount()) < QR_MIN_PX_PER_MODULE) bad.push(slot.code);
  }
  return bad;
}

/** 用户可见的告警文案（导出前弹确认，允许用户决定） */
export function unscannableWarning(codes: readonly string[], template: LabelTemplate, sample = 3): string {
  const list = codes.slice(0, sample).join("、") + (codes.length > sample ? ` 等 ${codes.length} 个` : "");
  return `${codes.length} 个库位编码过长，当前模板（${template.dpi} dpi）下二维码可能扫不出：${list}。\n\n建议提高模板 dpi 或缩短编码。仍要继续导出吗？`;
}