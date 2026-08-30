"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, BookOpen, Package, BarChart3, X,
  Users, Settings, FileText, ChevronDown, GitBranch, Upload, Sparkles, TrendingUp, Activity, Brain, Cloud, UserCircle, IdCard, Trash2, ShieldAlert, ArrowLeftRight, ClipboardCheck, HardDrive, Ticket, LayoutGrid
} from "lucide-react";
import { useSidebar } from "./SidebarContext";
import { useBrand } from "@/lib/brand";
import { useCurrentUser } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { heading: string; items: NavItem[] };

/** 顶层基础导航（非管理） */
const baseGroups: NavGroup[] = [
  { heading: "总览", items: [{ href: "/", label: "仪表盘", icon: LayoutDashboard }] },
  {
    heading: "资源",
    items: [
      { href: "/knowledge", label: "知识库", icon: BookOpen },
      { href: "/flightlog", label: "飞行日志", icon: TrendingUp },
      { href: "/webtools", label: "日志分析", icon: Activity },
      { href: "/wiki", label: "Wiki 文档", icon: GitBranch },
    ],
  },
  {
    heading: "团队",
    items: [
      { href: "/incidents", label: "事故安全", icon: ShieldAlert },
      { href: "/files", label: "资源共享", icon: Upload },
      { href: "/profile", label: "我的档案", icon: IdCard },
    ],
  },
];

/** 物料管理子菜单 */
const materialNav = [
  { href: "/inventory", label: "零件库存", icon: Package },
  { href: "/inventory/layout", label: "物料布局", icon: LayoutGrid },
  { href: "/inventory/checkout", label: "领用管理", icon: ArrowLeftRight },
  { href: "/inventory/stocktake", label: "盘点", icon: ClipboardCheck },
  { href: "/finance", label: "采购申请", icon: BarChart3 },
];

/** 管理员子菜单（staff 折叠展开） */
const staffNav = [
  { href: "/admin/profiles", label: "队员档案", icon: UserCircle },
  { href: "/admin/knowledge", label: "资料管理", icon: FileText },
  { href: "/wiki/import", label: "Wiki 导入", icon: Upload },
];

const adminNav = [
  { href: "/admin/organization", label: "组织架构", icon: Users },
  { href: "/admin/exams", label: "考核管理", icon: ClipboardCheck },
  { href: "/admin/invites", label: "邀请码", icon: Ticket },
  { href: "/admin/wiki-settings", label: "Wiki 设置", icon: Settings },
  { href: "/admin/settings", label: "系统设置", icon: Settings },
  { href: "/admin/logs", label: "系统日志", icon: FileText },
  { href: "/admin/trash", label: "回收站", icon: Trash2 },
  { href: "/admin/backup", label: "备份恢复", icon: HardDrive },
  { href: "/admin/cloud", label: "云存储", icon: Cloud },
  { href: "/admin/ai-admin", label: "AI 管理员", icon: Brain },
];

/** 判断一个链接是否处于激活态（首页精确匹配，其余前缀匹配） */
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** 普通导航项 */
function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted hover:text-foreground hover:bg-surface-hover"
      )}
    >
      <item.icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-primary" : "opacity-75")} />
      {item.label}
    </Link>
  );
}

/** 分组标题（参考样板 .nav-head：小写字母间距） */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[10px] font-medium text-faint uppercase tracking-[0.08em]">
      {children}
    </div>
  );
}

export function Sidebar() {
  const { teamName, teamSubtitle } = useBrand();
  const { open, setOpen } = useSidebar();
  const [adminOpen, setAdminOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const { user } = useCurrentUser();

  const role = user?.role ?? null;
  const isStaff = role === "admin" || role === "部长";

  const close = () => setOpen(false);
  const pathname = usePathname();

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity" onClick={close} />}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-72 sm:w-64 max-w-[calc(100vw-3rem)] flex flex-col transition-transform duration-300 shadow-xl",
        "bg-surface border-r border-border-subtle",
        "lg:translate-x-0 lg:static lg:z-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Brand — 品牌渐变小方块 + 队名/副标题 */}
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
          <button onClick={close} className="lg:hidden ml-auto p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {baseGroups.map((group) => (
            <div key={group.heading}>
              <GroupHeading>{group.heading}</GroupHeading>
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} onNavigate={close} />
              ))}

              {/* 物料管理（资源组内，可折叠） */}
              {group.heading === "资源" && (
                <div className="pt-0.5">
                  <button
                    onClick={() => setMaterialOpen(!materialOpen)}
                    className={cn(
                      "flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                      pathname.startsWith("/inventory") || pathname.startsWith("/finance")
                        ? "bg-primary/10 text-foreground"
                        : "text-muted hover:text-foreground hover:bg-surface-hover"
                    )}
                  >
                    <Package className={cn("h-4.5 w-4.5 shrink-0", (pathname.startsWith("/inventory") || pathname.startsWith("/finance")) ? "text-primary" : "opacity-75")} />
                    <span className="flex-1 text-left">物料管理</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform", materialOpen && "rotate-180")} />
                  </button>
                  {(materialOpen || pathname.startsWith("/inventory") || pathname.startsWith("/finance")) && (
                    <div className="mt-0.5 ml-4 space-y-0.5 border-l border-border-subtle pl-3">
                      {materialNav.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <Link key={item.href} href={item.href} onClick={close}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-150",
                              active ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
                            )}>
                            <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "opacity-75")} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* 管理（staff 专属，可折叠） */}
          {isStaff && (
            <div>
              <GroupHeading>管理</GroupHeading>
              <button
                onClick={() => setAdminOpen(!adminOpen)}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                  pathname.startsWith("/admin") || pathname.startsWith("/wiki/import")
                    ? "bg-primary/10 text-foreground"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                )}
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", adminOpen && "rotate-180")} />
                管理
              </button>
              {adminOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {staffNav.map((item) => (
                    <NavLink key={item.href} item={item} onNavigate={close} />
                  ))}
                  {adminNav.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={close}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                          active ? "bg-primary/10 text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
                        )}>
                        <item.icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-primary" : "opacity-75")} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2 text-[10px] text-faint">
            <Sparkles className="h-3 w-3" />
            <span>{teamName} © 2026 · 内部系统</span>
          </div>
        </div>
      </aside>
    </>
  );
}
