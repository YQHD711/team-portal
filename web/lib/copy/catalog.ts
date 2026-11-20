import type { CopyEntry } from "./types";
import { NAV_COPY } from "./groups/nav";
import { COMMON_COPY } from "./groups/common";
import { AUTH_COPY } from "./groups/auth";
import { TOPBAR_COPY } from "./groups/topbar";
import { EMPTY_COPY } from "./groups/empty";

export type { CopyEntry, CopyGroup } from "./types";
export { COPY_GROUPS } from "./types";

/**
 * 全部界面文案的**默认值目录**。
 *
 * 运行时的真实文案 = 本目录 + 数据库覆盖（SiteText 表）。
 * 新增一条可配置文案：在对应 groups/*.ts 里加 key，然后在组件里用 useText() 读取。
 */
export const CATALOG: Record<string, CopyEntry> = {
  ...NAV_COPY,
  ...TOPBAR_COPY,
  ...COMMON_COPY,
  ...AUTH_COPY,
  ...EMPTY_COPY,
};

/** 取默认文案；key 不存在返回 undefined（调用方回落到字面量） */
export function defaultText(key: string): string | undefined {
  return CATALOG[key]?.text;
}

/** 按分组列出 key（管理页渲染顺序固定，避免每次刷新顺序乱跳） */
export function keysByGroup(group: string): string[] {
  return Object.keys(CATALOG).filter((k) => CATALOG[k].group === group);
}
