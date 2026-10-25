/**
 * 物料 → 标签渲染数据（LabelData）。
 *
 * 单张弹窗（ItemLabelModal）与批量打印必须用**同一条短链规则**：
 * `{对外地址}/i/{编码}`，对外地址来自后端 App:PublicBaseUrl（不能取 window.origin，
 * 否则用 localhost 打开时印出的二维码别人扫不开）。
 */
import type { LabelData } from "@/lib/labelTemplate";
import type { InventoryItem } from "./inventoryTypes";

/** 短链 = {baseUrl}/i/{encodeURIComponent(code)}；去掉 baseUrl 末尾斜杠 */
export function materialShortUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/i/${encodeURIComponent(code)}`;
}

/** 单个物料 → LabelData（单张/批量共用，避免两条路径印出不同内容） */
export function toMaterialLabelData(item: InventoryItem, baseUrl: string): LabelData {
  const code = item.code ?? "";
  return {
    code,
    url: materialShortUrl(baseUrl, code),
    name: item.name,
    grade: item.grade,
    locationCode: item.locationCode,
    category: item.category,
  };
}

/** 批量：只为填了编码的物料生成标签（没编码无法生成二维码） */
export function toMaterialLabelDataList(items: readonly InventoryItem[], baseUrl: string): LabelData[] {
  return items.filter(item => Boolean(item.code)).map(item => toMaterialLabelData(item, baseUrl));
}
