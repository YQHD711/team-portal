/**
 * 物料标签 PDF 导出：单页 80×50mm，内容与 ItemLabelModal 一致（二维码 + 编码 + 名称 + 等级/库位/分类 + 短链）。
 *
 * 为什么整张标签栅格化成一张图，而不是用 jsPDF 画矢量文字：
 * jsPDF 内置的 14 个标准字体只覆盖 Latin-1，物料名称/分类是中文，矢量文字会印成空白或乱码；
 * 嵌入 CJK 字体又要额外塞几 MB 字体进仓库。所以用 canvas 按系统字体绘制（中文正常），
 * 再以 600 DPI 满版嵌进 PDF。二维码取「模块矩阵」后逐个画方块（react-qr-code 用的同一个
 * qrcode-generator），是纯计算、不依赖 DOM，能在单测里用 jsQR 解码验证可扫。
 */

/** 标签物理尺寸：对齐用户精臣软件里的 T80*50-560白 标签 */
export const LABEL_WIDTH_MM = 80;
export const LABEL_HEIGHT_MM = 50;

/** 栅格化 DPI：热敏标签机多为 203~300 DPI，源图 600 DPI 让二维码单模块留足余量 */
export const LABEL_DPI = 600;
export const PX_PER_MM = LABEL_DPI / 25.4;

/** 二维码方框边长（含静区）与静区宽度（mm） */
export const QR_BOX_MM = 30;
export const QR_QUIET_MM = 3;

const PAGE_MARGIN_MM = 3;
/** 二维码方框左上角（垂直居中） */
const QR_X_MM = PAGE_MARGIN_MM;
const QR_Y_MM = (LABEL_HEIGHT_MM - QR_BOX_MM) / 2;
/** 右侧文字栏 */
const TEXT_X_MM = QR_X_MM + QR_BOX_MM + 3;
const TEXT_RIGHT_MM = LABEL_WIDTH_MM - PAGE_MARGIN_MM;
const TEXT_CENTER_MM = (TEXT_X_MM + TEXT_RIGHT_MM) / 2;
const TEXT_WIDTH_MM = TEXT_RIGHT_MM - TEXT_X_MM;

/** 二维码在标签页上的位置（mm）：导出便于测试裁剪验证 */
export const QR_RECT_MM = { x: QR_X_MM, y: QR_Y_MM, size: QR_BOX_MM } as const;

const FONT_SANS = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
const FONT_MONO = '"Consolas","DejaVu Sans Mono","Courier New",monospace';

export interface LabelData {
  code: string;
  url: string;
  name: string;
  grade?: string | null;
  locationCode?: string | null;
  category?: string | null;
}

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

const mm = (v: number) => v * PX_PER_MM;
const pt = (v: number) => (v * LABEL_DPI) / 72;

export function labelPixelSize(): { width: number; height: number } {
  return { width: Math.round(mm(LABEL_WIDTH_MM)), height: Math.round(mm(LABEL_HEIGHT_MM)) };
}

/** 短链 → 模块矩阵（纯计算，不碰 DOM） */
export function createQrMatrix(url: string, makeQr: QrFactory): QrMatrix {
  const qr = makeQr(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  return { count, isDark: (row, col) => qr.isDark(row, col) };
}

/** 文字按栏宽自动缩号，避免长名称/长编码溢出标签 */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, startPt: number, minPt: number, family: string): void {
  let size = startPt;
  for (;;) {
    ctx.font = `${weight} ${pt(size)}px ${family}`;
    if (size <= minPt || ctx.measureText(text).width <= mm(TEXT_WIDTH_MM)) return;
    size -= 0.5;
  }
}

function drawQr(ctx: CanvasRenderingContext2D, matrix: QrMatrix): void {
  const x0 = mm(QR_X_MM);
  const y0 = mm(QR_Y_MM);
  const inset = mm(QR_QUIET_MM);
  const cell = mm(QR_BOX_MM - 2 * QR_QUIET_MM) / matrix.count;
  // 静区必须是纯白：底衬/背景色会干扰识读
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x0, y0, mm(QR_BOX_MM), mm(QR_BOX_MM));
  ctx.fillStyle = "#000000";
  for (let row = 0; row < matrix.count; row++) {
    for (let col = 0; col < matrix.count; col++) {
      if (matrix.isDark(row, col)) ctx.fillRect(x0 + inset + col * cell, y0 + inset + row * cell, cell, cell);
    }
  }
}

/** 把整张标签画到 2D 上下文（纯函数：给定 ctx + 数据 + 矩阵，输出确定） */
export function drawLabel(ctx: CanvasRenderingContext2D, data: LabelData, matrix: QrMatrix): void {
  const { width, height } = labelPixelSize();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawQr(ctx, matrix);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#111111";
  fitFont(ctx, data.code, 700, 12, 7, FONT_MONO);
  ctx.fillText(data.code, mm(TEXT_CENTER_MM), mm(17.5));
  ctx.fillStyle = "#111111";
  fitFont(ctx, data.name, 600, 10, 6, FONT_SANS);
  ctx.fillText(data.name, mm(TEXT_CENTER_MM), mm(25.5));
  ctx.fillStyle = "#444444";
  const meta = `${data.grade || "-"} 级 · ${data.locationCode || "库位未指定"} · ${data.category || "未分类"}`;
  fitFont(ctx, meta, 400, 8, 5, FONT_SANS);
  ctx.fillText(meta, mm(TEXT_CENTER_MM), mm(31.5));
  ctx.fillStyle = "#666666";
  fitFont(ctx, data.url, 400, 6.5, 4, FONT_SANS);
  ctx.fillText(data.url, mm(TEXT_CENTER_MM), mm(37));
}

/** 渲染成 PNG data URL（600 DPI，整张标签） */
export function renderLabelPng(data: LabelData, matrix: QrMatrix): string {
  const { width, height } = labelPixelSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法导出标签 PDF");
  drawLabel(ctx, data, matrix);
  return canvas.toDataURL("image/png");
}

/**
 * 导出标签 PDF 并触发下载（文件名 `{code}.pdf`）。
 * jsPDF 与 qrcode-generator 都在这里动态 import：只有用户点「导出 PDF」时才下载这两个包。
 */
export async function exportLabelPdf(data: LabelData): Promise<void> {
  const [pdfMod, qrMod] = await Promise.all([import("jspdf"), import("qrcode-generator")]);
  const png = renderLabelPng(data, createQrMatrix(data.url, qrMod.default));
  const doc = new pdfMod.jsPDF({
    unit: "mm",
    format: [LABEL_WIDTH_MM, LABEL_HEIGHT_MM],
    orientation: "landscape",
    compress: true,
  });
  // 满版铺满，无页边距
  doc.addImage(png, "PNG", 0, 0, LABEL_WIDTH_MM, LABEL_HEIGHT_MM);
  doc.save(`${data.code}.pdf`);
}
