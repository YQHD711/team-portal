import type { LabelTemplate } from "./labelTemplate";

/**
 * **库位标签**内置兜底版式（60×40，**不含二维码**）。
 *
 * 用户明确：「库位标签不用二维码」。`DEFAULT_TEMPLATE`（见 `labelTemplate.ts`）是**物料**标签默认，
 * 带二维码 —— 物料靠扫二维码打开详情页，两者不能混用。以前库位导出回落到物料模板时，
 * 库位标签上会多出一个没人扫的二维码，尺寸也变成物料的 80×50。
 *
 * 版式考量：贴货架/货位上的标签，**库位编码要最醒目**（一眼能读到），下面是名称/分类/房间。
 */
export const LOCATION_FALLBACK_TEMPLATE: LabelTemplate = {
  id: -1,
  name: "内置库位 60×40",
  isDefault: false,
  kind: "location",
  widthMm: 60,
  heightMm: 40,
  dpi: 600,
  background: "#FFFFFF",
  elements: [
    { id: "code", type: "text", x: 3, y: 5, w: 54, h: 10, field: "code", fontSizePt: 18, fontWeight: 700, fontFamily: "mono", color: "#111111", align: "center", autoShrink: true },
    { id: "name", type: "text", x: 3, y: 17, w: 54, h: 7, field: "name", fontSizePt: 11, fontWeight: 600, fontFamily: "sans", color: "#111111", align: "center", autoShrink: true },
    { id: "meta", type: "text", x: 3, y: 25, w: 54, h: 5, field: "meta", fontSizePt: 8.5, fontWeight: 400, fontFamily: "sans", color: "#444444", align: "center", autoShrink: true },
    { id: "url", type: "text", x: 3, y: 31.5, w: 54, h: 4.5, field: "url", fontSizePt: 7, fontWeight: 400, fontFamily: "sans", color: "#666666", align: "center", autoShrink: true },
  ],
};
