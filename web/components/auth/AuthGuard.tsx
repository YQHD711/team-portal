"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

const PUBLIC_PATHS = ["/auth/login"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/auth/login");
    }
  }, [pathname, router]);

  if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  return <>{children}</>;
}
