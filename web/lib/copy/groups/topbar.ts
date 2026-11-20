import type { CopyEntry } from "../types";

/** 顶栏：搜索、通知、主题切换等入口文案。 */
export const TOPBAR_COPY: Record<string, CopyEntry> = {
  "topbar.search": { text: "搜索...", group: "顶栏", desc: "搜索按钮上的占位文字", max: 12 },
  "topbar.search.placeholder": { text: "搜索知识库、库存、Wiki、文件...", group: "顶栏", desc: "搜索弹层输入框占位", max: 30 },
  "topbar.search.hint": { text: "输入至少 2 个字符开始搜索", group: "顶栏", desc: "搜索弹层空状态提示", max: 24 },
};
