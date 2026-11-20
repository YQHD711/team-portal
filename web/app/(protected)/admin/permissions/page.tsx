"use client";

import { PermissionMatrix } from "@/components/admin/permissions/PermissionMatrix";

/**
 * 权限管理（需要 admin.permissions.manage）：按角色勾选可用功能与操作。
 * 菜单会按这里的权限实时过滤；后端接口同样按权限校验，前端隐藏只是体验。
 */
export default function PermissionsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 data-guide="page-permissions" className="text-xl font-semibold">权限管理</h1>
        <p className="mt-1 text-sm text-muted">
          按角色调整可用的功能与操作。保存后立即生效，成员刷新页面即可看到新菜单。
        </p>
      </div>
      <PermissionMatrix />
    </div>
  );
}
