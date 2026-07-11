"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BookOpen, Package, BarChart3, X,
  Users, Building2, Settings, FileText, ChevronDown, GitBranch, Upload, Sparkles, TrendingUp, Brain, Cloud, UserCircle, IdCard, Trash2, ShieldAlert, ArrowLeftRight, ClipboardCheck, HardDrive
} from "lucide-react";
import { useState, useEffect } from "react";
import { useSidebar } from "./SidebarContext";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

const mainNav = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/knowledge", label: "知识库", icon: BookOpen },
  { href: "/flightlog", label: "飞行日志", icon: TrendingUp },
  { href: "/incidents", label: "事故安全", icon: ShieldAlert },
  { href: "/files", label: "资源共享", icon: Upload },
  { href: "/wiki", label: "Wiki 文档", icon: GitBranch },
  { href: "/profile", label: "我的档案", icon: IdCard },
];

const materialNav = [
  { href: "/inventory", label: "零件库存", icon: Package },
  { href: "/inventory/checkout", label: "领用管理", icon: ArrowLeftRight },
  { href: "/inventory/stocktake", label: "盘点", icon: ClipboardCheck },
  { href: "/finance", label: "采购申请", icon: BarChart3 },
];

const staffNav = [
  { href: "/admin/profiles", label: "队员档案", icon: UserCircle },
  { href: "/admin/knowledge", label: "资料管理", icon: FileText },
  { href: "/wiki/import", label: "Wiki 导入", icon: Upload },
];

const adminNav = [
  { href: "/admin/users", label: "队员管理", icon: Users },
  { href: "/admin/departments", label: "部门管理", icon: Building2 },
  { href: "/admin/wiki-settings", label: "Wiki 设置", icon: Settings },
  { href: "/admin/settings", label: "系统设置", icon: Settings },
  { href: "/admin/logs", label: "系统日志", icon: FileText },
  { href: "/admin/trash", label: "回收站", icon: Trash2 },
  { href: "/admin/backup", label: "备份恢复", icon: HardDrive },
  { href: "/admin/cloud", label: "云存储", icon: Cloud },
  { href: "/admin/ai-admin", label: "AI 管理员", icon: Brain },
];

export function Sidebar() {
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();
  const [adminOpen, setAdminOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api.get<{ role: string; department: string | null }>("/api/auth/me").then(u => setRole(u.role)).catch(() => setRole(null));
  }, []);

  const isStaff = role === "admin" || role === "部长";
  const isAdmin = role === "admin";

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity" onClick={() => setOpen(false)} />}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-72 sm:w-64 max-w-[calc(100vw-3rem)] flex flex-col transition-transform duration-300 shadow-xl",
        "bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800",
        "lg:translate-x-0 lg:static lg:z-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Brand — gradient header */}
        <div className="relative overflow-hidden px-5 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 opacity-90" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
          <Link href="/" className="relative flex items-center gap-3 text-white" onClick={() => setOpen(false)}>
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/20 backdrop-blur overflow-hidden">
              <img src="/logo.png" alt="雏鹰之翼" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">雏鹰之翼</div>
              <div className="text-[10px] text-white/60 leading-tight">队员协作平台</div>
            </div>
          </Link>
          <button onClick={() => setOpen(false)} className="lg:hidden absolute right-2 top-3 p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {mainNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-blue-600/30 text-blue-300 shadow-lg shadow-blue-500/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                )}>
                <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-blue-400")} />
                {item.label}
              </Link>
            );
          })}

          {/* Material management submenu */}
          <div className="pt-1">
            <button onClick={() => setMaterialOpen(!materialOpen)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                pathname.startsWith("/inventory")
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              )}>
              <Package className={cn("h-5 w-5 shrink-0", pathname.startsWith("/inventory") && "text-blue-400")} />
              <span className="flex-1 text-left">物料管理</span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", materialOpen && "rotate-180")} />
            </button>
            {(materialOpen || pathname.startsWith("/inventory")) && (
              <div className="mt-1 ml-4 space-y-0.5 border-l border-white/10 pl-3">
                {materialNav.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                        isActive
                          ? "bg-blue-600/20 text-blue-300"
                          : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                      )}>
                      <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-blue-400")} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin section */}
          {isStaff && (
            <div className="pt-3 mt-3 border-t border-white/10">
              <button onClick={() => setAdminOpen(!adminOpen)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-medium text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors">
                <ChevronDown className={cn("h-3 w-3 transition-transform", adminOpen && "rotate-180")} />
                管理
              </button>
              {adminOpen && (
                <div className="mt-1 space-y-1">
                  {staffNav.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                          isActive
                            ? "bg-blue-600/30 text-blue-300 shadow-lg shadow-blue-500/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                        )}>
                        <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-blue-400")} />
                        {item.label}
                      </Link>
                    );
                  })}
                  {isAdmin && adminNav.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                          isActive
                            ? "bg-blue-600/30 text-blue-300 shadow-lg shadow-blue-500/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                        )}>
                        <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-blue-400")} />
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
        <div className="px-4 py-3 border-t border-white/5">
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <Sparkles className="h-3 w-3" />
            <span>雏鹰之翼 © 2026 · 内部系统</span>
          </div>
        </div>
      </aside>
    </>
  );
}
