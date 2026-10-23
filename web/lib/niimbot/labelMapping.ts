/**
 * 标签模板（LabelTemplate）→ 精臣 SDK 单页打印数据（NiimbotPrintPage）。
 *
 * 纯函数：不碰 DOM、不连 WebSocket，可在 vitest 里直接断言每个字段。
 *
 * 坐标/单位（从 labelTemplate.ts 与 labelPdf.ts 确认）：
 *  - 模板元素 x/y/w/h 都是 **mm**，相对标签左上角；SDK 的绘制参数同样用 mm，直接透传。
 *  - 模板 fontSizePt 是 **pt**；SDK 的 fontSize 是 **mm** → 换算 fontSize = pt × 25.4 / 72。
 *  - 模板二维码的 quietMm 只是 canvas 栅格化时的静区，SDK 自己排二维码，无需传。
 *
 * 当前模板契约（task-17 冻结）只有 qr / text 两种元素；若以后模板新增条码/线条/图形，
 * 需要在这里补映射，不能静默丢弃（否则用户会得到一张缺元素的标签）。
 */
import { resolveElementText, type LabelData, type LabelElement, type LabelTemplate } from "../labelTemplate";
import type { InitDrawingBoardParam, NiimbotPrintElement, NiimbotPrintPage } from "./protocol";

/** K3W 最常见耗材尺寸（50 × 30 mm）；只用于提示，不强制改模板 */
export const K3W_COMMON_SIZE = { widthMm: 50, heightMm: 30 } as const;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** pt → mm（1 inch = 25.4 mm = 72 pt） */
export function ptToMm(pt: number): number {
  return round2((pt * 25.4) / 72);
}

/** 模板对齐方式 → SDK textAlignHorizonral（0 左 / 1 居中 / 2 右） */
export function horizontalAlign(align: LabelElement["align"]): 0 | 1 | 2 {
  if (align === "left") return 0;
  if (align === "right") return 2;
  return 1;
}

/** 模板尺寸是否是 K3W 常用的 50×30mm */
export function isK3wCommonSize(template: Pick<LabelTemplate, "widthMm" | "heightMm">): boolean {
  return Math.abs(template.widthMm - K3W_COMMON_SIZE.widthMm) < 0.01
    && Math.abs(template.heightMm - K3W_COMMON_SIZE.heightMm) < 0.01;
}

/** 非 50×30 时的提醒（不阻止打印：自定义尺寸也可能匹配用户手上的纸） */
export function k3wSizeWarning(template: Pick<LabelTemplate, "widthMm" | "heightMm" | "name">): string | null {
  if (isK3wCommonSize(template)) return null;
  return `模板「${template.name}」是 ${template.widthMm}×${template.heightMm}mm，K3W 常用 50×30mm。`
    + "若纸张不是这个尺寸，打印会错位或超出打印头宽度；建议先在精臣软件里确认耗材，或改用导出 PDF。";
}

function mapQrElement(el: LabelElement, data: LabelData): NiimbotPrintElement {
  if (!data.url) throw new Error("物料缺少短链 URL，无法生成二维码");
  return {
    type: "qrCode",
    json: {
      x: round2(el.x),
      y: round2(el.y),
      width: round2(el.w),
      height: round2(el.h),
      value: data.url,
      codeType: 31, // QR_CODE
      rotate: 0,
    },
  };
}

function mapTextElement(el: LabelElement, data: LabelData): NiimbotPrintElement | null {
  const value = resolveElementText(el, data).trim();
  if (!value) return null; // 空字段不画，避免占位空白/服务端报错
  return {
    type: "text",
    json: {
      x: round2(el.x),
      y: round2(el.y),
      width: round2(el.w),
      height: round2(el.h),
      value,
      fontFamily: "宋体", // 当前服务版本固定思源黑体，该字段不生效，保留以兼容协议
      rotate: 0,
      fontSize: ptToMm(el.fontSizePt ?? 10),
      textAlignHorizonral: horizontalAlign(el.align),
      textAlignVertical: 1, // 垂直居中，与 PDF 渲染一致
      letterSpacing: 0,
      lineSpacing: 1,
      // 6 = 宽高固定、内容超框自动缩放；4 = 宽高固定、超出裁切
      lineMode: el.autoShrink === false ? 4 : 6,
      fontStyle: [(el.fontWeight ?? 400) >= 600, false, false, false],
    },
  };
}

/** 单个模板元素 → SDK 元素（返回 null 表示跳过） */
export function mapLabelElement(el: LabelElement, data: LabelData): NiimbotPrintElement | null {
  if (el.type === "qr") return mapQrElement(el, data);
  if (el.type === "text") return mapTextElement(el, data);
  // 运行期防御：模板 JSON 可能来自接口，类型系统保证不了
  const unknownType = (el as { type?: string }).type ?? "unknown";
  throw new Error(`模板包含暂不支持直连打印的元素（${unknownType}），请改用「导出 PDF」打印`);
}

/** 模板 + 物料数据 → 单页打印数据（InitDrawingBoardParam + elements） */
export function mapLabelToPrintPage(template: LabelTemplate, data: LabelData): NiimbotPrintPage {
  if (!template.elements.length) throw new Error("标签模板没有元素，无法打印");
  const elements = template.elements
    .map(el => mapLabelElement(el, data))
    .filter((el): el is NiimbotPrintElement => el !== null);
  if (!elements.length) throw new Error("模板元素都解析为空内容，无法打印（检查字段与固定文案）");

  const InitDrawingBoardParam: InitDrawingBoardParam = {
    width: round2(template.widthMm),
    height: round2(template.heightMm),
    rotate: 0,
    path: "",
    verticalShift: 0,
    HorizontalShift: 0,
  };
  return { InitDrawingBoardParam, elements };
}
