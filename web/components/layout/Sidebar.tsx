"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, BookOpen, Package, X, BarChart3,
  Users, Settings, FileText, ChevronDown, GitBranch, Upload, Sparkles, TrendingUp, Activity, Brain, Cloud, IdCard, Trash2, ShieldAlert, ArrowLeftRight, ClipboardCheck, HardDrive, LayoutGrid, GraduationCap, Tags, BatteryCharging, Cpu, Type, ShieldCheck
} from "lucide-react";
import { useSidebar } from "./SidebarContext";
import { useBrand } from "@/lib/brand";
import { useCurrentUser } from "@/lib/hooks";
import { useCopy } from "@/components/content/ContentProvider";
import { usePermissions } from "@/components/permissions/PermissionsProvider";
import { buildLabel } from "@/lib/build-info";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon; perm?: string; copyKey?: string };
type NavGroup = { heading: string; items: NavItem[] };

/** 顶层基础导航（非管理）；perm 缺省 = 所有登录用户可见 */
const baseGroups: NavGroup[] = [
  { heading: "总览", items: [{ href: "/", label: "仪表盘", icon: LayoutDashboard }] },
  {
    heading: "资源",
    items: [
      { href: "/study", label: "学习库", icon: GraduationCap, perm: "content.study.view" },
      { href: "/flightlog", label: "飞行日志 / 固件", icon: TrendingUp },
      { href: "/webtools", label: "日志分析", icon: Activity },
      { href: "/wiki", label: "Wiki 文档", icon: GitBranch, perm: "content.wiki.view" },
    ],
  },
  {
    heading: "团队",
    items: [
      { href: "/incidents", label: "事故安全", icon: ShieldAlert, perm: "team.incidents.view" },
      { href: "/files", label: "资源共享", icon: Upload, perm: "content.files.view" },
      { href: "/profile", label: "我的档案", icon: IdCard, perm: "team.profile.self" },
    ],
  },
];

/** 物料管理子菜单 */
const materialNav: NavItem[] = [
  { href: "/inventory", label: "零件库存", icon: Package, perm: "material.inventory.view" },
  { href: "/inventory/layout", label: "物料布局", icon: LayoutGrid, perm: "material.layout.view" },
  { href: "/inventory/checkout", label: "领用管理", icon: ArrowLeftRight, perm: "material.checkout.apply" },
  { href: "/inventory/stocktake", label: "盘点", icon: ClipboardCheck, perm: "material.stocktake.execute" },
  { href: "/batteries", label: "电池借还", icon: BatteryCharging, perm: "material.battery.view" },
  { href: "/finance", label: "采购申请", icon: BarChart3, perm: "material.finance.apply" },
];

/** 管理端：按「人员 / 内容 / 系统」分组，避免一屏十几个入口堆在一起 */
const adminGroups: NavGroup[] = [
  {
    heading: "人员",
    items: [
      { href: "/admin/organization", label: "组织架构", icon: Users, perm: "admin.users.view" },
      { href: "/admin/exams", label: "考核管理", icon: ClipboardCheck, perm: "admin.exams.manage" },
    ],
  },
  {
    heading: "内容",
    items: [
      { href: "/admin/knowledge", label: "知识库", icon: BookOpen, perm: "content.knowledge.edit" },
      { href: "/admin/wiki-settings", label: "Wiki 设置", icon: Settings, perm: "content.wiki.manage" },
      { href: "/admin/content", label: "内容管理", icon: Type, perm: "admin.content.manage" },
      { href: "/admin/label-templates", label: "标签模板", icon: Tags, perm: "admin.settings.manage" },
    ],
  },
  {
    heading: "系统",
    items: [
      { href: "/admin/settings", label: "系统设置", icon: Settings, perm: "admin.settings.manage" },
      { href: "/admin/permissions", label: "权限管理", icon: ShieldCheck, perm: "admin.permissions.manage" },
      { href: "/admin/logs", label: "系统日志", icon: FileText, perm: "admin.logs.view" },
      { href: "/admin/trash", label: "回收站", icon: Trash2, perm: "admin.trash.manage" },
      { href: "/admin/backup", label: "备份恢复", icon: HardDrive, perm: "admin.backup.manage" },
      { href: "/admin/cloud", label: "云存储", icon: Cloud, perm: "admin.cloud.manage" },
      { href: "/admin/devices", label: "设备管理", icon: Cpu, perm: "admin.devices.manage" },
      { href: "/admin/ai-admin", label: "AI 管理员", icon: Brain, perm: "admin.ai.use" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** 导航项锚点："/" → nav-home，"/inventory/layout" → nav-inventory-layout */
function guideId(href: string): string {
  return href === "/" ? "nav-home" : "nav-" + href.replace(/^\//, "").replace(/\//g, "-");
}

/** 文案 key："/" → nav.dashboard，"/inventory/layout" → nav.layout */
function copyKeyFor(href: string): string {
  if (href === "/") return "nav.dashboard";
  return "nav." + (href.split("/").filter(Boolean).pop() ?? "");
}

const GROUP_KEYS: Record<string, string> = {
  "总览": "nav.group.overview",
  "资源": "nav.group.resources",
  "团队": "nav.group.team",
  "管理": "nav.group.admin",
};

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[10px] font-medium text-faint uppercase tracking-[0.08em]">
      {children}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-1 pb-0.5 text-[10px] text-faint">{children}</div>;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const t = useCopy();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      data-guide={guideId(item.href)}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
        active ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
      )}
    >
      <item.icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-primary" : "opacity-75")} />
      {t(copyKeyFor(item.href), item.label)}
    </Link>
  );
}

export function Sidebar() {
  const { teamName, teamSubtitle } = useBrand();
  const t = useCopy();
  const { can } = usePermissions();
  const { open, setOpen } = useSidebar();
  const [adminOpen, setAdminOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const { user } = useCurrentUser();

  const close = () => setOpen(false);
  const pathname = usePathname();
  const allowed = (item: NavItem) => !item.perm || can(item.perm);
  const isMaterialPath = pathname.startsWith("/inventory")
    || pathname.startsWith("/finance")
    || pathname.startsWith("/batteries");
  const visibleMaterials = materialNav.filter(allowed);
  const visibleAdminGroups = adminGroups
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);

  // 移动端抽屉：打开时锁滚动、支持 Esc；桌面端（lg 及以上）常驻
  useEffect(() => {
    if (!open) return;
    const isDesktop = typeof window.matchMedia === "function"
      && window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  useEffect(() => { setOpen(false); }, [pathname, setOpen]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity" onClick={close} />}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-72 sm:w-64 max-w-[calc(100vw-3rem)] flex flex-col transition-transform duration-300 shadow-xl",
        "bg-surface border-r border-border-subtle",
        "lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )} aria-label="主导航">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-subtle">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl overflow-hidden shrink-0"
            style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))", boxShadow: "0 6px 16px -8px color-mix(in srgb, var(--primary) 70%, transparent)" }}
          >
            <img src="/logo.png" alt={teamName} className="w-7 h-7 object-contain" />
          </div>
          <Link href="/" onClick={close} className="min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">{teamName}</div>
            <div className="text-[10px] text-faint leading-tight">{teamSubtitle}</div>
          </Link>
          <button onClick={close} aria-label="关闭菜单" className="lg:hidden ml-auto p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2" data-guide="sidebar-base">
          {baseGroups.map((group) => {
            const items = group.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div key={group.heading}>
                <GroupHeading>{t(GROUP_KEYS[group.heading] ?? "", group.heading)}</GroupHeading>
                {items.map((item) => <NavLink key={item.href} item={item} onNavigate={close} />)}

                {group.heading === "资源" && visibleMaterials.length > 0 && (
                  <div className="pt-0.5">
                    <button
                      onClick={() => setMaterialOpen(!materialOpen)}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                        isMaterialPath ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
                      )}
                    >
                      <Package className={cn("h-4.5 w-4.5 shrink-0", isMaterialPath ? "text-primary" : "opacity-75")} />
                      <span className="flex-1 text-left">{t("nav.group.materials", "物料管理")}</span>
                      <ChevronDown className={cn("h-3 w-3 transition-transform", materialOpen && "rotate-180")} />
                    </button>
                    {(materialOpen || isMaterialPath) && (
                      <div className="mt-0.5 ml-4 space-y-0.5 border-l border-border-subtle pl-3">
                        {visibleMaterials.map((item) => {
                          const active = isActive(pathname, item.href);
                          return (
                            <Link key={item.href} href={item.href} onClick={close} data-guide={guideId(item.href)}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-150",
                                active ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
                              )}>
                              <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "opacity-75")} />
                              {t(copyKeyFor(item.href), item.label)}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {visibleAdminGroups.length > 0 && (
            <div>
              <GroupHeading>管理</GroupHeading>
              <button
                onClick={() => setAdminOpen(!adminOpen)}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                  pathname.startsWith("/admin") ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
                )}
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", adminOpen && "rotate-180")} />
                {t("nav.group.admin", "管理")}
              </button>
              {adminOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleAdminGroups.map((group) => (
                    <div key={group.heading}>
                      <SubHeading>{group.heading}</SubHeading>
                      {group.items.map((item) => <NavLink key={item.href} item={item} onNavigate={close} />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-border-subtle">
          <div className="flex items-center gap-2 text-[10px] text-faint">
            <Sparkles className="h-3 w-3" />
            <span>{t("nav.footer", "{teamName} © 2026 · 内部系统").replace("{teamName}", teamName)}</span>
            <span className="ml-auto font-mono" title={`构建版本 ${buildLabel}`}>{buildLabel}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
