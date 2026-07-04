"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { User, LogOut } from "lucide-react";
import { getToken, removeToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface UserInfo {
  id: number;
  username: string;
  role: string;
}

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .get<UserInfo>("/api/auth/me")
      .then(setUser)
      .catch(() => removeToken());
  }, []);

  const handleLogout = () => {
    removeToken();
    setUser(null);
    router.push("/auth/login");
  };

  if (!user) {
    return (
      <div className="flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-700">
        <User className="h-5 w-5 text-zinc-500" />
        <span className="text-sm text-zinc-600 dark:text-zinc-400 hidden sm:block">
          未登录
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-700">
      <User className="h-5 w-5 text-zinc-500" />
      <span className="text-sm text-zinc-600 dark:text-zinc-400 hidden sm:block">
        {user.username}
      </span>
      <button
        onClick={handleLogout}
        className="rounded-md p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        aria-label="Logout"
        title="退出登录"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
