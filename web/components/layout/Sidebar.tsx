"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BookOpen, Package, BarChart3, Bot, X, Bird,
  Users, Building2, Settings, FileText, ChevronDown, GitBranch
} from "lucide-react";
import { useState, useEffect } from "react";
import { useSidebar } from "./SidebarContext";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

const mainNav = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/knowledge", label: "知识库", icon: BookOpen },
  { href: "/inventory", label: "零件库存", icon: Package },
  { href: "/flightlog", label: "飞行日志", icon: BarChart3 },
];

const adminNav = [
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/departments", label: "部门管理", icon: Building2 },
  { href: "/admin/knowledge", label: "资料管理", icon: FileText },
  { href: "/admin/settings", label: "系统设置", icon: Settings },
  { href: "/wiki", label: "Wiki 导入", icon: GitBranch },
];

export function Sidebar() {
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();
  const [adminOpen, setAdminOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api.get<{ role: string; department: string | null }>("/api/admin/me").then(u => setRole(u.role)).catch(() => setRole(null));
  }, []);

  const canManage = role === "admin" || role === "部长";

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-300",
        "lg:translate-x-0 lg:static lg:z-0",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-sky-600 to-sky-500 dark:from-sky-700 dark:to-sky-600">
          <Link href="/" className="flex items-center gap-2.5 text-white font-bold text-lg" onClick={() => setOpen(false)}>
            <Bird className="h-6 w-6" /> <span>雏鹰之翼</span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-white/80 hover:text-white hover:bg-white/10 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">航模队管理系统</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {mainNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 shadow-sm"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50"
                )}>
                <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-sky-600 dark:text-sky-400")} />
                {item.label}
              </Link>
            );
          })}

          {/* Admin section — only for admin/部长 */}
          {canManage && (
          <div className="pt-3 mt-3 border-t border-zinc-200 dark:border-zinc-800">
            <button onClick={() => setAdminOpen(!adminOpen)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 uppercase tracking-wider hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
              <ChevronDown className={cn("h-3 w-3 transition-transform", adminOpen && "rotate-180")} />
              管理
            </button>
            {adminOpen && (
              <div className="mt-1 space-y-0.5">
                {adminNav.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                        isActive ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 shadow-sm"
                                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50"
                      )}>
                      <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-sky-600 dark:text-sky-400")} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </nav>

        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">雏鹰之翼航模队 © 2026</p>
        </div>
      </aside>
    </>
  );
}
