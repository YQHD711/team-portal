"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

const PUBLIC_PATHS = ["/auth/login"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/auth/login");
    }
  }, [pathname, router]);

  // Always render children on server to match client — avoids hydration mismatch
  if (!mounted) return <>{children}</>;
  if (!isAuthenticated() && !PUBLIC_PATHS.includes(pathname)) return null;

  return <>{children}</>;
}
