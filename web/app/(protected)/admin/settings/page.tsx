"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Settings, Save, Server, Database, Users, Package, Building2 } from "lucide-react";

interface Stats { userCount: number; inventoryCount: number; inventoryTotal: number; departmentCount: number; }

export default function SettingsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/admin/stats").then(setStats).catch(() => {});
  }, []);

  const statsCards = [
    { label: "用户总数", value: stats?.userCount ?? "—", icon: Users, color: "text-purple-600 bg-purple-100 dark:bg-purple-950" },
    { label: "部门数量", value: stats?.departmentCount ?? "—", icon: Building2, color: "text-sky-600 bg-sky-100 dark:bg-sky-950" },
    { label: "零件种类", value: stats?.inventoryCount ?? "—", icon: Package, color: "text-amber-600 bg-amber-100 dark:bg-amber-950" },
    { label: "零件总数", value: stats?.inventoryTotal ?? "—", icon: Database, color: "text-green-600 bg-green-100 dark:bg-green-950" },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div><h1 className="text-2xl font-bold tracking-tight">系统设置</h1><p className="text-sm text-zinc-500">系统概览与配置</p></div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statsCards.map(s => (
          <div key={s.label} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${s.color}`}><s.icon className="h-5 w-5" /></div>
            <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-zinc-500">{s.label}</div></div>
          </div>
        ))}
      </div>

      {/* System info */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        <div className="p-4 flex items-center gap-3">
          <Server className="h-5 w-5 text-zinc-400" />
          <div>
            <div className="font-medium text-sm">系统信息</div>
            <div className="text-xs text-zinc-500 mt-0.5 space-y-0.5">
              <div>后端：ASP.NET Core 10 + SQLite</div>
              <div>前端：Next.js 16 + Tailwind CSS 4</div>
              <div>AI 服务：Python FastAPI + DeepSeek</div>
            </div>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <Settings className="h-5 w-5 text-zinc-400" />
          <div>
            <div className="font-medium text-sm">环境配置</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              API 密钥、JWT Secret、管理账号等敏感配置请通过 <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">.env</code> 文件或环境变量设置。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
