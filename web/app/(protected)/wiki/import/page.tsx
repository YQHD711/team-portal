"use client";

/**
 * `/wiki/import` → `/admin/wiki-settings?tab=import`（**保留原查询参数**）。
 *
 * 用户要求「wiki导入和wiki设置合并」：导入不再是独立页面，但老链接/书签不能断。
 * 这里是过渡页，只做跳转，不渲染业务。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WikiImportRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const search = window.location.search;         // 形如 "?projectName=x"
    router.replace(`/admin/wiki-settings?tab=import${search ? `&${search.slice(1)}` : ""}`);
  }, [router]);
  return <div className="p-6 text-sm text-muted">「Wiki 导入」已并入「Wiki 设置」，正在跳转…</div>;
}
