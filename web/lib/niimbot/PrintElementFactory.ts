/**
 * 精臣 SDK 绘制元素 → apiName 映射（vendor 自官方包
 * web-4.2.1_20260902/pc-react/src/PrintElementFactory.ts）。
 *
 * 注意：apiName 的历史拼写是 DrawLable*（Lable 而非 Label），必须保持原样，
 * 改了服务端会返回"未知接口"。
 */
import type { NiimbotElementType, NiimbotPrintElement } from "./protocol";

type ElementConfig = Record<string, unknown>;

const API_NAMES: Record<NiimbotElementType, string> = {
  text: "DrawLableText",
  qrCode: "DrawLableQrCode",
  qrCodeWithLogo: "DrawLableQrCodeWithImage",
  barCode: "DrawLableBarCode",
  line: "DrawLableLine",
  graph: "DrawLableGraph",
  image: "DrawLableImage",
};

export default class PrintElementFactory {
  static createElement(type: NiimbotElementType, config: ElementConfig): NiimbotPrintElement {
    const apiName = API_NAMES[type];
    if (!apiName) throw new Error(`不支持的绘制元素: ${type}`);
    return { type, json: config };
  }

  /** 元素 → 发往打印服务的 apiName（UI 日志/测试可读） */
  static apiNameOf(type: NiimbotElementType): string {
    return API_NAMES[type];
  }
}
