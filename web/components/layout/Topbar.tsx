"use client";

import Link from "next/link";
import { Menu, Bird } from "lucide-react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { UserMenu } from "./UserMenu";
import { useSidebar } from "./SidebarContext";

const pageTitles: Record<string, string> = {
  "/": "仪表盘",
  "/knowledge": "知识库",
  "/inventory": "零件库存",
  "/flightlog": "飞行日志",
};

export function Topbar() {
  const { setOpen } = useSidebar();
  const pathname = usePathname();
  const title = pageTitles[pathname] || pathname.startsWith("/knowledge") ? "知识库" : null;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 lg:hidden transition-colors"
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* Mobile brand */}
        <Link href="/" className="flex items-center gap-2 lg:hidden">
          <Bird className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          <span className="font-semibold text-sm">雏鹰之翼</span>
        </Link>
        {title && (
          <h1 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 hidden sm:block">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
