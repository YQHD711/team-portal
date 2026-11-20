/**
 * 使用引导（Guided Tour）类型定义。
 *
 * 内容与引擎分离：内容是可 JSON 序列化的普通对象，既能写在代码里作默认值，
 * 也能被后台（GuideContent 表）覆盖后从接口下发。
 */

/** 全站角色：member（成员）、部长、admin（系统管理员） */
export type Role = "member" | "部长" | "admin";

export const ALL_ROLES: readonly Role[] = ["member", "部长", "admin"];

/** 气泡相对目标元素的位置；auto = 按视口空间自动翻转 */
export type Placement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  /** 稳定 id（同一 tour 内唯一）：改文案/换顺序不影响进度记录 */
  id: string;
  /** 目标元素的 data-guide 值；找不到目标时该步自动跳过 */
  target: string;
  title: string;
  body: string;
  placement?: Placement;
  /** 步骤级权限：缺省继承 tour 的 roles（用于同页不同权的步骤） */
  roles?: Role[];
  /** 仅桌面端显示：移动端侧栏是抽屉，导航类目标不存在 */
  desktopOnly?: boolean;
  /** 可选「带我去试试」按钮 */
  action?: { label: string; href: string };
}

export interface TourDef {
  /** 全局唯一 key（同时用于进度记录与后台覆盖） */
  key: string;
  title: string;
  /** 谁能看到这条引导 */
  roles: readonly Role[];
  /** 自动触发的路径："/" 精确匹配，其余按前缀匹配 */
  entry: string;
  /** 首次进入该功能时是否自动开始 */
  autoStart: boolean;
  /** 内容版本：文案改版后 +1，老用户会看到「引导已更新」而不是被强制重放 */
  version: number;
  steps: TourStep[];
}

/** 把后端/缓存里的 string 收敛成合法 Role，非法值返回 null（按无权限处理） */
export function normalizeRole(role: string | null | undefined): Role | null {
  return role === "member" || role === "部长" || role === "admin" ? role : null;
}
