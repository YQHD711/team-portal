"use client";

import { useState } from "react";
import { TextsTab } from "@/components/admin/content/TextsTab";
import { GuidesTab } from "@/components/admin/content/GuidesTab";
import { MessageSquareText, Route } from "lucide-react";

type Tab = "texts" | "guides";

/**
 * 内容管理（仅管理员）：界面文案 + 使用引导。
 *
 * 默认值都在代码里（web/lib/copy/catalog.ts、web/lib/tours/tours/*.ts），
 * 这里保存的是覆盖值；「恢复默认」= 删除覆盖行，不涉及数据迁移。
 */
export default function ContentAdminPage() {
  const [tab, setTab] = useState<Tab>("texts");

  const tabs: { key: Tab; label: string; icon: typeof MessageSquareText }[] = [
    { key: "texts", label: "界面文案", icon: MessageSquareText },
    { key: "guides", label: "使用引导", icon: Route },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 data-guide="page-content" className="text-xl font-semibold">内容管理</h1>
        <p className="mt-1 text-sm text-muted">
          界面文案与使用引导的默认值写在代码里，这里保存覆盖值；改坏了可以随时恢复默认，不会影响页面运行。
        </p>
      </div>

      <div className="flex gap-1 border-b border-border-subtle">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={
              "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm transition-colors " +
              (tab === key
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted hover:text-foreground")
            }>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === "texts" ? <TextsTab /> : <GuidesTab />}
    </div>
  );
}
