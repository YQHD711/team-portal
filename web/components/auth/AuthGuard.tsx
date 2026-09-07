"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated, isStaff, isAdmin } from "@/lib/auth";

const PUBLIC_PATHS = ["/auth/login", "/auth/register", "/auth/wechat/bind"];
const ADMIN_PATHS = ["/admin"];
const BAIDU_PATHS = ["/admin/cloud"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [authorized, setAuthorized] = useState(true);

  useEffect(() => {
    setMounted(true);

    // 微信回调落地：后端把正式 token 放进 /?token=...。进入守卫时先落盘，
    // 否则 isAuthenticated() 读到空 token 会把刚授权回来的用户弹回登录页。
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      if (urlToken) window.localStorage.setItem("token", urlToken);
    }

    if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) {
      setAuthorized(false);
      router.replace("/auth/login");
      return;
    }
    // Admin pages require staff role
    if (pathname.startsWith("/admin")) {
      if (BAIDU_PATHS.some(p => pathname.startsWith(p))) {
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
