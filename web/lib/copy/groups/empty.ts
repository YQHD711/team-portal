import type { CopyEntry } from "../types";

/**
 * 空状态文案（列表无数据时的提示）。
 *
 * 第 1 批只收录已确认真实存在的空状态；后续模块迁移时再逐步补充。
 */
export const EMPTY_COPY: Record<string, CopyEntry> = {
  "empty.inventory.materials": { text: "暂无物料数据", group: "空状态", desc: "仪表盘 · 物料分类饼图无数据", max: 20 },
  "empty.incidents.open": { text: "暂无未处理事故", group: "空状态", desc: "仪表盘 · 未处理事故", max: 20 },
  "empty.incidents.good": { text: "安全记录良好", group: "空状态", desc: "仪表盘 · 未处理事故的补充说明", max: 20 },
  "empty.files": { text: "暂无共享文件", group: "空状态", desc: "资源共享页列表为空", max: 20 },
  "empty.finance.requests": { text: "暂无采购申请", group: "空状态", desc: "采购申请列表为空", max: 20 },
};
