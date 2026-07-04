"use client";

import { Menu, User, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useSidebar } from "./SidebarContext";

export function Topbar() {
  const { setOpen } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        {/* Placeholder user menu — will be replaced in Phase 1 */}
        <div className="flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-700">
          <User className="h-5 w-5 text-zinc-500" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400 hidden sm:block">
            未登录
          </span>
        </div>
      </div>
    </header>
  );
}
