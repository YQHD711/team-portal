/**
 * 物料标签 PDF 导出（**模板驱动**）：标签尺寸/DPI/背景/每个元素都由 `LabelTemplate` 决定，
 * 不传模板则用内置默认模板（= 改造前那份写死的 80×50 版式）。
 *
 * 为什么整张标签栅格化成一张图，而不是用 jsPDF 画矢量文字：
 * jsPDF 内置的 14 个标准字体只覆盖 Latin-1，物料名称/分类是中文，矢量文字会印成空白或乱码；
 * 嵌入 CJK 字体又要额外塞几 MB 字体进仓库。所以用 canvas 按系统字体绘制（中文正常），
 * 再以模板 DPI 满版嵌进 PDF。二维码取「模块矩阵」后逐个画方块（react-qr-code 用的同一个
 * qrcode-generator），是纯计算、不依赖 DOM，能在单测里用 jsQR 解码验证可扫。
 *
 * 设计器预览与导出**共用**这里的 drawLabel/renderLabelPng —— 没有第二套渲染。
 */

import { DEFAULT_TEMPLATE, resolveElementText, type LabelData, type LabelElement, type LabelTemplate } from "./labelTemplate";

export type { LabelData, LabelElement, LabelTemplate };

/** 默认模板的物理尺寸：对齐用户精臣软件里的 T80*50-560白 标签 */
export const LABEL_WIDTH_MM = DEFAULT_TEMPLATE.widthMm;
export const LABEL_HEIGHT_MM = DEFAULT_TEMPLATE.heightMm;

/** 栅格化 DPI：热敏标签机多为 203~300 DPI，源图 600 DPI 让二维码单模块留足余量 */
export const LABEL_DPI = DEFAULT_TEMPLATE.dpi;

/** 默认模板的二维码方框与静区（导出的兼容常量，测试与调用方仍按 80×50 版式取用） */
export const QR_BOX_MM = 30;
export const QR_QUIET_MM = 3;

/** 默认模板里二维码的位置（mm）：导出便于测试裁剪验证 */
const defaultQr = DEFAULT_TEMPLATE.elements.find(e => e.type === "qr")!;
export const QR_RECT_MM = { x: defaultQr.x, y: defaultQr.y, size: defaultQr.w } as const;

const PX_PER_MM_DEFAULT = LABEL_DPI / 25.4;
export const PX_PER_MM = PX_PER_MM_DEFAULT;

const FONT_SANS = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
const FONT_MONO = '"Consolas","DejaVu Sans Mono","Courier New",monospace';

export interface QrMatrix {
  count: number;
  isDark(row: number, col: number): boolean;
}

/** qrcode-generator 的工厂签名（0 = 自动版本，与 react-qr-code 的用法一致） */
export interface QrFactory {
  (typeNumber: 0, level: "M"): {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  };
}

/** 某个模板下的像素尺寸（px = mm × dpi/25.4） */
export function labelPixelSize(template: LabelTemplate = DEFAULT_TEMPLATE): { width: number; height: number } {
  const perMm = template.dpi / 25.4;
  return { width: Math.round(template.widthMm * perMm), height: Math.round(template.heightMm * perMm) };
}

/** 短链 → 模块矩阵（纯计算，不碰 DOM） */
export function createQrMatrix(url: string, makeQr: QrFactory): QrMatrix {
  const qr = makeQr(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  return { count, isDark: (row, col) => qr.isDark(row, col) };
}

/** pt → px：canvas 是 `dpi` 分辨率，1pt = dpi/72 px = perMm × 25.4/72 */
const ptToPx = (ptValue: number, perMm: number) => (ptValue * perMm * 25.4) / 72;

/** 文本元素水平锚点（对齐方式决定） */
export function textX(el: LabelElement, perMm: number): number {
  const align = el.align ?? "center";
  if (align === "left") return el.x * perMm;
  if (align === "right") return (el.x + el.w) * perMm;
  return (el.x + el.w / 2) * perMm;
}

/** 文本元素基线：盒子 (y, h) 内**垂直居中**（基线 ≈ 中心 + 0.35×字高） */
export function textBaseline(el: LabelElement, fontPx: number, perMm: number): number {
  return (el.y + el.h / 2) * perMm + fontPx * 0.35;
}

/** 文字按元素宽度自动缩号，避免长名称/长编码溢出；autoShrink=false 时不缩 */
function pickFont(ctx: CanvasRenderingContext2D, el: LabelElement, text: string, perMm: number, family: string): number {
  const startPt = el.fontSizePt ?? 10;
  if (el.autoShrink === false) return startPt;
  const maxWidthPx = el.w * perMm;
  const minPt = Math.max(3, startPt * 0.4);
  let size = startPt;
  for (;;) {
    ctx.font = `${el.fontWeight ?? 400} ${ptToPx(size, perMm)}px ${family}`;
    if (size <= minPt || ctx.measureText(text).width <= maxWidthPx) return size;
    size -= 0.5;
  }
}

function drawQr(ctx: CanvasRenderingContext2D, matrix: QrMatrix, el: LabelElement, perMm: number): void {
  const side = Math.min(el.w, el.h);
  const quiet = Math.min(el.quietMm ?? 3, side / 4);
  const x0 = el.x * perMm;
  const y0 = el.y * perMm;
  const inset = quiet * perMm;
  const cell = ((side - 2 * quiet) * perMm) / matrix.count;
  // 静区必须是纯白：底衬/背景色会干扰识读
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x0, y0, el.w * perMm, el.h * perMm);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < matrix.count; row++) {
    for (let col = 0; col < matrix.count; col++) {
      if (matrix.isDark(row, col)) ctx.fillRect(x0 + inset + col * cell, y0 + inset + row * cell, cell, cell);
    }
  }
}

/** 画一个文本元素（纯函数：给定 ctx/元素/数据，输出确定） */
export function drawTextElement(ctx: CanvasRenderingContext2D, el: LabelElement, data: LabelData, perMm: number): void {
  const text = resolveElementText(el, data);
  if (!text) return;
  const family = el.fontFamily === "mono" ? FONT_MONO : FONT_SANS;
  const pt = pickFont(ctx, el, text, perMm, family);
  const fontPx = ptToPx(pt, perMm);
  ctx.font = `${el.fontWeight ?? 400} ${fontPx}px ${family}`;
  ctx.textAlign = el.align ?? "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = el.color ?? "#111111";
  ctx.fillText(text, textX(el, perMm), textBaseline(el, fontPx, perMm));
}

/** 把整张标签画到 2D 上下文（纯函数：给定 ctx + 数据 + 矩阵 + 模板，输出确定） */
export function drawLabel(
  ctx: CanvasRenderingContext2D, data: LabelData, matrix: QrMatrix, template: LabelTemplate = DEFAULT_TEMPLATE,
): void {
  const perMm = template.dpi / 25.4;
  const { width, height } = labelPixelSize(template);
  ctx.fillStyle = template.background || "#ffffff";
  ctx.fillRect(0, 0, width, height);

  for (const el of template.elements) {
    if (el.type === "qr") drawQr(ctx, matrix, el, perMm);
    else drawTextElement(ctx, el, data, perMm);
  }
}

/** 渲染成 PNG data URL（整张标签，模板 DPI） */
export function renderLabelPng(data: LabelData, matrix: QrMatrix, template: LabelTemplate = DEFAULT_TEMPLATE): string {
  const { width, height } = labelPixelSize(template);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法导出标签 PDF");
  drawLabel(ctx, data, matrix, template);
  return canvas.toDataURL("image/png");
}

/**
 * 导出标签 PDF 并触发下载（文件名 `{code}.pdf`）。
 * jsPDF 与 qrcode-generator 都在这里动态 import：只有用户点「导出 PDF」时才下载这两个包。
 * 不传 template 用内置默认模板（与改造前版式一致）。
 */
export async function exportLabelPdf(data: LabelData, template: LabelTemplate = DEFAULT_TEMPLATE): Promise<void> {
  const [pdfMod, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const png = renderLabelPng(data, createQrMatrix(data.url, qrMod.default), template);
  const doc = new pdfMod.jsPDF({
    unit: "mm",
    format: [template.widthMm, template.heightMm],
    orientation: template.widthMm >= template.heightMm ? "landscape" : "portrait",
    compress: true,
  });
  // 满版铺满，无页边距
  doc.addImage(png, "PNG", 0, 0, template.widthMm, template.heightMm);
  doc.save(`${data.code}.pdf`);
}
