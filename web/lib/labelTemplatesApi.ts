/**
 * 标签模板 CRUD（契约见 task-17/18）：GET 任意登录用户可读，写入 AdminOnly。
 * 接口可能还没合进 main → 读取失败时返回内置兜底模板 + degraded 标记（页面给可读提示，不崩）。
 */
import { api } from "./api";
import { DEFAULT_TEMPLATE, normalizeTemplate, normalizeTemplates, type LabelTemplate } from "./labelTemplate";

export interface TemplateListResult {
  templates: LabelTemplate[];
  /** true = 接口不可用，正在用内置兜底模板 */
  degraded: boolean;
  /** 给用户看的可读原因 */
  message?: string;
}

const reason = (err: unknown): string => (err instanceof Error && err.message ? err.message : "模板接口不可用");

/** 拉列表：失败/空/结构非法 → 内置兜底模板（导出与编辑都不因此不可用） */
export async function fetchTemplates(): Promise<TemplateListResult> {
  try {
    const list = normalizeTemplates(await api.get<unknown>("/api/label-templates"));
    if (list.length === 0) return { templates: [DEFAULT_TEMPLATE], degraded: true, message: "模板接口暂无数据，已用内置默认模板" };
    return { templates: list, degraded: false };
  } catch (err) {
    return { templates: [DEFAULT_TEMPLATE], degraded: true, message: `模板接口不可用（${reason(err)}），已用内置默认模板` };
  }
}

/** 写入用的 body：完整模板（含完整 elements 数组），不带服务端负责的 id/updatedAt */
export function toWritePayload(t: LabelTemplate): Record<string, unknown> {
  return {
    name: t.name,
    isDefault: t.isDefault === true,
    widthMm: t.widthMm,
    heightMm: t.heightMm,
    dpi: t.dpi,
    background: t.background,
    elements: t.elements.map(e => ({ ...e })),
  };
}

const asTemplate = (raw: unknown, fallback: LabelTemplate): LabelTemplate => normalizeTemplate(raw) ?? fallback;

/** 新建（AdminOnly）：服务端算 id/updatedAt */
export async function createTemplate(input: LabelTemplate): Promise<LabelTemplate> {
  return asTemplate(await api.post<unknown>("/api/label-templates", toWritePayload(input)), input);
}

/** 保存（AdminOnly）：希望被改的只有当前模板，载荷仍是完整模板 */
export async function saveTemplate(input: LabelTemplate): Promise<LabelTemplate> {
  return asTemplate(await api.put<unknown>(`/api/label-templates/${input.id}`, toWritePayload(input)), input);
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/api/label-templates/${id}`);
}

/** 设为默认（AdminOnly）：服务端保证唯一默认 */
export async function setDefaultTemplate(id: number): Promise<void> {
  await api.post(`/api/label-templates/${id}/default`, {});
}
