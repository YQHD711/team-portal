import { type Role, type TourDef, type TourStep, normalizeRole } from "./types";
import { welcomeTour } from "./tours/welcome";
import { batteryTour } from "./tours/battery";
import { inventoryTour } from "./tours/inventory";

/**
 * 引导注册表：新增一条引导 = 在 tours/ 下建文件并在这里注册。
 * 后台（GuideContent）只覆盖已有 key 的内容，不能新增 key——新引导总要有人先写锚点。
 */
export const TOURS: TourDef[] = [welcomeTour, batteryTour, inventoryTour];

export function getTour(key: string): TourDef | undefined {
  return TOURS.find((t) => t.key === key);
}

/** 当前角色能看到的引导（管理类引导不下发给成员，避免进引导中心后点开才发现无权访问） */
export function visibleTours(role: string | null | undefined, all: TourDef[] = TOURS): TourDef[] {
  const r = normalizeRole(role);
  if (!r) return [];
  return all.filter((t) => t.roles.includes(r));
}

/** 路径匹配："/" 精确匹配，其余允许子路径（如 /inventory/layout 命中 /inventory） */
export function matchesEntry(entry: string, pathname: string): boolean {
  if (entry === "/") return pathname === "/";
  return pathname === entry || pathname.startsWith(entry + "/");
}

/** 当前路径应自动开始的引导；更具体的 entry 优先（长前缀胜出） */
export function tourForPath(
  pathname: string,
  role: string | null | undefined,
  all: TourDef[] = TOURS,
): TourDef | undefined {
  return visibleTours(role, all)
    .filter((t) => t.autoStart && matchesEntry(t.entry, pathname))
    .sort((a, b) => b.entry.length - a.entry.length)[0];
}

/** 过滤掉当前角色无权看的步骤（引导级角色 + 步骤级角色） */
export function visibleSteps(tour: TourDef, role: string | null | undefined): TourStep[] {
  const r = normalizeRole(role);
  if (!r) return [];
  return tour.steps.filter((s) => (s.roles ? s.roles.includes(r) : tour.roles.includes(r)));
}

/** 角色标签（管理页与引导中心展示用） */
export function roleLabel(role: Role): string {
  return role === "admin" ? "管理员" : role === "部长" ? "部长" : "成员";
}
