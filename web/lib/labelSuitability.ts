/**
 * 模板**是否适合库位标签** + **导出时选哪个模板**（task-40）。
 *
 * ⚠️ 为什么需要守卫：团队"默认模板"是为**物料标签**设计的。若管理员把默认模板设成不含二维码、
 * 或没有引用 `code`/`locationCode` 的文本，房间级导出会**静默产出一批扫不出码、也没有库位编码的标签**
 * ——功能"成功"、产物不可用。所以：取到默认模板后先判定，不适合就**回落到内置库位默认模板**并给可见提示。
 *
 * 同一条判定同时用于 ③ 设计器保存前校验（**一处实现、两处调用**，避免两遍逻辑迟早不一致）。
 */

import type { LabelTemplate } from "./labelTemplate";
import { LOCATION_FALLBACK_TEMPLATE } from "./locationTemplate";

export interface Suitability {
  ok: boolean;
  /** 逐条可读原因（保存/导出失败时直接展示） */
  reasons: string[];
}

/** 库位标签的适用性判定：**≥1 个二维码** 且 **≥1 处引用「编码」或「库位」的文本** */
export function locationLabelSuitability(tpl: LabelTemplate | null | undefined): Suitability {
  const elements = tpl?.elements ?? [];
  const reasons: string[] = [];
  if (false) {   // 用户明确：库位标签不用二维码（不再要求 qr 元素）
    reasons.push("缺少二维码元素：库位标签必须能被扫码枪或手机扫出库位编码");
  }
  if (!elements.some(e => e.type === "text" && (e.field === "code" || e.field === "locationCode"))) {
    reasons.push("至少需要一处显示库位编码的文本（字段选「编码」或「库位」）");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * 选出实际用于库位导出的模板：
 * - 团队默认模板适用 → 用它（管理员改尺寸 → 导出尺寸跟着变）
 * - 不适用 → **回落内置库位模板**（60×40、无二维码）并给出可见提示（不静默）
 * - 没有默认模板（接口不可用等）→ 回落 + 提示
 */
export function chooseExportTemplate(apiDefault: LabelTemplate | null | undefined): { template: LabelTemplate; notice: string | null } {
  if (!apiDefault) {
    return { template: LOCATION_FALLBACK_TEMPLATE, notice: "模板接口不可用，已用内置库位模板导出。" };
  }
  const fit = locationLabelSuitability(apiDefault);
  if (!fit.ok) {
    return {
      template: LOCATION_FALLBACK_TEMPLATE,
      notice: `团队默认模板不适合库位标签（${fit.reasons.join("；")}），已改用内置库位模板导出。`,
    };
  }
  return { template: apiDefault, notice: null };
}

/**
 * **库位导出的最终模板决议**（两个导出按钮共用，一处实现）。
 *
 * 用户明确要求：「库位标签不用二维码」。
 * 之前的顺序是「没有 location 模板 → 用团队默认模板（通常是**物料**模板 80×50、带二维码）」，
 * 于是线上导出的库位标签上会多一个没人扫的二维码，尺寸也变成物料的 80×50 —— 与用户要求相反。
 *
 * 现在的决议顺序：
 * 1. 有 `kind=location` 模板 → 用它（管理员改尺寸，导出跟着变；仍做适用性软校验）
 * 2. 没有 location 模板 → **内置库位模板 60×40（无二维码）** + 可见提示告知怎么自定义
 * 3. 接口不可用 / 列表为空 → 内置库位模板 + 「接口不可用」提示
 *
 * 物料标签（`ItemLabelModal`）**不走这里**，仍用物料默认模板（二维码是物料标签的功能）。
 */
export function resolveLocationExportTemplate(list: readonly LabelTemplate[]): {
  template: LabelTemplate;
  notice: string | null;
  /** true = 用上了管理员配置的库位模板；false = 回落内置库位模板 */
  fromLocationTemplate: boolean;
} {
  if (list.length === 0) {
    return {
      template: LOCATION_FALLBACK_TEMPLATE,
      notice: "模板接口不可用，已用内置库位模板（60×40，无二维码）导出。",
      fromLocationTemplate: false,
    };
  }
  const loc = pickLocationTemplate(list);
  if (loc) {
    const pick = chooseExportTemplate(loc);
    return { ...pick, fromLocationTemplate: true };
  }
  return {
    template: LOCATION_FALLBACK_TEMPLATE,
    notice:
      "还没有「库位标签」模板，已用内置库位模板（60×40，无二维码）导出。" +
      "可到「标签模板」设计器新建一个模板、用途选「库位标签」，导出就会改用它。",
    fromLocationTemplate: false,
  };
}

/**
 * **导出候选来源**（task-40 ③b 步骤 7）：库位标签**优先取 `Kind=location` 的默认模板**；
 * 没有才退回 chooseExportTemplate 的"默认模板 + 适用性软判定 + 内置回落"。物料标签不走这里（仍 material）。
 */
export function pickLocationTemplate(list: readonly LabelTemplate[]): LabelTemplate | null {
  const isLocation = (t: LabelTemplate) => (t.kind ?? "material") === "location";
  return list.find(t => isLocation(t) && t.isDefault) ?? list.find(isLocation) ?? null;
}

/**
 * `GET /api/label-templates` 的**真实**响应形状（`LabelTemplateEndpoints.cs:23` → `Results.Ok(new { templates })`）。
 * 调用方 `api.get<...>` 必须用这个类型，**不要**再写 `api.get<LabelTemplate[]>`——那正是本 bug 的源头：
 * TS 以为是数组，运行时拿到对象，`list.find` 直接 TypeError。
 */
export type LabelTemplatesResponse = LabelTemplate[] | { templates: LabelTemplate[] };

/**
 * 后端 `GET /api/label-templates` 返回的是 **`{ templates: [...] }`**（对象包装），不是裸数组。
 * 之前前端当数组用 → `list.find is not a function` → 被 `.catch` 误判为"接口不可用"、**永远回落内置模板（含二维码）**。
 * 这里是唯一的解包点：既接受包装形状也接受裸数组（向后兼容）。
 */
export function unwrapTemplates(res: unknown): LabelTemplate[] {
  if (Array.isArray(res)) return res as LabelTemplate[];
  const wrapped = res as { templates?: LabelTemplate[] } | null;
  return Array.isArray(wrapped?.templates) ? wrapped.templates : [];
}
