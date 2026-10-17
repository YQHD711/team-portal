"use client";

/**
 * **Wiki 设置**（用户两次要求的「wiki导入和wiki设置合并」后的统一入口）。
 *
 * 两个页签：
 * - 生成参数：模型/超时/并行等（`WikiGenerationSettings`）
 * - 导入仓库：GitHub / ZIP 提交 + 任务队列（`WikiImportPanel`，原 `/wiki/import` 页面）
 *
 * `?tab=import` 可直达导入页签（老地址 `/wiki/import` 会带参跳到这里）。
 * 用 `window.location` 而不是 `useSearchParams`：后者在当前 Next 版本会让这页必须包 Suspense，
 * 而这里只是读一次初始值，没必要引入那层复杂度。
 */

import { useEffect, useState } from "react";
import { Settings2, Upload } from "lucide-react";
import { WikiGenerationSettings } from "@/components/wiki/WikiGenerationSettings";
import { WikiImportPanel } from "@/components/wiki/WikiImportPanel";

type Tab = "settings" | "import";

const TABS: { key: Tab; label: string; icon: typeof Settings2 }[] = [
  { key: "settings", label: "生成参数", icon: Settings2 },
  { key: "import", label: "导入仓库", icon: Upload },
];

const isTab = (v: string | null): v is Tab => v === "settings" || v === "import";

export default function WikiSettingsPage() {
  const [tab, setTab] = useState<Tab>("settings");

  // 初始页签从 URL 读（老 /wiki/import 会带 ?tab=import 过来）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (isTab(q)) setTab(q);
  }, []);

  const switchTab = (t: Tab) => {
    setTab(t);
    // 只改 URL 不整页跳转，刷新后仍停在同一个页签
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Wiki 设置</h1>
        <p className="text-sm text-muted mt-1">配置 AI 代码文档生成的参数，并导入要生成文档的仓库</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)} data-testid={`wiki-tab-${t.key}`}
            aria-selected={tab === t.key} role="tab"
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${tab === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "settings" ? <WikiGenerationSettings /> : <WikiImportPanel />}
    </div>
  );
}
