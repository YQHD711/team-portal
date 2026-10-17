/**
 * 标签文字的**光栅化补充路径**（task-40 回归修复，方案 A）。
 *
 * 背景（必须写下来，否则以后又会有人"顺手"把文字全走矢量）：
 * `jsPDF.text()` 只能用 **PDF 标准字体**（Helvetica/Courier/Times…），**不含任何 CJK 字形**，
 * 因此在标签上写中文会得到**乱码**——而且几何断言（页数/MediaBox/图像数）全都过得去，
 * 属于"功能成功、产物不可用"。旧路径用 canvas + 系统字体画中文是对的，但 600dpi 整张光栅太慢。
 *
 * 方案 A：**纯 ASCII 文本继续走矢量**（清晰、零成本）+ **含非 ASCII 的文本块走 canvas 光栅**（中文必然正确，
 * 且文字块远小于整张标签：80×50 里的一块 40×12mm 在 300dpi 下约 472×142px，
 * 而整张 600dpi 是 1890×1181px → 面积约 1/33，性能优势得以保住）。
 *
 * 不用方案 B（嵌入子集化 CJK 字体）的理由：需要引入**字体资产**与子集化逻辑，
 * 而这里只需要"中文别乱码"，canvas 光栅**无新依赖、与旧路径同一渲染机制**、风险最低。
 */

import type { LabelElement } from "./labelTemplate";

/**
 * 非 ASCII 文本块的光栅 dpi。
 * 取 300：9pt 文字在该 dpi 下约 38px 高，肉眼与打印都足够清晰；再高只是浪费像素。
 * （二维码另有 `QR_MIN_PX_PER_MODULE` 规则，与文字无关。）
 */
export const TEXT_RASTER_DPI = 300;

/** 渲染方式判定：**含非 ASCII → 必须光栅**（jsPDF 标准字体没有 CJK 字形） */
export function textRenderMode(text: string): "raster" | "vector" {
  return /[^\u0000-\u007F]/.test(text) ? "raster" : "vector";
}

/**
 * 把一个文本块画成**透明背景** PNG（data URL）：字号/对齐/颜色按元素定义，
 * 供 `doc.addImage()` 贴在同样的 mm 位置上（尺寸与元素盒一致）。
 */
export function textBlockPng(text: string, el: LabelElement, dpi: number = TEXT_RASTER_DPI): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((el.w * dpi) / 25.4));
  canvas.height = Math.max(1, Math.round((el.h * dpi) / 25.4));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法渲染中文标签文字");
  const fontPx = Math.max(6, Math.round(((el.fontSizePt ?? 7) * dpi) / 72));
  const family = el.fontFamily === "mono" ? "monospace" : "sans-serif";
  ctx.font = `${el.fontWeight ?? 400} ${fontPx}px ${family}`;
  ctx.fillStyle = el.color ?? "#000000";
  ctx.textBaseline = "middle";
  ctx.textAlign = el.align ?? "left";
  const x = (el.align === "center" ? el.w / 2 : el.align === "right" ? el.w : 0) * (dpi / 25.4);
  ctx.fillText(text, x, (el.h / 2) * (dpi / 25.4), el.w * (dpi / 25.4));
  return canvas.toDataURL("image/png");   // 透明背景（未填充底色）
}
