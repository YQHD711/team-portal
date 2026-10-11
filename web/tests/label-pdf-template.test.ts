import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import qrcode from "qrcode-generator";
import {
  PX_PER_MM, createQrMatrix, drawLabel, drawTextElement, exportLabelPdf, labelPixelSize, textBaseline, textX,
} from "@/lib/labelPdf";
import { DEFAULT_TEMPLATE, type LabelElement, type LabelTemplate } from "@/lib/labelTemplate";
import { installFakeCanvas, darkExtent, decodeQr, type FakeCanvas } from "./support/labelCanvas";

/**
 * 模板驱动渲染：改模板的尺寸/DPI/元素位置，输出跟着变（验收点 2）。
 * 导出与预览共用 drawLabel/renderLabelPng —— 这里跑的就是导出那条路径。
 */

const pdfMock = vi.hoisted(() => ({ format: [] as unknown[], images: [] as unknown[][], saved: [] as string[] }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(opts: { format?: unknown }) { pdfMock.format.push(opts?.format); }
    addImage(...args: unknown[]) { pdfMock.images.push(args); }
    save(name: string) { pdfMock.saved.push(name); return this; }
  },
}));

const URL = "http://8.137.161.160:3000/i/EL-MOTOR-2212-2026-0001";
const data = { code: "EL-MOTOR-2212-2026-0001", url: URL, name: "测试电机", grade: "B", locationCode: "1030-A-1-01", category: "动力系统" };

/** 60×40mm / 300DPI，二维码挪到 (10,5) 20×20 静区 2 */
const custom: LabelTemplate = {
  id: 9, name: "小标签", widthMm: 60, heightMm: 40, dpi: 300, background: "#FFFFFF",
  elements: [
    { id: "qr", type: "qr", x: 10, y: 5, w: 20, h: 20, quietMm: 2 },
    { id: "t1", type: "text", x: 35, y: 8, w: 20, h: 6, field: "name", fontSizePt: 10, fontWeight: 600, fontFamily: "sans", color: "#111111", align: "left", autoShrink: true },
  ],
};

/** 造一个只记录调用的假 ctx（文字不落像素，用调用参数验证位置/字号） */
function spyCtx() {
  const calls: { text: string; x: number; y: number }[] = [];
  const fonts: string[] = [];
  const ctx = {
    fillStyle: "", textAlign: "left", textBaseline: "alphabetic",
    set font(v: string) { fonts.push(v); }, get font() { return fonts.at(-1) ?? ""; },
    fillRect: () => {},
    fillText: (text: string, x: number, y: number) => { calls.push({ text, x, y }); },
    measureText: (t: string) => ({ width: t.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fonts };
}

describe("模板驱动渲染", () => {
  let canvases: FakeCanvas[] = [];
  beforeEach(() => {
    pdfMock.format.length = 0; pdfMock.images.length = 0; pdfMock.saved.length = 0;
    canvases = installFakeCanvas();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("像素尺寸随模板的 mm 与 DPI 变化（默认 80×50@600 → 1890×1181）", () => {
    expect(labelPixelSize()).toEqual({ width: 1890, height: 1181 });
    expect(labelPixelSize(custom)).toEqual({ width: Math.round(60 * 300 / 25.4), height: Math.round(40 * 300 / 25.4) });
    expect(labelPixelSize(custom).width).not.toBe(Math.round(60 * PX_PER_MM));
  });

  it("二维码元素换位置/换大小：像素里就画在新位置，且仍能被 jsQR 解出", () => {
    const matrix = createQrMatrix(URL, qrcode);
    const size = labelPixelSize(custom);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    drawLabel(ctx, data, matrix, custom);
    const painted = canvases.at(-1)!;

    const perMm = custom.dpi / 25.4;
    const rect = { x: 10 * perMm, y: 5 * perMm, size: 20 * perMm };
    const extent = darkExtent(painted, rect)!;
    // 黑色模块区 = 20mm 盒子 − 两侧各 2mm 静区 = 16mm
    expect(extent.width / perMm).toBeCloseTo(16, 0);
    expect(extent.height / perMm).toBeCloseTo(16, 0);
    expect(decodeQr(painted, rect)).toBe(URL);

    // 整张画布上只有这一个二维码（画在模板给的新位置）
    const whole = darkExtent(painted, { x: 0, y: 0, size: Math.max(size.width, size.height) })!;
    expect(whole.width).toBe(extent.width);
    expect(whole.height).toBe(extent.height);
  });

  it("导出 PDF 用模板的物理尺寸（format/满版 addImage/文件名）", async () => {
    await exportLabelPdf(data, custom);

    expect(pdfMock.format[0]).toEqual([60, 40]);
    const img = pdfMock.images[0] as unknown[];
    // addImage(png, "PNG", x, y, wMm, hMm)
    expect([img[2], img[3], img[4], img[5]]).toEqual([0, 0, 60, 40]);
    expect(pdfMock.saved).toEqual(["EL-MOTOR-2212-2026-0001.pdf"]);
  });

  it("文本元素：水平锚点随 align，垂直在 (y,h) 盒子内居中", () => {
    const perMm = DEFAULT_TEMPLATE.dpi / 25.4;
    const el: LabelElement = { id: "t", type: "text", x: 40, y: 10, w: 20, h: 6, field: "name", fontSizePt: 10, fontWeight: 600, fontFamily: "sans", align: "right", autoShrink: true };
    const { ctx, calls } = spyCtx();

    drawTextElement(ctx, el, data, perMm);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe("测试电机");
    expect(calls[0].x).toBe(textX(el, perMm));
    expect(calls[0].x).toBeCloseTo(60 * perMm, 5);          // right 对齐到盒子右边界
    expect(calls[0].y).toBeCloseTo(textBaseline(el, 10 * perMm * 25.4 / 72, perMm), 5);
    // 居中：基线落在盒子内（13mm 中心 ± 字高）
    expect(calls[0].y).toBeGreaterThan(13 * perMm);
    expect(calls[0].y).toBeLessThan(16 * perMm + 10 * perMm);
  });

  it("autoShrink：长文本自动用小字号；关掉后保持标称字号", () => {
    const perMm = DEFAULT_TEMPLATE.dpi / 25.4;
    const long = "超长物料名称需要自动缩号才能塞进这一栏里面";
    const el: LabelElement = { id: "t", type: "text", x: 36, y: 20, w: 3, h: 6, field: "", text: long, fontSizePt: 12, fontWeight: 400, fontFamily: "sans", autoShrink: true };
    const a = spyCtx();
    drawTextElement(a.ctx, el, data, perMm);
    const shrunk = parseFloat(/ ([\d.]+)px /.exec(a.fonts.at(-1)!)![1]);

    const b = spyCtx();
    drawTextElement(b.ctx, { ...el, autoShrink: false }, data, perMm);
    const fixed = parseFloat(/ ([\d.]+)px /.exec(b.fonts.at(-1)!)![1]);

    const nominal = 12 * perMm * 25.4 / 72;
    expect(fixed).toBeCloseTo(nominal, 5);
    expect(shrunk).toBeLessThan(fixed);
  });
});
