"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Package,
  BarChart3,
  Bot,
  X,
  Bird,
} from "lucide-react";
import { useSidebar } from "./SidebarContext";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/knowledge", label: "知识库", icon: BookOpen },
  { href: "/inventory", label: "零件库存", icon: Package },
  { href: "/flightlog", label: "飞行日志", icon: BarChart3 },
  { href: "/ai", label: "AI 助手", icon: Bot },
];

export function Sidebar() {
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-300",
          "lg:translate-x-0 lg:static lg:z-0",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-sky-600 to-sky-500 dark:from-sky-700 dark:to-sky-600">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-white font-bold text-lg"
            onClick={() => setOpen(false)}
          >
            <Bird className="h-6 w-6" />
            <span>雏鹰之翼</span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-white/80 hover:text-white hover:bg-white/10 lg:hidden"
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Subtitle */}
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">航模队管理系统</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50"
                )}
              >
                <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-sky-600 dark:text-sky-400")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            雏鹰之翼航模队 © 2026
          </p>
        </div>
      </aside>
    </>
  );
}
