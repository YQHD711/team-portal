"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated, isStaff, isAdmin } from "@/lib/auth";

const PUBLIC_PATHS = ["/auth/login"];
const ADMIN_PATHS = ["/admin"];
const BAIDU_PATHS = ["/admin/cloud"];

/**
 * 「仅管理员」页面：侧边栏对部长隐藏，但 URL 直达此前只拦 /admin/cloud——
 * 部长输 URL 就能看到完整管理界面（随后 API 全 403 且前端静默吞掉）。
 * 这里把菜单「仅管理员可见」的路径统一收口（前端隐藏 + 前端拦截 + 后端 AdminOnly 三层）。
 */
const ADMIN_ONLY_PATHS = [
  "/admin/settings", "/admin/label-templates", "/admin/logs",
  "/admin/trash", "/admin/backup", "/admin/cloud", "/admin/ai-admin", "/admin/devices",
];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [authorized, setAuthorized] = useState(true);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) {
      setAuthorized(false);
      // 带上原目标：登录后回到刚才那一页。
      // 扫码进 /i/<编码> 时尤其重要 —— 否则未登录的队员扫完码、登录完会落在首页，
      // 而不是那件物料上。
      // 用 window.location 而不是 useSearchParams：这里本来就只在客户端 useEffect 里跑，
      // 也省掉 useSearchParams 需要 Suspense 边界的麻烦。
      const target = window.location.pathname + window.location.search;
      router.replace(`/auth/login?next=${encodeURIComponent(target)}`);
      return;
    }
    // Admin pages require staff role
    if (pathname.startsWith("/admin")) {
      if (ADMIN_ONLY_PATHS.some(p => pathname.startsWith(p))) {
        // 仅管理员页面：部长直达 URL 也拦回首页（与侧边栏菜单承诺一致）
        if (!isAdmin()) {
          setAuthorized(false);
          router.replace("/");
          return;
        }
      } else if (!isStaff()) {
        setAuthorized(false);
        router.replace("/");
        return;
      }
    }
    setAuthorized(true);
  }, [pathname, router]);

  // Always render children on server to match client — avoids hydration mismatch
  if (!mounted) return <>{children}</>;
  if (!authorized) return null;

  return <>{children}</>;
}
