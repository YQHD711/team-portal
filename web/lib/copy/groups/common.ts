import type { CopyEntry } from "../types";

/** 全站通用按钮与状态文案。改这里会同时影响所有用到该 key 的按钮。 */
export const COMMON_COPY: Record<string, CopyEntry> = {
  "common.save": { text: "保存", group: "通用", desc: "通用保存按钮", max: 8 },
  "common.cancel": { text: "取消", group: "通用", desc: "通用取消按钮", max: 8 },
  "common.delete": { text: "删除", group: "通用", desc: "通用删除按钮", max: 8 },
  "common.confirm": { text: "确认", group: "通用", desc: "通用确认按钮", max: 8 },
  "common.edit": { text: "编辑", group: "通用", desc: "通用编辑按钮", max: 8 },
  "common.add": { text: "新增", group: "通用", desc: "通用新增按钮", max: 8 },
  "common.close": { text: "关闭", group: "通用", desc: "通用关闭按钮", max: 8 },
  "common.search": { text: "搜索", group: "通用", desc: "通用搜索按钮", max: 8 },
  "common.back": { text: "返回", group: "通用", desc: "通用返回按钮", max: 8 },
  "common.loading": { text: "加载中…", group: "通用", desc: "加载状态", max: 12 },
  "common.retry": { text: "重试", group: "通用", desc: "失败重试按钮", max: 8 },
  "common.submit": { text: "提交", group: "通用", desc: "通用提交按钮", max: 8 },
  "common.reset": { text: "重置", group: "通用", desc: "通用重置按钮", max: 8 },
};
