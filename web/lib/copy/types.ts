/**
 * 界面文案（Site Copy）类型定义。
 *
 * 默认值写在代码里（catalog），管理员改过的值存数据库（SiteText 表）。
 * 渲染时"数据库覆盖优先、代码默认兜底"——数据库不可用或 key 不存在时界面照常显示，
 * 所以管理员改错文案也不会把页面改崩。
 */

/** 文案分组：管理页按此分组展示与批量操作 */
export const COPY_GROUPS = ["导航", "顶栏", "通用", "登录注册", "空状态"] as const;

export type CopyGroup = (typeof COPY_GROUPS)[number];

export interface CopyEntry {
  /** 默认文案（与上线时界面显示一致） */
  text: string;
  /** 管理页分组 */
  group: CopyGroup;
  /** 给管理员看的说明：这条文案出现在哪里 */
  desc?: string;
  /** 建议最大长度（超出只提示不拦截，路由/按钮可能截断） */
  max?: number;
}
