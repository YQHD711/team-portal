"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface PermissionValue {
  role: string | null;
  permissions: Set<string>;
  /** 是否已经拿到服务端权限（未拿到前 can 返回 true，避免菜单整块闪没） */
  ready: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PermissionValue>({
  role: null,
  permissions: new Set(),
  ready: false,
  can: () => true,
  refresh: async () => {},
});

/**
 * 当前用户的权限集合（服务端 /api/me/permissions）。
 *
 * 菜单与按钮按它渲染；真正的写操作仍由后端权限策略兜底——
 * 前端隐藏只是体验，不是安全边界。
 */
export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ role: string | null; permissions: string[] }>("/api/me/permissions");
      setRole(data.role);
      setPermissions(new Set(data.permissions ?? []));
    } catch {
      // 接口失败：保持"未知"状态，按可见处理，避免把整个导航锁死
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<PermissionValue>(() => ({
    role,
    permissions,
    ready,
    // 未加载完成时乐观放行，加载后按真实权限过滤
    // "*" 是测试/超级管理员的通配；正常接口返回显式权限列表
    can: (permission: string) => !ready || permissions.has("*") || permissions.has(permission),
    refresh,
  }), [role, permissions, ready, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions(): PermissionValue {
  return useContext(Ctx);
}
