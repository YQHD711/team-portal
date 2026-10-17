"use client";

import Link from "next/link";
import { Menu, Sparkles, Sun, Moon, Monitor } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { GlobalSearch } from "./GlobalSearch";
import { useSidebar } from "./SidebarContext";
import { useBrand } from "@/lib/brand";
import { DEFAULT_SCHEME, applyScheme, nextScheme, readStoredScheme, schemeLabel, type SchemePreference } from "@/lib/scheme";

const pageTitles: Record<string, string> = {
  "/": "仪表盘", "/admin/knowledge": "知识库", "/inventory": "零件库存", "/flightlog": "飞行日志 / 固件", "/incidents": "事故安全",
};

export function Topbar() {
  const { setOpen } = useSidebar();
  const { teamName } = useBrand();
  const pathname = usePathname();
  const title = pageTitles[pathname] || (pathname.startsWith("/admin/knowledge") ? "知识库" : null);
  // SSR 一致性:首帧不读 localStorage(否则服务端 null vs 客户端 "light" 引发表单错位)
  // 初始态为 null,挂载后 useEffect 读 localStorage 同步 class
  const [scheme, setScheme] = useState<SchemePreference>(DEFAULT_SCHEME);

  useEffect(() => {
    // 首帧 class 由服务端按 cookie 渲染；这里只把客户端偏好同步进 state（不重复改 class，避免闪）
    setScheme(readStoredScheme());
  }, []);

  function toggleScheme() {
    // 三态循环：深色 → 浅色 → 跟随系统 → 深色（只动 class，不碰品牌主色的内联 style）
    const pref = nextScheme(scheme);
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyScheme(pref, systemDark);   // cookie + localStorage + 立即切 class
    setScheme(pref);
  }

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border-subtle glass">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(true)} className="rounded-xl p-2 hover:bg-surface-hover lg:hidden transition-colors" aria-label="打开菜单">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="hidden lg:flex items-center gap-2">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg text-white shrink-0"
            style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-sm gradient-text">{teamName}</span>
        </Link>
        {title && <h1 className="text-sm font-medium text-muted hidden sm:block">{title}</h1>}
      </div>

      <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-end">
        <button
          onClick={toggleScheme}
          className="rounded-xl p-2 hover:bg-surface-hover transition-colors"
          aria-label={`切换明暗（当前：${schemeLabel(scheme)}）`}
          title={`当前：${schemeLabel(scheme)} · 点击切换`}
        >
          {scheme === "light" ? <Sun className="h-5 w-5" /> : scheme === "auto" ? <Monitor className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        <GlobalSearch />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
