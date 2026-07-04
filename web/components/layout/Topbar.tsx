"use client";

import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { UserMenu } from "./UserMenu";
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
        <UserMenu />
      </div>
    </header>
  );
}
