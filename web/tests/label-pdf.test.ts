import { describe, it, expect, vi, afterEach } from "vitest";
import qrcode from "qrcode-generator";
import {
  LABEL_WIDTH_MM, LABEL_HEIGHT_MM, LABEL_DPI, PX_PER_MM, QR_BOX_MM, QR_QUIET_MM, QR_RECT_MM,
  createQrMatrix, drawLabel, labelPixelSize,
} from "@/lib/labelPdf";
import { installFakeCanvas, darkExtent, decodeQr, type FakeCanvas } from "./support/labelCanvas";

const URL = "http://8.137.161.160:3000/i/BAT-LIPO-6S3300MAH-2026-0007";
const data = {
  code: "BAT-LIPO-6S3300MAH-2026-0007", url: URL, name: "6S 3300mAh 锂电池",
  grade: "A", locationCode: "1012-A-1-01", category: "电池电源",
};

const QrRectPx = { x: QR_RECT_MM.x * PX_PER_MM, y: QR_RECT_MM.y * PX_PER_MM, size: QR_RECT_MM.size * PX_PER_MM };

/** 跑一遍真实绘制路径，拿到画布像素 */
function drawLabelOnce(): { painted: FakeCanvas; count: number } {
  const canvases = installFakeCanvas();
  const matrix = createQrMatrix(URL, qrcode);
  const size = labelPixelSize();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  expect(ctx).not.toBeNull();
  drawLabel(ctx as CanvasRenderingContext2D, data, matrix);
  const painted = canvases.at(-1);
  expect(painted).not.toBeNull();
  return { painted: painted!, count: matrix.count };
}

describe("标签 PDF 的物理尺寸与二维码清晰度", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("页面尺寸是对齐精臣 T80*50-560白 的 80×50mm，栅格化分辨率 ≥300 DPI", () => {
    expect(LABEL_WIDTH_MM).toBe(80);
    expect(LABEL_HEIGHT_MM).toBe(50);
    expect(LABEL_DPI).toBeGreaterThanOrEqual(300);
    const px = labelPixelSize();
    expect(px.width / PX_PER_MM).toBeCloseTo(LABEL_WIDTH_MM, 1);
    expect(px.height / PX_PER_MM).toBeCloseTo(LABEL_HEIGHT_MM, 1);
  });

  it("二维码按「模块矩阵」画满 24mm 模块区（两侧各 3mm 静区），单模块 ≥8px ≈0.34mm", () => {
    const { painted, count } = drawLabelOnce();

    // 量实际画出来的黑色范围：应占满「方框 30mm − 两侧静区 6mm」的方块
    const extent = darkExtent(painted, QrRectPx);
    expect(extent).not.toBeNull();
    expect(extent!.width / PX_PER_MM).toBeCloseTo(QR_BOX_MM - 2 * QR_QUIET_MM, 0);
    expect(extent!.height / PX_PER_MM).toBeCloseTo(QR_BOX_MM - 2 * QR_QUIET_MM, 0);

    const modulePx = extent!.width / count;
    expect(modulePx).toBeGreaterThanOrEqual(8);
    // 换算成物理尺寸：热敏机 300 DPI 下每个模块仍有 4 个点，远超识读下限
    expect(modulePx / PX_PER_MM).toBeGreaterThanOrEqual(0.5);
  });

  it("画出来的二维码能被 jsQR 解出 payload = 短链（离线验证真的扫得出来）", () => {
    const { painted } = drawLabelOnce();
    expect(decodeQr(painted, QrRectPx)).toBe(URL);
  });
});
