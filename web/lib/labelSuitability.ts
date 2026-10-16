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
import { DEFAULT_TEMPLATE } from "./labelTemplate";

export interface Suitability {
  ok: boolean;
  /** 逐条可读原因（保存/导出失败时直接展示） */
  reasons: string[];
}

/** 库位标签的适用性判定：**≥1 个二维码** 且 **≥1 处引用「编码」或「库位」的文本** */
export function locationLabelSuitability(tpl: LabelTemplate | null | undefined): Suitability {
  const elements = tpl?.elements ?? [];
  const reasons: string[] = [];
  if (!elements.some(e => e.type === "qr")) {
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
 * - 不适用 → **回落内置模板**并给出可见提示（不静默）
 * - 没有默认模板（接口不可用等）→ 回落 + 提示
 */
export function chooseExportTemplate(apiDefault: LabelTemplate | null | undefined): { template: LabelTemplate; notice: string | null } {
  if (!apiDefault) {
    return { template: DEFAULT_TEMPLATE, notice: "未取到团队默认模板（接口不可用），已用内置库位模板导出。" };
  }
  const fit = locationLabelSuitability(apiDefault);
  if (!fit.ok) {
    return {
      template: DEFAULT_TEMPLATE,
      notice: `团队默认模板不适合库位标签（${fit.reasons.join("；")}），已改用内置库位模板导出。`,
    };
  }
  return { template: apiDefault, notice: null };
}
