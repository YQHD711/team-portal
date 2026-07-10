"use client";

import Link from "next/link";
import { Menu, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { GlobalSearch } from "./GlobalSearch";
import { useSidebar } from "./SidebarContext";

const pageTitles: Record<string, string> = {
  "/": "仪表盘", "/knowledge": "知识库", "/inventory": "零件库存", "/flightlog": "飞行日志", "/incidents": "事故安全",
};

export function Topbar() {
  const { setOpen } = useSidebar();
  const pathname = usePathname();
  const title = pageTitles[pathname] || (pathname.startsWith("/knowledge") ? "知识库" : null);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-slate-200/60 dark:border-slate-800/60 glass">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(true)} className="rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden transition-colors" aria-label="打开菜单">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="hidden lg:flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-sm gradient-text">雏鹰之翼</span>
        </Link>
        {title && <h1 className="text-sm font-medium text-muted hidden sm:block">{title}</h1>}
      </div>

      <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-end">
        <GlobalSearch />
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
