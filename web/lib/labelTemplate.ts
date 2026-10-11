/**
 * 标签模板契约（与后端 task-17 冻结的 JSON 一致）+ **内置兜底默认模板**。
 *
 * 兜底模板的意义：`GET /api/label-templates` 可能 404/失败/返回空，
 * 那时导出必须照旧能用（改造前就是能导的，不能退化成不能）——
 * 所以默认版式在这里硬编码一份，且与后端种子**等价**，渲染结果与改造前逐字一致。
 */

export type LabelField = "code" | "name" | "grade" | "locationCode" | "category" | "url" | "meta";
export type LabelElementType = "qr" | "text";
export type LabelAlign = "left" | "center" | "right";
export type LabelFontFamily = "sans" | "mono";

export interface LabelElement {
  id: string;
  type: LabelElementType;
  /** mm，相对标签左上角 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** text：7 个字段之一；为空则用 text 字面量 */
  field?: LabelField | "";
  text?: string;
  fontSizePt?: number;
  fontWeight?: number;
  fontFamily?: LabelFontFamily;
  color?: string;
  align?: LabelAlign;
  autoShrink?: boolean;
  /** qr：静区宽度（mm） */
  quietMm?: number;
}

export interface LabelTemplate {
  id: number;
  name: string;
  isDefault?: boolean;
  widthMm: number;
  heightMm: number;
  dpi: number;
  background: string;
  elements: LabelElement[];
  updatedAt?: string;
}

/** 渲染用的物料数据（labelPdf 只读这些字段） */
export interface LabelData {
  code: string;
  url: string;
  name: string;
  grade?: string | null;
  locationCode?: string | null;
  category?: string | null;
}

/** 七个字段（属性面板下拉用） */
export const LABEL_FIELDS: { value: LabelField; label: string }[] = [
  { value: "code", label: "编码" },
  { value: "name", label: "名称" },
  { value: "grade", label: "等级" },
  { value: "locationCode", label: "库位" },
  { value: "category", label: "分类" },
  { value: "url", label: "短链" },
  { value: "meta", label: "等级·库位·分类（组合）" },
];

/** 组合字段 meta 的分隔符与缺省文案（固定规则，复刻改造前的第三行） */
export const META_SEPARATOR = " · ";
export const META_MISSING_GRADE = "-";
export const META_MISSING_LOCATION = "库位未指定";
export const META_MISSING_CATEGORY = "未分类";

/** `meta` = `${grade || "-"} 级 · ${locationCode || "库位未指定"} · ${category || "未分类"}` */
export function metaText(data: Pick<LabelData, "grade" | "locationCode" | "category">): string {
  return [
    `${data.grade || META_MISSING_GRADE} 级`,
    data.locationCode || META_MISSING_LOCATION,
    data.category || META_MISSING_CATEGORY,
  ].join(META_SEPARATOR);
}

/** 取一个文本元素最终要画的内容：field 优先，其次固定文字 */
export function resolveElementText(el: Pick<LabelElement, "field" | "text">, data: LabelData): string {
  switch (el.field) {
    case "code": return data.code ?? "";
    case "name": return data.name ?? "";
    case "grade": return data.grade ?? "";
    case "locationCode": return data.locationCode ?? "";
    case "category": return data.category ?? "";
    case "url": return data.url ?? "";
    case "meta": return metaText(data);
    default: return el.text ?? "";
  }
}

/** 默认版式：等价于改造前写死的那一版（二维码 x3 y10 30×30 静区3；右侧 x36 宽41 四行文字） */
export const DEFAULT_TEMPLATE: LabelTemplate = {
  id: 0,
  name: "默认 80×50",
  isDefault: true,
  widthMm: 80,
  heightMm: 50,
  dpi: 600,
  background: "#FFFFFF",
  elements: [
    { id: "qr", type: "qr", x: 3, y: 10, w: 30, h: 30, quietMm: 3 },
    { id: "code", type: "text", x: 36, y: 14, w: 41, h: 6, field: "code", fontSizePt: 12, fontWeight: 700, fontFamily: "mono", color: "#111111", align: "center", autoShrink: true },
    { id: "name", type: "text", x: 36, y: 22, w: 41, h: 7, field: "name", fontSizePt: 10, fontWeight: 600, fontFamily: "sans", color: "#111111", align: "center", autoShrink: true },
    { id: "meta", type: "text", x: 36, y: 29.5, w: 41, h: 5, field: "meta", fontSizePt: 8, fontWeight: 400, fontFamily: "sans", color: "#444444", align: "center", autoShrink: true },
    { id: "url", type: "text", x: 36, y: 35.5, w: 41, h: 4.5, field: "url", fontSizePt: 6.5, fontWeight: 400, fontFamily: "sans", color: "#666666", align: "center", autoShrink: true },
  ],
};

/** 设计器预览用的示例物料 */
export const SAMPLE_LABEL_DATA: LabelData = {
  code: "EL-MOTOR-2212-2026-0001",
  url: "http://8.137.161.160:3000/i/EL-MOTOR-2212-2026-0001",
  name: "测试电机",
  grade: "B",
  locationCode: "1030-A-1-01",
  category: "动力系统",
};

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === "string" && v ? v : fallback);
const isField = (v: unknown): v is LabelField => LABEL_FIELDS.some(f => f.value === v);

/** 归一化单个元素：类型/尺寸不合法就丢掉（返回 null），可选字段给安全默认值 */
export function normalizeElement(raw: unknown, index: number): LabelElement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "qr" && o.type !== "text") return null;
  const size = { w: Math.max(1, num(o.w, 10)), h: Math.max(1, num(o.h, 5)) };
  const base: LabelElement = {
    id: str(o.id, `el${index + 1}`),
    type: o.type,
    x: num(o.x, 0), y: num(o.y, 0), w: size.w, h: size.h,
  };
  if (o.type === "qr") return { ...base, quietMm: Math.max(0, num(o.quietMm, 3)) };
  const align = o.align === "left" || o.align === "right" ? o.align : "center";
  return {
    ...base,
    field: isField(o.field) ? o.field : "",
    text: typeof o.text === "string" ? o.text : "",
    fontSizePt: Math.max(1, num(o.fontSizePt, 10)),
    fontWeight: num(o.fontWeight, 400),
    fontFamily: o.fontFamily === "mono" ? "mono" : "sans",
    color: str(o.color, "#111111"),
    align,
    autoShrink: o.autoShrink !== false,
  };
}

/** 归一化模板：尺寸/DPI/元素全部兜底；完全不合法的返回 null（调用方改用内置默认模板） */
export function normalizeTemplate(raw: unknown): LabelTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.elements) ? o.elements : [];
  const elements = list.map(normalizeElement).filter((e): e is LabelElement => e !== null);
  const widthMm = Math.max(10, num(o.widthMm, DEFAULT_TEMPLATE.widthMm));
  const heightMm = Math.max(10, num(o.heightMm, DEFAULT_TEMPLATE.heightMm));
  return {
    id: num(o.id, 0),
    name: str(o.name, "未命名模板"),
    isDefault: o.isDefault === true,
    widthMm, heightMm,
    dpi: Math.max(72, num(o.dpi, DEFAULT_TEMPLATE.dpi)),
    background: str(o.background, "#FFFFFF"),
    elements: elements.length > 0 ? elements : DEFAULT_TEMPLATE.elements.map(e => ({ ...e })),
  };
}

/** 归一化整个列表响应 `{ templates: [...] }`；空/非法 → 空数组（调用方决定是否用兜底） */
export function normalizeTemplates(raw: unknown): LabelTemplate[] {
  const list = raw && typeof raw === "object" ? (raw as { templates?: unknown }).templates : null;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeTemplate).filter((t): t is LabelTemplate => t !== null);
}
